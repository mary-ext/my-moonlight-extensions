import type { ExtensionWebExports } from '@moonlight-mod/types';

export const patches: ExtensionWebExports['patches'] = [
	{
		find: '.downloadUrl,showDownload:',
		replace: {
			match:
				/(?<=isSingleMosaicItem:\i\}=(\i),.{0,1500}?\(0,\i\.jsx\)\((\i\.\i),\{text:.{0,1500}?)let (\i)=Math\.max\(0,(\i)\.length-\i\)/,
			replacement: '$4.unshift(...require("imageDownloader_button").renderButtons($1,$2));$&',
		},
	},
];

export const webpackModules: ExtensionWebExports['webpackModules'] = {
	button: {
		dependencies: [
			{ id: 'react' },
			{ ext: 'common', id: 'ErrorBoundary' },
			{ id: 'discord/Constants' },
			{ id: 'discord/design/components/Clickable/web/Clickable' },
			{ id: 'discord/design/components/Toast/web/Toast' },
			{ id: 'discord/design/components/Toast/web/ToastAPI' },
			{ id: 'discord/design/components/Toast/web/ToastConstants' },
			{ id: 'discord/modules/chat/web/ImageHoverButtons.css' },
			{ id: 'discord/modules/icons/web/DownloadIcon' },
			{ id: 'discord/uikit/Spinner' },
			{ id: 'discord/utils/HTTPUtils' },
		],
	},
};
