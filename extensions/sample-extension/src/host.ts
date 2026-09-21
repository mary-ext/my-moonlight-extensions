import { app } from 'electron';

// https://moonlight-mod.github.io/ext-dev/cookbook/#extension-entrypoints
const logger = moonlightHost.getLogger('sampleExtension/host');
logger.info(`hello from the main process! running Electron ${process.versions.electron} in ${app.getName()}`);
