// the package root re-exports types as values, which can't be bundled
import { ExtensionLoadSource } from '@moonlight-mod/types/extension';
import * as v from 'valibot';

import { getCapture } from '#/lib/capture.ts';
import { pluralize, truncate } from '#/lib/text.ts';
import { defineTool } from '#/lib/tool.ts';

import { isEnabledInConfig } from './lib/extensions.ts';

const SOURCE_NAMES: Record<ExtensionLoadSource, string> = {
	[ExtensionLoadSource.Developer]: 'developer',
	[ExtensionLoadSource.Core]: 'core',
	[ExtensionLoadSource.Normal]: 'installed',
};

export const listExtensions = defineTool({
	name: 'list_extensions',
	description: `List moonlight extensions with load state, source and patch count.`,
	annotations: { readOnlyHint: true },
	input: v.object({
		filter: v.pipe(
			v.optional(v.string()),
			v.description('Case-insensitive substring filter on id, name and tagline'),
		),
		enabledOnly: v.optional(v.boolean(), false),
	}),
	handler({ filter, enabledOnly }) {
		const needle = filter?.toLowerCase();

		const patchCounts = new Map<string, number>();
		for (const patch of getCapture().patches) {
			patchCounts.set(patch.ext, (patchCounts.get(patch.ext) ?? 0) + 1);
		}

		const rows = moonlightNode.extensions
			.filter((ext) => !enabledOnly || moonlight.enabledExtensions.has(ext.id))
			.filter((ext) => {
				if (!needle) {
					return true;
				}
				const { name = '', tagline = '' } = ext.manifest.meta ?? {};
				return [ext.id, name, tagline].some((s) => s.toLowerCase().includes(needle));
			})
			.toSorted((a, b) => a.id.localeCompare(b.id))
			.map((ext) => {
				const loaded = moonlight.enabledExtensions.has(ext.id);
				const enabled = isEnabledInConfig(ext.id);
				const patches = patchCounts.get(ext.id);

				const flags = [loaded ? 'loaded' : 'not loaded', SOURCE_NAMES[ext.source.type]];
				if (loaded && !enabled) {
					flags.push('not enabled in config (dependency or disabled since last reload)');
				} else if (!loaded && enabled) {
					flags.push('enabled in config since the last reload');
				}
				if (patches) {
					flags.push(pluralize(patches, 'patch', 'patches'));
				}

				const tagline = ext.manifest.meta?.tagline;
				return `${ext.id} [${flags.join(', ')}]${tagline ? `: ${truncate(tagline, 120)}` : ''}`;
			});

		return `${pluralize(rows.length, 'extension')}:\n${rows.join('\n')}`;
	},
});
