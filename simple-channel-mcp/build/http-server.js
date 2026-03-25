import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { WebSocketServer } from 'ws';
import { state } from './state.js';
import { sendToChannel, sendPermissionVerdict } from './channel.js';
import { log } from './log.js';
const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, '..', 'public');
function json(res, data, status = 200) {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
}
function cors(res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}
async function readBody(req) {
    const chunks = [];
    for await (const chunk of req)
        chunks.push(chunk);
    return Buffer.concat(chunks).toString();
}
export function startHttpServer(port) {
    const httpServer = createServer(async (req, res) => {
        cors(res);
        if (req.method === 'OPTIONS') {
            res.writeHead(204);
            res.end();
            return;
        }
        const url = new URL(req.url ?? '/', `http://localhost:${port}`);
        // API routes
        if (url.pathname === '/api/status') {
            json(res, state.getSessionState());
            return;
        }
        if (url.pathname === '/api/messages') {
            json(res, state.messages);
            return;
        }
        if (url.pathname === '/api/send' && req.method === 'POST') {
            try {
                const body = JSON.parse(await readBody(req));
                const text = body.text;
                const meta = body.meta;
                if (!text) {
                    json(res, { error: 'text is required' }, 400);
                    return;
                }
                log('HTTP', `POST /api/send: "${text.slice(0, 100)}"`);
                await sendToChannel(text, meta);
                json(res, { ok: true });
            }
            catch (e) {
                log('HTTP', 'Error in /api/send:', e);
                json(res, { error: String(e) }, 500);
            }
            return;
        }
        if (url.pathname === '/api/permission' && req.method === 'POST') {
            try {
                const body = JSON.parse(await readBody(req));
                const { request_id, behavior } = body;
                if (!request_id || !['allow', 'deny'].includes(behavior)) {
                    json(res, { error: 'request_id and behavior (allow|deny) required' }, 400);
                    return;
                }
                await sendPermissionVerdict(request_id, behavior);
                json(res, { ok: true });
            }
            catch (e) {
                log('HTTP', 'Error in /api/permission:', e);
                json(res, { error: String(e) }, 500);
            }
            return;
        }
        // Serve static files
        if (url.pathname === '/' || url.pathname === '/index.html') {
            try {
                const html = await readFile(join(PUBLIC_DIR, 'index.html'), 'utf-8');
                res.writeHead(200, { 'Content-Type': 'text/html' });
                res.end(html);
            }
            catch {
                res.writeHead(404);
                res.end('Not found');
            }
            return;
        }
        res.writeHead(404);
        res.end('Not found');
    });
    // WebSocket server
    const wss = new WebSocketServer({ server: httpServer });
    function broadcast(msg) {
        const data = JSON.stringify(msg);
        const readyClients = [...wss.clients].filter(c => c.readyState === 1).length;
        log('WS', `Broadcasting ${msg.type} (${data.length} bytes JSON) to ${readyClients} clients`);
        for (const client of wss.clients) {
            if (client.readyState === 1)
                client.send(data);
        }
    }
    // Wire state events → WebSocket broadcasts
    state.on('message', (message) => broadcast({ type: 'message', message }));
    state.on('permission_request', (request) => broadcast({ type: 'permission_request', request }));
    state.on('permission_resolved', (request_id) => broadcast({ type: 'permission_resolved', request_id }));
    state.on('activity', (activity) => broadcast({ type: 'activity', activity }));
    state.on('session_info', (info) => broadcast({ type: 'session_info', info }));
    state.on('background_process', (process) => broadcast({ type: 'background_process', process }));
    state.on('tool_event', (event) => broadcast({ type: 'tool_event', event }));
    state.on('file', (file) => {
        log('WS', `Broadcasting file: ${file.name} (${file.mime_type}, base64: ${file.data_base64?.length ?? 0} chars, id: ${file.id})`);
        const payload = JSON.stringify({ type: 'file', file });
        log('WS', `File broadcast payload size: ${payload.length} chars, connected clients: ${wss.clients.size}`);
        broadcast({ type: 'file', file });
    });
    wss.on('connection', (ws) => {
        log('WS', 'Client connected');
        // Send full current state on connect
        const sessionState = state.getSessionState();
        ws.send(JSON.stringify({ type: 'status', state: sessionState }));
        ws.send(JSON.stringify({ type: 'activity', activity: state.activity }));
        if (Object.keys(state.sessionInfo).length > 0) {
            ws.send(JSON.stringify({ type: 'session_info', info: state.sessionInfo }));
        }
        for (const proc of state.backgroundProcesses.values()) {
            ws.send(JSON.stringify({ type: 'background_process', process: proc }));
        }
        for (const event of state.toolEvents) {
            ws.send(JSON.stringify({ type: 'tool_event', event }));
        }
        for (const message of state.messages) {
            ws.send(JSON.stringify({ type: 'message', message }));
        }
        ws.on('message', async (raw) => {
            const rawStr = raw.toString();
            log('WS', `Received: ${rawStr.slice(0, 200)}`);
            try {
                const msg = JSON.parse(rawStr);
                if (msg.type === 'send') {
                    await sendToChannel(msg.text, msg.meta);
                }
                else if (msg.type === 'permission') {
                    await sendPermissionVerdict(msg.request_id, msg.behavior);
                }
                else if (msg.type === 'command') {
                    await sendToChannel(msg.command, { type: 'command' });
                }
            }
            catch (e) {
                log('WS', 'Error handling message:', e);
            }
        });
        ws.on('close', () => log('WS', 'Client disconnected'));
        ws.on('error', (e) => log('WS', 'Client error:', e));
    });
    httpServer.listen(port, () => {
        log('HTTP', `Dashboard listening on http://localhost:${port}`);
    });
    return httpServer;
}
//# sourceMappingURL=http-server.js.map