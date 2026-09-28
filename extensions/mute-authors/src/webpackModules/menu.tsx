import React from 'react';

import { addItem, MenuItem } from '@moonlight-mod/wp/contextMenu_contextMenu';
import { isMuted, setMuted } from '@moonlight-mod/wp/muteAuthors_rules';

interface UserMenuProps {
	channel?: { id: string };
	user: { id: string };
}

// contextMenu calls this directly; hooks aren't supported
const renderMuteItem = ({ channel, user }: UserMenuProps) => {
	if (channel == null) {
		return null;
	}

	const target = { authorId: user.id, channelId: channel.id };
	const muted = isMuted(target);

	return (
		<MenuItem
			id="mute-author"
			label={muted ? 'Unmute Notifications Here' : 'Mute Notifications Here'}
			action={() => setMuted({ ...target, muted: !muted })}
		/>
	);
};

// webhook menus have no "block" item; anchor to "copy ID" instead
addItem('user-context', renderMuteItem, /^(?:block$|devmode-copy-id-)/);
