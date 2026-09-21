import type { PatchMatch, PatchReplace } from '@moonlight-mod/types';
// the package root re-exports types as values, which can't be bundled
import { PatchReplaceType } from '@moonlight-mod/types/extension';

import { findOccurrences, isMappedFind, matcherToString, matches, normalizeFactory } from './modules.ts';
import { errorMessage, pluralize } from './text.ts';

const MAX_CHANGE_PREVIEW = 1500;

/** outcome of a single replacement */
export interface ReplaceResult {
	/** 1-based position in the patch's replacements */
	index: number;
	match: PatchMatch | null;
	status: 'applied' | 'no effect' | 'error' | 'replaced module';
	occurrences: number;
	note?: string;
	diff?: string;
}

/** outcome of running a patch's replacements over a module */
export interface PatchRun {
	results: ReplaceResult[];
	/** patched source, or the original input after a `hardFail` rollback */
	output: string;
	/** whether a failure discarded every change of a `hardFail` patch */
	hardFailed: boolean;
}

/**
 * tests whether a patch's find selects a module.
 *
 * @param id module ID
 * @param code the module's original source
 * @param find the patch's find, with `\i` already expanded
 * @returns whether moonlight would consider the module a match
 */
export const findMatchesModule = (id: string, code: string, find: PatchMatch): boolean => {
	return matches(code, find) || (typeof find === 'string' && isMappedFind(id, find));
};

/**
 * lists the modules a patch's find matches.
 *
 * @param sources `[id, original source]` pairs in load order, as from `allModuleSources`
 * @param find the patch's find, with `\i` already expanded
 * @returns IDs of matching modules, in load order
 */
export const findMatchingModules = (
	sources: Iterable<readonly [string, string]>,
	find: PatchMatch,
): string[] => {
	const out: string[] = [];
	for (const [id, code] of sources) {
		if (findMatchesModule(id, code, find)) {
			out.push(id);
		}
	}
	return out;
};

/**
 * selects patch targets from matching modules.
 *
 * @param find the patch's find
 * @param matching IDs of matching modules, in load order
 * @returns all matches for a global regex, otherwise the first match
 */
export const selectTargets = (find: PatchMatch, matching: string[]): string[] => {
	if (find instanceof RegExp && find.global) {
		return matching;
	}
	return matching.slice(0, 1);
};

const elide = (s: string) => {
	if (s.length <= MAX_CHANGE_PREVIEW) {
		return s;
	}
	const half = MAX_CHANGE_PREVIEW / 2;
	return `${s.slice(0, half)}…[${s.length - MAX_CHANGE_PREVIEW} chars]…${s.slice(-half)}`;
};

/** brackets the changed region with ⟪ ⟫ and includes surrounding context */
const diff = (before: string, after: string, context: number) => {
	let start = 0;
	while (start < before.length && start < after.length && before[start] === after[start]) {
		start++;
	}

	let endBefore = before.length;
	let endAfter = after.length;
	while (endBefore > start && endAfter > start && before[endBefore - 1] === after[endAfter - 1]) {
		endBefore--;
		endAfter--;
	}

	const show = (s: string, end: number) =>
		(start - context > 0 ? '…' : '') +
		s.slice(Math.max(0, start - context), start) +
		`⟪${elide(s.slice(start, end))}⟫` +
		s.slice(end, end + context) +
		(end + context < s.length ? '…' : '');

	return `  - ${show(before, endBefore)}\n  + ${show(after, endAfter)}`;
};

/**
 * checks that moonlight can rebuild a module from patched source.
 *
 * @param code patched module source
 * @returns the syntax error's message, or undefined if it compiles
 */
export const compileError = (code: string): string | undefined => {
	try {
		// oxlint-disable-next-line no-new, typescript/no-implied-eval
		new Function('module', 'exports', 'require', `(${code}).apply(this, arguments)`);
		return undefined;
	} catch (e) {
		return errorMessage(e);
	}
};

/** options for {@link runReplacements} */
export interface RunOptions {
	hardFail?: boolean;
	/** characters of context for before/after diffs; omit to skip diffing */
	context?: number;
}

/**
 * runs a patch's replacements over a module source, in order.
 *
 * @param code module source to patch
 * @param replaces the patch's replacements, with `\i` already expanded
 * @param options patch flags and output options
 * @returns per-replacement results and the resulting source
 */
export const runReplacements = (code: string, replaces: PatchReplace[], options: RunOptions): PatchRun => {
	const results: ReplaceResult[] = [];
	let current = code;
	let hardFailed = false;

	for (const [i, replace] of replaces.entries()) {
		if (replace.type === PatchReplaceType.Module) {
			const result: ReplaceResult = { index: i + 1, match: null, status: 'replaced module', occurrences: 0 };
			results.push(result);

			try {
				const next = normalizeFactory(replace.replacement(current));
				if (options.context != null) {
					result.diff = diff(current, next, options.context);
				}
				current = next;
			} catch (e) {
				result.status = 'error';
				result.note = `replacement threw: ${errorMessage(e)}`;
			}
			continue;
		}

		const { match } = replace;
		const result: ReplaceResult = {
			index: i + 1,
			match,
			status: 'applied',
			occurrences: findOccurrences(current, match).length,
		};
		results.push(result);

		let next = current;
		try {
			if (match instanceof RegExp) {
				match.lastIndex = 0;
			}
			next =
				typeof replace.replacement === 'string'
					? current.replace(match, replace.replacement)
					: current.replace(match, replace.replacement);

			if (next === current) {
				result.status = 'no effect';
			}
		} catch (e) {
			result.status = 'error';
			result.note = `replacement threw: ${errorMessage(e)}`;
		}

		if (result.status !== 'applied') {
			if (options.hardFail) {
				hardFailed = true;
				break;
			}
			continue;
		}

		if (match instanceof RegExp && !match.global && result.occurrences > 1) {
			result.note = `regex matches ${result.occurrences} times but isn't global, only the first is replaced`;
		}
		if (options.context != null) {
			result.diff = diff(current, next, options.context);
		}

		current = next;
	}

	if (hardFailed) {
		return { results, output: code, hardFailed };
	}
	return { results, output: current, hardFailed };
};

/**
 * finds the first replacement whose output fails to compile.
 *
 * @param code module source before the patch
 * @param replaces the patch's replacements
 * @returns the 1-based index of the first replacement whose output doesn't compile, if any
 */
export const findBreakingReplacement = (code: string, replaces: PatchReplace[]): number | undefined => {
	for (let i = 1; i <= replaces.length; i++) {
		const { output } = runReplacements(code, replaces.slice(0, i), {});
		if (compileError(output)) {
			return i;
		}
	}
	return undefined;
};

/**
 * formats a replacement result as a report line.
 *
 * @param r the result
 * @returns e.g. `#1 /foo/: APPLIED (1 occurrence)` followed by its diff, if any
 */
export const formatResult = (r: ReplaceResult): string => {
	let line = `#${r.index} ${r.match === null ? 'module replacement' : matcherToString(r.match)}: ${r.status.toUpperCase()}`;
	if (r.match !== null) {
		line += ` (${pluralize(r.occurrences, 'occurrence')})`;
	}
	if (r.note) {
		line += ` - ${r.note}`;
	}
	if (r.diff) {
		line += `\n${r.diff}`;
	}
	return line;
};
