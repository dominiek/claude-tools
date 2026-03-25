// All logging goes to stderr so it doesn't interfere with stdio MCP transport on stdout
export function log(tag, ...args) {
    const ts = new Date().toISOString().slice(11, 23);
    console.error(`[${ts}] [${tag}]`, ...args);
}
//# sourceMappingURL=log.js.map