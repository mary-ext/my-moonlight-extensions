import { defineExtensionConfig } from '@mary-ext/moonlight-bundler';

export default defineExtensionConfig({
	manifest: {
		id: 'channelTabs',
		version: '0.010',
		apiLevel: 2,
		environment: 'desktop',
		meta: {
			name: 'Channel Tabs',
			tagline: 'Browser-style channel tabs in the title bar',
			authors: ['mary'],
			tags: ['qol'],
			source: 'https://github.com/mary-ext/my-moonlight-extensions',
		},
		dependencies: ['common', 'contextMenu', 'spacepack'],
	},
	entrypoints: {
		web: 'src/index.ts',
		webpackModules: {
			discord: 'src/webpackModules/discord.ts',
			entrypoint: 'src/webpackModules/entrypoint.ts',
			tabs: 'src/webpackModules/tabs.ts',
			ui: 'src/webpackModules/ui.tsx',
		},
	},
	style: 'src/style.css',
	outDir: '../../dist',
});
