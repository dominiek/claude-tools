#!/usr/bin/env node
import { createChannelServer, connectStdio } from './channel.js';
import { startHttpServer } from './http-server.js';
import { log } from './log.js';
// Catch unhandled errors so the process doesn't silently die
process.on('uncaughtException', (err) => {
    log('FATAL', 'Uncaught exception:', err);
});
process.on('unhandledRejection', (err) => {
    log('FATAL', 'Unhandled rejection:', err);
});
const PORT = parseInt(process.env.PORT ?? '3100', 10);
const isTTY = process.stdin.isTTY;
log('INIT', `pid=${process.pid} tty=${!!isTTY} port=${PORT}`);
// 1. Create the MCP channel server (registers tools + handlers)
createChannelServer();
log('INIT', 'Channel server created');
// 2. Start the HTTP + WebSocket dashboard server
const httpServer = startHttpServer(PORT);
// 3. Graceful shutdown — kill HTTP server when parent dies
function shutdown() {
    log('SHUTDOWN', 'Shutting down...');
    httpServer.close();
    process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGHUP', shutdown);
process.on('SIGINT', shutdown);
// When Claude Code exits, stdin closes — detect that and shut down
process.stdin.on('end', () => {
    log('SHUTDOWN', 'stdin closed (parent exited)');
    shutdown();
});
process.stdin.on('close', () => {
    log('SHUTDOWN', 'stdin stream closed');
    shutdown();
});
// 4. Connect the MCP channel over stdio to Claude Code (only when spawned as a subprocess)
if (!isTTY) {
    log('INIT', 'Connecting stdio transport...');
    await connectStdio();
    log('INIT', 'Stdio transport connected');
}
else {
    log('INIT', 'Running in standalone mode (no Claude Code connection)');
    log('INIT', 'To connect: claude --dangerously-load-development-channels server:simple-channel');
}
//# sourceMappingURL=index.js.map