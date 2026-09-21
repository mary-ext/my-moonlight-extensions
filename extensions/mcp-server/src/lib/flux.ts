import { Store } from '@moonlight-mod/wp/discord/packages/flux';

import { lazy } from './lazy.ts';

/**
 * collects Discord's Flux stores.
 *
 * @returns stores keyed by name
 */
export const allStores = (): Map<string, any> => {
	const stores = new Map<string, any>();
	for (const store of Store.getAll()) {
		stores.set(store.getName(), store);
	}
	return stores;
};

const lazyStore = (name: string): { readonly value: any } => {
	return lazy(() => {
		for (const store of Store.getAll()) {
			if (store.getName() === name) {
				return store;
			}
		}
		throw new Error(`Store ${name} not found`);
	});
};

// #region stores

export const ActiveJoinedThreadsStore = lazyStore('ActiveJoinedThreadsStore');
export const ActiveThreadsStore = lazyStore('ActiveThreadsStore');
export const ChannelStore = lazyStore('ChannelStore');
export const GatewayConnectionStore = lazyStore('GatewayConnectionStore');
export const GuildChannelStore = lazyStore('GuildChannelStore');
export const GuildMemberCountStore = lazyStore('GuildMemberCountStore');
export const GuildMemberRequesterStore = lazyStore('GuildMemberRequesterStore');
export const GuildMemberStore = lazyStore('GuildMemberStore');
export const GuildRoleStore = lazyStore('GuildRoleStore');
export const GuildStore = lazyStore('GuildStore');
export const MessageStore = lazyStore('MessageStore');
export const PermissionStore = lazyStore('PermissionStore');
export const PresenceStore = lazyStore('PresenceStore');
export const PrivateChannelSortStore = lazyStore('PrivateChannelSortStore');
export const ReadStateStore = lazyStore('ReadStateStore');
export const RelationshipStore = lazyStore('RelationshipStore');
export const SortedGuildStore = lazyStore('SortedGuildStore');
export const UserProfileStore = lazyStore('UserProfileStore');
export const UserStore = lazyStore('UserStore');

// #endregion
