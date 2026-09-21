import type { ExtensionWebExports } from '@moonlight-mod/types';
import { WebEventType } from '@moonlight-mod/types/core/event';

import { createCapture } from './lib/capture.ts';

// extension entrypoints run before moonlight installs the webpack patcher
{
	const capture = createCapture();

	// `unpatched` includes earlier extensions' patches and receives later registrations
	const unpatched = moonlight.unpatched;
	for (const patch of unpatched) {
		capture.patches.add(patch);
	}

	const add = unpatched.add.bind(unpatched);
	unpatched.add = (patch) => {
		capture.patches.add(patch);
		return add(patch);
	};

	// ChunkLoad fires before patching overwrites moonlight's cached sources
	moonlight.events.addEventListener(WebEventType.ChunkLoad, ({ modules }) => {
		for (const [id, factory] of Object.entries(modules)) {
			if (factory.__moonlight !== true) {
				capture.factories.set(id, factory);
			}
		}
	});
}

export const webpackModules: ExtensionWebExports['webpackModules'] = {
	server: {
		dependencies: [
			{ ext: 'spacepack', id: 'spacepack' },
			{ id: 'discord/Dispatcher' },
			{ id: 'discord/packages/flux' },
		],
		entrypoint: true,
	},
};
