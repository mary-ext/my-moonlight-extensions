import type { ContentBlock } from '@mary-ext/moonlight-mcp/types';

import * as v from 'valibot';

import { Endpoints } from '@moonlight-mod/wp/discord/Constants';
import { HTTP } from '@moonlight-mod/wp/discord/utils/HTTPUtils';

import { getNatives } from '#/lib/natives.ts';
import { errorMessage, pluralize } from '#/lib/text.ts';
import type { ToolRegistry } from '#/lib/tool.ts';

import { channelName, formatAttachment, isImageAttachment, isVideoAttachment } from './lib/format.ts';
import { discordGet, toApiError } from './lib/http.ts';
import { storeNames } from './lib/lookup.ts';
import { createMessageRecord } from './lib/modules.ts';
import { acquireDiscordLock } from './lib/read-lock.ts';
import { SnowflakeSchema } from './lib/snowflake.ts';
import { MessageStore } from './lib/stores.ts';

/**
 * registers the `get_media` tool.
 *
 * @param registry registry to add the tool to
 */
export const registerGetMedia = (registry: ToolRegistry): void => {
	registry.define({
		name: 'get_media',
		description: `View message attachments, embed previews and stickers.`,
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
				items.map(async (item, i): Promise<ContentBlock[]> => {
					const numbered = `[${i + 1}] ${item.label}`;
					try {
						switch (item.kind) {
							case 'file': {
								const file = await getNatives().saveMedia({ url: item.url, name: item.name });
								return [{ type: 'text', text: `${numbered}, saved to ${file}` }];
							}
							case 'image': {
								return [{ type: 'text', text: numbered }, await fetchImage(item)];
							}
							default: {
								return [{ type: 'text', text: numbered }];
							}
						}
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
};

const logger = moonlight.getLogger('mcpServer/getMedia');

const MAX_EDGE = 1568;
const STICKER_SIZE = 320;
const STICKER_LOTTIE = 3;
const REFRESH_MARGIN = 60 * 60 * 1000;

interface ProxySource {
	url: string;
	params: Record<string, string>;
}

type MediaItem =
	| { kind: 'file'; label: string; url: string; name: string }
	| ({ kind: 'image'; label: string } & ProxySource)
	| { kind: 'unavailable'; label: string };

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
		if (isVideoAttachment(a)) {
			// attachment IDs prevent name collisions and keep paths stable across calls
			items.push({ kind: 'file', label, url: a.url, name: `${a.id}-${a.filename}` });
		} else if (isImageAttachment(a)) {
			items.push({ kind: 'image', label, url: a.proxy_url, params: fitParams(a.width, a.height) });
		} else {
			items.push({ kind: 'unavailable', label: `${label} (preview unavailable)` });
		}
	}

	for (const e of message.embeds ?? []) {
		// video embeds carry their preview frame as the thumbnail
		const image = e.image ?? e.thumbnail;
		if (image?.proxyURL) {
			const title = e.rawTitle ? ` ${e.rawTitle}` : '';
			const dimensions = image.width ? `, ${image.width}×${image.height}` : '';
			items.push({
				kind: 'image',
				label: `${prefix}embed${title}${dimensions}: ${e.url ?? image.url}`,
				url: image.proxyURL,
				params: fitParams(image.width, image.height),
			});
		}
	}

	for (const s of message.stickerItems ?? []) {
		if (s.format_type === STICKER_LOTTIE) {
			items.push({ kind: 'unavailable', label: `${prefix}sticker ${s.name} (Lottie; preview unavailable)` });
		} else {
			items.push({
				kind: 'image',
				label: `${prefix}sticker ${s.name}`,
				url: `https://media.discordapp.net/stickers/${s.id}.webp`,
				params: { size: String(STICKER_SIZE) },
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
	const expiring = items.flatMap((item) =>
		item.kind !== 'unavailable' && isExpiring(item.url) ? [item.url] : [],
	);
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
		if (item.kind === 'unavailable') {
			return item;
		}
		const url = refreshed.get(item.url);
		return url ? { ...item, url } : item;
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
