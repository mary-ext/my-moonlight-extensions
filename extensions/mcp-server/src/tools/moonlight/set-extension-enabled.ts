import * as v from 'valibot';

import type { ToolRegistry } from '#/lib/tool.ts';

import { getConfig, getExtension, isEnabledInConfig, writeConfig } from './lib/extensions.ts';

const SELF = 'mcpServer';

/**
 * registers the `set_extension_enabled` tool.
 *
 * @param registry registry to add the tool to
 */
export const registerSetExtensionEnabled = (registry: ToolRegistry): void => {
	registry.define({
		name: 'set_extension_enabled',
		description: 'Enable or disable an extension in the saved config.',
		annotations: { idempotentHint: true },
		input: v.object({
			id: v.string(),
			enabled: v.boolean(),
		}),
		async handler({ id, enabled }) {
			const ext = getExtension(id);
			if (ext.id === SELF) {
				throw new Error(`Cannot toggle mcpServer through its own tools`);
			}
			if (isEnabledInConfig(id) === enabled) {
				return `${id} is already ${enabled ? 'enabled' : 'disabled'}`;
			}

			const next = structuredClone(getConfig());
			const entry = next.extensions[id];
			next.extensions[id] = typeof entry === 'object' ? { ...entry, enabled } : enabled;
			await writeConfig(next);

			const apply = ext.scripts.hostPath != null ? 'restart' : 'reload';
			return `${id} ${enabled ? 'enabled' : 'disabled'}, ${apply} to apply.`;
		},
	});
};
