import React from 'react';

import {
	CircleBadge,
	computeChannelName,
	getChannelIcon,
	GuildIcon,
	NumberBadge,
	PinIcon,
	TitleBarButton,
	useDrag,
	useDrop,
} from '@moonlight-mod/wp/channelTabs_discord';
import {
	closeTab,
	getEntry,
	getHistoryTab,
	getState,
	isEnabled,
	isTabBarVisible,
	moveTab,
	openNewTab,
	setActiveTab,
	setTabPinned,
	type Tab,
	useTabsState,
} from '@moonlight-mod/wp/channelTabs_tabs';
import ErrorBoundary from '@moonlight-mod/wp/common_ErrorBoundary';
import stores from '@moonlight-mod/wp/common_stores';
import { MenuGroup, MenuItem } from '@moonlight-mod/wp/contextMenu_contextMenu';
import {
	closeContextMenu,
	openContextMenu,
} from '@moonlight-mod/wp/discord/actions/ContextMenuActionCreators';
import Clickable from '@moonlight-mod/wp/discord/design/components/Clickable/web/Clickable';
import Text from '@moonlight-mod/wp/discord/design/components/Text/Text';
import PlusLargeIcon from '@moonlight-mod/wp/discord/modules/icons/web/PlusLargeIcon';
import StarIcon from '@moonlight-mod/wp/discord/modules/icons/web/StarIcon';
import XSmallIcon from '@moonlight-mod/wp/discord/modules/icons/web/XSmallIcon';
import { Menu } from '@moonlight-mod/wp/discord/modules/menus/web/Menu';
import { useStateFromStores, useStateFromStoresObject } from '@moonlight-mod/wp/discord/packages/flux';
import ChannelStore from '@moonlight-mod/wp/discord/stores/ChannelStore';
import GuildStore from '@moonlight-mod/wp/discord/stores/GuildStore';
import ReadStateStore from '@moonlight-mod/wp/discord/stores/ReadStateStore';
import RelationshipStore from '@moonlight-mod/wp/discord/stores/RelationshipStore';
import SelectedChannelStore from '@moonlight-mod/wp/discord/stores/SelectedChannelStore';
import UserGuildSettingsStore from '@moonlight-mod/wp/discord/stores/UserGuildSettingsStore';
import AvatarUtils from '@moonlight-mod/wp/discord/utils/AvatarUtils';
import NativeUtils from '@moonlight-mod/wp/discord/utils/NativeUtils';

import { getRoutePage, isFavoritesGuild } from '#/lib/routes.ts';
import type { Channel, UserStore as UserStoreType } from '#/lib/types.ts';

// its mapped module lacks the `__esModule` flag, so a default import gets the whole module
const UserStore: UserStoreType = stores.UserStore;

const DRAG_TYPE = 'CHANNEL_TAB';

// #region tab

// retain labels for deleted or inaccessible channels
const channelNames = new Map<string, string>();

const useChannelName = (channel: Channel | null | undefined): string | null => {
	return useStateFromStores(
		[UserStore, RelationshipStore],
		() => (channel != null ? (computeChannelName?.(channel, UserStore, RelationshipStore) ?? null) : null),
		[channel],
	);
};

const TabIcon = ({ tab, channel }: { tab: Tab; channel: Channel | null | undefined }) => {
	const entry = getEntry(tab);
	const guildId = entry.kind === 'channel' ? entry.guildId : null;

	const guild = useStateFromStores(
		[GuildStore],
		() => (guildId !== null ? GuildStore.getGuild(guildId) : null),
		[guildId],
	);
	const avatarUrl = useStateFromStores(
		[UserStore],
		() => {
			if (channel?.isDM()) {
				return UserStore.getUser(channel.getRecipientId())?.getAvatarURL(undefined, 16) ?? null;
			}
			if (channel?.isGroupDM()) {
				return (
					AvatarUtils.getChannelIconURL({
						id: channel.id,
						icon: channel.icon,
						applicationId: channel.getApplicationId(),
						size: 16,
					}) ?? null
				);
			}
			return null;
		},
		[channel],
	);

	if (entry.kind === 'route') {
		const page = getRoutePage(entry.routePath);
		if (page?.icon === undefined) {
			return null;
		}
		return <page.icon size="xs" color="currentColor" className="channelTabs-icon" />;
	}

	if (isFavoritesGuild(guildId)) {
		return <StarIcon size="xs" color="currentColor" className="channelTabs-icon" />;
	}

	if (channel?.isThread()) {
		const threadIcon = getChannelIcon?.(channel);
		if (threadIcon == null) {
			return null;
		}
		return React.createElement(threadIcon, {
			size: 'xs',
			color: 'currentColor',
			className: 'channelTabs-icon',
		});
	}

	if (guild != null && GuildIcon !== undefined) {
		return <GuildIcon guild={guild} size={GuildIcon.Sizes.SMOL} active className="channelTabs-guildIcon" />;
	}

	if (avatarUrl !== null) {
		return <img className="channelTabs-dmIcon" src={avatarUrl} alt="" aria-hidden draggable={false} />;
	}

	return null;
};

const TabMenu = ({ tab }: { tab: Tab }) => {
	return (
		<Menu navId="channel-tab-context" onClose={closeContextMenu} aria-label="Tab actions">
			<MenuGroup>
				<MenuItem
					id={tab.pinned ? 'unpin-tab' : 'pin-tab'}
					label={tab.pinned ? 'Unpin Tab' : 'Pin Tab'}
					action={() => setTabPinned(tab.id, !tab.pinned)}
				/>
			</MenuGroup>
			<MenuGroup>
				<MenuItem id="close-tab" label="Close Tab" action={() => closeTab(tab.id)} />
			</MenuGroup>
		</Menu>
	);
};

// the mappings leave out the props Clickable forwards to its element
const TabButton = Clickable as React.ComponentType<
	React.ComponentProps<typeof Clickable> & {
		'aria-current'?: 'page';
		onAuxClick?: (ev: React.MouseEvent) => void;
	}
>;

type DropSide = 'before' | 'after';

interface TabProps {
	closable: boolean;
	isActive: boolean;
	tab: Tab;
	onDragEnd: () => void;
	onDragHover: (draggedId: string, targetId: string, side: DropSide) => void;
	onDrop: (draggedId: string) => void;
	registerNode: (id: string, node: HTMLElement | null) => void;
}

const ChannelTab = React.memo(function ChannelTab({
	closable,
	isActive,
	tab,
	onDragEnd,
	onDragHover,
	onDrop,
	registerNode,
}: TabProps) {
	const entry = getEntry(tab);
	const channelId = entry.kind === 'channel' ? entry.channelId : null;

	const channel = useStateFromStores(
		[ChannelStore],
		() => (channelId !== null ? ChannelStore.getChannel(channelId) : null),
		[channelId],
	);

	const channelName = useChannelName(channel);
	if (channelId !== null && channelName !== null) {
		channelNames.set(channelId, channelName);
	}

	let label: string;
	if (entry.kind === 'route') {
		label = getRoutePage(entry.routePath)?.label ?? 'Unknown';
	} else {
		label = channelName ?? channelNames.get(entry.channelId) ?? 'Unknown';
	}

	const { mentionCount, isLowImportance, showUnreadDot } = useStateFromStoresObject(
		[ReadStateStore, UserGuildSettingsStore],
		() => {
			if (entry.kind !== 'channel') {
				return { mentionCount: 0, isLowImportance: false, showUnreadDot: false };
			}

			const count = ReadStateStore.getMentionCount(entry.channelId);
			const muted = UserGuildSettingsStore.isGuildOrCategoryOrChannelMuted(entry.guildId, entry.channelId);

			return {
				mentionCount: count,
				isLowImportance: ReadStateStore.getIsMentionLowImportance(entry.channelId),
				showUnreadDot: count === 0 && !muted && ReadStateStore.hasUnread(entry.channelId),
			};
		},
		[entry],
	);

	const nodeRef = React.useRef<HTMLDivElement | null>(null);

	const [{ isDragging }, dragRef] = useDrag!<{ isDragging: boolean }>({
		type: DRAG_TYPE,
		item: () => ({ id: tab.id }),
		collect: (monitor) => ({ isDragging: monitor.isDragging() }),
		end: onDragEnd,
	});

	const [, dropRef] = useDrop!({
		accept: DRAG_TYPE,
		hover: (item, monitor) => {
			const node = nodeRef.current;
			const offset = monitor.getClientOffset();
			if (node === null || offset === null || item.id === tab.id) {
				return;
			}

			const rect = node.getBoundingClientRect();
			onDragHover(item.id, tab.id, offset.x < (rect.left + rect.right) / 2 ? 'before' : 'after');
		},
		drop: (item) => onDrop(item.id),
	});

	const setNode = React.useCallback(
		(node: HTMLDivElement | null) => {
			nodeRef.current = node;
			dragRef(node);
			dropRef(node);
			registerNode(tab.id, node);
		},
		[dragRef, dropRef, registerNode, tab.id],
	);

	const onAuxClick = (ev: React.MouseEvent) => {
		if (ev.button === 1 && closable) {
			ev.preventDefault();
			closeTab(tab.id);
		}
	};

	const onContextMenu = (ev: React.MouseEvent) => {
		openContextMenu(ev, () => <TabMenu tab={tab} />);
	};

	const UnreadDot = !isActive && showUnreadDot ? CircleBadge : undefined;

	let trailing: React.ReactNode = null;
	if (tab.pinned) {
		trailing = (
			<div className="channelTabs-pinIndicator" aria-hidden>
				{PinIcon !== undefined && <PinIcon size="xs" color="currentColor" />}
				{UnreadDot !== undefined && <UnreadDot className="channelTabs-pinUnreadDot" color="var(--white)" />}
			</div>
		);
	} else if (closable) {
		trailing = (
			<>
				{UnreadDot !== undefined && (
					<div className="channelTabs-unreadIndicator" aria-hidden>
						<UnreadDot color="var(--white)" />
					</div>
				)}
				<Clickable
					className="channelTabs-closeButton"
					onClick={() => closeTab(tab.id)}
					aria-label={`Close tab, ${label}`}
				>
					<XSmallIcon size="xs" />
				</Clickable>
			</>
		);
	}

	return (
		<div
			ref={setNode}
			className={[
				'channelTabs-tab',
				isActive && 'channelTabs-tabActive',
				isDragging && 'channelTabs-tabDragging',
			]
				.filter(Boolean)
				.join(' ')}
			onContextMenu={onContextMenu}
			onDoubleClick={(ev) => ev.stopPropagation()}
		>
			<TabButton
				className="channelTabs-tabButton"
				onClick={() => setActiveTab(tab.id)}
				onAuxClick={onAuxClick}
				aria-current={isActive ? 'page' : undefined}
			>
				<span className="channelTabs-iconWrapper">
					<TabIcon tab={tab} channel={channel} />
					{mentionCount > 0 && NumberBadge !== undefined && (
						<div className="channelTabs-mentionBadge" aria-hidden>
							<NumberBadge
								count={mentionCount}
								color={
									isLowImportance ? 'var(--background-mod-strong)' : 'var(--background-feedback-notification)'
								}
							/>
						</div>
					)}
				</span>
				<Text variant="text-sm/medium" lineClamp={1}>
					{label}
				</Text>
			</TabButton>
			{trailing}
		</div>
	);
});

// #endregion

// #region tab bar

// the mappings only type part of NativeUtils
const maximizeWindow = () => {
	const maximize: unknown = Reflect.get(NativeUtils, 'maximize');
	if (typeof maximize === 'function') {
		maximize.call(NativeUtils);
	}
};

const animateReorder = (nodes: Map<string, HTMLElement>, reorder: () => void) => {
	if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
		reorder();
		return;
	}

	const before = new Map([...nodes].map(([id, node]) => [id, node.getBoundingClientRect().left]));
	reorder();

	// measure the reordered tabs before paint
	requestAnimationFrame(() => {
		for (const [id, node] of nodes) {
			const from = before.get(id);
			if (from === undefined) {
				continue;
			}

			node.style.transition = '';
			node.style.transform = '';

			const dx = from - node.getBoundingClientRect().left;
			if (Math.abs(dx) <= 0.5) {
				continue;
			}

			node.style.transform = `translateX(${dx}px)`;
			// commit the offset before transitioning away from it
			node.getBoundingClientRect();
			node.style.transition = 'transform 150ms ease-out';
			node.style.transform = '';
			node.addEventListener('transitionend', () => (node.style.transition = ''), { once: true });
		}
	});
};

const TabBar = () => {
	const { tabs, activeTabId } = useTabsState();

	const barRef = React.useRef<HTMLDivElement | null>(null);
	const nodes = React.useRef(new Map<string, HTMLElement>());
	const pendingIndex = React.useRef<number | null>(null);
	const [indicatorLeft, setIndicatorLeft] = React.useState<number | null>(null);

	const registerNode = React.useCallback((id: string, node: HTMLElement | null) => {
		if (node !== null) {
			nodes.current.set(id, node);
		} else {
			nodes.current.delete(id);
		}
	}, []);

	const onDragHover = React.useCallback((draggedId: string, targetId: string, side: DropSide) => {
		const current = getState().tabs;
		const bar = barRef.current;
		const target = nodes.current.get(targetId);
		const from = current.findIndex((tab) => tab.id === draggedId);
		const over = current.findIndex((tab) => tab.id === targetId);
		if (bar === null || target === undefined || from === -1 || over === -1) {
			return;
		}

		// account for removing the dragged tab before insertion
		const insertAt = side === 'before' ? over : over + 1;
		const toIndex = from < insertAt ? insertAt - 1 : insertAt;
		if (toIndex === pendingIndex.current) {
			return;
		}
		pendingIndex.current = toIndex;

		const barRect = bar.getBoundingClientRect();
		const targetRect = target.getBoundingClientRect();
		setIndicatorLeft((side === 'before' ? targetRect.left : targetRect.right) - barRect.left - 1);
	}, []);

	const onDragEnd = React.useCallback(() => {
		pendingIndex.current = null;
		setIndicatorLeft(null);
	}, []);

	const onDrop = React.useCallback(
		(draggedId: string) => {
			const toIndex = pendingIndex.current;
			if (toIndex !== null) {
				animateReorder(nodes.current, () => moveTab(draggedId, toIndex));
			}
			onDragEnd();
		},
		[onDragEnd],
	);

	// accept drops outside tab buttons at the last indicated position
	const [, dropRef] = useDrop!({
		accept: DRAG_TYPE,
		drop: (item, monitor) => {
			if (!monitor.didDrop()) {
				onDrop(item.id);
			}
		},
	});

	const setBar = React.useCallback(
		(node: HTMLDivElement | null) => {
			barRef.current = node;
			dropRef(node);
		},
		[dropRef],
	);

	const closable = tabs.length > 1;

	return (
		<div
			ref={setBar}
			className="channelTabs-tabBar"
			role="group"
			aria-label="Channel tabs"
			onDoubleClick={maximizeWindow}
		>
			{tabs.map((tab) => (
				<ChannelTab
					key={tab.id}
					tab={tab}
					isActive={tab.id === activeTabId}
					closable={closable}
					registerNode={registerNode}
					onDragHover={onDragHover}
					onDrop={onDrop}
					onDragEnd={onDragEnd}
				/>
			))}
			{TitleBarButton !== undefined && (
				<div className="channelTabs-newTabButton">
					<TitleBarButton icon={PlusLargeIcon} onClick={openNewTab} aria-label="New Tab" />
				</div>
			)}
			{indicatorLeft !== null && (
				<div className="channelTabs-dropIndicator" style={{ left: indicatorLeft }} />
			)}
		</div>
	);
};

// #endregion

// #region title bar

interface TitleBarProps {
	growLeading?: boolean;
	leading?: React.ReactNode;
	title?: React.ReactNode;
	windowKey?: string;
}

/**
 * replaces the main window title with the tab bar when visible.
 *
 * @param props the title bar's props
 * @returns title bar props with tabs, or the original props when hidden or in a popout
 */
export const useTitleBarProps = <P extends TitleBarProps>(props: P): P => {
	useTabsState();

	// popout windows have their own title bars
	if (props.windowKey != null || !isTabBarVisible()) {
		return props;
	}

	return {
		...props,
		growLeading: true,
		leading: (
			<>
				{props.leading}
				<ErrorBoundary noop>
					<TabBar />
				</ErrorBoundary>
			</>
		),
		title: null,
	};
};

/**
 * makes the title bar's back/forward buttons follow the active tab's history.
 *
 * @param canGoBack whether the app's own history can go back
 * @param canGoForward whether the app's own history can go forward
 * @returns tab history availability, falling back to Discord's history
 */
export const useBackForwardState = (canGoBack: boolean, canGoForward: boolean) => {
	const state = useTabsState();
	const tab = useStateFromStores([SelectedChannelStore], () => (isEnabled() ? getHistoryTab() : null), [
		state,
	]);

	if (tab === null) {
		return { canGoBack, canGoForward };
	}

	return { canGoBack: tab.index > 0, canGoForward: tab.index < tab.entries.length - 1 };
};

// #endregion
