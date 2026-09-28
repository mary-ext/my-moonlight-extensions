import { PrivateChannelActions } from '@moonlight-mod/wp/channelTabs_discord';
import {
	closeTab,
	cycleTab,
	getActiveTab,
	getState,
	isEnabled,
	isTabBarVisible,
	navigateRoute,
	openInBackground,
	openInForeground,
	openSelectedChannel,
	setActiveTab,
	setTabPinned,
} from '@moonlight-mod/wp/channelTabs_tabs';
import stores from '@moonlight-mod/wp/common_stores';
import Dispatcher from '@moonlight-mod/wp/discord/Dispatcher';
import { closeAllModals, hasAnyModalOpen } from '@moonlight-mod/wp/discord/modules/modals/Modals';
import ChannelStore from '@moonlight-mod/wp/discord/stores/ChannelStore';

import { isFavoritesGuild, matchRoutePage } from '#/lib/routes.ts';

const logger = moonlight.getLogger('channelTabs/entrypoint');

const LayerStore: { hasLayers: () => boolean } = stores.LayerStore;
const QuickSwitcherStore: { isOpen: () => boolean } = stores.QuickSwitcherStore;
const SelectedGuildStore: { getGuildId: () => string | null } = stores.SelectedGuildStore;

// #region keybinds

const IS_MAC = navigator.userAgent.includes('Macintosh');

/** @returns whether the shortcut was handled */
const handleKeybind = (ev: KeyboardEvent): boolean => {
	if (ev.ctrlKey && !ev.altKey && !ev.metaKey && ev.key === 'Tab') {
		return cycleTab(ev.shiftKey ? -1 : 1);
	}

	const mod = IS_MAC ? ev.metaKey && !ev.ctrlKey : ev.ctrlKey && !ev.metaKey;
	if (!mod || ev.altKey) {
		return false;
	}

	// digits by position, so shifted layouts like AZERTY still work
	const digit = /^Digit([1-9])$/.exec(ev.code);
	if (digit !== null && !ev.shiftKey) {
		if (!isTabBarVisible()) {
			return false;
		}

		const tab = getState().tabs[Number(digit[1]) - 1];
		if (tab !== undefined) {
			setActiveTab(tab.id);
		}
		return true;
	}

	switch (ev.key.toLowerCase()) {
		case 't': {
			// the quick switcher closes itself on this shortcut
			return !ev.shiftKey && !QuickSwitcherStore.isOpen() && openSelectedChannel();
		}
		case 'w': {
			const active = getActiveTab();
			if (
				ev.shiftKey ||
				active === null ||
				LayerStore.hasLayers() ||
				hasAnyModalOpen() ||
				QuickSwitcherStore.isOpen()
			) {
				return false;
			}

			return closeTab(active.id);
		}
		case 'p': {
			const active = getActiveTab();
			if (!ev.shiftKey || active === null) {
				return false;
			}

			setTabPinned(active.id, !active.pinned);
			return true;
		}
	}

	return false;
};

// capture on window to handle shortcuts before Discord's keybinds
window.addEventListener(
	'keydown',
	(ev) => {
		if ((ev.ctrlKey || ev.metaKey) && isEnabled() && handleKeybind(ev)) {
			ev.preventDefault();
			ev.stopImmediatePropagation();
		}
	},
	true,
);

// #endregion

// #region middle click

// guild channels use list item IDs; DMs use channel links
const getClickedChannelId = (target: Element): string | null => {
	const item = target.closest('[data-list-item-id^="channels___"]');
	if (item !== null) {
		return item.getAttribute('data-list-item-id')!.slice('channels___'.length);
	}

	const link = target.closest('a[href^="/channels/@me/"]');
	if (link !== null) {
		return /^\/channels\/@me\/(\d+)$/.exec(link.getAttribute('href')!)?.[1] ?? null;
	}

	return null;
};

window.addEventListener(
	'auxclick',
	(ev) => {
		if (ev.button !== 1 || !(ev.target instanceof Element) || !isEnabled()) {
			return;
		}

		const channelId = getClickedChannelId(ev.target);
		const channel = channelId !== null ? ChannelStore.getChannel(channelId) : undefined;
		if (channel === undefined) {
			return;
		}

		ev.preventDefault();
		ev.stopImmediatePropagation();

		// the channel list shows favorited channels under the favorites guild
		const selectedGuildId = SelectedGuildStore.getGuildId();
		const guildId = isFavoritesGuild(selectedGuildId) ? selectedGuildId : channel.getGuildId();

		openInBackground(channel.id, guildId ?? null);
	},
	true,
);

// #endregion

// #region quick switcher

interface QuickSwitcherResult {
	record: { id: string };
	type: string;
}

/**
 * opens a quick switcher result in a new tab.
 *
 * @param result the selected result
 * @returns whether handled; `false` lets the quick switcher handle the result
 */
export const openQuickSwitcherResult = (result: QuickSwitcherResult): boolean => {
	if (!isEnabled()) {
		return false;
	}

	const close = () => {
		void Dispatcher.dispatch({ type: 'QUICKSWITCHER_HIDE' });
		closeAllModals();
		void Dispatcher.dispatch({ type: 'QUICKSWITCHER_SWITCH_TO', result });
	};

	switch (result.type) {
		case 'DM':
		case 'GROUP_DM':
		case 'TEXT_CHANNEL':
		case 'VOICE_CHANNEL': {
			const channel = ChannelStore.getChannel(result.record.id);
			if (channel === undefined) {
				return false;
			}

			close();
			openInForeground(channel.id, channel.getGuildId() ?? null);
			return true;
		}
		case 'USER': {
			if (PrivateChannelActions === undefined) {
				return false;
			}

			close();
			PrivateChannelActions.openPrivateChannel({
				recipientIds: [result.record.id],
				location: 'Quickswitcher',
				navigateToChannel: false,
			}).then(
				(channelId) => openInForeground(channelId, null),
				(err) => logger.error('failed to open DM', err),
			);
			return true;
		}
	}

	return false;
};

// #endregion

// #region routes

const onLocationChange = () => {
	const page = matchRoutePage(window.location.pathname);
	if (page !== undefined) {
		navigateRoute(page.path);
	}
};

// currententrychange catches Discord's History API navigation
(window as Window & { navigation?: EventTarget }).navigation?.addEventListener(
	'currententrychange',
	onLocationChange,
);
onLocationChange();

// #endregion
