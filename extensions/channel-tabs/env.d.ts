/// <reference types="@moonlight-mod/types" />

// stores the mappings leave untyped, narrowed to what this extension uses

type FluxStore = InstanceType<typeof import('@moonlight-mod/wp/discord/packages/flux').Store>;

declare module '@moonlight-mod/wp/discord/stores/ChannelStore' {
	const ChannelStore: FluxStore & {
		getChannel(id: string): import('#/lib/types.ts').Channel | undefined;
	};
	export default ChannelStore;
}

declare module '@moonlight-mod/wp/discord/stores/GuildStore' {
	const GuildStore: FluxStore & {
		getGuild(id: string): import('#/lib/types.ts').Guild | undefined;
	};
	export default GuildStore;
}

declare module '@moonlight-mod/wp/discord/stores/RelationshipStore' {
	const RelationshipStore: FluxStore;
	export default RelationshipStore;
}

declare module '@moonlight-mod/wp/discord/stores/ReadStateStore' {
	const ReadStateStore: FluxStore & {
		getIsMentionLowImportance(channelId: string): boolean;
		getMentionCount(channelId: string): number;
		hasUnread(channelId: string): boolean;
	};
	export default ReadStateStore;
}

declare module '@moonlight-mod/wp/discord/stores/UserGuildSettingsStore' {
	const UserGuildSettingsStore: FluxStore & {
		isGuildOrCategoryOrChannelMuted(guildId: string | null, channelId: string): boolean;
	};
	export default UserGuildSettingsStore;
}

declare module '@moonlight-mod/wp/discord/stores/SelectedChannelStore' {
	const SelectedChannelStore: FluxStore & {
		getCurrentlySelectedChannelId(): string | undefined;
	};
	export default SelectedChannelStore;
}

declare module '@moonlight-mod/wp/discord/utils/AvatarUtils' {
	const AvatarUtils: {
		getChannelIconURL(options: {
			applicationId?: string;
			icon?: string | null;
			id: string;
			size: number;
		}): string | undefined;
	};
	export default AvatarUtils;
}

declare module '@moonlight-mod/wp/channelTabs_discord' {
	export * from '#/webpackModules/discord.ts';
}

declare module '@moonlight-mod/wp/channelTabs_tabs' {
	export * from '#/webpackModules/tabs.ts';
}
