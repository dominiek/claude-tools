# claude-tools

Tools for integrating Claude Code with external services.

## Projects

### [simple-channel-mcp](./simple-channel-mcp)

MCP channel server for Claude Code. Bridges Claude Code sessions to external clients over WebSocket. Includes a built-in web dashboard and exposes tools for messaging, file sharing, permission handling, and background process tracking.

### [deckhand](./deckhand)

Slack bot that connects to simple-channel-mcp and surfaces Claude Code sessions in Slack threads. Users @mention the bot to start a session, then interact through threaded replies. Supports text, screenshots/GIFs, permission approvals, and tool event reporting.
