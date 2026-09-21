/** behavioral hints about a tool, as defined by MCP */
export interface ToolAnnotations {
	title?: string;
	readOnlyHint?: boolean;
	destructiveHint?: boolean;
	idempotentHint?: boolean;
	openWorldHint?: boolean;
}

/** a tool as advertised in `tools/list` */
export interface ToolInfo {
	name: string;
	description: string;
	inputSchema: Record<string, unknown>;
	annotations?: ToolAnnotations;
}

/** a text block in a tool result */
export interface ContentBlock {
	type: 'text';
	text: string;
}

/** result of a `tools/call` request */
export interface CallToolResult {
	content: ContentBlock[];
	isError?: boolean;
}

/** Discord and moonlight version metadata */
export interface InstanceInfo {
	moonlightVersion: string;
	moonlightBranch: string;
	releaseChannel: string;
	/** Discord's build number, or -1 while it isn't known yet */
	buildNumber: number;
}

/** contents of `<pid>.json` in the discovery directory */
export interface InstanceMetadata extends InstanceInfo {
	formatVersion: 1;
	pid: number;
	/** socket path, or named pipe on Windows */
	socket: string;
	/** when the process started, in milliseconds since the epoch */
	startedAt: number;
}
