/** source finds shared by module lookups and webpack dependencies */
export const FINDS = {
	badges: [/renderBadgeCount:\w+=/],
	channelIcon: ['"getChannelIconComponent"'],
	channelName: ['.isProvisional&&null!='],
	guildIcon: ['"Smol"', '"iconActive"'],
	privateChannelActions: ['"CHANNEL_PERMISSIONS_PUT_OVERWRITE_SUCCESS"'],
	routing: ['"Routing/Utils"'],
	rtcActions: ['"CHANNEL_RTC_ACTIVE_CHANNELS"'],
	titleBarButton: [/Masks\.HEADER_BAR_BADGE_BOTTOM,height:\w+\.\w+\.sm/],
	useDrag: ['"spec.type must be defined"'],
	useDrop: ['"accept must be defined"'],
} satisfies Record<string, (string | RegExp)[]>;

// not a webpack dependency: the store may be absent
/** source find for Discord's native tabs store */
export const NATIVE_TABS_STORE_FIND = 'displayName="ChannelTabsStore"';
