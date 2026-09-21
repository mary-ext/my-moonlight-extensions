import * as fs from 'node:fs';
import * as net from 'node:net';
import * as path from 'node:path';

import {
	SOCKET_IS_FILE,
	getDiscoveryDir,
	getMetadataPath,
	getSocketPath,
	removeInstanceFiles,
} from '@mary-ext/moonlight-mcp/discovery';
import { McpSession, type ToolHost } from '@mary-ext/moonlight-mcp/protocol';
import type { CallToolResult, InstanceMetadata } from '@mary-ext/moonlight-mcp/types';

import { type WebContents, app, ipcMain } from 'electron';

import {
	BRIDGE_KEY,
	IpcChannel,
	LOG_LEVELS,
	type LogEntry,
	type LogLevel,
	type LogPage,
	type LogQuery,
	type RendererInfo,
} from './lib/ipc.ts';
import { truncate } from './lib/text.ts';

const logger = moonlightHost.getLogger('mcpServer/host');

const RENDERER_WAIT_TIMEOUT = 30_000;
const CALL_TIMEOUT = 5 * 60_000;
const STARTED_AT = Date.now();

// #region console capture

const MAX_LOG_ENTRIES = 5000;
// trim in batches so a full buffer doesn't shift thousands of entries on every message
const LOG_TRIM_BATCH = 500;
const MAX_LOG_MESSAGE = 4000;

const logs: LogEntry[] = [];
let nextLogId = 1;

const onConsoleMessage = (
	event: any,
	legacyLevel?: number,
	legacyMessage?: string,
	legacyLine?: number,
	legacySourceId?: string,
) => {
	// newer Electron versions pass the details on the event, older ones as positional arguments
	const level: LogLevel =
		typeof event.level === 'string' ? event.level : (LOG_LEVELS[legacyLevel ?? 1] ?? 'info');
	const rawMessage: string = event.message ?? legacyMessage ?? '';
	const sourceId: string | undefined = event.sourceId ?? legacySourceId;
	const line: number | undefined = event.lineNumber ?? legacyLine;

	// Chromium appends %c style arguments to the message; remove the corresponding CSS blocks
	let message = rawMessage;
	const styleCount = rawMessage.match(/%c/g)?.length ?? 0;
	if (styleCount) {
		let removed = 0;
		message = message
			.replaceAll('%c', '')
			// Discord's own logger spreads its CSS over several lines
			.replace(/(?:\s*[a-z-]+:\s*[^;]*;)+\s*/g, (css) => (removed++ < styleCount ? ' ' : css))
			.replace(/ {2,}/g, ' ');
	}
	message = truncate(message.trim(), MAX_LOG_MESSAGE);

	const source = sourceId ? `${path.posix.basename(sourceId)}:${line}` : undefined;

	logs.push({ id: nextLogId++, level, message, source });
	if (logs.length > MAX_LOG_ENTRIES + LOG_TRIM_BATCH) {
		logs.splice(0, logs.length - MAX_LOG_ENTRIES);
	}
};

const getLogs = ({ sinceId, level, filter, limit }: LogQuery): LogPage => {
	const minLevel = LOG_LEVELS.indexOf(level);
	const needle = filter?.toLowerCase();

	const matching = logs.filter(
		(e) =>
			e.id > sinceId &&
			LOG_LEVELS.indexOf(e.level) >= minLevel &&
			(!needle || e.message.toLowerCase().includes(needle)),
	);

	let dropped = 0;
	if (logs.length && sinceId < logs[0].id - 1) {
		dropped = logs[0].id - 1 - sinceId;
	}

	return { entries: matching.slice(-limit), nextId: nextLogId - 1, dropped };
};

// #endregion

// #region renderer tracking

let renderer: WebContents | null = null;
/** a renderer that's about to reload or relaunch */
let leaving: WebContents | null = null;
let rendererInfo: RendererInfo | null = null;
let rendererWaiters: Array<() => void> = [];
let detachListeners: Array<(reason: Error) => void> = [];
let hooked: { wc: WebContents; unhook(): void } | null = null;

const onRendererGone = (wc: WebContents, reason: string) => {
	if (renderer !== wc) {
		return;
	}

	renderer = null;
	const listeners = detachListeners;
	detachListeners = [];
	for (const listener of listeners) {
		listener(new Error(`Renderer ${reason} during the call`));
	}
};

const unhookContents = () => {
	hooked?.unhook();
	hooked = null;
};

const hookContents = (wc: WebContents) => {
	if (hooked?.wc === wc) {
		return;
	}
	unhookContents();

	// isInPlace is true for same-document navigations (history.pushState), which Discord uses for routing
	const onNavigation = (_e: unknown, _url: string, isInPlace: boolean, isMainFrame: boolean) => {
		if (isMainFrame && !isInPlace) {
			onRendererGone(wc, 'reloaded');
		}
	};
	const onCrash = () => {
		onRendererGone(wc, 'crashed');
	};
	const onDestroyed = () => {
		onRendererGone(wc, 'was destroyed');
		unhookContents();
	};

	wc.on('console-message', onConsoleMessage);
	wc.on('did-start-navigation', onNavigation);
	wc.on('render-process-gone', onCrash);
	wc.on('destroyed', onDestroyed);

	hooked = {
		wc,
		unhook() {
			if (wc.isDestroyed()) {
				return;
			}
			wc.off('console-message', onConsoleMessage);
			wc.off('did-start-navigation', onNavigation);
			wc.off('render-process-gone', onCrash);
			wc.off('destroyed', onDestroyed);
		},
	};
};

const waitForRenderer = (signal: AbortSignal) => {
	// let the departing renderer finish existing calls; new calls wait for its replacement
	if (renderer && renderer !== leaving) {
		return Promise.resolve(renderer);
	}

	return new Promise<WebContents>((resolve, reject) => {
		const timeout = setTimeout(() => {
			cleanup();
			reject(new Error(`Discord's renderer is unavailable. Check that mcpServer is enabled.`));
		}, RENDERER_WAIT_TIMEOUT);

		const onReady = () => {
			cleanup();
			resolve(renderer!);
		};
		const onAbort = () => {
			cleanup();
			reject(signal.reason);
		};
		const cleanup = () => {
			clearTimeout(timeout);
			rendererWaiters = rendererWaiters.filter((w) => w !== onReady);
			signal.removeEventListener('abort', onAbort);
		};

		rendererWaiters.push(onReady);
		signal.addEventListener('abort', onAbort);
	});
};

// #endregion

// #region server

let server: net.Server | null = null;
let discoveryDir: string | null = null;
let socketPath: string | null = null;
const sessions = new Set<McpSession>();

const toolHost: ToolHost = {
	listTools() {
		return rendererInfo?.tools ?? [];
	},

	async callTool(name, args, signal) {
		const wc = await waitForRenderer(signal);

		const call: Promise<CallToolResult> = wc.executeJavaScript(
			`globalThis[Symbol.for(${JSON.stringify(BRIDGE_KEY)})].handleCall(${JSON.stringify(name)}, ${JSON.stringify(args)})`,
		);

		let cleanup!: () => void;
		const interrupted = new Promise<never>((_, reject) => {
			const timeout = setTimeout(() => {
				reject(new Error(`Tool call timed out after ${CALL_TIMEOUT / 1000}s`));
			}, CALL_TIMEOUT);
			const onAbort = () => reject(signal.reason);
			const onDetach = (reason: Error) => reject(reason);

			signal.addEventListener('abort', onAbort);
			detachListeners.push(onDetach);

			cleanup = () => {
				clearTimeout(timeout);
				signal.removeEventListener('abort', onAbort);
				detachListeners = detachListeners.filter((l) => l !== onDetach);
			};
		});

		try {
			return await Promise.race([call, interrupted]);
		} finally {
			cleanup();
		}
	},
};

const ensureDiscoveryDir = () => {
	const dir = getDiscoveryDir();
	fs.mkdirSync(dir, { recursive: true, mode: 0o700 });

	// socket access permits code execution; restrict discovery to the current user
	if (SOCKET_IS_FILE) {
		const stat = fs.statSync(dir);
		if (stat.uid !== process.getuid!() || (stat.mode & 0o077) !== 0) {
			throw new Error(
				`Discovery directory ${dir} must belong to the current user with no group or other permissions`,
			);
		}
	}

	return dir;
};

const writeMetadata = ({ instance }: RendererInfo) => {
	const metadata: InstanceMetadata = {
		formatVersion: 1,
		pid: process.pid,
		socket: socketPath!,
		startedAt: STARTED_AT,
		...instance,
	};

	// publish metadata atomically, after the socket starts listening
	const metadataPath = getMetadataPath(discoveryDir!, process.pid);
	const tmp = `${metadataPath}.tmp`;
	fs.writeFileSync(tmp, JSON.stringify(metadata, null, '\t'), { mode: 0o600 });
	fs.renameSync(tmp, metadataPath);
};

const startServer = () => {
	const dir = (discoveryDir = ensureDiscoveryDir());
	socketPath = getSocketPath(dir, process.pid);

	// remove leftovers from PID reuse
	removeInstanceFiles(dir, process.pid);

	const srv = (server = net.createServer((socket) => {
		const session = new McpSession(socket, {
			info: {
				name: 'moonlight',
				title: 'moonlight',
				version: rendererInfo?.instance.moonlightVersion ?? 'unknown',
			},
			host: toolHost,
		});
		sessions.add(session);
		socket.on('close', () => sessions.delete(session));
	}));

	srv.on('error', (err) => logger.error('server error', err));
	srv.listen(socketPath, () => {
		if (SOCKET_IS_FILE) {
			fs.chmodSync(socketPath!, 0o600);
		}
		if (rendererInfo) {
			writeMetadata(rendererInfo);
		}
		logger.info('listening on', socketPath);
	});
};

const stopServer = () => {
	for (const session of sessions) {
		session.close();
	}
	sessions.clear();

	server?.close();
	server = null;

	if (discoveryDir !== null) {
		removeInstanceFiles(discoveryDir, process.pid);
	}
	discoveryDir = socketPath = null;
};

process.on('exit', stopServer);

// #endregion

// #region ipc

const attach = (wc: WebContents, info: RendererInfo) => {
	const toolsChanged = JSON.stringify(rendererInfo?.tools) !== JSON.stringify(info.tools);

	renderer = wc;
	leaving = null;
	rendererInfo = info;
	hookContents(wc);

	if (!server) {
		startServer();
	} else {
		if (server.listening) {
			writeMetadata(info);
		}
		if (toolsChanged) {
			for (const session of sessions) {
				session.notifyToolsChanged();
			}
		}
	}

	const waiters = rendererWaiters;
	rendererWaiters = [];
	for (const waiter of waiters) {
		waiter();
	}

	return socketPath;
};

ipcMain.on(IpcChannel.Hook, (e) => hookContents(e.sender));
ipcMain.handle(IpcChannel.Attach, (e, info: RendererInfo) => attach(e.sender, info));
ipcMain.handle(IpcChannel.GetLogs, (_e, query: LogQuery) => getLogs(query));
ipcMain.handle(IpcChannel.Leave, (e) => {
	leaving = e.sender;
});
ipcMain.handle(IpcChannel.Relaunch, () => {
	app.relaunch();
	app.exit(0);
});

// #endregion
