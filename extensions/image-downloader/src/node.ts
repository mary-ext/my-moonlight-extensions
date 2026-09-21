import { ipcRenderer } from 'electron';

import { DOWNLOAD_CHANNEL } from './lib/ipc.ts';

/**
 * downloads a Discord CDN attachment into the configured directory.
 *
 * @param url attachment link on Discord's CDN
 * @returns path of the saved file; existing files are never overwritten
 * @throws if the link isn't on Discord's CDN, the request fails, or the file can't be written
 */
export const download = async (url: string): Promise<string> => {
	try {
		return await ipcRenderer.invoke(DOWNLOAD_CHANNEL, url);
	} catch (err) {
		// Electron prefixes errors thrown across IPC with the channel they came through
		const message = err instanceof Error ? err.message : String(err);
		throw new Error(message.replace(/^Error invoking remote method '[^']*': (?:Error: )?/, ''), {
			cause: err,
		});
	}
};
