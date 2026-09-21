import type { IdentifiedPatch, WebpackModuleFunc } from '@moonlight-mod/types';

/** patches and original factories recorded before patching */
export interface Capture {
	/** patches in registration order, which determines application order */
	patches: Set<IdentifiedPatch>;
	/** unpatched factories of Discord's webpack modules, in load order */
	factories: Map<string, WebpackModuleFunc>;
}

// index.ts and webpack modules are separate bundles, so they share state through a registered symbol
const CAPTURE_KEY = Symbol.for('mcpServer.capture');

/**
 * reads the state recorded by the extension's entrypoint.
 *
 * @returns the capture state
 * @throws if the entrypoint didn't run, which means the extension failed to load
 */
export const getCapture = (): Capture => {
	const capture: Capture | undefined = Reflect.get(globalThis, CAPTURE_KEY);
	if (capture === undefined) {
		throw new Error(`mcpServer's entrypoint didn't run, patches and original sources are unavailable`);
	}
	return capture;
};

/**
 * creates the capture state and makes it available to {@link getCapture}.
 *
 * @returns the new capture state
 */
export const createCapture = (): Capture => {
	const capture: Capture = { patches: new Set(), factories: new Map() };
	Reflect.set(globalThis, CAPTURE_KEY, capture);
	return capture;
};
