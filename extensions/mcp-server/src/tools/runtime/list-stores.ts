import * as v from 'valibot';

import { pluralize } from '#/lib/text.ts';
import type { ToolRegistry } from '#/lib/tool.ts';

import { allStores } from './lib/stores.ts';

/**
 * registers the `list_stores` tool.
 *
 * @param registry registry to add the tool to
 */
export const registerListStores = (registry: ToolRegistry): void => {
	registry.define({
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
};
