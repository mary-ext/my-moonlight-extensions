import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { app, ipcMain } from 'electron';

import { CDN_HOSTS } from './lib/cdn.ts';
import { DOWNLOAD_CHANNEL } from './lib/ipc.ts';

const EXT_ID = 'imageDownloader';
const MAX_NAME_ATTEMPTS = 1000;

const logger = moonlightHost.getLogger('imageDownloader/host');

// read from disk because moonlightHost.config doesn't reflect renderer changes
const readDirectorySetting = async () => {
	try {
		const config = JSON.parse(await fs.readFile(await moonlightHost.getConfigPath(), 'utf8'));
		const entry = config?.extensions?.[EXT_ID];
		const directory = typeof entry === 'object' ? entry?.config?.directory : undefined;
		return typeof directory === 'string' ? directory.trim() : '';
	} catch (err) {
		logger.warn('failed to read the config, using the default directory', err);
		return '';
	}
};

const expandHome = (p: string) => {
	if (p === '~' || p.startsWith('~/')) {
		return path.join(app.getPath('home'), p.slice(1));
	}
	return p;
};

const getDirectory = async () => {
	const directory = await readDirectorySetting();
	if (directory) {
		return path.resolve(expandHome(directory));
	}
	// Electron resolves the xdg-user-dirs download directory on Linux, the env var just takes priority
	return path.join(process.env.XDG_DOWNLOAD_DIR || app.getPath('downloads'), 'moonlight');
};

const sanitizeFileName = (name: string) => {
	// oxlint-disable-next-line no-control-regex
	const clean = name
		.replace(/[/\\:*?"<>|\x00-\x1f]/g, '_')
		.replace(/^\.+/, '')
		.trim()
		.slice(0, 200);
	return clean || 'image';
};

/** adds ` (n)` before the extension on filename collisions */
const writeUnique = async (dir: string, name: string, data: Uint8Array) => {
	const { name: stem, ext } = path.parse(name);

	for (let n = 0; n < MAX_NAME_ATTEMPTS; n++) {
		const file = path.join(dir, n === 0 ? name : `${stem} (${n})${ext}`);
		try {
			// oxlint-disable-next-line no-await-in-loop -- each attempt depends on the previous one failing
			await fs.writeFile(file, data, { flag: 'wx' });
			return file;
		} catch (e) {
			if (!(e instanceof Error && 'code' in e && e.code === 'EEXIST')) {
				throw e;
			}
		}
	}

	throw new Error(`Couldn't find a free file name for ${name} in ${dir}`);
};

const download = async (url: unknown) => {
	if (typeof url !== 'string') {
		throw new Error(`Expected a URL`);
	}
	const parsed = new URL(url);
	if (parsed.protocol !== 'https:' || !CDN_HOSTS.has(parsed.hostname)) {
		throw new Error(`Refusing to download from ${parsed.host}`);
	}

	const [res, dir] = await Promise.all([fetch(parsed.href), getDirectory()]);
	if (!res.ok) {
		throw new Error(`Download failed with HTTP ${res.status}`);
	}

	const data = new Uint8Array(await res.arrayBuffer());
	await fs.mkdir(dir, { recursive: true });

	let fileName = '';
	try {
		fileName = decodeURIComponent(path.posix.basename(parsed.pathname));
	} catch {}

	return writeUnique(dir, sanitizeFileName(fileName), data);
};

ipcMain.handle(DOWNLOAD_CHANNEL, (_e, url: unknown) => download(url));
