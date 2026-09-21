import { mapDefined } from '@mary/array-fns';

import type { PatchMatch, WebpackModuleFunc } from '@moonlight-mod/types';
import spacepack from '@moonlight-mod/wp/spacepack_spacepack';
import * as v from 'valibot';

import { getCapture } from './capture.ts';

// #region schemas

/** a string or regex matcher as accepted by tools */
export const MatcherSchema = v.pipe(
	v.union([v.string(), v.object({ regex: v.string(), flags: v.optional(v.string()) })]),
	v.description(
		String.raw`A plain string, or { regex, flags } for a regular expression. Regexes support \i (a minified identifier).`,
	),
);

/** a webpack module ID, normalized to a string */
export const ModuleIdSchema = v.pipe(
	v.union([v.string(), v.number()]),
	v.description('Webpack module id'),
	v.transform(String),
);

// #endregion

// #region matchers

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

// #endregion

// #region sources

/**
 * normalizes a module factory for moonlight patch matching.
 *
 * @param factory module factory
 * @returns the source on one line, starting with `function`
 */
export const normalizeFactory = (factory: Function): string => {
	// caching would retain a source copy of every module for the session
	const src = String(factory).replace(/\n/g, '');
	// rspack emits method shorthand (`123(e,t,n){...}`), which moonlight turns into a function expression
	if (!src.startsWith('function')) {
		return `function${src.slice(src.indexOf('('))}`;
	}
	return src;
};

const getOriginalFactory = (id: string): WebpackModuleFunc | undefined => {
	const captured = getCapture().factories.get(id);
	if (captured) {
		return captured;
	}

	const current = spacepack.modules[id];
	if (current && current.__moonlight !== true) {
		return current;
	}
	return undefined;
};

/**
 * reads a module's source as moonlight's patches see it.
 *
 * @param id module ID
 * @returns the unpatched source, or undefined if there's no such Discord module
 */
export const getOriginalSource = (id: string): string | undefined => {
	const factory = getOriginalFactory(id);
	return factory && normalizeFactory(factory);
};

// moonlight rebuilds patched modules with
//   new Function("module", "exports", "require", `(${patched}).apply(this, arguments)\n// Patched by moonlight: ${ids}\n${sourceURL}`)
const PATCHED_HEADER = 'function anonymous(module,exports,require\n) {\n(';
const PATCHED_FOOTER = ').apply(this, arguments)\n';
const PATCHED_BY_PREFIX = '// Patched by moonlight: ';

/**
 * reads a module's source with its patches applied.
 *
 * @param id module ID
 * @returns the patched source, or undefined if the module isn't patched
 */
export const getPatchedSource = (id: string): string | undefined => {
	const current = spacepack.modules[id];
	if (!current || current === getOriginalFactory(id)) {
		return undefined;
	}

	const src = String(current);
	if (src.startsWith(PATCHED_HEADER)) {
		const end = src.lastIndexOf(PATCHED_FOOTER);
		if (end !== -1) {
			return src.slice(PATCHED_HEADER.length, end);
		}
	}

	// replaced wholesale by a module-type patch
	return normalizeFactory(current);
};

/**
 * lists the patches applied to a module.
 *
 * @param id module ID
 * @returns patch IDs like `ext#0` (or `ext#0#1` for one replacement of several), or extension IDs when the
 *   module was replaced wholesale
 */
export const getPatchedBy = (id: string): string[] => {
	const current = spacepack.modules[id];
	if (current) {
		const src = String(current);
		const start = src.lastIndexOf(PATCHED_BY_PREFIX);
		if (start !== -1) {
			const end = src.indexOf('\n', start);
			return src.slice(start + PATCHED_BY_PREFIX.length, end === -1 ? undefined : end).split(', ');
		}
	}
	return [...(moonlight.patched.get(id) ?? [])];
};

/**
 * checks whether a Discord module exists.
 *
 * @param id module ID
 * @returns whether its factory is known
 */
export const moduleExists = (id: string): boolean => {
	return getOriginalFactory(id) !== undefined;
};

/**
 * checks whether a module has been required.
 *
 * @param id module ID
 * @returns whether it ran and has exports
 */
export const isModuleLoaded = (id: string): boolean => {
	return !!spacepack.cache[id]?.loaded;
};

/**
 * lists a module's moonmap names; several mappings can resolve to the same module.
 *
 * @param id module ID
 * @returns the names it's importable as through `@moonlight-mod/wp/<name>`
 */
export const getMappedNames = (id: string): string[] => {
	return mapDefined(Object.entries(moonlight.moonmap.modules), ([name, mappedId]) => {
		return mappedId === id ? name : undefined;
	});
};

/**
 * checks a string find against the module's first moonmap name, matching moonlight's lookup.
 *
 * @param id module ID
 * @param find a string find
 * @returns whether the find selects the module by name
 */
export const isMappedFind = (id: string, find: string): boolean => {
	// the lookup rules out nearly every module before the full scan
	if (moonlight.moonmap.modules[find] !== id) {
		return false;
	}
	return getMappedNames(id)[0] === find;
};

/**
 * summarizes a module's state.
 *
 * @param id module ID
 * @returns e.g. `loaded, mapped as discord/Dispatcher, patched by foo#0`
 */
export const moduleStatus = (id: string): string => {
	const parts = [isModuleLoaded(id) ? 'loaded' : 'not loaded'];

	const mapped = getMappedNames(id);
	if (mapped.length) {
		parts.push(`mapped as ${mapped.join(', ')}`);
	}

	const patchedBy = getPatchedBy(id);
	if (patchedBy.length) {
		parts.push(`patched by ${patchedBy.join(', ')}`);
	}

	return parts.join(', ');
};

/**
 * iterates loaded module exports and their enumerable string-keyed properties, including inherited ones.
 *
 * @returns `[id, key, value]` entries; `key` is null for the whole exports value. only objects are traversed;
 *   properties whose getters throw are skipped
 */
export function* iterateExports(): Generator<readonly [string, string | null, unknown]> {
	for (const [id, mod] of Object.entries(spacepack.cache)) {
		const exports = mod?.exports;
		if (!mod?.loaded || exports == null) {
			continue;
		}

		yield [id, null, exports] as const;
		if (typeof exports !== 'object') {
			continue;
		}

		for (const key in exports) {
			let value: unknown;
			try {
				value = exports[key];
			} catch {
				continue;
			}
			yield [id, key, value] as const;
		}
	}
}

/**
 * iterates the original sources of Discord's modules.
 *
 * @returns `[id, source]` pairs in load order, which decides the module a patch lands on
 */
export function* allModuleSources(): Generator<readonly [string, string]> {
	const { factories } = getCapture();
	for (const [id, factory] of factories) {
		yield [id, normalizeFactory(factory)] as const;
	}

	// include factories missed by capture, e.g. after another extension replaced the chunk array
	for (const [id, factory] of Object.entries(spacepack.modules)) {
		if (!factories.has(id) && factory.__moonlight !== true) {
			yield [id, normalizeFactory(factory)] as const;
		}
	}
}

// #endregion
