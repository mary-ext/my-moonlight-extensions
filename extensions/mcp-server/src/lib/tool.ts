import { errorResult, textResult } from '@mary-ext/moonlight-mcp/protocol';
import type { CallToolResult, ToolAnnotations, ToolInfo } from '@mary-ext/moonlight-mcp/types';

import { toJsonSchema } from '@valibot/to-json-schema';
import * as v from 'valibot';

import { describe, stringify } from './describe.ts';

type ObjectSchema = v.ObjectSchema<v.ObjectEntries, v.ErrorMessage<v.ObjectIssue> | undefined>;

/**
 * creates an inclusive integer range schema.
 *
 * @param min smallest allowed value
 * @param max largest allowed value
 * @returns a schema accepting integers from `min` through `max`
 */
export const IntSchema = (min: number, max: number) => {
	return v.pipe(v.number(), v.integer(), v.minValue(min), v.maxValue(max));
};

/** what a tool handler returns; strings become a single text block */
export type ToolOutput = string | CallToolResult;

/** a tool served over MCP */
export interface Tool<S extends ObjectSchema = ObjectSchema> {
	name: string;
	description: string;
	input: S;
	annotations?: ToolAnnotations;
	handler(args: v.InferOutput<S>): ToolOutput | Promise<ToolOutput>;
}

/**
 * defines a tool, inferring the handler's argument type from its input schema.
 *
 * @param tool metadata, input schema and handler
 * @returns the same tool, typed for {@link ToolRegistry}
 */
export const defineTool = <S extends ObjectSchema>(tool: Tool<S>): Tool => {
	return tool;
};

/** holds tools and dispatches calls to them */
export class ToolRegistry {
	readonly #tools = new Map<string, Tool>();
	#infoCache: ToolInfo[] | null = null;

	/**
	 * adds tools.
	 *
	 * @param tools tools to add
	 * @throws if a tool with the same name was already added
	 */
	add(...tools: Tool[]): void {
		for (const tool of tools) {
			if (this.#tools.has(tool.name)) {
				throw new Error(`Duplicate tool ${tool.name}`);
			}
			this.#tools.set(tool.name, tool);
		}
		this.#infoCache = null;
	}

	/**
	 * lists the tools as advertised over MCP.
	 *
	 * @returns tool names, descriptions and JSON schemas
	 */
	list(): ToolInfo[] {
		return (this.#infoCache ??= [...this.#tools.values()].map(({ name, description, input, annotations }) => {
			// input mode, so fields with defaults show as optional
			const { $schema: _, ...inputSchema } = toJsonSchema(input, { typeMode: 'input', errorMode: 'ignore' });
			return { name, description, inputSchema, annotations };
		}));
	}

	/**
	 * validates arguments and calls a tool.
	 *
	 * @param name tool name
	 * @param args arguments as received over MCP
	 * @returns the tool result, or an error result for unknown tools, invalid arguments and handler failures
	 */
	async call(name: string, args: unknown): Promise<CallToolResult> {
		const tool = this.#tools.get(name);
		if (!tool) {
			return errorResult(`Unknown tool: ${name}`);
		}

		const parsed = v.safeParse(tool.input, args ?? {});
		if (!parsed.success) {
			return errorResult(`Invalid arguments:\n${v.summarize(parsed.issues)}`);
		}

		try {
			const result = await tool.handler(parsed.output);
			return typeof result === 'string' ? textResult(result) : result;
		} catch (e) {
			// code run by evaluate can throw anything, not just errors
			return errorResult(e instanceof Error ? e : `Thrown: ${stringify(describe(e, 2))}`);
		}
	}
}
