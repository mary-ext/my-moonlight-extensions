import * as fs from 'node:fs';
import * as path from 'node:path';

import type { Plugin, RolldownOptions } from 'rolldown';

import type { ExtensionManifest } from '@moonlight-mod/types';

// #region types

/** replaces string enums with their values, so manifests can be written as plain object literals */
type Unenum<T> = T extends string ? `${T}` : T extends object ? { [K in keyof T]: Unenum<T[K]> } : T;

/** extension manifest, as written out to `manifest.json` */
export type ExtensionManifestInput = Unenum<Omit<ExtensionManifest, '$schema'>>;

/** source files for each script moonlight loads from an extension */
export interface ExtensionEntrypoints {
	/** script evaluated in Discord's renderer, bundled to `index.js` */
	web?: string;
	/** webpack modules keyed by module ID, bundled to `webpackModules/<id>.js` */
	webpackModules?: Record<string, string>;
	/** script required in the preload process, bundled to `node.js` */
	node?: string;
	/** script required in Electron's main process, bundled to `host.js` */
	host?: string;
}

/** describes a moonlight extension to bundle */
export interface ExtensionConfig {
	/** extension manifest; its ID names the output directory */
	manifest: ExtensionManifestInput;
	/** scripts to bundle, as paths relative to the working directory */
	entrypoints: ExtensionEntrypoints;
	/** stylesheet copied to `style.css`, relative to the working directory */
	style?: string;
	/** directory that receives the extension's own `<id>/` directory, relative to the working directory */
	outDir: string;
}

// #endregion

// #region sides

/** where a bundle runs: Discord's renderer, the preload process, or Electron's main process */
type Side = 'web' | 'node' | 'host';

const SIDES: Side[] = ['web', 'node', 'host'];

// each side doubles as a label, so `web: { ... }` blocks are kept only in web bundles
const getDropLabels = (side: Side): string[] => {
	return SIDES.filter((s) => s !== side);
};

// #endregion

// #region plugins

const WEBPACK_IMPORT_RE = /^@moonlight-mod\/wp\//;

/** leaves `@moonlight-mod/wp/<id>` imports to be required from Discord's webpack at runtime */
const webpackImports = (): Plugin => {
	return {
		name: 'moonlight-webpack-imports',
		resolveId: {
			filter: { id: WEBPACK_IMPORT_RE },
			handler(id) {
				return { id: id.replace(WEBPACK_IMPORT_RE, ''), external: true };
			},
		},
	};
};

/** emits the manifest, package type and optional stylesheet */
const extensionFiles = (
	manifest: ExtensionManifestInput,
	style: string | undefined,
	outDir: string,
): Plugin => {
	return {
		name: 'moonlight-extension-files',
		buildStart() {
			// normal builds run configs in order, so the first can clear stale scripts.
			// watch builds run concurrently; clearing would delete other bundles' output
			if (!this.meta.watchMode) {
				fs.rmSync(outDir, { recursive: true, force: true });
			}

			if (style !== undefined) {
				this.addWatchFile(style);
			}
		},
		generateBundle() {
			this.emitFile({
				type: 'asset',
				fileName: 'manifest.json',
				source: `${JSON.stringify(manifest, null, '\t')}\n`,
			});

			// prevent dev search paths from inheriting an enclosing package's `"type": "module"`
			this.emitFile({
				type: 'asset',
				fileName: 'package.json',
				source: '{ "type": "commonjs" }\n',
			});

			if (style !== undefined) {
				this.emitFile({
					type: 'asset',
					fileName: 'style.css',
					source: fs.readFileSync(style),
				});
			}
		},
	};
};

// #endregion

/**
 * creates rolldown configs that bundle a moonlight extension into `<outDir>/<manifest.id>/`.
 *
 * @param config extension to bundle
 * @returns configs to default-export from `rolldown.config.ts`
 */
export const defineExtensionConfig = (config: ExtensionConfig): RolldownOptions[] => {
	const { manifest, entrypoints } = config;
	const outDir = path.resolve(config.outDir, manifest.id);
	const style = config.style !== undefined ? path.resolve(config.style) : undefined;
	const production = process.env.NODE_ENV === 'production';

	const bundles: { side: Side; input: string; fileName: string }[] = [];
	{
		const { web, webpackModules = {}, node, host } = entrypoints;

		if (web !== undefined) {
			bundles.push({ side: 'web', input: web, fileName: 'index.js' });
		}
		for (const [id, input] of Object.entries(webpackModules)) {
			bundles.push({ side: 'web', input, fileName: `webpackModules/${id}.js` });
		}
		if (node !== undefined) {
			bundles.push({ side: 'node', input: node, fileName: 'node.js' });
		}
		if (host !== undefined) {
			bundles.push({ side: 'host', input: host, fileName: 'host.js' });
		}
	}

	if (bundles.length === 0) {
		throw new Error(`extension ${manifest.id} has no entrypoints`);
	}

	return bundles.map(({ side, input, fileName }, index): RolldownOptions => {
		const platform = side === 'web' ? 'browser' : 'node';

		return {
			input,
			platform,
			external: ['electron', 'original-fs', 'react'],
			resolve: {
				// rolldown still adds `import` or `require` to these, depending on how a module is loaded
				conditionNames: ['source', platform, 'default'],
			},
			transform: {
				dropLabels: getDropLabels(side),
			},
			plugins: [webpackImports(), index === 0 && extensionFiles(manifest, style, outDir)],
			output: {
				dir: outDir,
				entryFileNames: fileName,
				format: 'cjs',
				codeSplitting: false,
				minify: production,
				comments: {
					annotation: false,
					legal: false,
					jsdoc: !production,
				},
				sourcemap: production ? false : 'inline',
			},
			experimental: {
				attachDebugInfo: production ? 'none' : 'simple',
			},
		};
	});
};
