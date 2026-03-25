# simple-channel-mcp

A simple MCP channel server for [Claude Code](https://claude.ai/claude-code). Exposes Claude Code session controls over a local WebSocket so external tools (Slack bots, web dashboards, custom integrations) can interact with a running Claude Code session.

## What it does

When Claude Code starts with `--dangerously-load-development-channels server:simple-channel`, it spawns this server as a subprocess. The server:

1. **Speaks MCP over stdio** to Claude Code (channel protocol with tool definitions)
2. **Runs an HTTP + WebSocket server** on a local port for external clients
3. **Serves a built-in web dashboard** for quick browser-based interaction

External clients connect via WebSocket and can:
- Send messages/commands to Claude
- Receive Claude's replies, tool activity, and status updates in real-time
- Approve or deny permission requests (tool use authorization)

```
┌─────────────┐  stdio/MCP  ┌─────────────────────┐  WebSocket  ┌──────────────┐
│ Claude Code  │◄───────────►│  simple-channel-mcp  │◄───────────►│ Slack bot,   │
│              │             │  (this server)       │             │ Dashboard,   │
└─────────────┘             │  http://localhost:3100│             │ Custom tools │
                             └─────────────────────┘             └──────────────┘
```

> **Security warning:** The WebSocket and HTTP server bind to `localhost` with no authentication. This is intended for **local development only**. Do not expose this port to the internet or untrusted networks.

## Setup

### 1. Install and build

```bash
git clone <repo-url> simple-channel-mcp
cd simple-channel-mcp
npm install
npm run build
```

### 2. Register with Claude Code

Add the server to your Claude Code MCP config. You can do this per-project or globally.

**Per-project** — create `.mcp.json` in your project root:

```json
{
  "mcpServers": {
    "simple-channel": {
      "command": "node",
      "args": ["/absolute/path/to/simple-channel-mcp/build/index.js"],
      "env": {
        "PORT": "3100"
      }
    }
  }
}
```

**Global** — add to `~/.claude.json` under `mcpServers`:

```json
{
  "mcpServers": {
    "simple-channel": {
      "command": "node",
      "args": ["/absolute/path/to/simple-channel-mcp/build/index.js"],
      "env": {
        "PORT": "3100"
      }
    }
  }
}
```

### 3. Run Claude Code with the channel

```bash
claude --dangerously-load-development-channels server:simple-channel
```

The server starts automatically as a subprocess. Open `http://localhost:3100` for the built-in dashboard.

## Configuration

| Environment Variable | Default | Description |
|---|---|---|
| `PORT` | `3100` | HTTP + WebSocket server port |

Set via the `env` block in your MCP config (see above) or export before running.

## Using from any project

The MCP config points to the absolute path of this server's build output. Once registered (globally or per-project), you can use it from any directory:

```bash
# From any project directory
claude --dangerously-load-development-channels server:simple-channel
```

The server runs in the background — Claude Code manages its lifecycle. When Claude exits, the server shuts down automatically.

## WebSocket API

Connect to `ws://localhost:3100` (or your configured port). The protocol is JSON messages.

### Client → Server

**Send a message to Claude:**
```json
{ "type": "send", "text": "Fix the login bug", "meta": { "source": "slack" } }
```

**Send a slash command:**
```json
{ "type": "command", "command": "/usage" }
```

**Respond to a permission request:**
```json
{ "type": "permission", "request_id": "abcde", "behavior": "allow" }
```

### Server → Client

**Claude's reply:**
```json
{ "type": "message", "message": { "id": "...", "direction": "outbound", "content": "...", "format": "markdown" } }
```

**Permission request (needs Allow/Deny):**
```json
{ "type": "permission_request", "request": { "request_id": "abcde", "tool_name": "Bash", "description": "...", "input_preview": "..." } }
```

**Tool activity:**
```json
{ "type": "tool_event", "event": { "id": "...", "tool_name": "Edit", "input_summary": "...", "status": "completed" } }
```

**Activity status change:**
```json
{ "type": "activity", "activity": { "status": "tool_running", "tool_name": "Bash", "detail": "npm test" } }
```

**Session info:**
```json
{ "type": "session_info", "info": { "model": "opus-4", "cwd": "/path/to/project" } }
```

**Background process update:**
```json
{ "type": "background_process", "process": { "process_id": "...", "command": "npm test", "status": "running" } }
```

**Full session state (sent on connect):**
```json
{ "type": "status", "state": { "connectedSince": 1234567890, "messageCount": 5, "activity": { "status": "idle" }, ... } }
```

## MCP Tools

The server exposes these tools to Claude via the MCP protocol:

| Tool | Description |
|---|---|
| `reply` | Send a response to connected clients (markdown supported) |
| `update_status` | Report current activity (idle, thinking, tool_running) |
| `update_session_info` | Push session metadata (model, cwd, token usage) |
| `report_tool_use` | Log tool calls for client visibility |
| `update_background_process` | Report on background command status |

## Building integrations

To build your own client (Slack bot, CLI tool, etc.), connect to the WebSocket and implement the protocol above. See [Deckhand](https://github.com/anthropics/deckhand) for a Slack bot example.

## Project structure

```
src/
├── index.ts          # Entry point — wires MCP channel + HTTP server
├── channel.ts        # MCP server with claude/channel capability and tool definitions
├── http-server.ts    # HTTP + WebSocket server
├── state.ts          # In-memory state with EventEmitter for broadcasting
├── types.ts          # TypeScript type definitions
└── log.ts            # Logging (stderr, to avoid corrupting stdio MCP)
public/
└── index.html        # Built-in web dashboard (single file, no build step)
```

## License

MIT
