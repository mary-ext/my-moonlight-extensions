import * as v from 'valibot';

import { getConfig, getExtension, isEnabledInConfig, writeConfig } from '#/lib/extensions.ts';
import { defineTool } from '#/lib/tool.ts';

const SELF = 'mcpServer';

export const setExtensionEnabled = defineTool({
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
