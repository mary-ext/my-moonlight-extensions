# @mary-ext/moonlight-mcp

an MCP bridge for Discord.

## setup

install the "MCP server" extension from
[my moonlight's extension repository](https://github.com/mary-ext/my-moonlight-extensions).

afterwards, register the bridge with your MCP client.

```sh
# Claude Code installation
claude mcp add moonlight -- npx -y @mary-ext/moonlight-mcp
```

```json
// .mcp.json
{
	"mcpServers": {
		"moonlight": {
			"command": "npx",
			"args": ["-y", "@mary-ext/moonlight-mcp"]
		}
	}
}
```

### options

- `--pid <pid>`: only connect to this process
- `--channel <name>`: only connect to this release channel (`stable`, `ptb`, `canary`)
- `--dir <path>`: discovery directory
