// MCP initialization, tools and cancellation over newline-delimited JSON-RPC.

import type { CallToolResult, ToolInfo } from './types.ts';

// newest first, used as the fallback during negotiation
const SUPPORTED_PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];

const MAX_LINE_LENGTH = 32 * 1024 * 1024;

/** JSON-RPC error codes */
export const ErrorCode = {
	ParseError: -32700,
	InvalidRequest: -32600,
	MethodNotFound: -32601,
	InvalidParams: -32602,
	InternalError: -32603,
} as const;

/** a JSON-RPC request ID */
export type RequestId = string | number;

/** a JSON-RPC message of any kind */
export interface Message {
	jsonrpc: '2.0';
	id?: RequestId | null;
	method?: string;
	params?: any;
	result?: any;
	error?: { code: number; message: string };
}

/** identifies the server in the initialize handshake */
export interface ServerInfo {
	name: string;
	version: string;
	title?: string;
}

/** provides the tools a session serves */
export interface ToolHost {
	listTools(): ToolInfo[] | Promise<ToolInfo[]>;
	callTool(name: string, args: Record<string, unknown>, signal: AbortSignal): Promise<CallToolResult>;
}

/** options for {@link McpSession} */
export interface ServerOptions {
	info: ServerInfo;
	instructions?: string;
	host: ToolHost;
}

/** readable stream interface for `net.Socket` and `process.stdin` */
export interface LineSource {
	setEncoding(encoding: 'utf8'): unknown;
	on(event: 'data', listener: (chunk: string) => void): unknown;
}

/** writable stream interface for `net.Socket` and `process.stdout` */
export interface LineSink {
	write(data: string): unknown;
}

/** duplex stream interface for `net.Socket` */
export interface ByteStream extends LineSource, LineSink {
	readonly destroyed: boolean;
	destroy(): unknown;
	on(event: 'data', listener: (chunk: string) => void): unknown;
	on(event: 'close' | 'error', listener: () => void): unknown;
}

class RpcError extends Error {
	code: number;

	constructor(code: number, message: string) {
		super(message);
		this.code = code;
	}
}

/**
 * splits a stream into newline-delimited messages.
 *
 * @param stream stream to read from; its encoding is set to UTF-8
 * @param onLine called with each non-empty line, trimmed
 * @param onOverflow called after discarding an unterminated buffer over `2 ** 25` UTF-16 code units
 */
export const readLines = (
	stream: LineSource,
	onLine: (line: string) => void,
	onOverflow?: () => void,
): void => {
	let buffer = '';
	stream.setEncoding('utf8');
	stream.on('data', (chunk) => {
		buffer += chunk;

		let newline: number;
		while ((newline = buffer.indexOf('\n')) !== -1) {
			const line = buffer.slice(0, newline).trim();
			buffer = buffer.slice(newline + 1);
			if (line) {
				onLine(line);
			}
		}

		if (buffer.length > MAX_LINE_LENGTH) {
			buffer = '';
			onOverflow?.();
		}
	});
};

/**
 * writes a JSON-RPC message followed by a newline.
 *
 * @param stream stream to write to
 * @param message message to send
 */
export const writeMessage = (stream: LineSink, message: Message): void => {
	stream.write(JSON.stringify(message) + '\n');
};

/**
 * builds the result of an initialize request.
 *
 * @param requestedVersion protocol version the client asked for
 * @param info server identity
 * @param instructions usage instructions for the model
 * @returns the initialize result, using the newest supported version if the requested one is unsupported
 */
export const initializeResult = (requestedVersion: unknown, info: ServerInfo, instructions?: string) => {
	const protocolVersion =
		typeof requestedVersion === 'string' && SUPPORTED_PROTOCOL_VERSIONS.includes(requestedVersion)
			? requestedVersion
			: SUPPORTED_PROTOCOL_VERSIONS[0];

	return {
		protocolVersion,
		capabilities: { tools: { listChanged: true } },
		serverInfo: info,
		instructions,
	};
};

/**
 * builds a tool result holding a single text block.
 *
 * @param text text content
 * @returns the tool result
 */
export const textResult = (text: string): CallToolResult => {
	return { content: [{ type: 'text', text }] };
};

/**
 * builds an MCP tool error result.
 *
 * @param e error message, or a thrown value; errors are shown with their stack
 * @returns the tool result
 */
export const errorResult = (e: unknown): CallToolResult => {
	const text = e instanceof Error ? (e.stack ?? e.message) : String(e);
	return { content: [{ type: 'text', text }], isError: true };
};

/** serves MCP over a single connection */
export class McpSession {
	#initialized = false;
	readonly #inFlight = new Map<RequestId, AbortController>();
	readonly #stream: ByteStream;
	readonly #options: ServerOptions;

	/**
	 * @param stream connection to serve; it's destroyed on protocol violations
	 * @param options server identity and tools
	 */
	constructor(stream: ByteStream, options: ServerOptions) {
		this.#stream = stream;
		this.#options = options;

		readLines(
			stream,
			(line) => void this.#onLine(line),
			() => {
				this.#sendError(null, ErrorCode.InvalidRequest, 'Message too large');
				stream.destroy();
			},
		);
		stream.on('error', () => stream.destroy());
		stream.on('close', () => {
			for (const controller of this.#inFlight.values()) {
				controller.abort(new Error('Connection closed'));
			}
			this.#inFlight.clear();
		});
	}

	/** tells the client to refetch the tool list, once it has finished initializing */
	notifyToolsChanged(): void {
		if (this.#initialized) {
			this.#send({ jsonrpc: '2.0', method: 'notifications/tools/list_changed' });
		}
	}

	/** closes the connection, aborting in-flight calls */
	close(): void {
		this.#stream.destroy();
	}

	#send(message: Message): void {
		if (!this.#stream.destroyed) {
			writeMessage(this.#stream, message);
		}
	}

	#sendError(id: RequestId | null, code: number, message: string): void {
		this.#send({ jsonrpc: '2.0', id, error: { code, message } });
	}

	async #onLine(line: string): Promise<void> {
		let message: any;
		try {
			message = JSON.parse(line);
		} catch {
			this.#sendError(null, ErrorCode.ParseError, 'Parse error');
			return;
		}

		if (Array.isArray(message)) {
			this.#sendError(null, ErrorCode.InvalidRequest, 'Batching is not supported');
			return;
		}

		if (message?.jsonrpc !== '2.0' || typeof message.method !== 'string') {
			// responses to server-to-client requests; we never send any
			if (message && 'id' in message && ('result' in message || 'error' in message)) {
				return;
			}
			this.#sendError(message?.id ?? null, ErrorCode.InvalidRequest, 'Invalid Request');
			return;
		}

		const { id, method, params = {} } = message;

		if (id == null) {
			this.#onNotification(method, params);
			return;
		}

		try {
			const result = await this.#onRequest(id, method, params);
			this.#send({ jsonrpc: '2.0', id, result });
		} catch (e) {
			if (e instanceof RpcError) {
				this.#sendError(id, e.code, e.message);
			} else {
				this.#sendError(id, ErrorCode.InternalError, e instanceof Error ? e.message : String(e));
			}
		}
	}

	#onNotification(method: string, params: any): void {
		switch (method) {
			case 'notifications/initialized': {
				this.#initialized = true;
				break;
			}
			case 'notifications/cancelled': {
				this.#inFlight.get(params.requestId)?.abort(new Error(params.reason ?? 'Cancelled'));
				break;
			}
		}
	}

	async #onRequest(id: RequestId, method: string, params: any): Promise<object> {
		switch (method) {
			case 'initialize': {
				return initializeResult(params.protocolVersion, this.#options.info, this.#options.instructions);
			}
			case 'ping': {
				return {};
			}
			case 'tools/list': {
				return { tools: await this.#options.host.listTools() };
			}
			case 'tools/call': {
				if (typeof params.name !== 'string') {
					throw new RpcError(ErrorCode.InvalidParams, 'Missing tool name');
				}

				const tools = await this.#options.host.listTools();
				if (!tools.some((t) => t.name === params.name)) {
					throw new RpcError(ErrorCode.InvalidParams, `Unknown tool: ${params.name}`);
				}

				const controller = new AbortController();
				this.#inFlight.set(id, controller);
				try {
					return await this.#options.host.callTool(params.name, params.arguments ?? {}, controller.signal);
				} catch (e) {
					return errorResult(e);
				} finally {
					this.#inFlight.delete(id);
				}
			}
			default: {
				throw new RpcError(ErrorCode.MethodNotFound, `Method not found: ${method}`);
			}
		}
	}
}
