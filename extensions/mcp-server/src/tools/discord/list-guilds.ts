import * as v from 'valibot';

import { pluralize } from '#/lib/text.ts';
import type { ToolRegistry } from '#/lib/tool.ts';

import { acquireDiscordLock } from './lib/read-lock.ts';
import { GuildMemberCountStore, GuildStore, SortedGuildStore } from './lib/stores.ts';

/**
 * registers the `list_guilds` tool.
 *
 * @param registry registry to add the tool to
 */
export const registerListGuilds = (registry: ToolRegistry): void => {
	registry.define({
		name: 'list_guilds',
		description: `List the servers the user is in.`,
		annotations: { readOnlyHint: true },
		input: v.object({
			filter: v.pipe(v.optional(v.string()), v.description('Case-insensitive substring filter on the name')),
		}),
		async handler({ filter }) {
			using _lock = await acquireDiscordLock();

			const needle = filter?.toLowerCase();

			const lines: string[] = [];
			for (const id of SortedGuildStore.value.getFlattenedGuildIds()) {
				const guild = GuildStore.value.getGuild(id);
				if (!guild || (needle && !guild.name.toLowerCase().includes(needle))) {
					continue;
				}

				const members: number | undefined = GuildMemberCountStore.value.getMemberCount(id);
				lines.push(`${guild.name} (${id})${members ? `, ${pluralize(members, 'member')}` : ''}`);
			}

			return `${pluralize(lines.length, 'server')}:\n${lines.join('\n')}`;
		},
	});
};
