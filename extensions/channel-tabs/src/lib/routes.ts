import type React from 'react';

import { Routes } from '@moonlight-mod/wp/discord/Constants';

import { FriendsIcon, QuestsIcon, ShopIcon } from '#/lib/icons.tsx';

/** a non-channel page supported by tabs */
export interface RoutePage {
	path: string;
	/** whether to match subpaths */
	prefix: boolean;
	label: string;
	icon: React.ComponentType<{ className?: string }>;
}

const ROUTE_PAGES: RoutePage[] = [
	{ path: Routes.FRIENDS, prefix: false, label: 'Friends', icon: FriendsIcon },
	{ path: Routes.COLLECTIBLES_SHOP, prefix: true, label: 'Shop', icon: ShopIcon },
	{ path: Routes.QUEST_HOME, prefix: true, label: 'Quests', icon: QuestsIcon },
];

/**
 * matches a path to a supported page.
 *
 * @param pathname the location's path
 * @returns the matching page, or `undefined` for unsupported paths
 */
export const matchRoutePage = (pathname: string): RoutePage | undefined => {
	return ROUTE_PAGES.find((page) => (page.prefix ? pathname.startsWith(page.path) : pathname === page.path));
};

/**
 * looks up a page by its exact path.
 *
 * @param path the page's path
 * @returns the matching page, or `undefined` for unknown paths
 */
export const getRoutePage = (path: string): RoutePage | undefined => {
	return ROUTE_PAGES.find((page) => page.path === path);
};

// both the legacy favorites guild ID and its route segment
const FAVORITES_GUILD_IDS = new Set(['373', '@favorites']);

/**
 * checks for the favorites guild ID or route segment.
 *
 * @param guildId the guild ID
 * @returns whether it's the favorites server
 */
export const isFavoritesGuild = (guildId: string | null | undefined): boolean => {
	return guildId != null && FAVORITES_GUILD_IDS.has(guildId);
};
