import * as v from 'valibot';

import {
	MatcherSchema,
	ModuleIdSchema,
	excerpt,
	findOccurrences,
	getOriginalSource,
	getPatchedSource,
	moduleExists,
	moduleStatus,
	toMatcher,
} from '#/lib/modules.ts';
import { pluralize } from '#/lib/text.ts';
import { IntSchema, defineTool } from '#/lib/tool.ts';

export const getModuleSource = defineTool({
	name: 'get_module_source',
	description: `Read a module's source in the normalized format used by moonlight patches.`,
	annotations: { readOnlyHint: true },
	input: v.object({
		id: ModuleIdSchema,
		patched: v.pipe(
			v.optional(v.boolean(), false),
			v.description('Read the source with currently applied patches instead of the original'),
		),
		around: v.pipe(
			v.optional(MatcherSchema),
			v.description('Show a window around this match; overrides offset and length'),
		),
		occurrence: v.pipe(
			v.optional(IntSchema(1, 1000), 1),
			v.description(`Which occurrence of 'around' to show (1-based)`),
		),
		context: v.pipe(
			v.optional(IntSchema(0, 20000), 400),
			v.description(`Characters on each side of the 'around' match`),
		),
		offset: v.pipe(
			v.optional(IntSchema(0, Number.MAX_SAFE_INTEGER), 0),
			v.description('Starting character offset when around is omitted'),
		),
		length: v.pipe(
			v.optional(IntSchema(1, 50000), 4000),
			v.description('Maximum characters to return when around is omitted'),
		),
	}),
	handler({ id, patched, around, occurrence, context, offset, length }) {
		const code = patched ? getPatchedSource(id) : getOriginalSource(id);
		if (code == null) {
			if (patched && moduleExists(id)) {
				throw new Error(`Module ${id} isn't patched`);
			}

			throw new Error(`No module with id ${id}`);
		}

		const header = `Module ${id} (${moduleStatus(id)}), ${patched ? 'patched' : 'original'} source, ${code.length} chars`;

		if (around != null) {
			const occurrences = findOccurrences(code, toMatcher(around));
			if (!occurrences.length) {
				return `${header}\nNo occurrence of the matcher.`;
			}

			const o = occurrences[occurrence - 1];
			if (!o) {
				return `${header}\nOnly ${pluralize(occurrences.length, 'occurrence')}.`;
			}

			const others =
				occurrences.length > 1
					? ` Offsets of all occurrences: ${occurrences
							.slice(0, 50)
							.map((x) => x.index)
							.join(', ')}`
					: '';
			return `${header}\nOccurrence ${occurrence}/${occurrences.length} at offset ${o.index}.${others}\n\n${excerpt(code, o.index, o.index + o.length, context)}`;
		}

		const end = Math.min(code.length, offset + length);
		return `${header}\nShowing ${offset}-${end}\n\n${code.slice(offset, end)}`;
	},
});
