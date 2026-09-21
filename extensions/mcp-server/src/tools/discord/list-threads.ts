import { ChannelTypes, Endpoints, Permissions } from '@moonlight-mod/wp/discord/Constants';
import * as v from 'valibot';

import { pluralize } from '#/lib/text.ts';
import { IntSchema, defineTool } from '#/lib/tool.ts';

import { type Names, channelName, formatDate, formatUser } from './lib/format.ts';
import { discordGet } from './lib/http.ts';
import { storeNames } from './lib/lookup.ts';
import { acquireDiscordLock } from './lib/read-lock.ts';
import { compareSnowflakes, snowflakeToDate, SnowflakeSchema } from './lib/snowflake.ts';
import { ActiveThreadsStore, PermissionStore } from './lib/stores.ts';

export const listThreads = defineTool({
	name: 'list_threads',
	description: `List channel threads or forum and media posts.`,
	annotations: { readOnlyHint: true, openWorldHint: true },
	input: v.object({
		channelId: SnowflakeSchema('Text, announcement, forum or media channel ID'),
		offset: v.pipe(
			v.optional(IntSchema(0, 10_000), 0),
			v.description('Archived threads to skip, from the previous result'),
		),
	}),
	async handler({ channelId, offset }) {
		using _lock = await acquireDiscordLock();

		const names = storeNames();

		const channel = names.channel(channelId);
		if (!channel || !THREAD_PARENT_TYPES.has(channel.type)) {
			throw new Error(`${channelId} isn't a server channel that can have threads; use list_channels`);
		}
		const guildId: string = channel.guild_id;

		const tagNames = new Map<string, string>();
		for (const tag of channel.availableTags ?? []) {
			tagNames.set(tag.id, tag.name);
		}

		const lines = [channelName(channel, names)];

		// active threads aren't paginated; include them only on the first page
		if (offset === 0) {
			const active: any[] = Object.values<any>(
				ActiveThreadsStore.value.getThreadsForParent(guildId, channelId),
			)
				.map(({ id }) => names.channel(id))
				.filter((thread) => thread && PermissionStore.value.can(Permissions.VIEW_CHANNEL, thread))
				.toSorted((a, b) => compareSnowflakes(b.lastMessageId ?? b.id, a.lastMessageId ?? a.id));

			lines.push('', `${pluralize(active.length, 'active thread')}:`);
			for (const thread of active) {
				lines.push(threadLine(fromRecord(thread, names), names, tagNames));
			}
		}

		if (!PermissionStore.value.can(Permissions.READ_MESSAGE_HISTORY, channel)) {
			lines.push('', `archived threads unavailable: missing read message history permission`);
			return lines.join('\n');
		}

		// bypass the browser's loader, which resets its list and scroll position
		const body = await discordGet(Endpoints.THREAD_SEARCH(channelId), {
			archived: 'true',
			sort_by: 'last_message_time',
			sort_order: 'desc',
			limit: String(PAGE_SIZE),
			tag_setting: 'match_some',
			offset: String(offset),
		});

		lines.push('', `archived threads from ${offset}:`);
		for (const thread of body.threads ?? []) {
			lines.push(threadLine(fromApi(thread, names), names, tagNames));
		}
		if (!body.threads?.length) {
			lines.push('none');
		}
		if (body.has_more) {
			lines.push('', `more archived: offset=${offset + PAGE_SIZE}`);
		}

		return lines.join('\n');
	},
});

// the thread browser's page size
const PAGE_SIZE = 25;

const THREAD_PARENT_TYPES = new Set<number>([
	ChannelTypes.GUILD_TEXT,
	ChannelTypes.GUILD_ANNOUNCEMENT,
	ChannelTypes.GUILD_FORUM,
	ChannelTypes.GUILD_MEDIA,
]);

interface ThreadSummary {
	id: string;
	name: string;
	private: boolean;
	guildId: string;
	ownerId: string;
	/** owner user record, if known */
	owner: any;
	messageCount: number | undefined;
	lastMessageId: string | undefined;
	archived: boolean;
	locked: boolean;
	appliedTags: string[];
}

const fromRecord = (thread: any, names: Names): ThreadSummary => {
	return {
		id: thread.id,
		name: thread.name,
		private: thread.type === ChannelTypes.PRIVATE_THREAD,
		guildId: thread.guild_id,
		ownerId: thread.ownerId,
		owner: names.user(thread.ownerId),
		messageCount: thread.messageCount,
		lastMessageId: thread.lastMessageId ?? undefined,
		archived: thread.threadMetadata?.archived ?? false,
		locked: thread.threadMetadata?.locked ?? false,
		appliedTags: thread.appliedTags ?? [],
	};
};

const fromApi = (thread: any, names: Names): ThreadSummary => {
	return {
		id: thread.id,
		name: thread.name,
		private: thread.type === ChannelTypes.PRIVATE_THREAD,
		guildId: thread.guild_id,
		ownerId: thread.owner_id,
		owner: names.user(thread.owner_id) ?? thread.owner?.user,
		messageCount: thread.message_count,
		lastMessageId: thread.last_message_id ?? undefined,
		archived: thread.thread_metadata?.archived ?? false,
		locked: thread.thread_metadata?.locked ?? false,
		appliedTags: thread.applied_tags ?? [],
	};
};

const threadLine = (thread: ThreadSummary, names: Names, tagNames: Map<string, string>) => {
	const details: string[] = [];
	if (thread.messageCount !== undefined) {
		details.push(pluralize(thread.messageCount, 'message'));
	}
	details.push(`last activity ${formatDate(snowflakeToDate(thread.lastMessageId ?? thread.id))}`);
	{
		const owner = thread.owner
			? formatUser(thread.owner, { guildId: thread.guildId, names })
			: thread.ownerId;
		details.push(`started by ${owner}`);
	}

	const flags: string[] = [];
	if (thread.archived) {
		flags.push('archived');
	}
	if (thread.locked) {
		flags.push('locked');
	}
	if (thread.private) {
		flags.push('private');
	}
	for (const id of thread.appliedTags) {
		flags.push(`tag: ${tagNames.get(id) ?? id}`);
	}

	let line = `#${thread.name} (${thread.id}), ${details.join(', ')}`;
	if (flags.length) {
		line += ` [${flags.join(', ')}]`;
	}
	return line;
};
