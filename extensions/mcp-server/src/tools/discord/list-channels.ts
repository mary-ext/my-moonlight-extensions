import * as v from 'valibot';

import { ChannelTypes } from '@moonlight-mod/wp/discord/Constants';

import { oneLine, pluralize } from '#/lib/text.ts';
import { IntSchema, defineTool } from '#/lib/tool.ts';

import { type Names, channelName, formatDate } from './lib/format.ts';
import { requireGuild, storeNames } from './lib/lookup.ts';
import { acquireDiscordLock } from './lib/read-lock.ts';
import { snowflakeToDate, SnowflakeSchema } from './lib/snowflake.ts';
import { ActiveJoinedThreadsStore, GuildChannelStore, PrivateChannelSortStore } from './lib/stores.ts';

export const listChannels = defineTool({
	name: 'list_channels',
	description: `List a server's channels and active joined threads, or the user's direct messages.`,
	annotations: { readOnlyHint: true },
	input: v.object({
		guildId: v.optional(SnowflakeSchema('Server ID; omit to list DMs')),
		limit: v.pipe(v.optional(IntSchema(1, 500), 50), v.description('Maximum number of DMs to list')),
	}),
	async handler({ guildId, limit }) {
		using _lock = await acquireDiscordLock();

		if (guildId !== undefined) {
			return listGuildChannels(guildId);
		}

		return listPrivateChannels(limit);
	},
});

const MAX_TOPIC = 120;
// GuildChannelStore files uncategorized channels under a pseudo-category with this ID
const UNCATEGORIZED = 'null';

const channelLine = (channel: any, names: Names) => {
	let line = `${channelName(channel, names)} (${channel.id})`;

	const type = (ChannelTypes[channel.type] ?? `type ${channel.type}`).replace(/^GUILD_/, '').toLowerCase();
	if (type !== 'text') {
		line += ` ${type}`;
	}
	if (channel.nsfw) {
		line += ' [age-restricted]';
	}
	if (channel.topic) {
		line += `: ${oneLine(channel.topic, MAX_TOPIC)}`;
	}
	return line;
};

const listGuildChannels = (guildId: string) => {
	const guild = requireGuild(guildId);
	const names = storeNames();

	// only holds channels the user can view, in sidebar order
	const channels = GuildChannelStore.value.getChannels(guildId);
	const threads = ActiveJoinedThreadsStore.value.getActiveJoinedThreadsForGuild(guildId);

	const byParent = new Map<string, any[]>();
	for (const { channel } of [...channels.SELECTABLE, ...channels.VOCAL]) {
		const parent: string = channel.parent_id ?? UNCATEGORIZED;
		const siblings = byParent.get(parent);
		if (siblings) {
			siblings.push(channel);
		} else {
			byParent.set(parent, [channel]);
		}
	}

	const lines = [guild.name];
	let count = 0;
	for (const { channel: category } of channels[ChannelTypes.GUILD_CATEGORY]) {
		const children = byParent.get(category.id) ?? [];
		if (!children.length) {
			continue;
		}

		lines.push('');
		if (category.id !== UNCATEGORIZED) {
			lines.push(`${category.name} (${category.id}):`);
		}

		for (const channel of children) {
			lines.push(`  ${channelLine(channel, names)}`);
			count++;

			for (const { channel: thread } of Object.values<any>(threads[channel.id] ?? {})) {
				lines.push(`    ${channelLine(thread, names)}`);
			}
		}
	}

	lines[0] += ` (${pluralize(count, 'channel')}; includes active joined threads)`;
	return lines.join('\n');
};

const listPrivateChannels = (limit: number) => {
	const names = storeNames();

	// favorites first, then by most recent activity
	const ids: string[] = PrivateChannelSortStore.value.getPrivateChannelIds();

	const lines = [`${pluralize(ids.length, 'DM')}, in DM list order:`];
	for (const id of ids.slice(0, limit)) {
		const channel = names.channel(id);
		if (!channel) {
			continue;
		}

		let line = `${channelName(channel, names)} (${id})`;
		if (channel.isDM()) {
			line += `, user ${channel.recipients[0]}`;
		} else {
			line += `, group of ${channel.recipients.length + 1}`;
		}
		if (channel.lastMessageId) {
			line += `, last message ${formatDate(snowflakeToDate(channel.lastMessageId))}`;
		}

		lines.push(line);
	}

	if (ids.length > limit) {
		lines.push(`… ${ids.length - limit} more`);
	}

	return lines.join('\n');
};
