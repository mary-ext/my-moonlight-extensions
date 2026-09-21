import * as v from 'valibot';

import { isModuleLoaded } from '#/lib/modules.ts';
import { pluralize } from '#/lib/text.ts';
import { defineTool } from '#/lib/tool.ts';

export const listMappings = defineTool({
	name: 'list_mappings',
	description: 'List modules mapped by moonmap, importable as @moonlight-mod/wp/<name>.',
	annotations: { readOnlyHint: true },
	input: v.object({
		filter: v.pipe(v.optional(v.string()), v.description('Case-insensitive substring filter on the name')),
	}),
	handler({ filter }) {
		const needle = filter?.toLowerCase();
		const rows = Object.entries(moonlight.moonmap.modules)
			.filter(([name]) => !needle || name.toLowerCase().includes(needle))
			.toSorted(([a], [b]) => a.localeCompare(b))
			.map(([name, id]) => `${name} -> ${id}${isModuleLoaded(id) ? '' : ' (not loaded)'}`);

		return `${pluralize(rows.length, 'mapping')}:\n${rows.join('\n')}`;
	},
});
