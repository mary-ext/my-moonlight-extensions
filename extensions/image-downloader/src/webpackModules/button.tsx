import React from 'react';

import ErrorBoundary from '@moonlight-mod/wp/common_ErrorBoundary';
import { Endpoints } from '@moonlight-mod/wp/discord/Constants';
import Clickable from '@moonlight-mod/wp/discord/design/components/Clickable/web/Clickable';
import { createToast } from '@moonlight-mod/wp/discord/design/components/Toast/web/Toast';
import { showToast } from '@moonlight-mod/wp/discord/design/components/Toast/web/ToastAPI';
import { ToastType } from '@moonlight-mod/wp/discord/design/components/Toast/web/ToastConstants';
import HoverButtonClasses from '@moonlight-mod/wp/discord/modules/chat/web/ImageHoverButtons.css';
import DownloadIcon from '@moonlight-mod/wp/discord/modules/icons/web/DownloadIcon';
import Spinner from '@moonlight-mod/wp/discord/uikit/Spinner';
import { HTTP } from '@moonlight-mod/wp/discord/utils/HTTPUtils';

import { CDN_HOSTS } from '#/lib/cdn.ts';
import type * as natives from '#/node.ts';

const logger = moonlight.getLogger('imageDownloader/button');

const REFRESH_MARGIN = 60 * 60 * 1000;

// refresh expiring attachment signatures for channels left open longer than the link's lifetime
const getFreshUrl = async (url: string) => {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return url;
	}

	if (!CDN_HOSTS.has(parsed.hostname)) {
		return url;
	}

	const expiry = Number.parseInt(parsed.searchParams.get('ex') ?? '', 16) * 1000;
	if (expiry > Date.now() + REFRESH_MARGIN) {
		return url;
	}

	try {
		const res = await HTTP.post({
			url: Endpoints.ATTACHMENTS_REFRESH_URLS,
			body: { attachment_urls: [url] },
		});

		return res.body?.refreshed_urls?.[0]?.refreshed ?? url;
	} catch (err) {
		logger.warn('failed to refresh attachment link, trying the old one', err);
		return url;
	}
};

const save = async (url: string) => {
	const native: typeof natives | undefined = moonlight.getNatives('imageDownloader');
	if (native === undefined) {
		throw new Error(`imageDownloader's natives are unavailable`);
	}

	return native.download(await getFreshUrl(url));
};

const DONE_DURATION = 3000;

type Status = 'idle' | 'busy' | 'done';

const STATUS_VIEWS: Record<Status, { icon: React.ReactElement; label: string }> = {
	idle: {
		icon: <DownloadIcon size="custom" color="currentColor" width={20} height={20} />,
		label: 'Save image',
	},
	busy: {
		icon: <Spinner type="spinningCircle" style={{ width: 20, height: 20 }} />,
		label: 'Saving image',
	},
	done: {
		icon: (
			<svg xmlns="http://www.w3.org/2000/svg" width={20} height={20} fill="none" viewBox="0 0 24 24">
				{/* Discord's CheckmarkLargeIcon, currently unmapped */}
				<path
					fill="currentColor"
					d="M21.7 5.3a1 1 0 0 1 0 1.4l-12 12a1 1 0 0 1-1.4 0l-6-6a1 1 0 1 1 1.4-1.4L9 16.58l11.3-11.3a1 1 0 0 1 1.4 0Z"
				/>
			</svg>
		),
		label: 'Saved',
	},
};

const DownloadButton = ({ url, Tooltip }: { url: string; Tooltip: Tooltip }) => {
	const [status, setStatus] = React.useState<Status>('idle');

	React.useEffect(() => {
		if (status !== 'done') {
			return undefined;
		}

		const timer = setTimeout(() => setStatus('idle'), DONE_DURATION);
		return () => clearTimeout(timer);
	}, [status]);

	const onClick = async () => {
		if (status === 'busy') {
			return;
		}

		setStatus('busy');

		try {
			await save(url);
			setStatus('done');
		} catch (err) {
			logger.error('failed to save', url, err);
			setStatus('idle');

			const reason = err instanceof Error ? err.message : String(err);

			showToast(createToast(`Couldn't save the image: ${reason}`, ToastType.FAILURE));
		}
	};

	const { icon, label } = STATUS_VIEWS[status];

	return (
		<ErrorBoundary noop>
			<Tooltip text={label}>
				<Clickable
					className={HoverButtonClasses.hoverButton}
					focusProps={{ offset: 2 }}
					onClick={onClick}
					aria-label={label}
				>
					{icon}
				</Clickable>
			</Tooltip>
		</ErrorBoundary>
	);
};

/** the props Discord passes its attachment hover toolbar */
interface ToolbarProps {
	downloadURL?: string;
	type?: string;
}

/** Discord's tooltip wrapper used by the toolbar's own buttons */
type Tooltip = React.ComponentType<{ text: string; children: React.ReactNode }>;

/**
 * renders a save button for image attachments.
 *
 * @param props Discord's attachment toolbar props
 * @param Tooltip the toolbar's tooltip component
 * @returns a keyed button, or an empty array for non-images or missing download URLs
 */
export const renderButtons = (props: ToolbarProps, Tooltip: Tooltip): React.ReactElement[] => {
	if (props.type !== 'IMAGE' || !props.downloadURL) {
		return [];
	}
	return [<DownloadButton key="imageDownloader" url={props.downloadURL} Tooltip={Tooltip} />];
};
