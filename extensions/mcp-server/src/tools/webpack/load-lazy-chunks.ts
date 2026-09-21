import spacepack from '@moonlight-mod/wp/spacepack_spacepack';
import * as v from 'valibot';

import { loadLazyChunks } from '#/lib/lazy-chunks.ts';
import { defineTool } from '#/lib/tool.ts';

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
