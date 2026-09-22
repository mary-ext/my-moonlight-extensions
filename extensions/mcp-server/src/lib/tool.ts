import { errorResult, textResult } from '@mary-ext/moonlight-mcp/protocol';
import type { CallToolResult, ToolAnnotations, ToolInfo } from '@mary-ext/moonlight-mcp/types';

import { type JsonSchema, toJsonSchema } from '@valibot/to-json-schema';
import * as v from 'valibot';

import { describe, stringify } from './describe.ts';

type ObjectSchema = v.GenericSchema<Record<string, unknown>>;

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

/** holds tools and dispatches calls to them */
export class ToolRegistry {
	readonly #tools = new Map<string, Tool>();
	#infoCache: ToolInfo[] | null = null;

	/**
	 * adds a tool, inferring the handler's argument type from its input schema.
	 *
	 * @param tool metadata, input schema and handler
	 * @throws if a tool with the same name was already added
	 */
	define<S extends ObjectSchema>(tool: Tool<S>): void {
		if (this.#tools.has(tool.name)) {
			throw new Error(`Duplicate tool ${tool.name}`);
		}
		this.#tools.set(tool.name, tool);
		this.#infoCache = null;
	}

	/**
	 * lists the tools as advertised over MCP.
	 *
	 * @returns tool names, descriptions and JSON schemas
	 */
	list(): ToolInfo[] {
		let info = this.#infoCache;
		if (info === null) {
			info = this.#tools
				.values()
				.map(({ name, description, input, annotations }) => {
					const { $schema: _, ...inputSchema } = toJsonSchema(input, {
						typeMode: 'input',
						errorMode: 'ignore',
						overrideSchema: ({ valibotSchema, jsonSchema }) => {
							// MCP requires a top-level object schema
							return valibotSchema === input ? flattenObjects(jsonSchema) : undefined;
						},
					});

					return { name, description, inputSchema, annotations };
				})
				.toArray();
		}

		return info;
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

const isObjectSchema = (schema: JsonSchema | boolean): schema is JsonSchema => {
	return typeof schema === 'object' && schema.type === 'object';
};

// annotations don't change that `not: {}` rejects every value
const isNever = (schema: JsonSchema | boolean): boolean => {
	if (typeof schema === 'boolean') {
		return !schema;
	}

	const { not } = schema;

	return not === true || (typeof not === 'object' && Object.keys(not).length === 0);
};

// flattening loses cross-property constraints; Valibot still validates tool arguments
const flattenObjects = (schema: JsonSchema): JsonSchema | undefined => {
	let combinator: 'allOf' | 'anyOf';
	if (schema.allOf !== undefined) {
		combinator = 'allOf';
	} else if (schema.anyOf !== undefined) {
		combinator = 'anyOf';
	} else {
		return undefined;
	}

	const { [combinator]: members = [], ...rest } = schema;

	// nested combinators can also describe the root object
	const options = members.map((member) => {
		return typeof member === 'object' ? (flattenObjects(member) ?? member) : member;
	});

	if (!options.every(isObjectSchema)) {
		return undefined;
	}

	const properties = new Map<string, Map<string, JsonSchema | boolean>>();
	for (const option of options) {
		for (const [key, property] of Object.entries(option.properties ?? {})) {
			// a property forbidden in one branch may be allowed in another
			if (combinator === 'anyOf' && isNever(property)) {
				continue;
			}

			const variants = properties.get(key) ?? new Map<string, JsonSchema | boolean>();
			variants.set(JSON.stringify(property), property);
			properties.set(key, variants);
		}
	}

	const required = properties.keys().filter((key) => {
		const requires = (option: JsonSchema) => option.required?.includes(key) ?? false;
		return combinator === 'anyOf' ? options.every(requires) : options.some(requires);
	});

	return {
		...rest,
		type: 'object',
		properties: Object.fromEntries(
			properties.entries().map(([key, variants]) => {
				const schemas = [...variants.values()];
				return [key, schemas.length === 1 ? schemas[0] : { [combinator]: schemas }];
			}),
		),
		required: required.toArray(),
	};
};
