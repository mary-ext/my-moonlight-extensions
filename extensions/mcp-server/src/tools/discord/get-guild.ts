import * as v from 'valibot';

import { channelName, formatDate, formatUser } from '#/lib/discord-format.ts';
import { acquireDiscordLock } from '#/lib/discord-lock.ts';
import { requireGuild, storeNames } from '#/lib/discord-lookup.ts';
import { snowflakeToDate } from '#/lib/discord-snowflake.ts';
import { GuildMemberCountStore, GuildRoleStore } from '#/lib/flux.ts';
import { pluralize } from '#/lib/text.ts';
import { SnowflakeSchema, defineTool } from '#/lib/tool.ts';

export const getGuild = defineTool({
	name: 'get_guild',
	description: `Show a server's details and roles.`,
	annotations: { readOnlyHint: true },
	input: v.object({
		guildId: SnowflakeSchema('Server ID'),
	}),
	async handler({ guildId }) {
		using _lock = await acquireDiscordLock();

		const guild = requireGuild(guildId);
		const names = storeNames();

		const lines = [`${guild.name} (${guild.id})`];
		if (guild.description) {
			lines.push(guild.description);
		}

		lines.push(`created: ${formatDate(snowflakeToDate(guild.id))}`);
		{
			const owner = names.user(guild.ownerId);
			lines.push(`owner: ${owner ? formatUser(owner, { guildId, names }) : guild.ownerId}`);
		}
		{
			const members: number | undefined = GuildMemberCountStore.value.getMemberCount(guildId);
			if (members) {
				lines.push(`members: ${members}`);
			}
		}
		if (guild.premiumTier) {
			lines.push(`boost level ${guild.premiumTier}, ${pluralize(guild.premiumSubscriberCount, 'boost')}`);
		}
		if (guild.vanityURLCode) {
			lines.push(`invite: discord.gg/${guild.vanityURLCode}`);
		}
		if (guild.joinedAt) {
			lines.push(`joined at: ${formatDate(new Date(guild.joinedAt))}`);
		}

		for (const [label, id] of [
			['rules channel', guild.rulesChannelId],
			['system channel', guild.systemChannelId],
		]) {
			const channel = id ? names.channel(id) : undefined;
			if (channel) {
				lines.push(`${label}: ${channelName(channel, names)} (${channel.id})`);
			}
		}

		{
			const roles = Object.values<any>(GuildRoleStore.value.getUnsafeMutableRoles(guildId)).toSorted(
				(a, b) => b.position - a.position,
			);

			lines.push('', `${pluralize(roles.length, 'role')}, highest first:`);
			for (const role of roles) {
				const flags: string[] = [];
				if (role.hoist) {
					flags.push('shown separately');
				}
				if (role.managed) {
					flags.push('managed');
				}
				lines.push(`${role.name} (${role.id})${flags.length ? ` [${flags.join(', ')}]` : ''}`);
			}
		}

		return lines.join('\n');
	},
});
