import spacepack from '@moonlight-mod/wp/spacepack_spacepack';
import * as v from 'valibot';

import { describe, stringify } from '#/lib/describe.ts';
import { ModuleIdSchema, getMappedNames, getPatchedBy, isModuleLoaded, moduleExists } from '#/lib/modules.ts';
import { IntSchema, defineTool } from '#/lib/tool.ts';

export const moduleInfo = defineTool({
	name: 'module_info',
	description: `Get a webpack module's load state, moonmap names, applied patches and exports outline.`,
	annotations: { readOnlyHint: true },
	input: v.object({
		id: ModuleIdSchema,
		depth: v.optional(IntSchema(0, 4), 1),
	}),
	handler({ id, depth }) {
		if (!moduleExists(id)) {
			throw new Error(`No module with id ${id}`);
		}

		return stringify({
			id,
			loaded: isModuleLoaded(id),
			mappedAs: getMappedNames(id),
			patchedBy: getPatchedBy(id),
			exports: isModuleLoaded(id) ? describe(spacepack.cache[id].exports, depth) : '[not loaded]',
		});
	},
});
