# my-moonlight-extensions

my [moonlight](https://github.com/moonlight-mod/moonlight) extensions.

```
https://mary-ext.github.io/my-moonlight-extensions/repo.json
```

## development

```sh
pnpm install
pnpm run dev
```

add the absolute path to `dist/` to Moonbase's "Extension search paths" setting.

### MCP server

enable `mcpServer` to inspect Discord and test patches against the running build. this repository's
`.mcp.json` connects Claude Code through [`packages/moonlight-mcp`](./packages/moonlight-mcp). keep
`pnpm run dev` running and use the `reload` tool to apply changes (`restart` for `host.ts`).
