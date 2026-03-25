# Deckhand

Slack bot that bridges Claude Code sessions with Slack threads via the simple-channel-mcp WebSocket server.

## Build & Run

```bash
npm run build
npm start
```

## Configuration

All config is via environment variables (`.env` file):

| Variable | Required | Description |
|---|---|---|
| `SLACK_BOT_TOKEN` | Yes | Bot token (`xoxb-...`) |
| `SLACK_APP_TOKEN` | Yes | App-level token (`xapp-...`) for Socket Mode |
| `SLACK_CHANNEL_ID` | Yes | Channel ID to listen in (right-click channel → View details → copy ID) |
| `CHANNEL_SERVER_URL` | No | WebSocket URL for simple-channel-mcp (default: `ws://localhost:3100`) |

## Slack App Setup

### Required Bot Token Scopes

| Scope | Purpose |
|---|---|
| `app_mentions:read` | Receive @mentions to start sessions |
| `chat:write` | Post messages in threads |
| `files:write` | Upload screenshots/GIFs to threads |
| `files:read` | View shared files |
| `reactions:write` | Add emoji reactions |
| `channels:read` | List public channels |
| `channels:history` | Read messages in public channels |
| `groups:history` | Read messages in private channels |
| `groups:read` | List/view private channels |

### Event Subscriptions

The app must subscribe to these bot events:
- `app_mention` — triggers new sessions
- `message.channels` — receives thread replies in public channels
- `message.groups` — receives thread replies in private channels

### Private Channels

For private channels, the bot must:
1. Have `groups:history` and `groups:read` scopes
2. Be invited to the channel with `/invite @Deckhand`

### Socket Mode

Socket Mode must be enabled (uses `SLACK_APP_TOKEN` for the WebSocket connection).

## Architecture

- `src/index.ts` — Main entry: Slack event handling, channel server message routing
- `src/channel-client.ts` — WebSocket client connecting to simple-channel-mcp
- `src/formatter.ts` — Markdown-to-Slack conversion, permission/tool event formatting
- `src/thread-state.ts` — Tracks active Slack thread per session
- `src/log.ts` — Logging utility

## Flow

1. User @mentions bot in configured channel → new thread + session starts
2. Thread replies are forwarded to Claude via channel server
3. Claude's responses, permission requests, tool events, and files are posted back to the thread
