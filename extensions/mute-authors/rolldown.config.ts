import { defineExtensionConfig } from '@mary-ext/moonlight-bundler';

export default defineExtensionConfig({
	manifest: {
		id: 'muteAuthors',
		version: '0.1.0',
		apiLevel: 2,
		meta: {
			name: 'Mute Authors',
			tagline: 'Mute notifications from users and webhooks per channel',
			authors: ['mary'],
			tags: ['qol'],
			source: 'https://github.com/mary-ext/my-moonlight-extensions',
		},
		dependencies: ['contextMenu'],
		settings: {
			rules: {
				displayName: 'Muted authors',
				description:
					'Format: <channel or thread ID>:<user or webhook ID>. Right-click a message author to toggle notifications in that channel.',
				type: 'list',
				default: [],
			},
		},
	},
	entrypoints: {
		web: 'src/index.ts',
		webpackModules: {
			menu: 'src/webpackModules/menu.tsx',
			rules: 'src/webpackModules/rules.ts',
		},
	},
	outDir: '../../dist',
});
