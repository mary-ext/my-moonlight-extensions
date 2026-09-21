import type { Config } from '@moonlight-mod/types';
import { NodeEventType } from '@moonlight-mod/types/core/event';

// the context bridge snapshots moonlightNode.config; track saves to keep it current
let config: Config = structuredClone(moonlightNode.config);
moonlightNode.events.addEventListener(NodeEventType.ConfigSaved, (saved) => {
	config = structuredClone(saved);
});

/**
 * reads the saved moonlight config.
 *
 * @returns the config as last saved, which may differ from what is currently loaded
 */
export const getConfig = (): Config => config;

/**
 * saves the moonlight config.
 *
 * @param next config to write
 */
export const writeConfig = async (next: Config): Promise<void> => {
	await moonlightNode.writeConfig(next);
	config = next;
};

/**
 * looks up a detected extension.
 *
 * @param id extension id
 * @returns the extension
 * @throws if no extension has that id
 */
export const getExtension = (id: string) => {
	const ext = moonlightNode.extensions.find((e) => e.id === id);
	if (!ext) {
		throw new Error(
			`No extension with id ${id}. See list_extensions; newly built extensions appear after a reload.`,
		);
	}
	return ext;
};

/**
 * checks whether an extension is enabled in the saved config.
 *
 * @param id extension id
 * @returns whether it is enabled, regardless of whether it is currently loaded
 */
export const isEnabledInConfig = (id: string): boolean => {
	const entry = config.extensions[id];
	return entry === true || (typeof entry === 'object' && entry.enabled);
};
