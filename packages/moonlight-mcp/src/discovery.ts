import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

/**
 * resolves the directory where running instances advertise themselves.
 *
 * @returns `$MOONLIGHT_MCP_DIR`, `$XDG_RUNTIME_DIR/moonlight-mcp`, or `<tmpdir>/moonlight-mcp-<user>`, in
 *   that order of preference
 */
export const getDiscoveryDir = (): string => {
	if (process.env.MOONLIGHT_MCP_DIR) {
		return process.env.MOONLIGHT_MCP_DIR;
	}
	if (process.env.XDG_RUNTIME_DIR) {
		return path.join(process.env.XDG_RUNTIME_DIR, 'moonlight-mcp');
	}
	return path.join(os.tmpdir(), `moonlight-mcp-${os.userInfo().username}`);
};

/**
 * resolves the socket path an instance listens on.
 *
 * @param dir discovery directory
 * @param pid process ID of the instance
 * @returns a Unix socket path, or a named pipe on Windows
 */
export const getSocketPath = (dir: string, pid: number): string => {
	if (process.platform === 'win32') {
		return `\\\\.\\pipe\\moonlight-mcp-${pid}`;
	}
	return path.join(dir, `${pid}.sock`);
};

/**
 * resolves the path of an instance's metadata file.
 *
 * @param dir discovery directory
 * @param pid process ID of the instance
 * @returns path to `<pid>.json`
 */
export const getMetadataPath = (dir: string, pid: number): string => {
	return path.join(dir, `${pid}.json`);
};

/**
 * checks whether a discovery directory entry is an instance's metadata file.
 *
 * @param name file name within the discovery directory
 * @returns whether it's named `<pid>.json`
 */
export const isMetadataFileName = (name: string): boolean => {
	return /^\d+\.json$/.test(name);
};

/**
 * removes an instance's metadata and socket files, ignoring deletion errors.
 *
 * @param dir discovery directory
 * @param pid process ID of the instance
 */
export const removeInstanceFiles = (dir: string, pid: number): void => {
	const files = [getMetadataPath(dir, pid)];
	if (SOCKET_IS_FILE) {
		files.push(getSocketPath(dir, pid));
	}

	for (const file of files) {
		try {
			fs.unlinkSync(file);
		} catch {}
	}
};

/** whether sockets need unlinking; false for Windows named pipes */
export const SOCKET_IS_FILE = process.platform !== 'win32';
