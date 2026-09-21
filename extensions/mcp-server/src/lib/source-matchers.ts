import type { PatchMatch } from '@moonlight-mod/types';
import * as v from 'valibot';

/** a string or regex matcher as accepted by tools */
export const MatcherSchema = v.pipe(
	v.union([v.string(), v.object({ regex: v.string(), flags: v.optional(v.string()) })]),
	v.description(
		String.raw`A plain string, or { regex, flags } for a regular expression. Regexes support \i (a minified identifier).`,
	),
);

const IDENTIFIER = String.raw`[A-Za-z_$][\w$]*`;

/**
 * expands moonlight's `\i` identifier shorthand in a regex.
 *
 * @param re regex that may contain `\i`
 * @returns a new regex with `\i` expanded to an identifier pattern
 */
export const expandRegExp = (re: RegExp): RegExp => {
	return new RegExp(re.source.replace(/\\i/g, IDENTIFIER), re.flags);
};

/**
 * expands moonlight's `\i` identifier shorthand in a matcher.
 *
 * @param match string or regex
 * @returns strings unchanged, or a new regex with `\i` expanded
 */
export const expandMatch = (match: PatchMatch): PatchMatch => {
	return match instanceof RegExp ? expandRegExp(match) : match;
};

/**
 * parses a tool's string or regex matcher.
 *
 * @param input matcher argument
 * @returns a string, or a regex with `\i` expanded
 */
export const toMatcher = (input: v.InferOutput<typeof MatcherSchema>): PatchMatch => {
	if (typeof input === 'string') {
		return input;
	}
	return expandRegExp(new RegExp(input.regex, input.flags ?? ''));
};

/**
 * formats a matcher for display.
 *
 * @param m string or regex
 * @returns a quoted string or regex literal
 */
export const matcherToString = (m: PatchMatch): string => {
	return typeof m === 'string' ? JSON.stringify(m) : String(m);
};

/**
 * tests source against a string or regex matcher.
 *
 * @param code source to search
 * @param matcher string or regex
 * @returns whether it matches
 */
export const matches = (code: string, matcher: PatchMatch): boolean => {
	if (typeof matcher === 'string') {
		return code.includes(matcher);
	}
	// global regexes are stateful
	matcher.lastIndex = 0;
	return matcher.test(code);
};

/** position of a match in a source */
export interface Occurrence {
	index: number;
	length: number;
}

/**
 * finds non-overlapping matches, up to `limit`.
 *
 * @param code source to search
 * @param matcher string or regex; regexes are searched as if global, empty strings return no matches
 * @param limit stop after this many occurrences
 * @returns occurrences in source order
 */
export const findOccurrences = (code: string, matcher: PatchMatch, limit = 1000): Occurrence[] => {
	const out: Occurrence[] = [];

	if (typeof matcher === 'string') {
		if (!matcher) {
			return out;
		}

		let i = code.indexOf(matcher);
		while (i !== -1 && out.length < limit) {
			out.push({ index: i, length: matcher.length });
			i = code.indexOf(matcher, i + matcher.length);
		}
		return out;
	}

	const flags = matcher.flags.includes('g') ? matcher.flags : `${matcher.flags}g`;
	for (const m of code.matchAll(new RegExp(matcher.source, flags))) {
		out.push({ index: m.index, length: m[0].length });
		if (out.length >= limit) {
			break;
		}
	}
	return out;
};

/**
 * extracts a source range with surrounding context.
 *
 * @param code source
 * @param start inclusive start offset
 * @param end exclusive end offset
 * @param context characters to include on each side
 * @returns the window, with ellipses where it was cut
 */
export const excerpt = (code: string, start: number, end: number, context: number): string => {
	const from = Math.max(0, start - context);
	const to = Math.min(code.length, end + context);
	return (from > 0 ? '…' : '') + code.slice(from, to) + (to < code.length ? '…' : '');
};
