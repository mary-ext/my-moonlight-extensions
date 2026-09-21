const DISCORD_EPOCH = 1420070400000n;

/**
 * reads the creation time encoded in a snowflake.
 *
 * @param id snowflake
 * @returns creation time
 */
export const snowflakeToDate = (id: string): Date => {
	return new Date(Number((BigInt(id) >> 22n) + DISCORD_EPOCH));
};

/**
 * builds the smallest snowflake created at a time, for use as a search bound.
 *
 * @param date time
 * @returns snowflake
 */
export const dateToSnowflake = (date: Date): string => {
	return String((BigInt(date.getTime()) - DISCORD_EPOCH) << 22n);
};

/**
 * orders two snowflakes by creation time.
 *
 * @param a snowflake
 * @param b snowflake
 * @returns negative if `a` is older, positive if newer, 0 if equal
 */
export const compareSnowflakes = (a: string, b: string): number => {
	// without leading zeros, a longer ID is a larger number; equal lengths compare like numbers
	if (a.length !== b.length) {
		return a.length - b.length;
	}
	if (a === b) {
		return 0;
	}
	return a < b ? -1 : 1;
};
