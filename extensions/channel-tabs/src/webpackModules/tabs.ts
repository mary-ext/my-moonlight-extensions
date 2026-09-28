import React from 'react';

import { NativeTabsStore, RTCActions, transitionTo } from '@moonlight-mod/wp/channelTabs_discord';
import stores from '@moonlight-mod/wp/common_stores';
import { Routes } from '@moonlight-mod/wp/discord/Constants';
import Dispatcher from '@moonlight-mod/wp/discord/Dispatcher';
import { impl as Storage } from '@moonlight-mod/wp/discord/lib/web/Storage';
import ChannelStore from '@moonlight-mod/wp/discord/stores/ChannelStore';
import SelectedChannelStore from '@moonlight-mod/wp/discord/stores/SelectedChannelStore';

const logger = moonlight.getLogger('channelTabs/tabs');

const SelectedGuildStore: { getGuildId: () => string | null } = stores.SelectedGuildStore;

// #region state

/** a channel or page in tab history */
export type TabEntry =
	| { kind: 'channel'; channelId: string; guildId: string | null }
	| { kind: 'route'; routePath: string };

/** a tab, with its own back/forward history */
export interface Tab {
	id: string;
	/** history, oldest first */
	entries: TabEntry[];
	/** current history index */
	index: number;
	/** hides the close button and opens navigation destinations in new tabs */
	pinned: boolean;
}

/** state of the tab bar */
export interface TabsState {
	activeTabId: string | null;
	tabs: Tab[];
}

const MAX_TABS = 25;
const MAX_HISTORY = 50;
const STORAGE_KEY = 'channelTabs_state';

const EMPTY_STATE: TabsState = { activeTabId: null, tabs: [] };

const isSavedState = (value: unknown): value is TabsState => {
	return typeof value === 'object' && value !== null && 'tabs' in value && Array.isArray(value.tabs);
};

const loadState = (): TabsState => {
	let saved: unknown;
	try {
		saved = Storage.get(STORAGE_KEY, '');
	} catch (err) {
		logger.warn('failed to restore tabs', err);
	}

	if (!isSavedState(saved)) {
		return EMPTY_STATE;
	}

	const tabs = saved.tabs.filter((tab) => Array.isArray(tab.entries) && tab.entries[tab.index] != null);
	const activeTabId = tabs.some((tab) => tab.id === saved.activeTabId)
		? saved.activeTabId
		: (tabs[0]?.id ?? null);

	return { activeTabId, tabs };
};

let state = loadState();
let nextId = state.tabs.reduce((max, tab) => Math.max(max, Number(tab.id) || 0), 0) + 1;

const listeners = new Set<() => void>();

const setState = (next: TabsState) => {
	state = next;
	Storage.set(STORAGE_KEY, next);

	for (const listener of listeners) {
		listener();
	}
};

const subscribe = (listener: () => void) => {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
};

/**
 * reads the current tab state.
 *
 * @returns the tab state
 */
export const getState = (): TabsState => {
	return state;
};

/**
 * subscribes a component to the tab state.
 *
 * @returns the tab state
 */
export const useTabsState = (): TabsState => {
	return React.useSyncExternalStore(subscribe, getState);
};

/**
 * reads a tab's current history entry.
 *
 * @param tab the tab
 * @returns the current entry
 */
export const getEntry = (tab: Tab): TabEntry => {
	return tab.entries[tab.index];
};

/**
 * reads the active tab.
 *
 * @returns the active tab, or `null` if there are no tabs
 */
export const getActiveTab = (): Tab | null => {
	return state.tabs.find((tab) => tab.id === state.activeTabId) ?? null;
};

/**
 * reads the active tab for back/forward navigation. falls back to Discord's history when the tab's channel
 * differs from the selected channel.
 *
 * @returns the active tab, or `null` if its history doesn't apply
 */
export const getHistoryTab = (): Tab | null => {
	const active = getActiveTab();
	if (active === null) {
		return null;
	}

	const entry = getEntry(active);
	if (entry.kind === 'channel' && SelectedChannelStore.getCurrentlySelectedChannelId() !== entry.channelId) {
		return null;
	}

	return active;
};

/**
 * checks whether Discord's native tabs are disabled or unavailable.
 *
 * @returns whether tabs are active
 */
export const isEnabled = (): boolean => {
	return NativeTabsStore?.isEnabled() !== true;
};

/**
 * checks whether the tab bar is shown.
 *
 * @returns whether the tab bar is shown
 */
export const isTabBarVisible = (): boolean => {
	return isEnabled() && state.tabs.length > 0;
};

const createTab = (entry: TabEntry): Tab => {
	return { id: String(nextId++), entries: [entry], index: 0, pinned: false };
};

const updateTab = (id: string, update: (tab: Tab) => Tab): Tab[] => {
	return state.tabs.map((tab) => (tab.id === id ? update(tab) : tab));
};

const isSameEntry = (a: TabEntry, b: TabEntry): boolean => {
	if (a.kind === 'channel') {
		return b.kind === 'channel' && a.channelId === b.channelId;
	}
	return b.kind === 'route' && a.routePath === b.routePath;
};

// static guild pages like `@home` take the place of a channel ID
const isRealChannel = (channelId: string | null | undefined): channelId is string => {
	return channelId != null && /^\d+$/.test(channelId);
};

const getSelectedEntry = (): TabEntry | null => {
	const channelId = SelectedChannelStore.getCurrentlySelectedChannelId();
	if (!isRealChannel(channelId)) {
		return null;
	}

	return { kind: 'channel', channelId, guildId: SelectedGuildStore.getGuildId() ?? null };
};

const pushEntry = (entry: TabEntry) => {
	const active = getActiveTab();
	if (active === null) {
		const tab = createTab(entry);
		setState({ activeTabId: tab.id, tabs: [tab] });
		return;
	}

	if (isSameEntry(getEntry(active), entry)) {
		return;
	}

	if (active.pinned) {
		if (state.tabs.length >= MAX_TABS) {
			return;
		}

		const tab = createTab(entry);
		setState({ activeTabId: tab.id, tabs: [...state.tabs, tab] });
		return;
	}

	setState({
		...state,
		tabs: updateTab(active.id, (tab) => {
			const entries = [...tab.entries.slice(0, tab.index + 1), entry].slice(-MAX_HISTORY);
			return { ...tab, entries, index: entries.length - 1 };
		}),
	});
};

// #endregion

// #region navigation

const selectChannel = (channelId: string, guildId: string | null) => {
	if (ChannelStore.getChannel(channelId)?.isGuildVocal()) {
		RTCActions?.updateChatOpen(channelId, true);
	}

	if (guildId !== null) {
		transitionTo?.(Routes.CHANNEL(guildId, channelId), { openChannel: true });
	} else {
		transitionTo?.(Routes.CHANNEL('@me', channelId));
	}
};

const showEntry = (entry: TabEntry) => {
	switch (entry.kind) {
		case 'channel': {
			selectChannel(entry.channelId, entry.guildId);
			break;
		}
		case 'route': {
			transitionTo?.(entry.routePath);
			break;
		}
	}
};

// starting from a non-channel page navigates without creating tabs
const shouldNavigateInstead = (): boolean => {
	return state.tabs.length === 0 && getSelectedEntry() === null;
};

// preserve the current channel when creating the first tabs
const openTab = (entry: TabEntry, { active }: { active: boolean }): boolean => {
	if (state.tabs.length >= MAX_TABS) {
		return false;
	}

	let { activeTabId, tabs } = state;
	if (tabs.length === 0) {
		const selected = getSelectedEntry();
		if (selected !== null) {
			const tab = createTab(selected);
			tabs = [tab];
			activeTabId = tab.id;
		}
	}

	const tab = createTab(entry);
	setState({ activeTabId: active || activeTabId === null ? tab.id : activeTabId, tabs: [...tabs, tab] });
	return true;
};

/**
 * opens a background tab. with no tabs or selected channel, navigates instead.
 *
 * @param channelId the channel
 * @param guildId the guild it's shown under, or `null` for DMs
 */
export const openInBackground = (channelId: string, guildId: string | null) => {
	if (shouldNavigateInstead()) {
		selectChannel(channelId, guildId);
		return;
	}

	openTab({ kind: 'channel', channelId, guildId }, { active: false });
};

/**
 * opens and selects a tab. with no tabs or selected channel, navigates instead.
 *
 * @param channelId the channel
 * @param guildId the guild it's shown under, or `null` for DMs
 */
export const openInForeground = (channelId: string, guildId: string | null) => {
	if (shouldNavigateInstead()) {
		selectChannel(channelId, guildId);
		return;
	}

	const opened = openTab({ kind: 'channel', channelId, guildId }, { active: true });
	if (opened && SelectedChannelStore.getCurrentlySelectedChannelId() !== channelId) {
		selectChannel(channelId, guildId);
	}
};

/**
 * opens the currently shown channel in a new tab.
 *
 * @returns whether a channel is selected, even if the tab limit prevents opening it
 */
export const openSelectedChannel = (): boolean => {
	const entry = getSelectedEntry();
	if (entry?.kind !== 'channel') {
		return false;
	}

	openInForeground(entry.channelId, entry.guildId);
	return true;
};

/** duplicates the active tab's entry, or the selected channel if there is no active tab */
export const openNewTab = () => {
	const active = getActiveTab();
	const entry = active !== null ? getEntry(active) : getSelectedEntry();

	switch (entry?.kind) {
		case 'channel': {
			openInForeground(entry.channelId, entry.guildId);
			break;
		}
		case 'route': {
			openTab(entry, { active: true });
			break;
		}
	}
};

/**
 * records a non-channel page in the active tab's history.
 *
 * @param routePath the page's path
 */
export const navigateRoute = (routePath: string) => {
	if (!isEnabled() || state.tabs.length === 0) {
		return;
	}

	pushEntry({ kind: 'route', routePath });
};

/**
 * moves through the active tab's history.
 *
 * @param direction `-1` to go back, `1` to go forward
 * @returns whether handled, including history boundaries; `false` requests Discord's history
 */
export const navigateHistory = (direction: -1 | 1): boolean => {
	const active = isEnabled() ? getHistoryTab() : null;
	if (active === null) {
		return false;
	}

	const entry = active.entries[active.index + direction];
	if (entry === undefined) {
		return true;
	}

	// deleted or inaccessible channels can only be reached through their guild
	if (
		entry.kind === 'channel' &&
		ChannelStore.getChannel(entry.channelId) === undefined &&
		entry.guildId === null
	) {
		return true;
	}

	setState({ ...state, tabs: updateTab(active.id, (tab) => ({ ...tab, index: tab.index + direction })) });
	showEntry(entry);
	return true;
};

/**
 * switches to a tab.
 *
 * @param id the tab
 */
export const setActiveTab = (id: string) => {
	const target = state.tabs.find((tab) => tab.id === id);
	if (target === undefined || state.activeTabId === id) {
		return;
	}

	setState({ ...state, activeTabId: id });
	showEntry(getEntry(target));
};

/**
 * switches to a neighboring tab, wrapping around.
 *
 * @param direction `-1` for the previous tab, `1` for the next
 * @returns whether there was another tab to switch to
 */
export const cycleTab = (direction: -1 | 1): boolean => {
	const { tabs } = state;
	const index = tabs.findIndex((tab) => tab.id === state.activeTabId);
	if (tabs.length <= 1 || index === -1) {
		return false;
	}

	setActiveTab(tabs[(index + direction + tabs.length) % tabs.length].id);
	return true;
};

/**
 * moves a tab to another position.
 *
 * @param id the tab
 * @param toIndex the tab's new position
 */
export const moveTab = (id: string, toIndex: number) => {
	const from = state.tabs.findIndex((tab) => tab.id === id);
	const to = Math.max(0, Math.min(toIndex, state.tabs.length - 1));
	if (from === -1 || from === to) {
		return;
	}

	const tabs = [...state.tabs];
	const [tab] = tabs.splice(from, 1);
	tabs.splice(to, 0, tab);
	setState({ ...state, tabs });
};

/**
 * pins or unpins a tab.
 *
 * @param id the tab
 * @param pinned whether to pin it
 */
export const setTabPinned = (id: string, pinned: boolean) => {
	if (!state.tabs.some((tab) => tab.id === id && tab.pinned !== pinned)) {
		return;
	}

	setState({ ...state, tabs: updateTab(id, (tab) => ({ ...tab, pinned })) });
};

/**
 * closes a tab. if active, selects its right neighbor, or left if none. keeps the last tab open.
 *
 * @param id the tab
 * @returns whether the tab was closed
 */
export const closeTab = (id: string): boolean => {
	const index = state.tabs.findIndex((tab) => tab.id === id);
	if (index === -1 || state.tabs.length === 1) {
		return false;
	}

	const tabs = state.tabs.filter((tab) => tab.id !== id);
	if (state.activeTabId !== id) {
		setState({ ...state, tabs });
		return true;
	}

	const next = tabs[Math.min(index, tabs.length - 1)];
	setState({ activeTabId: next.id, tabs });
	showEntry(getEntry(next));
	return true;
};

// #endregion

// #region dispatcher

Dispatcher.subscribe('CHANNEL_SELECT', (action: { channelId?: string | null; guildId?: string | null }) => {
	if (!isEnabled() || !isRealChannel(action.channelId)) {
		return;
	}

	pushEntry({ kind: 'channel', channelId: action.channelId, guildId: action.guildId ?? null });
});

// keep the active tab on channel deletion to avoid forcing navigation
const onChannelDelete = (action: { channel: { id: string } }) => {
	if (!isEnabled()) {
		return;
	}

	const isDeleted = (tab: Tab) => {
		const entry = getEntry(tab);
		return entry.kind === 'channel' && entry.channelId === action.channel.id && tab.id !== state.activeTabId;
	};

	if (state.tabs.some(isDeleted)) {
		setState({ ...state, tabs: state.tabs.filter((tab) => !isDeleted(tab)) });
	}
};

Dispatcher.subscribe('CHANNEL_DELETE', onChannelDelete);
Dispatcher.subscribe('THREAD_DELETE', onChannelDelete);

Dispatcher.subscribe('LOGOUT', () => {
	if (state.tabs.length > 0) {
		setState(EMPTY_STATE);
	}
});

// #endregion
