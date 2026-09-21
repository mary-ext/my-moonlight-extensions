import type { ContentBlock } from '@mary-ext/moonlight-mcp/types';

import { Endpoints } from '@moonlight-mod/wp/discord/Constants';
import { HTTP } from '@moonlight-mod/wp/discord/utils/HTTPUtils';
import * as v from 'valibot';

import { channelName, formatAttachment, isVisualAttachment } from '#/lib/discord-format.ts';
import { discordGet, toApiError } from '#/lib/discord-http.ts';
import { acquireDiscordLock } from '#/lib/discord-lock.ts';
import { storeNames } from '#/lib/discord-lookup.ts';
import { createMessageRecord } from '#/lib/discord-modules.ts';
import { MessageStore } from '#/lib/flux.ts';
import { errorMessage, pluralize } from '#/lib/text.ts';
import { SnowflakeSchema, defineTool } from '#/lib/tool.ts';

const logger = moonlight.getLogger('mcpServer/getMedia');

const MAX_EDGE = 1568;
const STICKER_SIZE = 320;
const STICKER_LOTTIE = 3;
const REFRESH_MARGIN = 60 * 60 * 1000;

interface ProxySource {
	url: string;
	params: Record<string, string>;
}

interface MediaItem {
	/** description shown above the image */
	label: string;
	/** absent for media the proxy can't render */
	source?: ProxySource;
}

const fitParams = (width: number | undefined, height: number | undefined): Record<string, string> => {
	if (!width || !height) {
		return {};
	}
	const scale = Math.min(1, MAX_EDGE / Math.max(width, height));
	return { width: String(Math.round(width * scale)), height: String(Math.round(height * scale)) };
};

const collectMedia = (message: any, prefix = ''): MediaItem[] => {
	const items: MediaItem[] = [];

	for (const a of message.attachments ?? []) {
		const label = `${prefix}attachment ${formatAttachment(a)}`;
		if (!isVisualAttachment(a)) {
			items.push({ label: `${label} (preview unavailable)` });
		} else {
			items.push({
				label: a.content_type.startsWith('video/') ? `${label} (thumbnail)` : label,
				source: { url: a.proxy_url, params: fitParams(a.width, a.height) },
			});
		}
	}

	for (const e of message.embeds ?? []) {
		// video embeds carry their preview frame as the thumbnail
		const image = e.image ?? e.thumbnail;
		if (image?.proxyURL) {
			const title = e.rawTitle ? ` ${e.rawTitle}` : '';
			const dimensions = image.width ? `, ${image.width}×${image.height}` : '';
			items.push({
				label: `${prefix}embed${title}${dimensions}: ${e.url ?? image.url}`,
				source: { url: image.proxyURL, params: fitParams(image.width, image.height) },
			});
		}
	}

	for (const s of message.stickerItems ?? []) {
		if (s.format_type === STICKER_LOTTIE) {
			items.push({ label: `${prefix}sticker ${s.name} (Lottie; preview unavailable)` });
		} else {
			items.push({
				label: `${prefix}sticker ${s.name}`,
				source: {
					url: `https://media.discordapp.net/stickers/${s.id}.webp`,
					params: { size: String(STICKER_SIZE) },
				},
			});
		}
	}

	for (const { message: snapshot } of message.messageSnapshots ?? []) {
		items.push(...collectMedia(snapshot, 'forwarded '));
	}

	return items;
};

const isExpiring = (url: string): boolean => {
	// attachment URL expiry is a hex-encoded Unix timestamp
	const ex = new URL(url).searchParams.get('ex');
	return ex !== null && Number.parseInt(ex, 16) * 1000 < Date.now() + REFRESH_MARGIN;
};

const refreshUrls = async (items: MediaItem[]): Promise<MediaItem[]> => {
	const expiring = items.flatMap(({ source }) => (source && isExpiring(source.url) ? [source.url] : []));
	if (!expiring.length) {
		return items;
	}

	let refreshed: Map<string, string>;
	try {
		const res = await HTTP.post({
			url: Endpoints.ATTACHMENTS_REFRESH_URLS,
			body: { attachment_urls: expiring },
		});
		refreshed = new Map(res.body.refreshed_urls.map((r: any) => [r.original, r.refreshed]));
	} catch (e) {
		logger.warn('attachment URL refresh failed; using existing URLs', toApiError(e));
		return items;
	}

	return items.map((item) => {
		if (!item.source) {
			return item;
		}
		const url = refreshed.get(item.source.url);
		return url ? { ...item, source: { ...item.source, url } } : item;
	});
};

const fetchImage = async ({ url, params }: ProxySource): Promise<ContentBlock> => {
	const request = new URL(url);
	request.searchParams.set('format', 'webp');
	for (const [key, value] of Object.entries(params)) {
		request.searchParams.set(key, value);
	}

	const res = await fetch(request);
	if (!res.ok) {
		throw new Error(`Media proxy returned ${res.status}`);
	}

	const bytes = new Uint8Array(await res.arrayBuffer());
	return { type: 'image', data: bytes.toBase64(), mimeType: res.headers.get('content-type') ?? 'image/webp' };
};

const loadMessage = async (channelId: string, messageId: string): Promise<any> => {
	const cached = MessageStore.value.getMessage(channelId, messageId);
	if (cached) {
		return cached;
	}

	const body: any[] = await discordGet(Endpoints.MESSAGES(channelId), { around: messageId, limit: '1' });
	const message = body.find((m) => m.id === messageId);
	if (!message) {
		throw new Error(`Message ${messageId} not found in channel ${channelId}`);
	}
	return createMessageRecord.value(message);
};

export const getMedia = defineTool({
	name: 'get_media',
	description: `View images, video thumbnails and stickers from a message.`,
	annotations: { readOnlyHint: true, openWorldHint: true },
	input: v.object({
		channelId: SnowflakeSchema('Channel, thread or DM channel ID'),
		messageId: SnowflakeSchema('Message ID'),
	}),
	async handler({ channelId, messageId }) {
		let items: MediaItem[];
		{
			// media proxy downloads don't need the Discord API lock
			using _lock = await acquireDiscordLock();

			const collected = collectMedia(await loadMessage(channelId, messageId));
			if (!collected.length) {
				throw new Error(`Message ${messageId} has no media`);
			}

			items = await refreshUrls(collected);
		}

		const blocks = await Promise.all(
			items.map(async ({ label, source }, i): Promise<ContentBlock[]> => {
				const numbered = `[${i + 1}] ${label}`;
				if (!source) {
					return [{ type: 'text', text: numbered }];
				}

				try {
					return [{ type: 'text', text: numbered }, await fetchImage(source)];
				} catch (e) {
					return [{ type: 'text', text: `${numbered} (failed: ${errorMessage(e)})` }];
				}
			}),
		);

		const names = storeNames();
		const channel = names.channel(channelId);
		const where = channel ? channelName(channel, names) : `channel ${channelId}`;

		const header = `message ${messageId} in ${where}: ${pluralize(items.length, 'media item')}`;
		return { content: [{ type: 'text', text: header }, ...blocks.flat()] };
	},
});
