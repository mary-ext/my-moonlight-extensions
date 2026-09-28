import type { ExtensionWebExports } from '@moonlight-mod/types';

import { FINDS } from '#/lib/finds.ts';

// patch shared navigation and title bar code to avoid depending on Discord's tabs experiment
export const patches: ExtensionWebExports['patches'] = [
	// title bar layout: show the tab bar in place of the title
	{
		find: '"data-window-chrome":"true"',
		replace: {
			match: /(function \i\((\i)\)\{)(let\{leading:)/,
			replacement: '$1$2=require("channelTabs_ui").useTitleBarProps($2);$3',
		},
	},
	// title bar back/forward buttons: reflect the active tab's history
	{
		find: /canGoBack:\i\.canGoBack\?\?!1/,
		replace: {
			match: /(\{canGoBack:(\i),canGoForward:(\i)\}=function\(\)\{.+?\}\(\));(?=return)/,
			replacement:
				'$1;({canGoBack:$2,canGoForward:$3}=require("channelTabs_ui").useBackForwardState($2,$3));',
		},
	},
	// back/forward actions: move through the active tab's history first
	{
		find: '.APP_BACK_FORWARD_NAVIGATED,{nav_direction:',
		replace: {
			match: /(function \i\(\i\)\{if\(!\(0,\i\.\i\)\(\)\)return;)(?=[^}]*?nav_direction:(-?1))/g,
			replacement: '$1if(require("channelTabs_tabs").navigateHistory($2))return;',
		},
	},
	// quick switcher: ctrl/cmd+enter opens the result in a new tab
	{
		find: /case"enter":\{if\(-1===\i\)return;/,
		replace: {
			match: /(\i)\.altKey\)return this\.handleContextMenu\(\1\);let (\i)=\i\[\i\];if\(null==\2\)return;/,
			replacement:
				'$&if(($1.metaKey||$1.ctrlKey)&&require("channelTabs_entrypoint").openQuickSwitcherResult($2))return;',
		},
	},
];

export const webpackModules: ExtensionWebExports['webpackModules'] = {
	discord: {
		dependencies: [{ ext: 'spacepack', id: 'spacepack' }, ...Object.values(FINDS).flat()],
	},
	entrypoint: {
		dependencies: [
			{ ext: 'channelTabs', id: 'discord' },
			{ ext: 'channelTabs', id: 'tabs' },
			{ ext: 'common', id: 'stores' },
			{ id: 'discord/Constants' },
			{ id: 'discord/Dispatcher' },
			{ id: 'discord/modules/modals/Modals' },
			{ id: 'discord/stores/ChannelStore' },
		],
		entrypoint: true,
	},
	tabs: {
		dependencies: [
			{ id: 'react' },
			{ ext: 'channelTabs', id: 'discord' },
			{ ext: 'common', id: 'stores' },
			{ id: 'discord/Constants' },
			{ id: 'discord/Dispatcher' },
			{ id: 'discord/lib/web/Storage' },
			{ id: 'discord/stores/ChannelStore' },
			{ id: 'discord/stores/SelectedChannelStore' },
		],
	},
	ui: {
		dependencies: [
			{ id: 'react' },
			{ ext: 'channelTabs', id: 'discord' },
			{ ext: 'channelTabs', id: 'tabs' },
			{ ext: 'common', id: 'ErrorBoundary' },
			{ ext: 'common', id: 'stores' },
			{ ext: 'contextMenu', id: 'contextMenu' },
			{ id: 'discord/actions/ContextMenuActionCreators' },
			{ id: 'discord/Constants' },
			{ id: 'discord/design/components/Clickable/web/Clickable' },
			{ id: 'discord/design/components/Text/Text' },
			{ id: 'discord/modules/icons/web/PlusLargeIcon' },
			{ id: 'discord/modules/icons/web/StarIcon' },
			{ id: 'discord/modules/icons/web/XSmallIcon' },
			{ id: 'discord/modules/menus/web/Menu' },
			{ id: 'discord/packages/flux' },
			{ id: 'discord/stores/ChannelStore' },
			{ id: 'discord/stores/GuildStore' },
			{ id: 'discord/stores/ReadStateStore' },
			{ id: 'discord/stores/RelationshipStore' },
			{ id: 'discord/stores/SelectedChannelStore' },
			{ id: 'discord/stores/UserGuildSettingsStore' },
			{ id: 'discord/utils/AvatarUtils' },
			{ id: 'discord/utils/NativeUtils' },
		],
	},
};
