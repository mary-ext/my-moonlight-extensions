import { Endpoints } from '@moonlight-mod/wp/discord/Constants';
import * as v from 'valibot';

import { pluralize } from '#/lib/text.ts';
import { IntSchema, defineTool } from '#/lib/tool.ts';

import { channelName, formatMessage } from './lib/format.ts';
import { discordGet } from './lib/http.ts';
import { storeNames } from './lib/lookup.ts';
import { loadMessageMembers } from './lib/message-members.ts';
import { createMessageRecord } from './lib/modules.ts';
import { acquireDiscordLock } from './lib/read-lock.ts';
import { compareSnowflakes, SnowflakeSchema } from './lib/snowflake.ts';
import { GuildStore, MessageStore, ReadStateStore } from './lib/stores.ts';

export const getMessages = defineTool({
	name: 'get_messages',
	description: `Read channel, thread or DM messages.`,
	annotations: { readOnlyHint: true, openWorldHint: true },
	input: v.object({
		channelId: SnowflakeSchema('Channel, thread or DM channel ID'),
		before: v.optional(SnowflakeSchema('Return messages before this message ID')),
		after: v.optional(SnowflakeSchema('Return messages after this message ID')),
		around: v.optional(SnowflakeSchema('Return messages around this message ID, including it')),
		limit: v.optional(IntSchema(1, 100), 50),
	}),
	async handler({ channelId, before, after, around, limit }) {
		const cursorCount = [before, after, around].filter((c) => c !== undefined).length;
		if (cursorCount > 1) {
			throw new Error(`Pass at most one of before, after and around`);
		}

		using _lock = await acquireDiscordLock();

		const cursor: Cursor = { before, after, around };
		let names = storeNames();
		const channel = names.channel(channelId);
		const parent = channel?.parent_id ? names.channel(channel.parent_id) : undefined;
		const guildId: string | null = channel?.guild_id ?? null;

		if (channel?.isForumLikeChannel()) {
			throw new Error(
				`${channelName(channel, names)} contains posts; use list_threads, then get_messages on a post`,
			);
		}

		// forum and media posts open at the starter message, which shares the post's ID
		if (channel?.isForumPost() && cursorCount === 0) {
			cursor.around = channelId;
		}

		let messages = readCached(channelId, cursor, limit);
		if (!messages) {
			const body: any[] = await discordGet(Endpoints.MESSAGES(channelId), {
				limit: String(limit),
				before: cursor.before,
				after: cursor.after,
				around: cursor.around,
			});
			messages = body.map(createMessageRecord.value).toReversed();
			names = storeNames(body);
		}

		if (guildId !== null) {
			await loadMessageMembers(guildId, messages);
		}

		let where = channel ? channelName(channel, names) : `channel ${channelId}`;
		if (parent && channel.isThread()) {
			where += ` (${channel.isForumPost() ? 'post' : 'thread'} in ${channelName(parent, names)})`;
		}
		if (guildId !== null) {
			const guild = GuildStore.value.getGuild(guildId);
			where += ` in ${guild?.name ?? guildId}`;
		}

		const lines = [`${where}: ${pluralize(messages.length, 'message')}`];
		for (const message of messages) {
			lines.push('', formatMessage(message, { guildId, names }));
		}

		if (messages.length) {
			const pages = [`older: before=${messages[0].id}`];

			// only cursor-based pages can have newer messages
			if (cursor.before !== undefined || cursor.after !== undefined || cursor.around !== undefined) {
				pages.push(`newer: after=${messages.at(-1).id}`);
			}

			lines.push('', pages.join(' · '));
		}

		return lines.join('\n');
	},
});

interface Cursor {
	before?: string;
	after?: string;
	around?: string;
}

/**
 * reads a complete page from the live message cache, avoiding an API request.
 *
 * @returns messages oldest first, or null if the cache can't answer the whole page
 */
const readCached = (channelId: string, { before, after, around }: Cursor, limit: number): any[] | null => {
	const cm = MessageStore.value.getMessages(channelId);
	// `cached` means the window came from the local database and may be stale
	if (!cm.ready || cm.cached || cm.loadingMore || around !== undefined) {
		return null;
	}

	const all: any[] = cm.toArray();

	// read state can know about messages absent from MessageStore; reject a cache that has fallen behind
	const reachesPresent = () => {
		if (cm.hasMoreAfter) {
			return false;
		}
		const latest: string | undefined = ReadStateStore.value.lastMessageId(channelId);
		const newest: string | undefined = all.at(-1)?.id;
		return !latest || (newest !== undefined && compareSnowflakes(newest, latest) >= 0);
	};

	if (before !== undefined) {
		const i = cm.indexOf(before);
		if (i === -1) {
			return null;
		}
		if (i >= limit) {
			return all.slice(i - limit, i);
		}
		return cm.hasMoreBefore ? null : all.slice(0, i);
	}

	if (after !== undefined) {
		const i = cm.indexOf(after);
		if (i === -1) {
			return null;
		}
		if (all.length - 1 - i >= limit) {
			return all.slice(i + 1, i + 1 + limit);
		}
		return reachesPresent() ? all.slice(i + 1) : null;
	}

	if (!reachesPresent()) {
		return null;
	}
	if (all.length >= limit) {
		return all.slice(-limit);
	}
	return cm.hasMoreBefore ? null : all;
};
