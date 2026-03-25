# Deckhand

Slack bot that bridges Claude Code sessions with Slack threads. Users @mention the bot to start a session, then interact with Claude through threaded replies. Claude's responses, screenshots, permission requests, and tool events all appear in the thread.

## Setup

### 1. Create a Slack App

1. Go to [api.slack.com/apps](https://api.slack.com/apps) and create a new app
2. Enable **Socket Mode** (Settings → Socket Mode → Enable)
3. Generate an **App-Level Token** with `connections:write` scope — this is your `SLACK_APP_TOKEN`

### 2. Configure Bot Token Scopes

Under **OAuth & Permissions → Scopes**, add:

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

### 3. Subscribe to Events

Under **Event Subscriptions → Subscribe to bot events**, add:

- `app_mention`
- `message.channels` (public channel messages)
- `message.groups` (private channel messages)

### 4. Install & Configure

1. Install the app to your workspace
2. Copy the **Bot User OAuth Token** (`xoxb-...`) — this is your `SLACK_BOT_TOKEN`
3. Get the channel ID: right-click channel name → View channel details → copy ID at the bottom
4. For private channels: `/invite @Deckhand` in the channel

### 5. Environment Variables

Create a `.env` file:

```
SLACK_BOT_TOKEN=xoxb-...
SLACK_APP_TOKEN=xapp-...
SLACK_CHANNEL_ID=C0123456789
CHANNEL_SERVER_URL=ws://localhost:3100
```

`CHANNEL_SERVER_URL` defaults to `ws://localhost:3100` if not set.

## Build & Run

```bash
npm install
npm run build
npm start
```

For development with auto-rebuild:

```bash
npm run dev
```

## How It Works

```
Slack thread ←→ Deckhand ←→ simple-channel-mcp ←→ Claude Code
```

1. User @mentions the bot → deckhand creates a thread and starts a Claude session
2. Thread replies are forwarded to Claude via the channel server WebSocket
3. Claude's output is posted back to the thread:
   - Text responses as threaded messages
   - Screenshots/GIFs uploaded as files
   - Permission requests as interactive button messages
   - Tool usage as compact status updates
