import { defineExtensionConfig } from '@mary-ext/moonlight-bundler';

export default defineExtensionConfig({
	manifest: {
		id: 'imageDownloader',
		version: '0.1.0',
		apiLevel: 2,
		environment: 'desktop',
		meta: {
			name: 'Image Downloader',
			tagline: 'Save image attachments with one click',
			authors: ['mary'],
			tags: ['qol'],
			source: 'https://github.com/mary-ext/my-moonlight-extensions',
		},
		dependencies: ['common'],
		settings: {
			directory: {
				displayName: 'Download directory',
				description: 'By default, it would save in the "moonlight" folder under your Downloads directory.',
				type: 'string',
				default: '',
			},
		},
	},
	entrypoints: {
		web: 'src/index.ts',
		webpackModules: {
			button: 'src/webpackModules/button.tsx',
		},
		node: 'src/node.ts',
		host: 'src/host.ts',
	},
	outDir: '../../dist',
});
