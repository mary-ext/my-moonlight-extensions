import type { CallToolResult } from '@mary-ext/moonlight-mcp/types';

import { type WebEventPayloads, WebEventType } from '@moonlight-mod/types/core/event';
import spacepack from '@moonlight-mod/wp/spacepack_spacepack';

import { isDeveloperMode, isReadToolsEnabled } from '#/lib/config.ts';
import { BRIDGE_KEY, type RendererInfo } from '#/lib/ipc.ts';
import { getNatives } from '#/lib/natives.ts';
import { ToolRegistry } from '#/lib/tool.ts';
import { registerGetGuild } from '#/tools/discord/get-guild.ts';
import { registerGetMedia } from '#/tools/discord/get-media.ts';
import { registerGetMessages } from '#/tools/discord/get-messages.ts';
import { registerGetUser } from '#/tools/discord/get-user.ts';
import { registerListChannels } from '#/tools/discord/list-channels.ts';
import { registerListGuilds } from '#/tools/discord/list-guilds.ts';
import { registerListThreads } from '#/tools/discord/list-threads.ts';
import { registerSearchMessages } from '#/tools/discord/search-messages.ts';
import { registerExtensionSettings } from '#/tools/moonlight/extension-settings.ts';
import { registerGetLogs } from '#/tools/moonlight/get-logs.ts';
import { registerListExtensions } from '#/tools/moonlight/list-extensions.ts';
import { registerReload } from '#/tools/moonlight/reload.ts';
import { registerSetExtensionEnabled } from '#/tools/moonlight/set-extension-enabled.ts';
import { registerCheckPatches } from '#/tools/patches/check-patches.ts';
import { registerTestPatch } from '#/tools/patches/test-patch.ts';
import { registerCaptureFlux } from '#/tools/runtime/capture-flux.ts';
import { registerEvaluate } from '#/tools/runtime/evaluate.ts';
import { registerInspectReact } from '#/tools/runtime/inspect-react.ts';
import { registerInspectStore } from '#/tools/runtime/inspect-store.ts';
import { registerListStores } from '#/tools/runtime/list-stores.ts';
import { registerQueryDom } from '#/tools/runtime/query-dom.ts';
import { registerFindExports } from '#/tools/webpack/find-exports.ts';
import { registerGetModuleSource } from '#/tools/webpack/get-module-source.ts';
import { registerListMappings } from '#/tools/webpack/list-mappings.ts';
import { registerLoadLazyChunks } from '#/tools/webpack/load-lazy-chunks.ts';
import { registerModuleInfo } from '#/tools/webpack/module-info.ts';
import { registerSearchModules } from '#/tools/webpack/search-modules.ts';
import { registerSuggestFind } from '#/tools/webpack/suggest-find.ts';

declare global {
	interface Window {
		GLOBAL_ENV?: { RELEASE_CHANNEL?: string };
	}
}

const logger = moonlight.getLogger('mcpServer/server');

const registry = new ToolRegistry();
registerEvaluate(registry);
registerListStores(registry);
registerInspectStore(registry);
registerCaptureFlux(registry);
registerQueryDom(registry);
registerReload(registry);

if (isDeveloperMode()) {
	registerTestPatch(registry);
	registerCheckPatches(registry);
	registerSearchModules(registry);
	registerGetModuleSource(registry);
	registerModuleInfo(registry);
	registerListMappings(registry);
	registerFindExports(registry);
	registerSuggestFind(registry);
	registerLoadLazyChunks(registry);
	registerInspectReact(registry);
	registerListExtensions(registry);
	registerSetExtensionEnabled(registry);
	registerExtensionSettings(registry);
	registerGetLogs(registry);
}

if (isReadToolsEnabled()) {
	registerListGuilds(registry);
	registerGetGuild(registry);
	registerListChannels(registry);
	registerListThreads(registry);
	registerGetMessages(registry);
	registerGetMedia(registry);
	registerSearchMessages(registry);
	registerGetUser(registry);
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
