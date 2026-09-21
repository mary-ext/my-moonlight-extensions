import { sleep } from './async.ts';
import { GatewayConnectionStore } from './flux.ts';

const CONNECTION_TIMEOUT = 30_000;
const CONNECTION_POLL = 250;
// space out tool reads, including those served from cache
const CALL_INTERVAL = 1_000;

const isConnected = (): boolean => {
	try {
		return GatewayConnectionStore.value.isConnected();
	} catch {
		// not registered yet during startup
		return false;
	}
};

const waitForConnection = (): Promise<void> => {
	if (isConnected()) {
		return Promise.resolve();
	}

	// the store may not exist yet, so poll rather than subscribe to it
	return new Promise((resolve, reject) => {
		const deadline = Date.now() + CONNECTION_TIMEOUT;
		const timer = setInterval(() => {
			if (isConnected()) {
				clearInterval(timer);
				resolve();
			} else if (Date.now() > deadline) {
				clearInterval(timer);
				reject(new Error(`Discord isn't connected; check that it's online and logged in`));
			}
		}, CONNECTION_POLL);
	});
};

// each acquirer waits for the previous holder to release
let tail: Promise<void> = Promise.resolve();
let lastReleasedAt = 0;

/**
 * serializes Discord reads, waiting for a gateway connection and a one-second gap between holders.
 *
 * @returns a handle that releases the lock when disposed
 * @throws if Discord doesn't connect within 30 seconds after the previous holder releases
 */
export const acquireDiscordLock = async (): Promise<Disposable> => {
	const previous = tail;
	let release!: () => void;
	tail = new Promise((resolve) => {
		release = () => {
			lastReleasedAt = Date.now();
			resolve();
		};
	});

	try {
		await previous;
		// stores may be empty or missing before the gateway connects
		await waitForConnection();

		const wait = lastReleasedAt + CALL_INTERVAL - Date.now();
		if (wait > 0) {
			await sleep(wait);
		}
	} catch (e) {
		release();
		throw e;
	}

	let released = false;
	return {
		[Symbol.dispose]() {
			if (!released) {
				released = true;
				release();
			}
		},
	};
};
