import { type WebEventPayloads, WebEventType } from '@moonlight-mod/types/core/event';
import spacepack from '@moonlight-mod/wp/spacepack_spacepack';
import pLimit from 'p-limit';
import * as v from 'valibot';

import { expandRegExp } from '#/lib/source-matchers.ts';
import { defineTool } from '#/lib/tool.ts';
import { normalizeFactory } from '#/lib/webpack-modules.ts';

export const lazyChunks = defineTool({
	name: 'load_lazy_chunks',
	description:
		'Load non-worker lazy webpack chunks and execute discovered entry points. May be slow and trigger side effects; prefer opening the relevant UI.',
	input: v.object({}),
	async handler() {
		const before = Object.keys(spacepack.modules).length;

		await loadLazyChunks();

		const after = Object.keys(spacepack.modules).length;

		return `Module factories: ${before} -> ${after}`;
	},
});

// #region loader

let loading: Promise<void> | undefined;
const loadLazyChunks = (): Promise<void> => {
	loading ??= loadAll().catch((err: unknown) => {
		loading = undefined;
		throw err;
	});

	return loading;
};

/** maps a chunk ID to its asset file name */
type ChunkFileName = (id: unknown) => string;

const logger = moonlight.getLogger('mcpServer/lazyChunks');

const WORKER_ASSET = /importScripts\(|self\.postMessage/;
const CHUNK_IDS = /\("([^"]+?)"\)/g;
const LAZY_CHUNK = expandRegExp(
	new RegExp(
		String.raw`(?:(?:Promise\.all\(\[)?((?:\i\.e\("?[^)]+?"?\),?)+?)(?:\]\))?)\.then\(\i\.bind\(\i,"?([^)]+?)"?\)\)`,
		'g',
	),
);

/** webpack keys numeric IDs by their canonical number, e.g. `"0123"` is chunk `123` */
const normalizeId = (id: string) => {
	const num = Number(id);
	return Number.isNaN(num) ? id : String(num);
};

/** extracts webpack's chunk ID to file name map, by making `u` read a key through `Object.prototype` */
const getChunkMap = (chunkFileName: ChunkFileName) => {
	const sym = Symbol();
	const found: { chunkMap?: Record<PropertyKey, string> } = {};

	// the getter runs with the chunk map as `this` when `u` looks the symbol up on it
	// oxlint-disable-next-line no-extend-native
	Object.defineProperty(Object.prototype, sym, {
		get(this: Record<PropertyKey, string>) {
			found.chunkMap = this;
			return '';
		},
		configurable: true,
	});

	try {
		chunkFileName(sym);
	} finally {
		Reflect.deleteProperty(Object.prototype, sym);
	}

	return found.chunkMap;
};

const loadAll = async () => {
	const wreq = spacepack.require;
	// untyped webpack helpers: `p` is the asset base URL; `u` maps chunk IDs to filenames
	const publicPath: string = Reflect.get(wreq, 'p');
	const chunkFileName: ChunkFileName = Reflect.get(wreq, 'u');
	const queue = pLimit(50);
	const workerAssets = new Map<string, Promise<boolean>>();

	// inspect asset contents to exclude worker scripts from page loading
	const checkWorkerAsset = (url: string, fetchAsset: (check: () => Promise<boolean>) => Promise<boolean>) => {
		let result = workerAssets.get(url);
		if (result === undefined) {
			result = fetchAsset(() =>
				fetch(url)
					.then((r) => r.text())
					.then((t) => WORKER_ASSET.test(t)),
			);
			workerAssets.set(url, result);
		}
		return result;
	};

	const checkedChunks = new Set<string>();
	const pending = new Set<Promise<void>>();

	const searchAndLoad = async (code: string) => {
		const groups: Array<[chunkIds: string[], entryPoint: string]> = [];

		await Promise.all(
			code.matchAll(LAZY_CHUNK).map(async ([, rawChunkIds, entryPoint]) => {
				const ids = rawChunkIds
					.matchAll(CHUNK_IDS)
					.map((m) => normalizeId(m[1]))
					.toArray();

				const validity = await Promise.all(
					ids.map(async (id) => {
						const file = chunkFileName(id);
						if (file == null || file === 'undefined.js') {
							return true;
						}

						checkedChunks.add(id);
						return !(await checkWorkerAsset(publicPath + file, queue));
					}),
				);

				if (ids.length && validity.every(Boolean)) {
					groups.push([ids, normalizeId(entryPoint)]);
				}
			}),
		);

		await Promise.all(groups.map(([chunkIds]) => Promise.all(chunkIds.map((id) => wreq.e(id)))));

		for (const [, entryPoint] of groups) {
			try {
				if (wreq.m[entryPoint]) {
					wreq(entryPoint);
				}
			} catch (err) {
				// some entry points expect native modules that only exist in Discord's own windows
				if (!(err instanceof TypeError && err.message.includes(`reading 'nativeModules'`))) {
					logger.error('failed to require lazy entry point', entryPoint, err);
				}
			}
		}
	};

	const search = (code: string) => {
		const promise = searchAndLoad(code).finally(() => pending.delete(promise));
		pending.add(promise);
	};

	// loading a chunk can reveal further lazy chunks
	const onChunkLoad = ({ modules }: WebEventPayloads[WebEventType.ChunkLoad]) => {
		for (const factory of Object.values(modules)) {
			search(normalizeFactory(factory));
		}
	};

	moonlight.events.addEventListener(WebEventType.ChunkLoad, onChunkLoad);
	try {
		for (const factory of Object.values(spacepack.modules)) {
			search(normalizeFactory(factory));
		}
		// chunk loads enqueue more searches
		while (pending.size) {
			// oxlint-disable-next-line no-await-in-loop
			await Promise.allSettled(pending);
		}
	} finally {
		moonlight.events.removeEventListener(WebEventType.ChunkLoad, onChunkLoad);
	}

	// chunks the regex couldn't find, like some language packs
	const chunkMap = getChunkMap(chunkFileName);
	if (!chunkMap) {
		throw new Error(`Failed to get webpack's chunk map`);
	}

	const leftover = Object.keys(chunkMap).filter((id) => !checkedChunks.has(id));
	await Promise.all(
		leftover.map((id) =>
			queue(async () => {
				// already running inside the queue, queueing the check again would deadlock
				if (!(await checkWorkerAsset(publicPath + chunkFileName(id), (check) => check()))) {
					await wreq.e(id);
				}
			}),
		),
	);
};

// #endregion
