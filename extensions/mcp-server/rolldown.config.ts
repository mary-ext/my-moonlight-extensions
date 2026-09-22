import { defineExtensionConfig } from '@mary-ext/moonlight-bundler';

export default defineExtensionConfig({
	manifest: {
		id: 'mcpServer',
		version: '0.2.1',
		apiLevel: 2,
		environment: 'desktop',
		meta: {
			name: 'MCP Server',
			tagline: 'Lets AI agents inspect Discord, test patches and develop extensions',
			description:
				'A local [Model Context Protocol](https://modelcontextprotocol.io) server. Connect with `npx @mary-ext/moonlight-mcp`.\n\nAllows arbitrary code execution in Discord.',
			authors: ['mary'],
			tags: ['development'],
			source: 'https://github.com/mary-ext/my-moonlight-extensions',
		},
		dependencies: ['spacepack'],
		settings: {
			developerTools: {
				displayName: 'Enable developer tools',
				description:
					'Enables patch testing, webpack inspection and extension management tools. This will retain original module sources in memory.',
				type: 'boolean',
				default: false,
				advice: 'reload',
			},
			readTools: {
				displayName: 'Enable Discord read tools',
				description: `Enables convenient tools to read and search messages, and look up users, servers and channels.`,
				type: 'boolean',
				default: false,
				advice: 'reload',
			},
		},
	},
	entrypoints: {
		web: 'src/index.ts',
		webpackModules: {
			server: 'src/webpackModules/server.ts',
		},
		node: 'src/node.ts',
		host: 'src/host.ts',
	},
	outDir: '../../dist',
});
