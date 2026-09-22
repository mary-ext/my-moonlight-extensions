import * as v from 'valibot';

import { getUser as fetchUser } from '@moonlight-mod/wp/discord/actions/UserActionCreators';
import { ActivityTypes } from '@moonlight-mod/wp/discord/Constants';

import { errorMessage, indent } from '#/lib/text.ts';
import type { ToolRegistry } from '#/lib/tool.ts';

import { formatDate, formatUser } from './lib/format.ts';
import { toApiError } from './lib/http.ts';
import { storeNames } from './lib/lookup.ts';
import { fetchProfile } from './lib/modules.ts';
import { acquireDiscordLock } from './lib/read-lock.ts';
import { snowflakeToDate, SnowflakeSchema } from './lib/snowflake.ts';
import {
	GuildMemberStore,
	GuildRoleStore,
	GuildStore,
	PresenceStore,
	RelationshipStore,
	UserProfileStore,
	UserStore,
} from './lib/stores.ts';

// omit non-visible relationship types: none, implicit and suggestion
const RELATIONSHIPS: Record<number, string> = {
	1: 'friend',
	2: 'blocked',
	3: 'incoming friend request',
	4: 'outgoing friend request',
};

const PREMIUM_TIERS: Record<number, string> = {
	1: 'nitro classic',
	2: 'nitro',
	3: 'nitro basic',
};

const isRedundantBadge = (id: string) => {
	return id === 'account_age' || id === 'premium' || id.startsWith('premium_tenure_');
};

/**
 * registers the `get_user` tool.
 *
 * @param registry registry to add the tool to
 */
export const registerGetUser = (registry: ToolRegistry): void => {
	registry.define({
		name: 'get_user',
		description: `Look up a user's profile, presence, relationship and mutual servers.`,
		annotations: { readOnlyHint: true, openWorldHint: true },
		input: v.object({
			userId: v.optional(SnowflakeSchema('User ID; omit for the logged-in user')),
			guildId: v.optional(SnowflakeSchema(`Guild ID for guild-specific profile information`)),
		}),
		async handler({ userId: requestedId, guildId }) {
			using _lock = await acquireDiscordLock();

			const currentUserId: string = UserStore.value.getCurrentUser().id;
			const userId = requestedId ?? currentUserId;

			let profileError: unknown;
			try {
				await fetchProfile.value(userId, undefined, {
					type: 'modal',
					guildId,
					withMutualGuilds: true,
					withMutualFriendsCount: true,
				});
			} catch (e) {
				profileError = e;
			}

			let user = UserStore.value.getUser(userId);
			if (!user) {
				// a basic user lookup can succeed even when the profile is unavailable
				try {
					user = await fetchUser(userId);
				} catch (e) {
					throw toApiError(e);
				}
			}

			const lines = [formatUser(user, { guildId: guildId ?? null, names: storeNames() })];
			{
				let kind = 'user';
				if (user.system) {
					kind = 'system';
				} else if (user.bot) {
					kind = 'bot';
				}
				lines.push(`${kind}, created ${formatDate(snowflakeToDate(user.id))}`);
			}

			const profile = UserProfileStore.value.getUserProfile(userId);
			if (profile) {
				const guildProfile =
					guildId !== undefined ? UserProfileStore.value.getGuildMemberProfile(userId, guildId) : null;
				const pronouns = guildProfile?.pronouns || profile.pronouns;
				const bio = guildProfile?.bio || profile.bio;

				if (pronouns) {
					lines.push(`pronouns: ${pronouns}`);
				}
				if (bio) {
					lines.push(`bio:\n${indent(bio, '  ')}`);
				}
				if (profile.premiumSince) {
					const tier = PREMIUM_TIERS[profile.premiumType] ?? 'nitro';
					lines.push(`premium: ${tier}, since ${formatDate(profile.premiumSince)}`);
				}
				{
					const badges = profile.badges?.filter((b: any) => !isRedundantBadge(b.id)) ?? [];
					if (badges.length) {
						lines.push(`badges: ${badges.map((b: any) => b.description).join(', ')}`);
					}
				}
				if (profile.connectedAccounts?.length) {
					lines.push('connections:');
					for (const account of profile.connectedAccounts) {
						lines.push(`  ${account.type}: ${account.name}${account.verified ? ' ✓' : ''}`);
					}
				}
			} else {
				const reason = profileError !== undefined ? ` (${errorMessage(toApiError(profileError))})` : '';
				lines.push(`profile unavailable${reason}`);
			}

			{
				const label = RELATIONSHIPS[RelationshipStore.value.getRelationshipType(userId)];
				if (label) {
					const nickname = RelationshipStore.value.getNickname(userId);
					lines.push(`relationship: ${label}${nickname ? `, nicknamed ${nickname}` : ''}`);
				}
			}

			{
				const status: string = PresenceStore.value.getStatus(userId);
				const platforms = Object.keys(PresenceStore.value.getClientStatus(userId) ?? {});
				lines.push(`status: ${status}${platforms.length ? ` on ${platforms.join(', ')}` : ''}`);

				for (const activity of PresenceStore.value.getActivities(userId)) {
					lines.push(`  ${describeActivity(activity)}`);
				}
			}

			if (guildId !== undefined) {
				const guild = GuildStore.value.getGuild(guildId);
				const member = GuildMemberStore.value.getMember(guildId, userId);
				if (member) {
					const roles = member.roles
						.map((id: string) => GuildRoleStore.value.getRole(guildId, id))
						.filter(Boolean)
						.toSorted((a: any, b: any) => b.position - a.position)
						.map((r: any) => r.name);

					lines.push(`in ${guild?.name ?? guildId}:`);
					if (member.nick) {
						lines.push(`  nickname: ${member.nick}`);
					}
					lines.push(`  joined: ${formatDate(new Date(member.joinedAt))}`);
					lines.push(`  roles: ${roles.length ? roles.join(', ') : 'none'}`);
					if (
						member.communicationDisabledUntil &&
						Date.parse(member.communicationDisabledUntil) > Date.now()
					) {
						lines.push(`  timed out until ${formatDate(new Date(member.communicationDisabledUntil))}`);
					}
				} else {
					lines.push(`not a member of ${guild?.name ?? guildId}, or not loaded`);
				}
			}

			if (userId !== currentUserId) {
				const mutualGuilds = UserProfileStore.value.getMutualGuilds(userId);
				if (mutualGuilds?.length) {
					const names = mutualGuilds.map(({ guild, nick }: any) => {
						return nick ? `${guild.name} (as ${nick})` : guild.name;
					});

					lines.push(`mutual servers (${mutualGuilds.length}): ${names.join(', ')}`);
				}

				const mutualFriends = UserProfileStore.value.getMutualFriendsCount(userId);
				if (mutualFriends) {
					lines.push(`mutual friends: ${mutualFriends}`);
				}
			}

			return lines.join('\n');
		},
	});
};

const describeActivity = (activity: any) => {
	if (activity.type === ActivityTypes.CUSTOM_STATUS) {
		return `custom status: ${[activity.emoji?.name, activity.state].filter(Boolean).join(' ')}`;
	}

	const kind = (ActivityTypes[activity.type] ?? 'activity').toLowerCase();
	const detail = [activity.details, activity.state].filter(Boolean).join(', ');
	return `${kind} ${activity.name}${detail ? ` (${detail})` : ''}`;
};
