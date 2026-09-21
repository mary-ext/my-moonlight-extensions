import * as v from 'valibot';

import { pluralize } from '#/lib/text.ts';
import { IntSchema, defineTool } from '#/lib/tool.ts';

import { channelName, formatMessage } from './lib/format.ts';
import { omitUndefined, toApiError } from './lib/http.ts';
import { requireGuild, storeNames } from './lib/lookup.ts';
import { loadMessageMembers } from './lib/message-members.ts';
import { type SearchType, createMessageRecord, searchFetcher } from './lib/modules.ts';
import { acquireDiscordLock } from './lib/read-lock.ts';
import { dateToSnowflake, SnowflakeSchema } from './lib/snowflake.ts';
import { ChannelStore, UserStore } from './lib/stores.ts';

const SEARCH_TIMEOUT = 60_000;
// fixed by the API
const PAGE_SIZE = 25;
// the API rejects larger offsets
const MAX_OFFSET = 9975;

const DateSchema = (description: string) => {
	return v.pipe(
		v.string(),
		v.description(description),
		v.check((s) => !Number.isNaN(Date.parse(s)), 'Expected a date, e.g. 2026-01-31 or 2026-01-31T12:00:00Z'),
		v.transform((s) => new Date(s)),
	);
};

export const searchMessages = defineTool({
	name: 'search_messages',
	description: `Search messages in a server, channel, thread or DM.`,
	annotations: { readOnlyHint: true, openWorldHint: true },
	input: v.object({
		guildId: v.optional(SnowflakeSchema('Server to search')),
		channelId: v.optional(SnowflakeSchema('Channel, thread or DM to search; narrows a server search')),
		content: v.pipe(v.optional(v.string()), v.description('Words to match in the message text')),
		authorIds: v.optional(v.array(SnowflakeSchema('from: user ID'))),
		mentions: v.optional(v.array(SnowflakeSchema('mentions: user ID'))),
		has: v.pipe(
			v.optional(
				v.array(
					v.picklist(['link', 'embed', 'file', 'image', 'video', 'sound', 'sticker', 'poll', 'snapshot']),
				),
			),
			v.description('has: kinds of content; snapshot means a forwarded message'),
		),
		authorType: v.optional(v.picklist(['user', 'bot', 'webhook'])),
		pinned: v.optional(v.boolean()),
		before: v.optional(DateSchema('Only messages sent before this date')),
		after: v.optional(DateSchema('Only messages sent after this date')),
		sort: v.optional(v.picklist(['newest', 'oldest', 'relevance']), 'newest'),
		offset: v.pipe(v.optional(IntSchema(0, MAX_OFFSET), 0), v.description('Results to skip, in steps of 25')),
	}),
	async handler(args) {
		if (args.guildId === undefined && args.channelId === undefined) {
			throw new Error(`Pass guildId or channelId`);
		}

		using _lock = await acquireDiscordLock();

		const scope = resolveScope(args.guildId, args.channelId);

		let sortBy = 'timestamp';
		let sortOrder = 'desc';
		switch (args.sort) {
			case 'oldest': {
				sortOrder = 'asc';
				break;
			}
			case 'relevance': {
				sortBy = 'relevance';
				break;
			}
		}

		const query = omitUndefined<unknown>({
			author_id: args.authorIds,
			author_type: args.authorType,
			channel_id: scope.channelIds,
			content: args.content,
			has: args.has,
			max_id: args.before && dateToSnowflake(args.before),
			mentions: args.mentions,
			min_id: args.after && dateToSnowflake(args.after),
			pinned: args.pinned,
			sort_by: sortBy,
			sort_order: sortOrder,
			offset: args.offset,
		});

		// the UI sets this after its age gate; the API separately enforces account restrictions
		if (scope.guildId !== null) {
			query.include_nsfw = UserStore.value.getCurrentUser()?.nsfwAllowed ?? true;
		}

		const body = await runSearch(scope, query);

		// threads found by search may not be loaded
		const threadNames = new Map<string, string>();
		for (const thread of body.threads ?? []) {
			threadNames.set(thread.id, thread.name);
		}

		const rawHits: any[] = body.messages.map((group: any[]) => group.find((m) => m.hit) ?? group[0]);
		const hits = rawHits.map(createMessageRecord.value);
		const names = storeNames(rawHits);

		if (scope.guildId !== null) {
			await loadMessageMembers(scope.guildId, hits);
		}

		const shown = hits.length ? `, showing ${args.offset + 1}-${args.offset + hits.length}` : '';
		const lines = [`${pluralize(body.total_results, 'result')}${shown}`];
		if (body.doing_deep_historical_index) {
			lines.push(`Discord is still indexing older messages; results may be incomplete`);
		}

		const context = { guildId: scope.guildId, names };
		let lastChannelId: string | undefined;
		for (const hit of hits) {
			lines.push('');

			if (hit.channel_id !== lastChannelId) {
				lastChannelId = hit.channel_id;

				const channel = names.channel(hit.channel_id);
				let name = 'unknown channel';
				if (channel) {
					name = channelName(channel, names);
				} else if (threadNames.has(hit.channel_id)) {
					name = `#${threadNames.get(hit.channel_id)}`;
				}
				lines.push(`in ${name} (${hit.channel_id}):`);
			}

			lines.push(formatMessage(hit, context));
		}

		const nextOffset = args.offset + PAGE_SIZE;
		if (args.offset + hits.length < body.total_results) {
			if (nextOffset <= MAX_OFFSET) {
				lines.push('', `next page: offset=${nextOffset}`);
			} else {
				lines.push('', `pagination limit reached; narrow the search or reverse the sort order`);
			}
		}

		return lines.join('\n');
	},
});

interface SearchScope {
	searchType: SearchType;
	/** server ID for GUILD searches, private channel ID for CHANNEL searches */
	searchId: string;
	guildId: string | null;
	channelIds: string[] | undefined;
}

const resolveScope = (guildId: string | undefined, channelId: string | undefined): SearchScope => {
	if (channelId !== undefined) {
		const channel = ChannelStore.value.getChannel(channelId);
		if (!channel) {
			throw new Error(`Unknown channel ${channelId}; use list_channels`);
		}

		if (channel.isPrivate()) {
			if (guildId !== undefined) {
				throw new Error(`Channel ${channelId} isn't in server ${guildId}`);
			}
			return { searchType: 'CHANNEL', searchId: channel.id, guildId: null, channelIds: undefined };
		}

		if (guildId !== undefined && guildId !== channel.guild_id) {
			throw new Error(`Channel ${channelId} isn't in server ${guildId}`);
		}
		// Discord searches server channels through the server, as with `in:#channel`
		return {
			searchType: 'GUILD',
			searchId: channel.guild_id,
			guildId: channel.guild_id,
			channelIds: [channel.id],
		};
	}

	if (guildId !== undefined) {
		requireGuild(guildId);
		return { searchType: 'GUILD', searchId: guildId, guildId, channelIds: undefined };
	}

	throw new Error(`Pass guildId or channelId`);
};

const runSearch = ({ searchId, searchType }: SearchScope, query: object) => {
	const SearchFetcher = searchFetcher.value;
	const fetcher = new SearchFetcher(searchId, searchType, query);

	return new Promise<any>((resolve, reject) => {
		const timeout = setTimeout(() => {
			fetcher.cancel();
			reject(new Error(`Search timed out after ${SEARCH_TIMEOUT / 1000}s`));
		}, SEARCH_TIMEOUT);

		fetcher.fetch(
			(res) => {
				clearTimeout(timeout);
				resolve(res.body);
			},
			() => {},
			(e) => {
				clearTimeout(timeout);
				reject(toApiError(e));
			},
		);
	});
};
