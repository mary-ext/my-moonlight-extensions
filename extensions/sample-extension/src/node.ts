import * as os from 'node:os';

// https://moonlight-mod.github.io/ext-dev/cookbook/#extension-entrypoints
const logger = moonlightNode.getLogger('sampleExtension/node');
logger.info('hello from the preload script!');

/**
 * reads the operating system's hostname.
 *
 * @returns the hostname
 */
export const getHostname = (): string => {
	return os.hostname();
};
