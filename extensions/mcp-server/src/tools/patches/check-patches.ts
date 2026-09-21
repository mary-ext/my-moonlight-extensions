import { mapDefined } from '@mary/array-fns';

import type { IdentifiedPatch } from '@moonlight-mod/types';
import * as v from 'valibot';

import { getCapture } from '#/lib/capture.ts';
import {
	allModuleSources,
	getOriginalSource,
	getPatchedBy,
	isModuleLoaded,
	matcherToString,
} from '#/lib/modules.ts';
import {
	compileError,
	findMatchingModules,
	formatResult,
	runReplacements,
	selectTargets,
} from '#/lib/patching.ts';
import { pluralize } from '#/lib/text.ts';
import { defineTool } from '#/lib/tool.ts';

interface PatchReport {
	/** whether the prerequisite kept the patch from being applied */
	skipped: boolean;
	targets: string[];
	issues: string[];
	/** whether the patch is expected to change its module */
	effective: boolean;
}

const patchLabel = (patch: IdentifiedPatch) => `${patch.ext}#${patch.id}`;

/** replays patches per module in registration order, each using the previous patch's output */
const simulateAll = (patches: IdentifiedPatch[]) => {
	const sources = [...allModuleSources()];
	const reports = new Map<IdentifiedPatch, PatchReport>();
	const chains = new Map<string, IdentifiedPatch[]>();

	for (const patch of patches) {
		const skipped = patch.prerequisite ? !patch.prerequisite() : false;
		const report: PatchReport = { skipped, targets: [], issues: [], effective: false };
		reports.set(patch, report);
		if (skipped) {
			continue;
		}

		const matching = findMatchingModules(sources, patch.find);

		if (!matching.length) {
			report.issues.push('FOUND NO MODULE (may be in an unloaded lazy chunk)');
			continue;
		}

		const targets = selectTargets(patch.find, matching);
		if (matching.length > 1 && targets.length === 1) {
			report.issues.push(
				`find matches ${matching.length} modules (${matching.slice(0, 5).join(', ')}), lands on whichever loads first`,
			);
		}

		report.targets = targets;
		for (const id of targets) {
			const chain = chains.get(id);
			if (chain) {
				chain.push(patch);
			} else {
				chains.set(id, [patch]);
			}
		}
	}

	for (const [id, chain] of chains) {
		const original = getOriginalSource(id)!;
		let code = original;

		for (const patch of chain) {
			const report = reports.get(patch)!;
			const { results, output, hardFailed } = runReplacements(code, [patch.replace].flat(), {
				hardFail: patch.hardFail,
			});

			report.issues.push(
				...mapDefined(results, (r) => {
					if (r.status === 'error' || r.status === 'no effect') {
						return `module ${id}: ${formatResult(r)}`;
					}
					return undefined;
				}),
			);
			if (hardFailed) {
				report.issues.push(`module ${id}: hardFail patch had a failure, none of its replacements apply`);
			}
			if (output !== code) {
				report.effective = true;
			}

			code = output;
		}

		const error = code !== original ? compileError(code) : undefined;
		if (error) {
			for (const patch of chain) {
				reports
					.get(patch)!
					.issues.push(
						`module ${id} doesn't compile after all its patches (${error}), moonlight keeps it unpatched`,
					);
			}
		}
	}

	return reports;
};

const runtimeState = (patch: IdentifiedPatch, report: PatchReport) => {
	if (!report.targets.length) {
		return undefined;
	}

	const label = patchLabel(patch);
	const applied = report.targets.some((id) =>
		getPatchedBy(id).some((p) => p === label || p.startsWith(`${label}#`)),
	);

	if (applied) {
		return 'applied at runtime';
	}
	if (!report.effective) {
		return 'not applied at runtime';
	}
	return report.targets.some(isModuleLoaded) ? 'NOT applied at runtime' : 'not applied yet';
};

export const checkPatches = defineTool({
	name: 'check_patches',
	description: `Replay registered patches and report unmatched or ambiguous finds, ineffective replacements, syntax errors and patches missing at runtime.`,
	annotations: { readOnlyHint: true },
	input: v.object({
		ext: v.pipe(
			v.optional(v.string()),
			v.description('Only report patches of this extension. Defaults to all'),
		),
		verbose: v.pipe(v.optional(v.boolean(), false), v.description('Also list patches without problems')),
	}),
	handler({ ext, verbose }) {
		const patches = [...getCapture().patches];
		if (ext && !patches.some((p) => p.ext === ext)) {
			throw new Error(`Extension ${ext} registered no patches. Check its state with list_extensions.`);
		}

		// every patch is simulated even when filtering, since patches on the same module affect each other
		const reports = simulateAll(patches);
		const byExt = new Map<string, string[]>();
		let total = 0;
		let problems = 0;

		for (const patch of patches) {
			if (ext && patch.ext !== ext) {
				continue;
			}
			total++;

			const report = reports.get(patch)!;
			const find = `find ${matcherToString(patch.find)}`;
			const state = runtimeState(patch, report);
			let lines: string[] = [];

			const target = report.targets.join(', ');
			if (report.skipped) {
				if (verbose) {
					lines = [`  #${patch.id} ${find}: skipped (prerequisite false)`];
				}
			} else if (report.issues.length) {
				problems++;
				lines = [
					`  #${patch.id} ${find}${target ? ` -> module ${target}` : ''}${state ? ` (${state})` : ''}:`,
					...report.issues.map((s) => `    ${s}`),
				];
			} else if (verbose) {
				lines = [`  #${patch.id} ${find} -> module ${target}: ok (${state})`];
			}

			if (lines.length) {
				const existing = byExt.get(patch.ext);
				if (existing) {
					existing.push(...lines);
				} else {
					byExt.set(patch.ext, lines);
				}
			}
		}

		const out = [`Checked ${pluralize(total, 'patch', 'patches')}: ${pluralize(problems, 'problem')}`];
		for (const [id, lines] of byExt) {
			out.push(`${id}:`, ...lines);
		}
		return out.join('\n');
	},
});
