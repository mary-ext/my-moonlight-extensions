import * as v from 'valibot';

import { describe, stringify } from '#/lib/describe.ts';
import { getExtension, isEnabledInConfig } from '#/lib/extensions.ts';
import { defineTool } from '#/lib/tool.ts';

export const extensionSettings = defineTool({
	name: 'extension_settings',
	description: `Read or update extension settings.`,
	input: v.object({
		id: v.string(),
		set: v.pipe(
			v.optional(v.record(v.string(), v.unknown())),
			v.description('Setting keys to new values; omit to read without changes'),
		),
	}),
	async handler({ id, set }) {
		const ext = getExtension(id);
		const defs = ext.manifest.settings ?? {};

		if (set) {
			for (const key of Object.keys(set)) {
				if (!(key in defs)) {
					throw new Error(`${id} has no setting ${key}`);
				}
			}
			// each call rewrites the whole config file, so they can't overlap
			for (const [key, value] of Object.entries(set)) {
				// oxlint-disable-next-line no-await-in-loop
				await moonlight.setConfigOption(id, key, value);
			}
		}

		const settings = Object.fromEntries(
			Object.entries(defs).map(([key, def]) => [
				key,
				{
					type: def.type,
					displayName: def.displayName,
					description: def.description,
					value: describe(moonlight.getConfigOption(id, key), 2),
					options: 'options' in def ? def.options : undefined,
				},
			]),
		);

		let note: string | undefined;
		if (set && Object.keys(set).length) {
			note = `Settings saved. If changes do not take effect, use the reload tool.`;
		}

		return stringify({
			loaded: moonlight.enabledExtensions.has(id),
			enabled: isEnabledInConfig(id),
			settings,
			note,
		});
	},
});
