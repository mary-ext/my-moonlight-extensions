import * as v from 'valibot';

import { describe, stringify } from '#/lib/describe.ts';
import { IntSchema, type ToolRegistry } from '#/lib/tool.ts';
import { iterateExports } from '#/lib/webpack-modules.ts';

import { componentChain, elementSummary, fiberName, queryElements } from './lib/dom.ts';

/**
 * registers the `inspect_react` tool.
 *
 * @param registry registry to add the tool to
 */
export const registerInspectReact = (registry: ToolRegistry): void => {
	registry.define({
		name: 'inspect_react',
		description: `Inspect a DOM element's enclosing React components, props and exporting modules.`,
		annotations: { readOnlyHint: true },
		input: v.object({
			selector: v.string(),
			text: v.pipe(
				v.optional(v.string()),
				v.description('Pick the deepest element matching selector that contains this text'),
			),
			index: v.pipe(v.optional(IntSchema(0, 1000), 0), v.description('Which matching element to inspect')),
			levels: v.pipe(
				v.optional(IntSchema(1, 50), 8),
				v.description('How many components up the tree to report'),
			),
			depth: v.pipe(
				v.optional(IntSchema(0, 4), 1),
				v.description('Depth of props previews; 0 summarizes objects without expanding them'),
			),
			modules: v.pipe(
				v.optional(v.boolean(), true),
				v.description('Look up the defining module of each component (slower)'),
			),
		}),
		handler({ selector, text, index, levels, depth, modules }) {
			const el = queryElements(selector, text)[index];
			if (!el) {
				throw new Error('No element matched');
			}

			const chain = componentChain(el, levels);
			if (!chain.length) {
				throw new Error('Element has no React fiber');
			}

			const exportIndex = modules ? buildExportIndex() : null;

			return stringify({
				element: elementSummary(el),
				components: chain.map((fiber) => {
					const { type } = fiber;
					return {
						name: fiberName(fiber),
						module: exportIndex?.get(type) ?? exportIndex?.get(type?.type ?? type?.render),
						props: describe(fiber.memoizedProps, depth),
					};
				}),
			});
		},
	});
};

/** indexes loaded exports by identity to trace components to their modules */
const buildExportIndex = () => {
	const index = new Map<unknown, string>();
	for (const [id, key, value] of iterateExports()) {
		if (value != null && !index.has(value)) {
			index.set(value, key === null ? id : `${id} (export ${key})`);
		}
	}
	return index;
};
