import * as v from 'valibot';

import { getNatives } from '#/lib/natives.ts';
import type { ToolRegistry } from '#/lib/tool.ts';

/**
 * registers the `reload` tool.
 *
 * @param registry registry to add the tool to
 */
export const registerReload = (registry: ToolRegistry): void => {
	registry.define({
		name: 'reload',
		description: `Reload or restart Discord to apply extension changes.`,
		annotations: { destructiveHint: false },
		input: v.object({
			mode: v.pipe(
				v.optional(v.picklist(['reload', 'restart']), 'reload'),
				v.description('reload: reloads the web page; restart: relaunches the app'),
			),
		}),
		async handler({ mode }) {
			// route new calls to the next renderer before starting the reload
			await getNatives().leave();

			let apply: () => void;
			let message: string;
			switch (mode) {
				case 'reload': {
					apply = () => location.reload();
					message = `Reloading.`;
					break;
				}
				case 'restart': {
					apply = () => void getNatives().relaunch();
					message = `Restarting.`;
					break;
				}
			}

			// give the response time to be sent before the renderer goes away
			setTimeout(apply, 300);
			return message;
		},
	});
};
