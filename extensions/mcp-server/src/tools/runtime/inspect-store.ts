import * as v from 'valibot';

import { describe, stringify } from '#/lib/describe.ts';
import { IntSchema, defineTool } from '#/lib/tool.ts';

import { allStores } from './lib/stores.ts';

export const inspectStore = defineTool({
	name: 'inspect_store',
	description: `Inspect a Flux store or call one of its methods.`,
	annotations: { readOnlyHint: true },
	input: v.object({
		name: v.pipe(v.string(), v.description('Store name, e.g. UserStore')),
		method: v.pipe(v.optional(v.string()), v.description('Method to call; omit to list store methods')),
		args: v.pipe(v.optional(v.array(v.unknown()), []), v.description('Positional arguments for the method')),
		depth: v.optional(IntSchema(0, 6), 2),
	}),
	handler({ name, method, args, depth }) {
		const store = allStores().get(name);
		if (!store) {
			throw new Error(`No store named ${name}. Use list_stores.`);
		}

		if (!method) {
			return stringify(describe(store, 1));
		}
		if (typeof store[method] !== 'function') {
			throw new Error(`${name}.${method} is not a function`);
		}
		return stringify(describe(store[method](...args), depth));
	},
});
