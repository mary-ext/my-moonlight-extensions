import * as v from 'valibot';

import { LOG_LEVELS } from '#/lib/ipc.ts';
import { getNatives } from '#/lib/natives.ts';
import { IntSchema, defineTool } from '#/lib/tool.ts';

export const getLogs = defineTool({
	name: 'get_logs',
	description: `Read the renderer's console output, kept across reloads.`,
	annotations: { readOnlyHint: true },
	input: v.object({
		sinceId: v.pipe(
			v.optional(IntSchema(0, Number.MAX_SAFE_INTEGER), 0),
			v.description(`Return messages after this ID; use the previous result's nextId to read newer messages`),
		),
		level: v.pipe(v.optional(v.picklist(LOG_LEVELS), 'info'), v.description('Minimum level')),
		filter: v.pipe(v.optional(v.string()), v.description('Case-insensitive substring filter')),
		limit: v.pipe(
			v.optional(IntSchema(1, 1000), 100),
			v.description('Return at most this many of the newest matching messages'),
		),
	}),
	async handler(query) {
		const { entries, nextId, dropped } = await getNatives().getLogs(query);
		const lines = entries.map((e) => `#${e.id} [${e.level}] ${e.source ? `(${e.source}) ` : ''}${e.message}`);
		const note = dropped ? ` (${dropped} older messages were dropped from the buffer)` : '';
		return `nextId: ${nextId}${note}\n${lines.join('\n') || '(no messages)'}`;
	},
});
