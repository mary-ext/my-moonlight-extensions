import { mapDefined } from '@mary/array-fns';

import type { WebpackModuleFunc } from '@moonlight-mod/types';
import spacepack from '@moonlight-mod/wp/spacepack_spacepack';
import * as v from 'valibot';

import { getCapture } from './capture.ts';

/** a webpack module ID, normalized to a string */
export const ModuleIdSchema = v.pipe(
	v.union([v.string(), v.number()]),
	v.description('Webpack module id'),
	v.transform(String),
);

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
