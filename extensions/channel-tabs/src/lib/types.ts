/** channel fields used by tabs */
export interface Channel {
	icon?: string | null;
	id: string;
	getApplicationId(): string | undefined;
	getGuildId(): string | null;
	getRecipientId(): string;
	isDM(): boolean;
	isGroupDM(): boolean;
	isGuildVocal(): boolean;
	isThread(): boolean;
}

/** guild fields used by tabs */
export interface Guild {
	id: string;
}

/** user fields used by tabs */
export interface User {
	getAvatarURL(guildId: string | undefined, size: number): string;
}

/** user store methods used by tabs */
export type UserStore = FluxStore & {
	getUser(id: string): User | undefined;
};

/** tab drag payload */
export interface TabDragItem {
	id: string;
}
