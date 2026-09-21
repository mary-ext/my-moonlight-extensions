# @mary-ext/moonlight-mcp

a stdio [Model Context Protocol](https://modelcontextprotocol.io) bridge to
[moonlight](https://moonlight-mod.github.io/)'s `mcpServer` extension for inspecting Discord and
testing patches.

## setup

enable `mcpServer` in Discord, then register the bridge with your MCP client. for Claude Code:

```sh
claude mcp add moonlight -- npx -y @mary-ext/moonlight-mcp
```

for clients using an `mcpServers` JSON config:

```json
{
	"mcpServers": {
		"moonlight": {
			"command": "npx",
			"args": ["-y", "@mary-ext/moonlight-mcp"]
		}
	}
}
```

the bridge connects to the newest running Discord instance and reconnects when Discord restarts. it
adds `list_instances` and `select_instance` tools for switching between instances.

### options

- `--pid <pid>`: only connect to this process
- `--channel <name>`: only connect to this release channel (`stable`, `ptb`, `canary`)
- `--dir <path>`: discovery directory

## how it works

the discovery directory is `$MOONLIGHT_MCP_DIR`, `$XDG_RUNTIME_DIR/moonlight-mcp`, or
`<tmpdir>/moonlight-mcp-<user>`, in that order. each Discord process writes `<pid>.json` with its
socket address, release channel and build number. the extension listens on `<pid>.sock` in that
directory on Unix, or a named pipe on Windows. the bridge forwards newline-delimited JSON-RPC
between stdio and the socket.

socket access allows arbitrary code execution through `evaluate`. on Unix, the discovery directory
must belong to the current user with no group or other permissions; it is created with mode 0700.
