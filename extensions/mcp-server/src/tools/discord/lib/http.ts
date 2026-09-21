import { HTTP } from '@moonlight-mod/wp/discord/utils/HTTPUtils';

import { truncate } from '#/lib/text.ts';

/**
 * formats a Discord request failure as an error.
 *
 * @param e HTTP response, error with status and body, or other rejection
 * @returns an error with API details when available; existing errors without a status pass through
 */
export const toApiError = (e: unknown): Error => {
	if (typeof e === 'object' && e !== null && 'status' in e && typeof e.status === 'number') {
		const body: any = 'body' in e ? e.body : undefined;
		let message = '';
		if (body?.message) {
			message = `: ${body.message}`;
		} else if (body && typeof body === 'object') {
			// validation failures come as field errors without a message
			message = `: ${truncate(JSON.stringify(body), 500)}`;
		}
		const code = body?.code ? ` (code ${body.code})` : '';
		return new Error(`Discord API returned ${e.status}${message}${code}`);
	}
	if (e instanceof Error) {
		return e;
	}
	return new Error(`Discord request failed: ${String(e)}`);
};

/**
 * removes undefined query parameters.
 *
 * @param query query parameters
 * @returns a new object with only the defined parameters
 */
export const omitUndefined = <T>(query: Record<string, T | undefined>): Record<string, T> => {
	// Discord's HTTP client sends undefined values as empty strings, which the API rejects
	const defined: Record<string, T> = {};
	for (const [key, value] of Object.entries(query)) {
		if (value !== undefined) {
			defined[key] = value;
		}
	}
	return defined;
};

/**
 * sends a GET request with Discord's authentication, retries and rate limit handling.
 *
 * @param url API path, from `Endpoints`
 * @param query query parameters; undefined values are left out
 * @returns the response body
 * @throws with the API's error message if the request fails
 */
export const discordGet = async (url: string, query: Record<string, string | undefined>): Promise<any> => {
	try {
		const res = await HTTP.get({ url, query: omitUndefined(query), oldFormErrors: true });
		return res.body;
	} catch (e) {
		throw toApiError(e);
	}
};
