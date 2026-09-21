import * as v from 'valibot';

import { getNatives } from '#/lib/natives.ts';
import { defineTool } from '#/lib/tool.ts';

export const reload = defineTool({
	name: 'reload',
	description: `Reload or restart Discord to apply extension changes.`,
	annotations: { destructiveHint: false },
	input: v.object({
		mode: v.pipe(
			v.optional(v.picklist(['reload', 'restart']), 'reload'),
			v.description('reload: Reloads the web page; restart: Relaunches the app'),
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
