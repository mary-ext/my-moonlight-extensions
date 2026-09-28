// unmapped Discord internals; missing modules or exports resolve to undefined
import type React from 'react';

import spacepack from '@moonlight-mod/wp/spacepack_spacepack';

import { FINDS, NATIVE_TABS_STORE_FIND } from '#/lib/finds.ts';
import type { Channel, TabDragItem } from '#/lib/types.ts';

const logger = moonlight.getLogger('channelTabs/discord');

type Find = string | RegExp;

const matches = (source: string, finds: Find[]) => {
	return finds.every((find) => (typeof find === 'string' ? source.includes(find) : find.test(source)));
};

// search only numeric module IDs: findByCode would also match and require this module
const findModules = (targets: Record<string, Find[]>): Record<string, Record<string, any> | undefined> => {
	const pending = new Map(Object.entries(targets));
	const found: Record<string, Record<string, any> | undefined> = {};

	for (const [id, factory] of Object.entries(spacepack.modules)) {
		if (pending.size === 0) {
			break;
		}
		if (!/^\d+$/.test(id)) {
			continue;
		}

		const source = factory.toString();
		for (const [key, finds] of pending) {
			if (matches(source, finds)) {
				found[key] = spacepack.require(id);
				pending.delete(key);
			}
		}
	}

	return found;
};

const modules = findModules({ ...FINDS, nativeTabsStore: [NATIVE_TABS_STORE_FIND] });

const pick = (
	label: string,
	exports: Record<string, any> | undefined,
	get: (exports: Record<string, any>) => unknown,
): any => {
	const value = exports !== undefined ? get(exports) : null;
	if (value == null) {
		logger.error(`couldn't find ${label}`);
		return undefined;
	}
	return value;
};

// #region actions

/** navigates Discord's router to a path */
export const transitionTo: ((path: string, options?: { openChannel?: boolean }) => void) | undefined = pick(
	'transitionTo',
	modules.routing,
	(exports) => spacepack.findFunctionByStrings(exports, 'transitionTo - Transitioning to'),
);

/** call and voice channel actions */
export const RTCActions: { updateChatOpen: (channelId: string, open: boolean) => void } | undefined = pick(
	'channel RTC actions',
	modules.rtcActions,
	(exports) => spacepack.findObjectFromKey(exports, 'updateChatOpen'),
);

/** DM and group DM actions */
export const PrivateChannelActions:
	| {
			openPrivateChannel: (options: {
				location: string;
				navigateToChannel: boolean;
				recipientIds: string[];
			}) => Promise<string>;
	  }
	| undefined = pick('private channel actions', modules.privateChannelActions, (exports) =>
	spacepack.findObjectFromKey(exports, 'openPrivateChannel'),
);

// #endregion

// #region stores

/** Discord's native tabs store, if present */
export const NativeTabsStore: { isEnabled: () => boolean } | undefined =
	modules.nativeTabsStore !== undefined
		? (spacepack.findObjectFromKey(modules.nativeTabsStore, 'isEnabled') ?? undefined)
		: undefined;

// #endregion

// #region channels

/** channel name formatter used by Discord's channel list */
export const computeChannelName:
	| ((channel: Channel, userStore: unknown, relationshipStore: unknown) => string)
	| undefined = pick('computeChannelName', modules.channelName, (exports) =>
	spacepack.findFunctionByStrings(exports, '"???"'),
);

/** Discord's channel icon lookup */
export const getChannelIcon: ((channel: Channel) => React.ComponentType<IconProps> | null) | undefined = pick(
	'getChannelIcon',
	modules.channelIcon,
	(exports) => spacepack.findFunctionByStrings(exports, 'getChannelIconComponent'),
);

// #endregion

// #region components

/** props of Discord's icon components */
export interface IconProps {
	className?: string;
	color?: string;
	size?: 'xxs' | 'xs' | 'sm' | 'md' | 'lg' | 'custom';
}

/** Discord's guild icon component */
export interface GuildIconComponent extends React.ComponentClass<{
	active?: boolean;
	className?: string;
	guild: unknown;
	size: string;
}> {
	Sizes: Record<'SMOL' | 'MINI' | 'SMALLER' | 'SMALL' | 'MEDIUM' | 'LARGE' | 'XLARGE', string>;
}

const pickIcon = (label: string, key: 'friendsIcon' | 'pinIcon' | 'questsIcon' | 'shopIcon') => {
	return pick(label, modules[key], (exports) => spacepack.findFunctionByStrings(exports, ...FINDS[key]));
};

/** Discord's FriendsIcon */
export const FriendsIcon: React.ComponentType<IconProps> | undefined = pickIcon('FriendsIcon', 'friendsIcon');

/** Discord's PinIcon */
export const PinIcon: React.ComponentType<IconProps> | undefined = pickIcon('PinIcon', 'pinIcon');

/** Discord's QuestsIcon */
export const QuestsIcon: React.ComponentType<IconProps> | undefined = pickIcon('QuestsIcon', 'questsIcon');

/** Discord's ShopIcon */
export const ShopIcon: React.ComponentType<IconProps> | undefined = pickIcon('ShopIcon', 'shopIcon');

/** a guild's icon, falling back to its acronym */
export const GuildIcon: GuildIconComponent | undefined = pick('GuildIcon', modules.guildIcon, (exports) =>
	spacepack.findObjectFromKey(exports, 'Sizes'),
);

/** a pill-shaped mention count */
export const NumberBadge: React.ComponentType<{ color?: string; count: number }> | undefined = pick(
	'NumberBadge',
	modules.badges,
	(exports) => spacepack.findFunctionByStrings(exports, 'renderBadgeCount'),
);

/** a small unread dot */
export const CircleBadge: React.ComponentType<{ className?: string; color?: string }> | undefined = pick(
	'CircleBadge',
	modules.badges,
	(exports) => spacepack.findFunctionByStrings(exports, 'INTERACTIVE_TEXT_ACTIVE'),
);

/** title bar action button */
export const TitleBarButton:
	| React.ComponentType<{
			'aria-label'?: string;
			icon: React.ComponentType<IconProps>;
			onClick: () => void;
			tooltip?: string;
	  }>
	| undefined = pick('TitleBarButton', modules.titleBarButton, (exports) =>
	spacepack.findObjectFromKey(exports, 'render'),
);

// #endregion

// #region drag and drop

interface DragSourceMonitor {
	isDragging: () => boolean;
}

interface DropTargetMonitor {
	didDrop: () => boolean;
	getClientOffset: () => { x: number; y: number } | null;
}

type ConnectFn = (node: Element | null) => void;

/** react-dnd's `useDrag` */
export const useDrag:
	| (<Collected>(spec: {
			collect: (monitor: DragSourceMonitor) => Collected;
			end: () => void;
			item: () => TabDragItem;
			type: string;
	  }) => [Collected, ConnectFn])
	| undefined = pick('useDrag', modules.useDrag, (exports) =>
	spacepack.findFunctionByStrings(exports, 'spec.type must be defined'),
);

/** react-dnd's `useDrop` */
export const useDrop:
	| ((spec: {
			accept: string;
			drop: (item: TabDragItem, monitor: DropTargetMonitor) => void;
			hover?: (item: TabDragItem, monitor: DropTargetMonitor) => void;
	  }) => [unknown, ConnectFn])
	| undefined = pick('useDrop', modules.useDrop, (exports) =>
	spacepack.findFunctionByStrings(exports, 'accept must be defined'),
);

// #endregion
