import * as v from 'valibot';

import { MatcherSchema, excerpt, findOccurrences, matches, toMatcher } from '#/lib/source-matchers.ts';
import { pluralize } from '#/lib/text.ts';
import { IntSchema, defineTool } from '#/lib/tool.ts';
import { allModuleSources, moduleStatus } from '#/lib/webpack-modules.ts';

export const searchModules = defineTool({
	name: 'search_modules',
	description: 'Search original source of known webpack modules, including unexecuted modules.',
	annotations: { readOnlyHint: true },
	input: v.object({
		matchers: v.pipe(v.array(MatcherSchema), v.minLength(1), v.description('All of these must match')),
		limit: v.optional(IntSchema(1, 200), 10),
		context: v.pipe(
			v.optional(IntSchema(0, 2000), 80),
			v.description('Characters of context around the match'),
		),
	}),
	handler({ matchers, limit, context }) {
		const parsed = matchers.map(toMatcher);
		const hits: string[] = [];
		let total = 0;

		for (const [id, code] of allModuleSources()) {
			if (!parsed.every((m) => matches(code, m))) {
				continue;
			}

			total++;
			if (hits.length >= limit) {
				continue;
			}

			const [first] = findOccurrences(code, parsed[0], 1);
			const snippet = first ? excerpt(code, first.index, first.index + first.length, context) : '';
			hits.push(
				`Module ${id} (${moduleStatus(id)}, ${code.length} chars) at offset ${first?.index}:\n  ${snippet}`,
			);
		}

		if (!total) {
			return 'No modules matched. If the code is lazy, open its UI or run load_lazy_chunks.';
		}

		return `${pluralize(total, 'module')} matched${total > limit ? `, showing ${limit}` : ''}:\n\n${hits.join('\n\n')}`;
	},
});
