import * as v from 'valibot';

import { MatcherSchema, findOccurrences, toMatcher } from '#/lib/source-matchers.ts';
import { IntSchema, type ToolRegistry } from '#/lib/tool.ts';
import { ModuleIdSchema, allModuleSources, getOriginalSource } from '#/lib/webpack-modules.ts';

// boundary checks prevent pairing one literal's closing quote with the next literal's opening quote
const STRING_LITERAL = /(?<=^|[([{,:;=?!&|+\-*<>~\s])"((?:[^"\\\n]|\\.){4,80})"(?=$|[)\]},:;?+=!&|.\s])/g;
const CONSTANT = /\.([A-Z][A-Z0-9_]{4,60})\b/g;

/**
 * registers the `suggest_find` tool.
 *
 * @param registry registry to add the tool to
 */
export const registerSuggestFind = (registry: ToolRegistry): void => {
	registry.define({
		name: 'suggest_find',
		description: 'Suggest patch finds unique to a module (string literals and CONSTANT_LIKE names).',
		annotations: { readOnlyHint: true },
		input: v.object({
			id: ModuleIdSchema,
			near: v.pipe(
				v.optional(MatcherSchema),
				v.description(
					'Rank candidates by distance from this match; omit to rank from the start of the module',
				),
			),
			limit: v.optional(IntSchema(1, 50), 10),
		}),
		handler({ id, near, limit }) {
			const code = getOriginalSource(id);
			if (code == null) {
				throw new Error(`No module with id ${id}`);
			}

			const target = near != null ? findOccurrences(code, toMatcher(near), 1)[0]?.index : 0;
			if (target == null) {
				throw new Error(`'near' doesn't occur in the module`);
			}

			const candidates = new Map<string, number>();
			for (const re of [STRING_LITERAL, CONSTANT]) {
				for (const m of code.matchAll(re)) {
					const find = re === STRING_LITERAL ? m[0] : `.${m[1]}`;
					const distance = Math.abs(m.index - target);
					const known = candidates.get(find);
					if (known === undefined || known > distance) {
						candidates.set(find, distance);
					}
				}
			}

			const others = allModuleSources()
				.filter(([otherId]) => otherId !== id)
				.map(([, src]) => src)
				.toArray();

			const unique = [...candidates]
				// oxlint-disable-next-line unicorn/no-array-sort -- sorts the array built above
				.sort((a, b) => a[1] - b[1])
				.values()
				.filter(([find]) => !others.some((src) => src.includes(find)))
				.take(limit)
				.toArray();

			if (!unique.length) {
				return 'No unique literals. Try a code fragment near the target (property names survive minification) and check it with search_modules.';
			}

			const lines = unique.map(([find, distance]) => `  ${JSON.stringify(find)}  (${distance} chars away)`);
			return `Unique string finds (distance from target):\n${lines.join('\n')}`;
		},
	});
};
