import spacepack from '@moonlight-mod/wp/spacepack_spacepack';
import * as v from 'valibot';

import { describe, stringify } from '#/lib/describe.ts';
import { IntSchema, defineTool } from '#/lib/tool.ts';

export const evaluateTool = defineTool({
	name: 'evaluate',
	description: `Run JavaScript in Discord's renderer and preview the result.`,
	input: v.object({
		code: v.pipe(
			v.string(),
			v.description(
				`Expression or async function body (use \`return\`). In scope: \`spacepack\`, webpack \`require\` (accepts moonmap names), and \`moonlight\`.`,
			),
		),
		depth: v.pipe(v.optional(IntSchema(0, 6), 2), v.description('How deep to expand objects in the result')),
	}),
	async handler({ code, depth }) {
		return stringify(describe(await evaluate(code), depth));
	},
});

const AsyncFunction: new (...args: string[]) => (...args: unknown[]) => Promise<unknown> =
	Object.getPrototypeOf(async () => {}).constructor;

const evaluate = (code: string) => {
	// expressions return implicitly; statement bodies need an explicit return
	let fn: (...args: unknown[]) => Promise<unknown>;
	try {
		fn = new AsyncFunction('spacepack', 'require', `return (\n${code}\n);`);
	} catch (e) {
		if (!(e instanceof SyntaxError)) {
			throw e;
		}
		fn = new AsyncFunction('spacepack', 'require', code);
	}
	return fn(spacepack, spacepack.require);
};
