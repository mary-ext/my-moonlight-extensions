import * as fs from 'node:fs';
import * as path from 'node:path';

import { createPackageWithOptions } from '@electron/asar';

const DIST_DIR = path.resolve(import.meta.dirname, '../dist');
const REPO_DIR = path.resolve(import.meta.dirname, '../repo');

/**
 * lists subdirectories containing a `manifest.json`.
 *
 * @param dir directory to scan
 * @returns extension IDs in alphabetical order, or an empty array if the directory is missing
 */
const listExtensions = (dir: string): string[] => {
	if (!fs.existsSync(dir)) {
		return [];
	}

	return fs
		.readdirSync(dir, { withFileTypes: true })
		.filter((entry) => entry.isDirectory() && fs.existsSync(path.join(dir, entry.name, 'manifest.json')))
		.map((entry) => entry.name)
		.toSorted();
};

const repoUrl = process.env.REPO_URL;
if (!repoUrl) {
	throw new Error(`set REPO_URL to the base URL serving the .asar files`);
}

fs.rmSync(REPO_DIR, { recursive: true, force: true });
fs.mkdirSync(REPO_DIR, { recursive: true });

const manifests = await Promise.all(
	listExtensions(DIST_DIR).map(async (ext) => {
		const input = path.join(DIST_DIR, ext);

		await createPackageWithOptions(input, path.join(REPO_DIR, `${ext}.asar`), {
			globOptions: { ignore: [path.join(input, 'package.json')] },
		});

		const manifest = JSON.parse(fs.readFileSync(path.join(input, 'manifest.json'), 'utf-8'));
		manifest.download = `${repoUrl}/${ext}.asar`;

		return manifest;
	}),
);

fs.writeFileSync(path.join(REPO_DIR, 'repo.json'), JSON.stringify(manifests, null, '\t'));
