import { getGreeting } from '@moonlight-mod/wp/sampleExtension_greeting';

const logger = moonlight.getLogger('sampleExtension/entrypoint');
logger.info(getGreeting());

// exports of `node.ts`, only available on desktop
const natives = moonlight.getNatives('sampleExtension');
if (natives !== undefined) {
	logger.info(`running on ${natives.getHostname()}`);
}
