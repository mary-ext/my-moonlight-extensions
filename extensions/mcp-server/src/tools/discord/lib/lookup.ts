import type { Names } from './format.ts';
import { ChannelStore, GuildMemberStore, GuildRoleStore, GuildStore, UserStore } from './stores.ts';

/**
 * provides name lookups from client stores and API mentions.
 *
 * @param apiMessages API messages with user mentions to supplement the stores
 * @returns store lookups, preferring users from `apiMessages` mentions
 */
export const storeNames = (apiMessages: any[] = []): Names => {
	const mentioned = new Map<string, any>();
	for (const message of apiMessages) {
		for (const user of message.mentions ?? []) {
			mentioned.set(user.id, user);
		}
	}

	return {
		user(id) {
			return mentioned.get(id) ?? UserStore.value.getUser(id);
		},
		nick(guildId, userId) {
			return GuildMemberStore.value.getNick(guildId, userId) ?? undefined;
		},
		role(guildId, roleId) {
			return GuildRoleStore.value.getRole(guildId, roleId);
		},
		channel(id) {
			return ChannelStore.value.getChannel(id);
		},
	};
};

/**
 * finds a server the user is in.
 *
 * @param guildId server ID
 * @returns the guild record
 * @throws if the user isn't in that server
 */
export const requireGuild = (guildId: string): any => {
	const guild = GuildStore.value.getGuild(guildId);
	if (!guild) {
		throw new Error(`Unknown server ${guildId}; use list_guilds`);
	}
	return guild;
};
