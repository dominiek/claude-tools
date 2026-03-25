# simple-channel-mcp

Simple MCP channel server for Claude Code. Exposes session controls over stdio (MCP) and WebSocket.

## Build & Run

```bash
npm run build
claude --dangerously-load-development-channels server:simple-channel
```

Dashboard: http://localhost:3100 (configurable via PORT env var)

## Architecture

- `src/channel.ts` — MCP Server with `claude/channel` capability (stdio transport)
- `src/http-server.ts` — HTTP + WebSocket server for external clients
- `src/state.ts` — In-memory state with EventEmitter
- `public/index.html` — Built-in web dashboard

## Channel Protocol

- Inbound (client → Claude): `notifications/claude/channel` with `{ content, meta }`
- Outbound (Claude → client): Claude calls the `reply` tool
- Permissions: clients approve/deny via `notifications/claude/channel/permission`
