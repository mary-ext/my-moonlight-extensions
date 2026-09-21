import { ipcRenderer } from 'electron';

import { IpcChannel, type LogPage, type LogQuery, type RendererInfo } from './lib/ipc.ts';

ipcRenderer.send(IpcChannel.Hook);

/**
 * registers this renderer with the MCP server in the main process, starting the server if needed.
 *
 * @param info tools and instance metadata
 * @returns the socket path the server listens on
 */
export const attach = (info: RendererInfo): Promise<string> => {
	return ipcRenderer.invoke(IpcChannel.Attach, info);
};

/**
 * reads console output captured in the main process.
 *
 * @param query which messages to return
 * @returns the matching messages
 */
export const getLogs = (query: LogQuery): Promise<LogPage> => {
	return ipcRenderer.invoke(IpcChannel.GetLogs, query);
};

/** tells the MCP server this renderer is about to reload, so new tool calls wait for the next one */
export const leave = (): Promise<void> => {
	return ipcRenderer.invoke(IpcChannel.Leave);
};

/** relaunches Discord */
export const relaunch = (): Promise<void> => {
	return ipcRenderer.invoke(IpcChannel.Relaunch);
};
