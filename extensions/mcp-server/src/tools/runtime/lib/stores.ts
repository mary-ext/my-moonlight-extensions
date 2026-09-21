import { Store } from '@moonlight-mod/wp/discord/packages/flux';

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
