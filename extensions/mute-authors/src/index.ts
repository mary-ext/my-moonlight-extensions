import type { ExtensionWebExports } from '@moonlight-mod/types';

const muteCheck = (channel: string, message: string): string => {
	return (
		'if(require("muteAuthors_rules").isMuted({authorId:' +
		message +
		'.author?.id,channelId:' +
		channel +
		'}))return!1;'
	);
};

export const patches: ExtensionWebExports['patches'] = [
	{
		find: '"RpcNotificationSettingsStore"',
		replace: [
			// shouldNotify: desktop notifications, sounds and the overlay
			{
				match: /function \i\((\i),(\i)\)\{[^}]*?SUPPRESS_NOTIFICATIONS\)\)return!1;/,
				replacement: (orig, message: string, channel: string) => orig + muteCheck(channel, message),
			},
			// selected-channel sounds use a separate check
			{
				match:
					/function \i\((\i),(\i)\)\{(?=if\(\i\.\i\.getChannelId\(\i\.\i\.getGuildId\(\)\)!==\2\)return!1;)/,
				replacement: (orig, message: string, channel: string) => orig + muteCheck(channel, message),
			},
		],
	},
];

export const webpackModules: ExtensionWebExports['webpackModules'] = {
	menu: {
		dependencies: [
			{ id: 'react' },
			{ ext: 'contextMenu', id: 'contextMenu' },
			{ ext: 'muteAuthors', id: 'rules' },
		],
		entrypoint: true,
	},
	rules: {},
};
