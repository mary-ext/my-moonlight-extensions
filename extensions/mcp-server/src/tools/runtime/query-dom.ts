import * as v from 'valibot';

import { stringify } from '#/lib/describe.ts';
import { componentChain, elementSummary, fiberName, queryElements } from '#/lib/dom.ts';
import { pluralize } from '#/lib/text.ts';
import { IntSchema, defineTool } from '#/lib/tool.ts';

export const queryDom = defineTool({
	name: 'query_dom',
	description: `Find DOM elements by selector and text, with positions and enclosing React components.`,
	annotations: { readOnlyHint: true },
	input: v.object({
		selector: v.optional(v.string(), '*'),
		text: v.pipe(
			v.optional(v.string()),
			v.description('Only elements whose text contains this; returns the deepest such elements'),
		),
		limit: v.optional(IntSchema(1, 100), 10),
		components: v.pipe(
			v.optional(IntSchema(0, 20), 3),
			v.description('How many enclosing React component names to include'),
		),
	}),
	handler({ selector, text, limit, components }) {
		const elements = queryElements(selector, text);
		const preview = elements.slice(0, limit).map((el) =>
			Object.assign(elementSummary(el), {
				components: components
					? componentChain(el, components).map(fiberName).join(' < ') || undefined
					: undefined,
			}),
		);
		return `${pluralize(elements.length, 'element')} matched${elements.length > limit ? `, showing ${limit}` : ''}\n${stringify(preview)}`;
	},
});
