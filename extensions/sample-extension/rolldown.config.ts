import { defineExtensionConfig } from '@mary-ext/moonlight-bundler';

export default defineExtensionConfig({
	manifest: {
		id: 'sampleExtension',
		version: '1.0.1',
		apiLevel: 2,
		meta: {
			name: 'Sample Extension',
			tagline: 'Example patches, webpack modules, and native entrypoints',
			authors: ['mary'],
			source: 'https://github.com/mary-ext/my-moonlight-extensions',
		},
		settings: {
			greeting: {
				displayName: 'Greeting',
				type: 'string',
				default: 'hello from sampleExtension!',
			},
		},
	},
	entrypoints: {
		web: 'src/index.ts',
		webpackModules: {
			entrypoint: 'src/webpackModules/entrypoint.ts',
			greeting: 'src/webpackModules/greeting.tsx',
		},
		node: 'src/node.ts',
		host: 'src/host.ts',
	},
	outDir: '../../dist',
});
