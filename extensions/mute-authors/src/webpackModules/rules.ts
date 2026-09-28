const EXT_ID = 'muteAuthors';

/** a user or webhook in a channel or thread */
export interface AuthorInChannel {
	/** user or webhook ID */
	authorId: string;
	/** channel or thread ID */
	channelId: string;
}

const getRules = (): string[] => {
	return moonlight.getConfigOption<string[]>(EXT_ID, 'rules') ?? [];
};

const toRule = ({ authorId, channelId }: AuthorInChannel): string => {
	return channelId + ':' + authorId;
};

/**
 * checks whether an author's notifications are muted in a channel.
 *
 * @param target author and channel to check
 * @returns whether notifications are muted
 */
export const isMuted = (target: AuthorInChannel): boolean => {
	return getRules().includes(toRule(target));
};

/**
 * mutes or unmutes an author's notifications in a channel.
 *
 * @param options author, channel and mute state
 * @param options.muted whether the author should be muted
 */
export const setMuted = ({ muted, ...target }: AuthorInChannel & { muted: boolean }): void => {
	const rule = toRule(target);
	const rules = getRules().filter((r) => r !== rule);
	if (muted) {
		rules.push(rule);
	}

	void moonlight.setConfigOption(EXT_ID, 'rules', rules);
};
