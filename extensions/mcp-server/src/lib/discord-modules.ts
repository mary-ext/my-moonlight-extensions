import spacepack from '@moonlight-mod/wp/spacepack_spacepack';

import { lazy } from './lazy.ts';

// unmapped modules are resolved on first use so lookup failures only affect tools that need them

const findFunction = (label: string, moduleFind: string[], fnFind: string): any => {
	for (const mod of spacepack.findByCode(...moduleFind)) {
		const fn = spacepack.findFunctionByStrings(mod.exports, fnFind);
		if (fn) {
			return fn;
		}
	}
	throw new Error(`Discord module not found: ${label}`);
};

/** options accepted by Discord's deduplicating profile fetcher */
export interface FetchProfileOptions {
	type?: 'modal' | 'popout' | 'sidebar';
	guildId?: string;
	withMutualGuilds?: boolean;
	withMutualFriends?: boolean;
	withMutualFriendsCount?: boolean;
}

/** Discord's profile fetcher, which updates UserProfileStore, reuses fresh profiles and backs off after 404 or 429. */
export const fetchProfile = lazy(
	(): ((userId: string, avatarUrl: string | undefined, options: FetchProfileOptions) => Promise<void>) => {
		return findFunction('profile fetcher', ['isFetchingProfile(', 'waitForRefetch:'], 'isFetchingProfile(');
	},
);

/** Discord's message record factory, converting an API message to a MessageStore record. */
export const createMessageRecord = lazy((): ((message: any) => any) => {
	const create = findFunction(
		'message record factory',
		['isBlockedForMessage(', 'giftingPrompt:'],
		'giftingPrompt:',
	);
	// the factory takes optional overrides second, which `.map` would fill with the index
	return (message) => create(message);
});

/** message search scope: a server or a private channel */
export type SearchType = 'GUILD' | 'CHANNEL';

/** a search request as used by Discord's search UI */
export interface SearchFetcher {
	/**
	 * sends the request, polling again while the server is still indexing.
	 *
	 * @param onSuccess called with the response once results are ready
	 * @param onIndexing called while the search index isn't ready
	 * @param onError called when the request fails
	 */
	fetch(
		onSuccess: (res: { body: any }) => void,
		onIndexing: () => void,
		onError: (err: unknown) => void,
	): void;
	/** cancels the request and stops polling */
	cancel(): void;
}

/** Discord's message search fetcher constructor, for server and private channel searches. */
export const searchFetcher = lazy(
	(): new (searchId: string, searchType: SearchType, query: object) => SearchFetcher => {
		return findFunction('search fetcher', ['[SearchFetcher] Unhandled search type'], 'SEARCH_GUILD(');
	},
);
