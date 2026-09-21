import type * as natives from '#/node.ts';

/**
 * gets the extension's preload exports.
 *
 * @returns the natives
 * @throws when running without them, e.g. on moonlight's browser build
 */
export const getNatives = (): typeof natives => {
	const exports: typeof natives | undefined = moonlight.getNatives('mcpServer');
	if (exports === undefined) {
		throw new Error(`mcpServer's natives are unavailable, the MCP server only works on desktop`);
	}
	return exports;
};
