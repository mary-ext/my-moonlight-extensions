/**
 * waits for a duration.
 *
 * @param ms milliseconds to wait
 * @returns a promise that resolves after the duration
 */
export const sleep = (ms: number): Promise<void> => {
	return new Promise((resolve) => setTimeout(resolve, ms));
};
