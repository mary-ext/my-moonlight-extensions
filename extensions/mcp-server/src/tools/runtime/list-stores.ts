import * as v from 'valibot';

import { allStores } from '#/lib/flux.ts';
import { pluralize } from '#/lib/text.ts';
import { defineTool } from '#/lib/tool.ts';

export const listStores = defineTool({
	name: 'list_stores',
	description: `List the names of Discord's Flux stores.`,
	annotations: { readOnlyHint: true },
	input: v.object({
		filter: v.pipe(v.optional(v.string()), v.description('Case-insensitive substring filter')),
	}),
	handler({ filter }) {
		const needle = filter?.toLowerCase();
		const names = [...allStores().keys()]
			.filter((n) => !needle || n.toLowerCase().includes(needle))
			.toSorted((a, b) => a.localeCompare(b));
		return `${pluralize(names.length, 'store')}:\n${names.join('\n')}`;
	},
});
