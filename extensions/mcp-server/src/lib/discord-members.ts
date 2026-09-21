import Dispatcher from '@moonlight-mod/wp/discord/Dispatcher';

import { sleep } from './async.ts';
import { GuildMemberRequesterStore, GuildMemberStore } from './flux.ts';

const MEMBER_WAIT = 2_000;

/**
 * loads missing authors and mentioned members for nickname resolution.
 *
 * @param guildId server the messages are in
 * @param messages message records
 * @returns when requests are acknowledged or after a two-second wait; members may still be missing
 */
export const loadMessageMembers = async (guildId: string, messages: any[]): Promise<void> => {
	const missing = new Set<string>();
	for (const message of messages) {
		for (const id of [message.author.id, ...(message.mentions ?? [])]) {
			if (!GuildMemberStore.value.isMember(guildId, id)) {
				missing.add(id);
			}
		}
	}

	// the requester deduplicates pending and previously answered requests
	for (const id of missing) {
		GuildMemberRequesterStore.value.requestMember(guildId, id);
	}

	// wait for the batch to be sent before checking pending requests, including earlier client requests
	await sleep(0);
	const pending = new Set<string>();
	for (const id of missing) {
		if (GuildMemberRequesterStore.value.getDebugState(id).unacknowledgedRequestGuildIds.includes(guildId)) {
			pending.add(id);
		}
	}
	if (!pending.size) {
		return;
	}

	await new Promise<void>((resolve) => {
		// acknowledgments precede listeners and include users no longer in the server
		const onChunk = () => {
			for (const id of pending) {
				if (
					!GuildMemberRequesterStore.value.getDebugState(id).unacknowledgedRequestGuildIds.includes(guildId)
				) {
					pending.delete(id);
				}
			}
			if (!pending.size) {
				done();
			}
		};
		const timeout = setTimeout(() => done(), MEMBER_WAIT);
		const done = () => {
			clearTimeout(timeout);
			Dispatcher.unsubscribe('GUILD_MEMBERS_CHUNK_BATCH', onChunk);
			resolve();
		};

		Dispatcher.subscribe('GUILD_MEMBERS_CHUNK_BATCH', onChunk);
	});
};
