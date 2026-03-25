#!/usr/bin/env node
import 'dotenv/config';
import { App, LogLevel } from '@slack/bolt';
import { ChannelClient } from './channel-client.js';
import { threadManager } from './thread-state.js';
import {
  mdToSlack,
  splitText,
  formatPermissionBlocks,
  formatPermissionResolved,
  formatToolEventBatch,
  type PermissionRequest,
  type ToolEvent,
} from './formatter.js';
import { log } from './log.js';

// === Config ===
const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN!;
const SLACK_APP_TOKEN = process.env.SLACK_APP_TOKEN!;
const SLACK_CHANNEL_ID = process.env.SLACK_CHANNEL_ID!;
const CHANNEL_SERVER_URL = process.env.CHANNEL_SERVER_URL ?? 'ws://localhost:3100';

if (!SLACK_BOT_TOKEN || !SLACK_APP_TOKEN || !SLACK_CHANNEL_ID) {
  console.error('Missing required env vars: SLACK_BOT_TOKEN, SLACK_APP_TOKEN, SLACK_CHANNEL_ID');
  process.exit(1);
}

// === Channel server connection ===
const channel = new ChannelClient(CHANNEL_SERVER_URL);

// === Tool event batching ===
let pendingToolEvents: ToolEvent[] = [];
let toolEventTimer: ReturnType<typeof setTimeout> | null = null;
let toolEventMessageTs: string | null = null;

// Store permission requests so we can re-format after verdict
const permissionRequests = new Map<string, PermissionRequest>();

// === Slack App ===
const app = new App({
  token: SLACK_BOT_TOKEN,
  appToken: SLACK_APP_TOKEN,
  socketMode: true,
  logLevel: LogLevel.WARN,
});

// === @mention → new session ===
app.event('app_mention', async ({ event }) => {
  if (event.channel !== SLACK_CHANNEL_ID) return;
  log('SLACK', `@mention from ${event.user}: ${event.text?.slice(0, 100)}`);

  // Notify old thread
  const oldThread = threadManager.getActiveThread();
  if (oldThread) {
    try {
      await app.client.chat.postMessage({
        channel: oldThread.channel_id,
        thread_ts: oldThread.thread_ts,
        text: ':arrow_right: _Session moved to a new thread._',
      });
    } catch {}
  }

  // Reset tool event tracking
  toolEventMessageTs = null;
  pendingToolEvents = [];
  if (toolEventTimer) clearTimeout(toolEventTimer);

  // Strip @mention from text
  const text = (event.text ?? '').replace(/<@[A-Z0-9]+>/g, '').trim();

  // Start new thread
  const thread = threadManager.startThread(event.ts, event.channel, event.user ?? 'unknown');

  // React to acknowledge
  try {
    await app.client.reactions.add({ channel: event.channel, timestamp: event.ts, name: 'eyes' });
  } catch {}

  // Send to Claude via channel server
  const instruction = [
    text,
    '\n\n---',
    'New session started from Slack. Read CLAUDE.md first for project context.',
    'Use the reply tool to respond (your responses will appear in the Slack thread).',
    'Use report_tool_use for every tool call so the user can see your progress.',
  ].join('\n');

  channel.sendMessage(instruction, { source: 'slack', thread_ts: thread.thread_ts });
});

// === Thread replies → continue conversation ===
app.event('message', async ({ event }) => {
  const msg = event as any;
  log('SLACK', `message event: channel=${msg.channel} thread_ts=${msg.thread_ts ?? 'none'} bot_id=${msg.bot_id ?? 'none'} subtype=${msg.subtype ?? 'none'} text="${(msg.text ?? '').slice(0, 80)}"`);
  if (msg.bot_id || msg.subtype) { log('SLACK', 'Skipping: bot or subtype'); return; }
  if (msg.channel !== SLACK_CHANNEL_ID) { log('SLACK', `Skipping: channel mismatch (got ${msg.channel}, want ${SLACK_CHANNEL_ID})`); return; }
  if (!msg.thread_ts) { log('SLACK', 'Skipping: not a thread reply'); return; }
  if (!threadManager.isActiveThread(msg.thread_ts)) { log('SLACK', `Skipping: not active thread (thread_ts=${msg.thread_ts})`); return; }
  if (msg.ts === msg.thread_ts) return; // handled by app_mention

  log('SLACK', `Thread reply from ${msg.user}: ${msg.text?.slice(0, 100)}`);
  const text = (msg.text ?? '').replace(/<@[A-Z0-9]+>/g, '').trim();
  if (!text) return;

  channel.sendMessage(text, { source: 'slack', thread_ts: msg.thread_ts });
});

// === Permission buttons ===
app.action('permission_allow', async ({ action, body, ack }) => {
  await ack();
  const requestId = (action as any).value;
  log('SLACK', `Permission ALLOW: ${requestId} by ${body.user.id}`);

  const permReq = permissionRequests.get(requestId);
  const found = threadManager.findPermission(requestId);

  channel.sendPermission(requestId, 'allow');
  threadManager.resolvePermission(requestId);

  if (found && permReq) {
    try {
      await app.client.chat.update({
        channel: found.thread.channel_id,
        ts: found.message_ts,
        blocks: formatPermissionResolved(permReq, 'allow', body.user.id) as any,
        text: `${permReq.tool_name} — Allowed`,
      });
    } catch (e) {
      log('SLACK', 'Error updating permission message:', e);
    }
  }
});

app.action('permission_deny', async ({ action, body, ack }) => {
  await ack();
  const requestId = (action as any).value;
  log('SLACK', `Permission DENY: ${requestId} by ${body.user.id}`);

  const permReq = permissionRequests.get(requestId);
  const found = threadManager.findPermission(requestId);

  channel.sendPermission(requestId, 'deny');
  threadManager.resolvePermission(requestId);

  if (found && permReq) {
    try {
      await app.client.chat.update({
        channel: found.thread.channel_id,
        ts: found.message_ts,
        blocks: formatPermissionResolved(permReq, 'deny', body.user.id) as any,
        text: `${permReq.tool_name} — Denied`,
      });
    } catch (e) {
      log('SLACK', 'Error updating permission message:', e);
    }
  }
});

// === Channel server events → Slack thread ===
channel.on('server_message', async (msg: any) => {
  const thread = threadManager.getActiveThread();
  log('WS-IN', `Received message type: ${msg.type}${msg.type === 'file' ? ` (file: ${msg.file?.name ?? 'unknown'})` : ''}`);
  log('WS-IN', `Active thread: ${thread ? `channel=${thread.channel_id} ts=${thread.thread_ts}` : 'NONE'}`);

  switch (msg.type) {
    case 'message': {
      if (msg.message.direction !== 'outbound') break;
      if (!thread) break;
      // Skip if this message came from slack originally (avoid echo)
      if (msg.message.meta?.source === 'slack' && msg.message.direction === 'inbound') break;

      const text = mdToSlack(msg.message.content);
      try {
        for (const chunk of splitText(text, 3900)) {
          await app.client.chat.postMessage({
            channel: thread.channel_id,
            thread_ts: thread.thread_ts,
            text: chunk,
            mrkdwn: true,
          });
        }
      } catch (e) {
        log('SLACK', 'Error posting reply:', e);
      }
      break;
    }

    case 'permission_request': {
      if (!thread) break;
      const req = msg.request as PermissionRequest;
      permissionRequests.set(req.request_id, req);

      try {
        const result = await app.client.chat.postMessage({
          channel: thread.channel_id,
          thread_ts: thread.thread_ts,
          blocks: formatPermissionBlocks(req) as any,
          text: `Permission required: ${req.tool_name}`,
        });
        if (result.ts) {
          threadManager.addPendingPermission(req.request_id, result.ts);
        }
      } catch (e) {
        log('SLACK', 'Error posting permission request:', e);
      }
      break;
    }

    case 'tool_event': {
      if (!thread) break;
      const evt = msg.event as ToolEvent;
      pendingToolEvents.push(evt);
      if (toolEventTimer) clearTimeout(toolEventTimer);
      toolEventTimer = setTimeout(() => flushToolEvents(thread), 1500);
      break;
    }

    case 'file': {
      if (!thread) {
        log('SLACK', `WARNING: Received file message but no active thread! File: ${msg.file?.name ?? 'unknown'}`);
        break;
      }
      const file = msg.file as { id: string; name: string; mime_type: string; data_base64: string; caption?: string };
      log('SLACK', `Received file for upload: name=${file.name}, mime=${file.mime_type}, id=${file.id}, caption="${file.caption ?? '(none)'}", base64_length=${file.data_base64?.length ?? 'MISSING'}`);

      if (!file.data_base64 || file.data_base64.length === 0) {
        log('SLACK', `ERROR: File ${file.name} has no base64 data!`);
        break;
      }

      try {
        const fileBuffer = Buffer.from(file.data_base64, 'base64');
        log('SLACK', `File decoded: ${fileBuffer.length} bytes from ${file.data_base64.length} base64 chars`);
        log('SLACK', `First 16 bytes hex: ${fileBuffer.slice(0, 16).toString('hex')}`);
        log('SLACK', `Uploading to channel=${thread.channel_id}, thread_ts=${thread.thread_ts}`);

        const uploadResult = await app.client.filesUploadV2({
          channel_id: thread.channel_id,
          thread_ts: thread.thread_ts,
          file: fileBuffer,
          filename: file.name,
          initial_comment: file.caption || undefined,
        });
        log('SLACK', `File uploaded successfully: ${file.name}, result ok=${uploadResult.ok}`);
      } catch (e: any) {
        log('SLACK', `Error uploading file ${file.name}:`, e?.data ?? e?.message ?? e);
        // Fallback: post a message about the file
        try {
          await app.client.chat.postMessage({
            channel: thread.channel_id,
            thread_ts: thread.thread_ts,
            text: `:frame_with_picture: _File: ${file.name}${file.caption ? ' — ' + file.caption : ''}_ (upload failed: ${e?.message ?? 'unknown error'})`,
          });
        } catch {}
      }
      break;
    }
  }
});

async function flushToolEvents(thread: { channel_id: string; thread_ts: string }) {
  if (pendingToolEvents.length === 0) return;
  const events = [...pendingToolEvents];
  pendingToolEvents = [];
  toolEventTimer = null;

  const blocks = formatToolEventBatch(events);

  try {
    if (toolEventMessageTs) {
      await app.client.chat.update({
        channel: thread.channel_id,
        ts: toolEventMessageTs,
        blocks: blocks as any,
        text: `${events.length} tool events`,
      });
    } else {
      const result = await app.client.chat.postMessage({
        channel: thread.channel_id,
        thread_ts: thread.thread_ts,
        blocks: blocks as any,
        text: `${events.length} tool events`,
      });
      toolEventMessageTs = result.ts ?? null;
    }
  } catch (e) {
    log('SLACK', 'Error posting tool events:', e);
    toolEventMessageTs = null;
  }
}

// === Start everything ===
async function main() {
  log('INIT', 'Starting Deckhand...');

  // Connect to channel server
  channel.connect();

  // Start Slack app
  await app.start();
  log('INIT', `Slack connected (channel: ${SLACK_CHANNEL_ID})`);
  log('INIT', `Channel server: ${CHANNEL_SERVER_URL}`);
}

main().catch((err) => {
  log('FATAL', 'Startup failed:', err);
  process.exit(1);
});
