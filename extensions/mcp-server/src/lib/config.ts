/**
 * reads the developer tools setting.
 *
 * @returns whether developer tools are enabled (false by default)
 */
export const isDeveloperMode = (): boolean => {
	return moonlight.getConfigOption<boolean>('mcpServer', 'developerTools') ?? false;
};

/**
 * reads the read tools setting.
 *
 * @returns whether tools that read Discord content as the user are enabled (false by default)
 */
export const isReadToolsEnabled = (): boolean => {
	return moonlight.getConfigOption<boolean>('mcpServer', 'readTools') ?? false;
};
