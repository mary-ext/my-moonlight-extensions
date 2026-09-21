/**
 * shortens a string, noting how much was cut.
 *
 * @param s string to shorten
 * @param max maximum number of characters to keep
 * @returns the string, or its first `max` characters followed by a note
 */
export const truncate = (s: string, max: number): string => {
	if (s.length <= max) {
		return s;
	}
	return `${s.slice(0, max)}… (${s.length - max} more chars)`;
};

/**
 * formats a thrown value for display.
 *
 * @param e thrown value
 * @returns `Name: message` for errors, the stringified value otherwise
 */
export const errorMessage = (e: unknown): string => {
	return e instanceof Error ? `${e.name}: ${e.message}` : String(e);
};

/**
 * pluralizes a count.
 *
 * @param count how many
 * @param singular noun for one
 * @param plural noun for any other count, defaults to `singular` with an `s`
 * @returns e.g. `1 module` or `3 modules`
 */
export const pluralize = (count: number, singular: string, plural = `${singular}s`): string => {
	return `${count} ${count === 1 ? singular : plural}`;
};
