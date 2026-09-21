import { defineExtensionConfig } from '@mary-ext/moonlight-bundler';

export default defineExtensionConfig({
	manifest: {
		id: 'mcpServer',
		version: '0.1.0',
		apiLevel: 2,
		environment: 'desktop',
		meta: {
			name: 'MCP Server',
			tagline: 'Lets AI agents inspect Discord, test patches and develop extensions',
			description:
				'A local [Model Context Protocol](https://modelcontextprotocol.io) server. Connect with `npx @mary-ext/moonlight-mcp`. Socket access allows arbitrary code execution in Discord.',
			authors: ['mary'],
			tags: ['development'],
			source: 'https://github.com/mary-ext/my-moonlight-extensions',
		},
		dependencies: ['spacepack'],
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
