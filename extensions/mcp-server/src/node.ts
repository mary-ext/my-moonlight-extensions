import { ipcRenderer } from 'electron';

import {
	IpcChannel,
	type LogPage,
	type LogQuery,
	type RendererInfo,
	type SaveMediaRequest,
} from './lib/ipc.ts';

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

/**
 * saves a temporary file, overwriting same-named files. files are removed when Discord exits.
 *
 * @param request download URL and file name
 * @returns absolute path in a private temporary directory
 * @throws on an invalid URL, download failure or write failure
 */
export const saveMedia = async (request: SaveMediaRequest): Promise<string> => {
	try {
		return await ipcRenderer.invoke(IpcChannel.SaveMedia, request);
	} catch (err) {
		// strip Electron's IPC error prefix from tool results
		const message = err instanceof Error ? err.message : String(err);
		throw new Error(message.replace(/^Error invoking remote method '[^']*': (?:Error: )?/, ''), {
			cause: err,
		});
	}
};

/** tells the MCP server this renderer is about to reload, so new tool calls wait for the next one */
export const leave = (): Promise<void> => {
	return ipcRenderer.invoke(IpcChannel.Leave);
};

/** relaunches Discord */
export const relaunch = (): Promise<void> => {
	return ipcRenderer.invoke(IpcChannel.Relaunch);
};
