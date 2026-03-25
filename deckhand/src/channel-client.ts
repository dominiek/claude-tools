import WebSocket from 'ws';
import { EventEmitter } from 'node:events';
import { log } from './log.js';

/**
 * WebSocket client that connects to the Claude Code Channel server.
 * Same protocol as the web dashboard uses.
 */
export class ChannelClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private url: string;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private _connected = false;

  constructor(url: string) {
    super();
    this.url = url;
  }

  get connected() { return this._connected; }

  connect() {
    log('WS-CLIENT', `Connecting to ${this.url}...`);
    this.ws = new WebSocket(this.url);

    this.ws.on('open', () => {
      this._connected = true;
      log('WS-CLIENT', 'Connected to channel server');
      this.emit('connected');
    });

    this.ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        this.emit('server_message', msg);
      } catch (e) {
        log('WS-CLIENT', 'Failed to parse message:', e);
      }
    });

    this.ws.on('close', () => {
      this._connected = false;
      log('WS-CLIENT', 'Disconnected from channel server');
      this.emit('disconnected');
      this.scheduleReconnect();
    });

    this.ws.on('error', (err) => {
      log('WS-CLIENT', 'WebSocket error:', err.message);
    });
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, 3000);
  }

  /** Send a message to Claude (same as dashboard's "send" action) */
  sendMessage(text: string, meta?: Record<string, string>) {
    this.send({ type: 'send', text, meta });
  }

  /** Send a slash command to Claude */
  sendCommand(command: string) {
    this.send({ type: 'command', command });
  }

  /** Respond to a permission request */
  sendPermission(request_id: string, behavior: 'allow' | 'deny') {
    this.send({ type: 'permission', request_id, behavior });
  }

  private send(msg: unknown) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      log('WS-CLIENT', 'Cannot send — not connected');
      return;
    }
    this.ws.send(JSON.stringify(msg));
  }

  close() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
  }
}
