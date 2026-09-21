/**
 * reads the developer tools setting.
 *
 * @returns whether developer tools are enabled (false by default)
 */
export const isDeveloperMode = (): boolean => {
	return moonlight.getConfigOption<boolean>('mcpServer', 'developerTools') ?? false;
};
