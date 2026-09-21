import * as v from 'valibot';

import { describe, stringify } from '#/lib/describe.ts';
import { getMappedNames, iterateExports } from '#/lib/modules.ts';
import { IntSchema, defineTool } from '#/lib/tool.ts';

const finders = {
	props: (args: string[]) => (value: any) => typeof value === 'object' && args.every((key) => key in value),
	code: (args: string[]) => (value: any) => {
		if (typeof value !== 'function') {
			return false;
		}
		const src = Function.prototype.toString.call(value);
		return args.every((s) => src.includes(s));
	},
	store: (args: string[]) => (value: any) =>
		typeof value?.getName === 'function' &&
		typeof value.getDispatchToken === 'function' &&
		value.getName() === args[0],
};

export const findExports = defineTool({
	name: 'find_exports',
	description: `Find loaded exports by properties, function source or Flux store name.`,
	annotations: { readOnlyHint: true },
	input: v.object({
		type: v.pipe(
			v.picklist(['props', 'code', 'store']),
			v.description(
				`props: object with all these keys; code: function whose source has all these strings; store: Flux store with this name`,
			),
		),
		args: v.pipe(v.array(v.string()), v.minLength(1)),
		limit: v.optional(IntSchema(1, 100), 10),
		depth: v.pipe(v.optional(IntSchema(0, 3), 0), v.description('Depth of the preview of each result')),
	}),
	handler({ type, args, limit, depth }) {
		const filter = finders[type](args);
		const results: Array<{ module: string; export: string | null; value: unknown }> = [];

		const check = (value: unknown) => {
			try {
				return value != null && filter(value);
			} catch {
				return false;
			}
		};

		// a module whose whole exports match isn't searched further
		let matchedModule: string | null = null;
		for (const [id, key, value] of iterateExports()) {
			if (id === matchedModule || !check(value)) {
				continue;
			}
			results.push({ module: id, export: key, value });
			if (key === null) {
				matchedModule = id;
			}
		}

		const unique = new Set(results.map((r) => r.value)).size;
		let verdict: string;
		switch (unique) {
			case 0: {
				verdict = 'No results (the module may not be loaded yet)';
				break;
			}
			case 1: {
				verdict = 'OK: exactly one unique result';
				break;
			}
			default: {
				verdict = `Ambiguous: ${unique} unique results, make the filter more specific`;
			}
		}

		const preview = results.slice(0, limit).map((r) => ({
			module: r.module,
			mappedAs: getMappedNames(r.module),
			export: r.export ?? '(module.exports)',
			value: describe(r.value, depth),
		}));

		return `${verdict}\n${stringify(preview)}`;
	},
});
