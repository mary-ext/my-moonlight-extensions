import type { CallToolResult } from '@mary-ext/moonlight-mcp/types';

import { type WebEventPayloads, WebEventType } from '@moonlight-mod/types/core/event';
import spacepack from '@moonlight-mod/wp/spacepack_spacepack';

import { isDeveloperMode, isReadToolsEnabled } from '#/lib/config.ts';
import { BRIDGE_KEY, type RendererInfo } from '#/lib/ipc.ts';
import { getNatives } from '#/lib/natives.ts';
import { ToolRegistry } from '#/lib/tool.ts';
import { getGuild } from '#/tools/discord/get-guild.ts';
import { getMessages } from '#/tools/discord/get-messages.ts';
import { getUser } from '#/tools/discord/get-user.ts';
import { listChannels } from '#/tools/discord/list-channels.ts';
import { listGuilds } from '#/tools/discord/list-guilds.ts';
import { listThreads } from '#/tools/discord/list-threads.ts';
import { searchMessages } from '#/tools/discord/search-messages.ts';
import { extensionSettings } from '#/tools/moonlight/extension-settings.ts';
import { getLogs } from '#/tools/moonlight/get-logs.ts';
import { listExtensions } from '#/tools/moonlight/list-extensions.ts';
import { reload } from '#/tools/moonlight/reload.ts';
import { setExtensionEnabled } from '#/tools/moonlight/set-extension-enabled.ts';
import { checkPatches } from '#/tools/patches/check-patches.ts';
import { testPatch } from '#/tools/patches/test-patch.ts';
import { captureFlux } from '#/tools/runtime/capture-flux.ts';
import { evaluateTool } from '#/tools/runtime/evaluate.ts';
import { inspectReact } from '#/tools/runtime/inspect-react.ts';
import { inspectStore } from '#/tools/runtime/inspect-store.ts';
import { listStores } from '#/tools/runtime/list-stores.ts';
import { queryDom } from '#/tools/runtime/query-dom.ts';
import { findExports } from '#/tools/webpack/find-exports.ts';
import { getModuleSource } from '#/tools/webpack/get-module-source.ts';
import { listMappings } from '#/tools/webpack/list-mappings.ts';
import { lazyChunks } from '#/tools/webpack/load-lazy-chunks.ts';
import { moduleInfo } from '#/tools/webpack/module-info.ts';
import { searchModules } from '#/tools/webpack/search-modules.ts';
import { suggestFind } from '#/tools/webpack/suggest-find.ts';

declare global {
	interface Window {
		GLOBAL_ENV?: { RELEASE_CHANNEL?: string };
	}
}

const logger = moonlight.getLogger('mcpServer/server');

const registry = new ToolRegistry();
registry.add(evaluateTool, listStores, inspectStore, captureFlux, queryDom, reload);

if (isDeveloperMode()) {
	registry.add(
		testPatch,
		checkPatches,
		searchModules,
		getModuleSource,
		moduleInfo,
		listMappings,
		findExports,
		suggestFind,
		lazyChunks,
		inspectReact,
		listExtensions,
		setExtensionEnabled,
		extensionSettings,
		getLogs,
	);
}

if (isReadToolsEnabled()) {
	registry.add(listGuilds, getGuild, listChannels, listThreads, getMessages, searchMessages, getUser);
}

const BUILD_NUMBER_MARKER = 'Trying to open a changelog for an invalid build number';
const BUILD_NUMBER = /"Trying to open a changelog for an invalid build number (\d+?)"\)/;

/** extracts Discord's build number from module factories, or returns -1 */
const findBuildNumber = (factories: Iterable<Function>) => {
	for (const factory of factories) {
		// prefilter the startup scan before running the regex
		const code = String(factory);
		if (!code.includes(BUILD_NUMBER_MARKER)) {
			continue;
		}

		const match = BUILD_NUMBER.exec(code);
		if (match) {
			return Number(match[1]);
		}
	}
	return -1;
};

// the main process calls tools through this, via `webContents.executeJavaScript`
(globalThis as Record<symbol, unknown>)[Symbol.for(BRIDGE_KEY)] = {
	handleCall(name: string, args: unknown): Promise<CallToolResult> {
		return registry.call(name, args);
	},
};

{
	let buildNumber = findBuildNumber(Object.values(spacepack.modules));

	const attach = () => {
		const info: RendererInfo = {
			tools: registry.list(),
			instance: {
				moonlightVersion: moonlight.version,
				moonlightBranch: moonlight.branch,
				releaseChannel: window.GLOBAL_ENV?.RELEASE_CHANNEL ?? 'unknown',
				buildNumber,
			},
		};

		getNatives()
			.attach(info)
			.then(
				(socket) => logger.info('MCP server socket:', socket),
				(err) => logger.error('failed to start the MCP server', err),
			);
	};

	attach();

	// update metadata if the build number arrives in a later chunk
	if (buildNumber === -1) {
		const onChunkLoad = ({ modules }: WebEventPayloads[WebEventType.ChunkLoad]) => {
			buildNumber = findBuildNumber(Object.values(modules));
			if (buildNumber !== -1) {
				moonlight.events.removeEventListener(WebEventType.ChunkLoad, onChunkLoad);
				attach();
			}
		};
		moonlight.events.addEventListener(WebEventType.ChunkLoad, onChunkLoad);
	}
}
