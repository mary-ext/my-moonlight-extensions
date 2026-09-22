import * as v from 'valibot';

import type { Patch, PatchReplace, PatchReplaceFn, PatchReplaceModule } from '@moonlight-mod/types';
// the package root re-exports types as values, which can't be bundled
import { PatchReplaceType } from '@moonlight-mod/types/extension';

import { expandMatch, matcherToString } from '#/lib/source-matchers.ts';
import { pluralize } from '#/lib/text.ts';
import { IntSchema, type ToolRegistry } from '#/lib/tool.ts';
import {
	ModuleIdSchema,
	allModuleSources,
	getOriginalSource,
	getPatchedBy,
	getPatchedSource,
	moduleStatus,
} from '#/lib/webpack-modules.ts';

import {
	compileError,
	findBreakingReplacement,
	findMatchingModules,
	formatResult,
	runReplacements,
	selectTargets,
} from './lib/patching.ts';

type NormalizedPatch = Patch & { replace: PatchReplace[] };

const isFunction = (value: unknown) => typeof value === 'function';

const MatchSchema = v.union([v.string(), v.instance(RegExp)]);
const ReplaceSchema = v.union([
	v.object({
		type: v.literal(PatchReplaceType.Module),
		replacement: v.custom<PatchReplaceModule>(isFunction),
	}),
	v.object({
		type: v.optional(v.literal(PatchReplaceType.Normal)),
		match: MatchSchema,
		replacement: v.union([v.string(), v.custom<PatchReplaceFn>(isFunction)]),
	}),
]);
const PatchSchema = v.object({
	find: MatchSchema,
	replace: v.union([ReplaceSchema, v.array(ReplaceSchema)]),
	hardFail: v.optional(v.boolean()),
	prerequisite: v.optional(v.custom<() => boolean>(isFunction)),
});

/** validates a patch and expands `\i` as moonlight does on registration */
const normalizePatch = (raw: unknown): NormalizedPatch => {
	const parsed = v.safeParse(PatchSchema, raw);
	if (!parsed.success) {
		throw new Error(`Invalid patch:\n${v.summarize(parsed.issues)}`);
	}

	// validation copies the patch, so normalization can mutate the parsed output
	const patch = parsed.output;
	const replaces = Array.isArray(patch.replace) ? patch.replace : [patch.replace];
	for (const replace of replaces) {
		if (replace.type !== PatchReplaceType.Module) {
			replace.match = expandMatch(replace.match);
		}
	}

	return Object.assign(patch, { find: expandMatch(patch.find), replace: replaces });
};

/**
 * registers the `test_patch` tool.
 *
 * @param registry registry to add the tool to
 */
export const registerTestPatch = (registry: ToolRegistry): void => {
	registry.define({
		name: 'test_patch',
		description:
			'Dry-run a patch and report matching modules, replacement results and syntax errors. Changes are marked with ⟪ ⟫.',
		annotations: { readOnlyHint: true },
		input: v.object({
			patch: v.pipe(
				v.string(),
				v.description(
					String.raw`One patch object as JS source, exactly as in an extension, e.g. { find: "some string", replace: { match: /(\i)\.foo\(/, replacement: "$1.bar(" } }`,
				),
			),
			against: v.pipe(
				v.optional(v.picklist(['original', 'current']), 'original'),
				v.description(`'current' tests on top of patches that are already applied`),
			),
			moduleId: v.pipe(v.optional(ModuleIdSchema), v.description('Test only this matching module')),
			context: v.pipe(
				v.optional(IntSchema(0, 2000), 100),
				v.description('Characters of context shown around each change'),
			),
		}),
		handler({ patch: source, against, moduleId, context }) {
			// source preserves regexes and functions that JSON cannot represent
			// oxlint-disable-next-line no-eval
			const patch = normalizePatch((0, eval)(`(${source}\n)`));
			const lines: string[] = [];

			if (patch.prerequisite && !patch.prerequisite()) {
				lines.push('Prerequisite returned false; moonlight would skip this patch');
			}

			const matching = findMatchingModules(allModuleSources(), patch.find);
			lines.push(
				`find ${matcherToString(patch.find)} matched ${pluralize(matching.length, 'module')}${matching.length ? `: ${matching.slice(0, 20).join(', ')}` : ''}`,
			);

			if (!matching.length) {
				lines.push('No module matched. If the code is lazy, open its UI or run load_lazy_chunks.');
				return lines.join('\n');
			}

			let targets = selectTargets(patch.find, matching).slice(0, 10);
			if (matching.length > 1 && targets.length === 1) {
				lines.push(
					`Ambiguous find: moonlight patches the first loaded match (${targets[0]}). Make the find more specific.`,
				);
			}
			if (moduleId != null) {
				if (!matching.includes(moduleId)) {
					throw new Error(`Module ${moduleId} doesn't match the find`);
				}
				targets = [moduleId];
			}

			for (const id of targets) {
				let code = getOriginalSource(id)!;
				let base = 'original';
				if (against === 'current') {
					const patched = getPatchedSource(id);
					if (patched) {
						code = patched;
						base = `current (patched by ${getPatchedBy(id).join(', ')})`;
					} else {
						base = 'original (module has no patches applied)';
					}
				}

				const { results, output, hardFailed } = runReplacements(code, patch.replace, {
					hardFail: patch.hardFail,
					context,
				});
				const applied = results.filter(
					(r) => r.status === 'applied' || r.status === 'replaced module',
				).length;

				lines.push(
					'',
					`== Module ${id} (${moduleStatus(id)}), tested against ${base} source, ${code.length} chars`,
				);
				lines.push(...results.map(formatResult));

				const error = output !== code ? compileError(output) : undefined;
				if (error) {
					const culprit = findBreakingReplacement(code, patch.replace);
					lines.push(
						`Result: patched module doesn't compile (${error})${culprit ? `, first broken by #${culprit}` : ''}. moonlight would discard every patch on this module.`,
					);
				} else if (hardFailed) {
					lines.push('Result: hardFail rolled back all replacements');
				} else {
					lines.push(`Result: ${applied}/${results.length} replacements applied`);
				}
			}

			return lines.join('\n');
		},
	});
};
