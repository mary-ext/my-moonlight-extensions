import type { InstanceInfo, ToolInfo } from '@mary-ext/moonlight-mcp/types';

/** IPC channels between the preload and the main process */
export const IpcChannel = {
	/** starts console capture when the preload loads */
	Hook: 'mcpServer:hook',
	Attach: 'mcpServer:attach',
	GetLogs: 'mcpServer:getLogs',
	/** the renderer is about to reload, route new calls to its replacement */
	Leave: 'mcpServer:leave',
	Relaunch: 'mcpServer:relaunch',
} as const;

/** state the renderer reports to the main process whenever it attaches */
export interface RendererInfo {
	tools: ToolInfo[];
	instance: InstanceInfo;
}

/** console log levels, from least to most severe */
export const LOG_LEVELS = ['debug', 'info', 'warning', 'error'] as const;

/** a console log level */
export type LogLevel = (typeof LOG_LEVELS)[number];

/** a captured console message */
export interface LogEntry {
	id: number;
	level: LogLevel;
	message: string;
	/** `<file>:<line>` the message was logged from */
	source?: string;
}

/** query for captured console messages */
export interface LogQuery {
	/** only return messages newer than this ID */
	sinceId: number;
	/** minimum level */
	level: LogLevel;
	/** case-insensitive substring filter */
	filter?: string;
	/** return at most this many of the newest matching messages */
	limit: number;
}

/** captured console messages matching a {@link LogQuery} */
export interface LogPage {
	entries: LogEntry[];
	/** ID of the newest captured message, to pass as `sinceId` next time */
	nextId: number;
	/** how many messages after `sinceId` were dropped from the buffer before they could be read */
	dropped: number;
}

/** global symbol key for the renderer's tool bridge */
export const BRIDGE_KEY = 'mcpServer.bridge';
