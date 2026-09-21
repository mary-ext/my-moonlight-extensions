#!/usr/bin/env node

// stdio-to-socket MCP bridge; replays initialization when reconnecting after a Discord restart.

import * as fs from 'node:fs';
import * as net from 'node:net';
import * as path from 'node:path';
import { parseArgs } from 'node:util';

import { getDiscoveryDir, isMetadataFileName, removeInstanceFiles } from './discovery.ts';
import {
	ErrorCode,
	type Message,
	type RequestId,
	errorResult,
	initializeResult,
	readLines,
	textResult,
	writeMessage,
} from './protocol.ts';
import type { CallToolResult, InstanceMetadata, ToolInfo } from './types.ts';

const POLL_INTERVAL = 1000;
const INITIAL_CONNECT_WAIT = 3000;
const REQUEST_WAIT = 30_000;
const SHIM_ID_PREFIX = 'moonlight-mcp:';

const HELP = `\
usage: moonlight-mcp [options]

bridges an MCP client over stdio to a Discord instance running moonlight's mcpServer extension.

options:
  --pid <pid>          only connect to this process
  --channel <name>     only connect to this release channel (stable, ptb, canary)
  --dir <path>         discovery directory (default: $MOONLIGHT_MCP_DIR, $XDG_RUNTIME_DIR/moonlight-mcp
                       or <tmpdir>/moonlight-mcp-<user>)
  -h, --help           show this help
`;

interface Connection {
	meta: InstanceMetadata;
	socket: net.Socket;
	ready: boolean;
	/** the client initialized this connection directly; forward its initialized notification */
	directHandshake?: boolean;
}

const { values: args } = parseArgs({
	options: {
		pid: { type: 'string' },
		channel: { type: 'string' },
		dir: { type: 'string' },
		help: { type: 'boolean', short: 'h' },
	},
});

if (args.help) {
	process.stdout.write(HELP);
	process.exit(0);
}

const discoveryDir = args.dir ?? getDiscoveryDir();

const log = (...parts: unknown[]) => {
	process.stderr.write(`[moonlight-mcp] ${parts.join(' ')}\n`);
};

// #region instances

const isAlive = (pid: number) => {
	try {
		process.kill(pid, 0);
		return true;
	} catch (e) {
		// the process exists but belongs to someone else
		return e instanceof Error && 'code' in e && e.code === 'EPERM';
	}
};

const listInstances = () => {
	let files: string[];
	try {
		files = fs.readdirSync(discoveryDir);
	} catch {
		return [];
	}

	const instances: InstanceMetadata[] = [];
	for (const file of files) {
		if (!isMetadataFileName(file)) {
			continue;
		}

		try {
			const meta: InstanceMetadata = JSON.parse(fs.readFileSync(path.join(discoveryDir, file), 'utf8'));
			if (isAlive(meta.pid)) {
				instances.push(meta);
			} else {
				removeInstanceFiles(discoveryDir, meta.pid);
			}
		} catch {}
	}

	return instances.toSorted((a, b) => b.startedAt - a.startedAt);
};

let pinnedPid = args.pid ? Number(args.pid) : null;

const pickInstance = (exclude: Set<number>) => {
	return listInstances().find(
		(meta) =>
			!exclude.has(meta.pid) &&
			(pinnedPid == null || meta.pid === pinnedPid) &&
			(!args.channel || meta.releaseChannel === args.channel),
	);
};

// #endregion

const sendToClient = (message: Message) => {
	writeMessage(process.stdout, message);
};

// #region shim tools

const SHIM_TOOLS: ToolInfo[] = [
	{
		name: 'list_instances',
		description: 'List running Discord instances and which one is connected.',
		inputSchema: { type: 'object', properties: {} },
		annotations: { readOnlyHint: true },
	},
	{
		name: 'select_instance',
		description: 'Switch the connected Discord instance.',
		inputSchema: {
			type: 'object',
			properties: {
				pid: { type: 'integer', description: 'Process ID; 0 resumes selecting the newest instance' },
			},
			required: ['pid'],
		},
	},
];

const callShimTool = (name: string, toolArgs: any): CallToolResult => {
	switch (name) {
		case 'select_instance': {
			const pid = Number(toolArgs?.pid);
			pinnedPid = pid || null;
			if (pid && !listInstances().some((meta) => meta.pid === pid)) {
				return errorResult(`No running instance with pid ${pid}`);
			}

			current?.socket.destroy();
			return textResult(pid ? `Switching to pid ${pid}` : `Switching to the newest instance`);
		}
		case 'list_instances': {
			const instances = listInstances();
			if (!instances.length) {
				return textResult(`No instances found in ${discoveryDir}. Start Discord with mcpServer enabled.`);
			}

			const lines = instances.map((meta) => {
				const marker = meta.pid === current?.meta.pid ? '* ' : '  ';
				return `${marker}pid ${meta.pid}: ${meta.releaseChannel}, build ${meta.buildNumber}, moonlight ${meta.moonlightVersion} (${meta.moonlightBranch})`;
			});
			return textResult(lines.join('\n'));
		}
		default: {
			return errorResult(`Unknown tool: ${name}`);
		}
	}
};

// #endregion

// #region server side (socket)

let current: Connection | null = null;
/** the client's initialize request, replayed on every new connection */
let clientInitialize: Message | null = null;
let clientInitialized = false;
let shimIdCounter = 0;

/** unanswered request IDs and methods */
const pending = new Map<RequestId, string>();
/** client messages waiting for a connection */
let queue: Array<{ message: Message; at: number }> = [];
const readyWaiters = new Set<() => void>();

const onReady = () => {
	for (const waiter of readyWaiters) {
		waiter();
	}
	readyWaiters.clear();

	const queued = queue;
	queue = [];
	for (const { message } of queued) {
		forwardToServer(message);
	}
};

const waitForReady = (timeout: number) => {
	if (current?.ready) {
		return Promise.resolve(true);
	}

	return new Promise<boolean>((resolve) => {
		const waiter = () => {
			clearTimeout(timer);
			resolve(true);
		};
		const timer = setTimeout(() => {
			readyWaiters.delete(waiter);
			resolve(false);
		}, timeout);
		readyWaiters.add(waiter);
	});
};

const forwardToServer = (message: Message) => {
	if (!current?.ready) {
		queue.push({ message, at: Date.now() });
		return;
	}

	if (message.id != null && message.method) {
		pending.set(message.id, message.method);
	}
	writeMessage(current.socket, message);
};

const onServerMessage = (conn: Connection, message: Message) => {
	// consume replay responses instead of forwarding them to the client
	if (typeof message.id === 'string' && message.id.startsWith(SHIM_ID_PREFIX)) {
		if (message.error) {
			log('server rejected initialize:', message.error.message);
			conn.socket.destroy();
			return;
		}

		writeMessage(conn.socket, { jsonrpc: '2.0', method: 'notifications/initialized' });
		conn.ready = true;
		onReady();

		// tools may differ between instances
		if (clientInitialized) {
			sendToClient({ jsonrpc: '2.0', method: 'notifications/tools/list_changed' });
		}
		return;
	}

	if (message.id != null && ('result' in message || 'error' in message)) {
		const method = pending.get(message.id);
		pending.delete(message.id);

		if (method === 'initialize' && message.result) {
			conn.ready = true;
			onReady();
		}
		if (method === 'tools/list' && message.result?.tools) {
			message.result.tools = [...message.result.tools, ...SHIM_TOOLS];
		}
	}

	sendToClient(message);
};

// MCP distinguishes tool errors from protocol errors.
const failRequest = (id: RequestId, method: string | undefined, text: string) => {
	if (method === 'tools/call') {
		sendToClient({ jsonrpc: '2.0', id, result: errorResult(text) });
	} else {
		sendToClient({ jsonrpc: '2.0', id, error: { code: ErrorCode.InternalError, message: text } });
	}
};

const onDisconnect = (conn: Connection) => {
	if (current !== conn) {
		return;
	}

	current = null;
	log(`disconnected from pid ${conn.meta.pid}`);

	for (const [id, method] of pending) {
		failRequest(id, method, `Discord disconnected during the call. Retry after it reconnects.`);
	}
	pending.clear();

	if (clientInitialized && !closing) {
		sendToClient({ jsonrpc: '2.0', method: 'notifications/tools/list_changed' });
	}
};

let connecting = false;
let closing = false;

const tryConnect = () => {
	if (current || connecting || closing) {
		return;
	}

	const failed = new Set<number>();
	const attempt = () => {
		const meta = pickInstance(failed);
		if (!meta) {
			connecting = false;
			return;
		}

		const socket = net.connect(meta.socket);
		const conn: Connection = { meta, socket, ready: false };

		socket.once('connect', () => {
			connecting = false;
			current = conn;
			log(`connected to pid ${meta.pid} (${meta.releaseChannel})`);

			readLines(socket, (line) => {
				try {
					onServerMessage(conn, JSON.parse(line));
				} catch (e) {
					log('bad message from server:', e);
				}
			});

			// initialize the new connection without involving the client again
			if (clientInitialize) {
				writeMessage(socket, { ...clientInitialize, id: `${SHIM_ID_PREFIX}${++shimIdCounter}` });
			} else {
				conn.ready = true;
				onReady();
			}
		});

		socket.on('error', (err: NodeJS.ErrnoException) => {
			if (current === conn) {
				return;
			}

			failed.add(meta.pid);
			// metadata is written after listen; an absent socket indicates stale metadata, e.g. PID reuse
			if (err.code === 'ENOENT' || err.code === 'ECONNREFUSED') {
				removeInstanceFiles(discoveryDir, meta.pid);
			} else {
				log(`failed to connect to pid ${meta.pid}: ${err.message}`);
			}
			attempt();
		});

		socket.on('close', () => onDisconnect(conn));
	};

	connecting = true;
	attempt();
};

setInterval(() => {
	tryConnect();

	const now = Date.now();
	queue = queue.filter(({ message, at }) => {
		if (now - at < REQUEST_WAIT) {
			return true;
		}
		if (message.id != null) {
			failRequest(
				message.id,
				message.method,
				`No Discord instance with the mcpServer extension is running (looked in ${discoveryDir}).`,
			);
		}
		return false;
	});
}, POLL_INTERVAL).unref();

// #endregion

// #region client side (stdio)

const onClientMessage = async (message: Message) => {
	const { id, method, params } = message;

	switch (method) {
		case 'initialize': {
			// only set after waiting, so a connection made in the meantime doesn't also replay the handshake
			const ready = await waitForReady(INITIAL_CONNECT_WAIT);
			clientInitialize = { jsonrpc: '2.0', method, params };

			if (ready) {
				current!.directHandshake = true;
				forwardToServer(message);
			} else {
				sendToClient({
					jsonrpc: '2.0',
					id,
					result: initializeResult(
						params?.protocolVersion,
						{ name: 'moonlight', title: 'moonlight', version: 'shim' },
						`No Discord instance is running yet; tools appear once Discord starts with the mcpServer extension enabled.`,
					),
				});
			}
			return;
		}
		case 'notifications/initialized': {
			clientInitialized = true;
			// a replayed handshake already sent initialized itself
			if (current?.directHandshake) {
				forwardToServer(message);
			}
			return;
		}
	}

	if (id != null && !current?.ready) {
		switch (method) {
			case 'ping': {
				sendToClient({ jsonrpc: '2.0', id, result: {} });
				return;
			}
			case 'tools/list': {
				sendToClient({ jsonrpc: '2.0', id, result: { tools: SHIM_TOOLS } });
				return;
			}
		}
	}

	if (id != null && method === 'tools/call' && SHIM_TOOLS.some((t) => t.name === params?.name)) {
		sendToClient({ jsonrpc: '2.0', id, result: callShimTool(params.name, params.arguments) });
		return;
	}

	// notifications (e.g. cancellations) are only meaningful to the connection they were meant for
	if (id == null && !current?.ready) {
		return;
	}

	forwardToServer(message);
};

/** client messages still being handled, e.g. an initialize waiting for Discord */
const handling = new Set<Promise<void>>();

readLines(process.stdin, (line) => {
	let message: Message;
	try {
		message = JSON.parse(line);
	} catch {
		sendToClient({ jsonrpc: '2.0', id: null, error: { code: ErrorCode.ParseError, message: 'Parse error' } });
		return;
	}

	const task = onClientMessage(message).finally(() => handling.delete(task));
	handling.add(task);
});

// finish pending requests after stdin closes; let the event loop drain to flush stdout
process.stdin.on('end', () => {
	closing = true;

	const deadline = Date.now() + REQUEST_WAIT;
	const shutdown = setInterval(() => {
		const outstanding = handling.size || pending.size || queue.some(({ message }) => message.id != null);
		if (outstanding && Date.now() < deadline) {
			return;
		}

		clearInterval(shutdown);
		current?.socket.destroy();
	}, 50);
});

tryConnect();

// #endregion
