import type { ExtensionWebExports } from '@moonlight-mod/types';

// https://moonlight-mod.github.io/ext-dev/webpack/#patching
export const patches: ExtensionWebExports['patches'] = [
	{
		find: '"User Settings",',
		replace: {
			match: '"User Settings",',
			replacement: '"hacked by sampleExtension lol",',
		},
	},
];

// https://moonlight-mod.github.io/ext-dev/webpack/#webpack-module-insertion
export const webpackModules: ExtensionWebExports['webpackModules'] = {
	entrypoint: {
		dependencies: [{ ext: 'sampleExtension', id: 'greeting' }],
		entrypoint: true,
	},
	// modules without an entrypoint still need an entry here to be loaded
	greeting: {},
};
