import { indent, oneLine } from './text.ts';

const MAX_EMBED_TEXT = 300;

// the typed `MessageTypes` mapping doesn't match this Discord build
const MESSAGE_DEFAULT = 0;
const MESSAGE_THREAD_CREATED = 18;
const MESSAGE_REPLY = 19;

const MESSAGE_TYPES: Record<number, string> = {
	1: 'recipient added',
	2: 'recipient removed',
	3: 'call',
	4: 'channel name changed',
	5: 'channel icon changed',
	6: 'message pinned',
	7: 'member joined',
	8: 'server boosted',
	9: 'server boosted',
	10: 'server boosted',
	11: 'server boosted',
	12: 'channel followed',
	18: 'thread created',
	20: 'slash command',
	21: 'thread starter',
	23: 'context menu command',
	24: 'automod action',
	46: 'poll result',
};

/** name lookups by ID; unknown entries return undefined */
export interface Names {
	user(id: string): any;
	nick(guildId: string, userId: string): string | undefined;
	role(guildId: string, roleId: string): any;
	channel(id: string): any;
}

/** name lookups and server context for formatting */
export interface NameContext {
	/** server the output is about, for nicknames and roles */
	guildId: string | null;
	names: Names;
}

/**
 * formats a UTC timestamp without milliseconds.
 *
 * @param date time
 * @returns e.g. `2026-09-21T11:41:22Z`
 */
export const formatDate = (date: Date): string => {
	return date.toISOString().replace(/\.\d+Z$/, 'Z');
};

// #region users and channels

/**
 * formats a user's display name, username and ID.
 *
 * @param user user record, or a user as the API returns it
 * @param context name lookups and server for nickname resolution
 * @returns e.g. `Nick (@username, 1234)`
 */
export const formatUser = (user: any, { guildId, names }: NameContext): string => {
	const nick = guildId !== null ? names.nick(guildId, user.id) : undefined;
	const name: string | undefined = nick ?? user.globalName ?? user.global_name ?? undefined;

	if (name === undefined || name === user.username) {
		return `${user.username} (${user.id})`;
	}
	return `${name} (@${user.username}, ${user.id})`;
};

/**
 * formats a channel's display name.
 *
 * @param channel channel record
 * @param names DM recipient lookups
 * @returns `#name` for server channels, `@name` for DMs, the name or member list for group DMs
 */
export const channelName = (channel: any, names: Names): string => {
	if (!channel.isPrivate()) {
		return `#${channel.name}`;
	}

	const recipients: string[] = channel.recipients.map((id: string) => {
		const user = names.user(id);
		return user ? (user.globalName ?? user.username) : id;
	});

	if (channel.isDM()) {
		return `@${recipients[0]}`;
	}
	return channel.name || recipients.join(', ');
};

// #endregion

// #region messages

const formatSize = (bytes: number) => {
	if (bytes < 1024) {
		return `${bytes} B`;
	}
	if (bytes < 1024 * 1024) {
		return `${(bytes / 1024).toFixed(1)} KB`;
	}
	return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

/**
 * identifies image and video attachments with dimensions.
 *
 * @param attachment attachment as the API returns it
 * @returns whether the attachment has a width and an image or video MIME type
 */
export const isVisualAttachment = (attachment: any): boolean => {
	const type: string = attachment.content_type ?? '';
	return !!attachment.width && (type.startsWith('image/') || type.startsWith('video/'));
};

/**
 * formats an attachment's name, type, dimensions and size.
 *
 * @param attachment attachment as the API returns it
 * @returns e.g. `image.png image/png, 1028×758, 677.2 KB`
 */
export const formatAttachment = (attachment: any): string => {
	const type = attachment.content_type ? ` ${attachment.content_type}` : '';
	const dimensions = attachment.width ? `, ${attachment.width}×${attachment.height}` : '';
	return `${attachment.filename}${type}${dimensions}, ${formatSize(attachment.size)}`;
};

const resolveMarkup = (content: string, { guildId, names }: NameContext) => {
	const resolved = content.replace(/<a?(:\w+:)\d+>/g, '$1');
	return resolved.replace(/<(@!?|@&|#)(\d+)>/g, (match, kind: string, id: string) => {
		switch (kind) {
			case '@':
			case '@!': {
				const user = names.user(id);
				return user ? `@${user.username}` : match;
			}
			case '@&': {
				const role = guildId !== null ? names.role(guildId, id) : undefined;
				return role ? `@${role.name}` : match;
			}
			case '#': {
				const channel = names.channel(id);
				return channel ? channelName(channel, names) : match;
			}
			default: {
				return match;
			}
		}
	});
};

const formatBody = (message: any, context: NameContext): string[] => {
	const lines: string[] = [];
	if (message.content) {
		lines.push(indent(resolveMarkup(message.content, context), '  '));
	}

	const embedText = (text: string) => {
		return oneLine(resolveMarkup(text, context), MAX_EMBED_TEXT);
	};

	for (const a of message.attachments ?? []) {
		// omit signed image/video URLs; use get_media to view them
		const url = isVisualAttachment(a) ? '' : `: ${a.url}`;
		lines.push(`  [attachment] ${formatAttachment(a)}${url}`);
	}

	for (const e of message.embeds ?? []) {
		const parts: string[] = [];
		if (e.author?.name) {
			parts.push(e.author.name);
		}
		if (e.rawTitle) {
			parts.push(e.rawTitle);
		}
		if (e.rawDescription) {
			parts.push(embedText(e.rawDescription));
		}
		for (const f of e.fields ?? []) {
			parts.push(`${f.rawName}: ${embedText(f.rawValue)}`);
		}
		if (e.url) {
			parts.push(e.url);
		}
		let media: string | undefined;
		if (e.video) {
			media = 'video';
		} else if (e.image || e.thumbnail) {
			media = 'image';
		}

		// include textless embeds so callers can discover media for get_media
		if (media !== undefined) {
			lines.push(parts.length ? `  [embed with ${media}] ${parts.join(' | ')}` : `  [embed with ${media}]`);
		} else if (parts.length) {
			lines.push(`  [embed] ${parts.join(' | ')}`);
		}
	}

	for (const s of message.stickerItems ?? []) {
		lines.push(`  [sticker] ${s.name}`);
	}

	if (message.poll) {
		const answers = message.poll.answers.map((a: any) => a.poll_media.text).join(' / ');
		lines.push(`  [poll] ${message.poll.question.text}: ${answers}`);
	}
	return lines;
};

/**
 * formats a message for a tool result.
 *
 * @param message MessageStore record
 * @param context name lookups and server context
 * @returns ID, time and author, followed by the indented body and metadata
 */
export const formatMessage = (message: any, context: NameContext): string => {
	let header = `${message.id} · ${formatDate(message.timestamp)} · ${formatUser(message.author, context)}`;
	if (message.author.bot) {
		header += message.webhookId ? ' [webhook]' : ' [bot]';
	}
	if (message.editedTimestamp) {
		header += ' (edited)';
	}
	if (message.pinned) {
		header += ' (pinned)';
	}
	if (message.blocked || message.ignored) {
		header += message.blocked ? ' (blocked user)' : ' (ignored user)';
	}

	const lines = [header];

	if (message.type !== MESSAGE_DEFAULT && message.type !== MESSAGE_REPLY) {
		lines.push(`  [${MESSAGE_TYPES[message.type] ?? `type ${message.type}`}]`);
	}
	if (message.interactionMetadata?.name) {
		lines.push(`  [used /${message.interactionMetadata.name}]`);
	}

	const ref = message.messageReference;
	// thread creation notices reference the new thread rather than a message
	if (message.type === MESSAGE_THREAD_CREATED && ref?.channel_id) {
		lines.push(`  → thread ${ref.channel_id}`);
	} else if (ref?.message_id && !message.messageSnapshots?.length) {
		const where = ref.channel_id !== message.channel_id ? ` in channel ${ref.channel_id}` : '';
		lines.push(`  ↳ reply to ${ref.message_id}${where}`);
	}

	lines.push(...formatBody(message, context));

	for (const { message: snapshot } of message.messageSnapshots ?? []) {
		lines.push(`  [forwarded from channel ${ref?.channel_id ?? 'unknown'}]`);
		lines.push(...formatBody(snapshot, context).map((line) => `  ${line}`));
	}

	if (message.reactions?.length) {
		const reactions = message.reactions.map((r: any) => {
			const emoji = r.emoji.id ? `:${r.emoji.name}:` : r.emoji.name;
			return `${emoji} ${r.count}`;
		});
		lines.push(`  [reactions] ${reactions.join(' · ')}`);
	}

	return lines.join('\n');
};

// #endregion
