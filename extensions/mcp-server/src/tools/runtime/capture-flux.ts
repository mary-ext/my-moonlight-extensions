import * as v from 'valibot';

import Dispatcher from '@moonlight-mod/wp/discord/Dispatcher';

import { describe, stringify } from '#/lib/describe.ts';
import { pluralize } from '#/lib/text.ts';
import { IntSchema, type ToolRegistry } from '#/lib/tool.ts';

/**
 * registers the `capture_flux` tool.
 *
 * @param registry registry to add the tool to
 */
export const registerCaptureFlux = (registry: ToolRegistry): void => {
	registry.define({
		name: 'capture_flux',
		description: 'Record Flux action counts and payload previews for a time window.',
		annotations: { readOnlyHint: true },
		input: v.object({
			durationMs: v.optional(IntSchema(100, 120_000), 5000),
			types: v.pipe(v.optional(v.array(v.string())), v.description('Only record these action types')),
			ignoreTypes: v.pipe(v.optional(v.array(v.string())), v.description('Action types to skip')),
			payloads: v.pipe(
				v.optional(IntSchema(0, 200), 20),
				v.description('Maximum number of payload previews to include'),
			),
			depth: v.optional(IntSchema(0, 5), 2),
		}),
		async handler({ durationMs, types, ignoreTypes, payloads, depth }) {
			const counts = new Map<string, number>();
			const recorded: unknown[] = [];
			const start = performance.now();

			const interceptor = (action: any) => {
				const type = action?.type;
				if ((types && !types.includes(type)) || ignoreTypes?.includes(type)) {
					return false;
				}

				counts.set(type, (counts.get(type) ?? 0) + 1);
				if (recorded.length < payloads) {
					recorded.push({ atMs: Math.round(performance.now() - start), action: describe(action, depth) });
				}
				return false;
			};

			Dispatcher.addInterceptor(interceptor);
			try {
				await new Promise((resolve) => setTimeout(resolve, durationMs));
			} finally {
				const index = Dispatcher._interceptors.indexOf(interceptor);
				if (index !== -1) {
					Dispatcher._interceptors.splice(index, 1);
				}
			}

			const total = counts.values().reduce((a, b) => a + b, 0);
			const summary = [...counts]
				.toSorted((a, b) => b[1] - a[1])
				.map(([type, n]) => `  ${type}: ${n}`)
				.join('\n');
			return `Captured ${pluralize(total, 'action')} in ${durationMs}ms:\n${summary || '  (none)'}\n\nPayloads:\n${stringify(recorded)}`;
		},
	});
};
