/** source finds shared by module lookups and webpack dependencies */
export const FINDS = {
	badges: [/renderBadgeCount:\w+=/],
	channelIcon: ['"getChannelIconComponent"'],
	channelName: ['.isProvisional&&null!='],
	friendsIcon: ['7.65 7.65 0 0 0-1.32-2.3'],
	guildIcon: ['"Smol"', '"iconActive"'],
	pinIcon: ['M19.38 11.38a3 3 0 0 0 4.24 0l.03-.03'],
	privateChannelActions: ['"CHANNEL_PERMISSIONS_PUT_OVERWRITE_SUCCESS"'],
	questsIcon: ['M7.5 21.7a8.95 8.95 0 0 1 9 0'],
	routing: ['"Routing/Utils"'],
	rtcActions: ['"CHANNEL_RTC_ACTIVE_CHANNELS"'],
	shopIcon: ['M2.63 4.19A3 3 0 0 1 5.53 2H7a1 1 0 0 1 1 1v3.98'],
	titleBarButton: [/Masks\.HEADER_BAR_BADGE_BOTTOM,height:\w+\.\w+\.sm/],
	useDrag: ['"spec.type must be defined"'],
	useDrop: ['"accept must be defined"'],
} satisfies Record<string, (string | RegExp)[]>;

// not a webpack dependency: the store may be absent
/** source find for Discord's native tabs store */
export const NATIVE_TABS_STORE_FIND = 'displayName="ChannelTabsStore"';
