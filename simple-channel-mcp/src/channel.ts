import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { state } from './state.js';
import { log } from './log.js';
import { readFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import type { ActivityStatus, ChannelMessage } from './types.js';

const MIME_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.txt': 'text/plain',
  '.json': 'application/json',
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.ts': 'text/typescript',
};

let server: Server;
let transportConnected = false;

const TOOLS = [
  {
    name: 'reply',
    description: 'Send a reply message back to the user. Supports markdown formatting.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        text: { type: 'string', description: 'The message text to send (markdown supported)' },
        format: { type: 'string', enum: ['plain', 'markdown'], description: 'Content format (default: markdown)' },
      },
      required: ['text'],
    },
  },
  {
    name: 'update_status',
    description: 'Update the channel with your current activity status. Call this when you start/finish tool calls so the channel shows what you are doing.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        status: { type: 'string', enum: ['idle', 'thinking', 'tool_running', 'waiting_permission'] },
        tool_name: { type: 'string', description: 'Name of tool currently executing (e.g., Bash, Read, Edit)' },
        detail: { type: 'string', description: 'Brief description of current activity' },
      },
      required: ['status'],
    },
  },
  {
    name: 'update_session_info',
    description: 'Push session metadata to the channel. Call at session start and after significant changes.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        model: { type: 'string' },
        session_id: { type: 'string' },
        cwd: { type: 'string' },
        tokens_used: { type: 'number' },
        tokens_limit: { type: 'number' },
        cost_usd: { type: 'number' },
      },
    },
  },
  {
    name: 'report_tool_use',
    description: 'Report a tool call to the channel so the user can see what you are doing. Call this EVERY TIME you use a tool (Read, Edit, Write, Bash, Grep, Glob, Agent, etc.) — report it with status "running" before and "completed" or "error" after. This is critical for channel visibility.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        tool_event_id: { type: 'string', description: 'Unique ID for this tool call (reuse same ID for running→completed updates)' },
        tool_name: { type: 'string', description: 'Name of the tool (e.g., Edit, Bash, Read, Grep)' },
        input_summary: { type: 'string', description: 'Brief summary of the input, e.g. file path, command, or search pattern. For Edit, include old_string and new_string.' },
        output_summary: { type: 'string', description: 'Brief summary of the result (on completion)' },
        status: { type: 'string', enum: ['running', 'completed', 'error'] },
      },
      required: ['tool_event_id', 'tool_name', 'input_summary', 'status'],
    },
  },
  {
    name: 'update_background_process',
    description: 'Report on a background process (e.g., a background Bash command). Call when a background process starts, produces output, or completes.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        process_id: { type: 'string', description: 'Unique ID for this process' },
        command: { type: 'string', description: 'The command that was run' },
        status: { type: 'string', enum: ['running', 'completed', 'failed'] },
        output: { type: 'string', description: 'Latest output from the process' },
        exit_code: { type: 'number', description: 'Exit code if completed/failed' },
      },
      required: ['process_id', 'command', 'status'],
    },
  },
  {
    name: 'share_file',
    description: [
      'Share a file from disk with connected clients (Slack, web dashboard, etc.).',
      'ALWAYS call this after creating visual content so remote users can see it.',
      '',
      'IMPORTANT: Do NOT use computer(action: "screenshot"). It wastes tokens and does not produce a file.',
      'ALWAYS use gif_creator to capture what is on screen. gif_creator only records frames from interactive actions (hover, click, scroll).',
      'Do NOT try to pass base64 image data as a tool argument — it will be truncated.',
      '',
      'SCREENSHOT (static image of current page):',
      '1. gif_creator(action: "start_recording", tabId)',
      '2. computer(action: "hover", coordinate: [1, 1], tabId) — creates exactly one frame',
      '3. gif_creator(action: "stop_recording", tabId)',
      '4. gif_creator(action: "export", tabId, download: true, filename: "<name>.gif", options: { showClickIndicators: false, showDragPaths: false, showActionLabels: false, showProgressBar: false, showWatermark: false, quality: 1 })',
      '5. share_file(file_path: "~/Downloads/<name>.gif", caption: "...")',
      '',
      'SCREENCAST (animated GIF of a multi-step interaction):',
      '1. gif_creator(action: "start_recording", tabId)',
      '2. Perform browser actions (click, type, navigate, scroll, hover, etc.) — each creates a frame',
      '3. gif_creator(action: "stop_recording", tabId)',
      '4. gif_creator(action: "export", tabId, download: true, filename: "<name>.gif")',
      '5. share_file(file_path: "~/Downloads/<name>.gif", caption: "...")',
    ].join('\n'),
    inputSchema: {
      type: 'object' as const,
      properties: {
        file_path: { type: 'string', description: 'Absolute path to the file. For Chrome exports: ~/Downloads/<filename>.gif' },
        caption: { type: 'string', description: 'Caption or description for the file' },
      },
      required: ['file_path'],
    },
  },
];

function ok(text: string) {
  return { content: [{ type: 'text' as const, text }] };
}

function err(text: string) {
  return { content: [{ type: 'text' as const, text }], isError: true };
}

export function createChannelServer() {
  server = new Server(
    { name: 'simple-channel', version: '0.1.0' },
    {
      capabilities: {
        experimental: {
          'claude/channel': {},
          'claude/channel/permission': {},
        },
        tools: {},
      },
      instructions: [
        'Messages from a remote channel client.',
        'Use the reply tool to send responses back to the user (supports markdown).',
        'IMPORTANT: Use report_tool_use EVERY TIME you call a tool (Edit, Bash, Read, Write, Grep, Glob, Agent, etc).',
        'For Edit calls, include the file path and the old/new strings in input_summary so the channel can show a diff.',
        'Report with status "completed" after the tool finishes (include output_summary with the result).',
        'Use update_status for high-level activity changes (thinking/idle).',
        'Use update_session_info at session start.',
        'Use update_background_process to report on background commands.',
      ].join(' '),
    },
  );

  server.onerror = (err) => {
    log('MCP', 'Server error:', err);
  };

  server.oninitialized = () => {
    log('MCP', 'Client initialized (handshake complete)');
    transportConnected = true;
  };

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    log('MCP', 'tools/list requested');
    return { tools: TOOLS };
  });

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: rawArgs } = req.params;
    const args = (rawArgs ?? {}) as Record<string, unknown>;
    log('MCP', `tools/call: ${name}`, JSON.stringify(args));

    switch (name) {
      case 'reply': {
        const text = args.text as string;
        if (!text) return err('text is required');
        const format = (args.format as string) || 'markdown';
        const msg: ChannelMessage = {
          id: crypto.randomUUID(),
          timestamp: Date.now(),
          direction: 'outbound',
          content: text,
          format: format as 'plain' | 'markdown',
        };
        state.addMessage(msg);
        log('MCP', 'Reply sent to channel:', text.slice(0, 100));
        return ok('Message sent to channel');
      }

      case 'update_status': {
        const status = args.status as ActivityStatus['status'];
        if (!status) return err('status is required');
        state.setActivity({
          status,
          tool_name: args.tool_name as string | undefined,
          detail: args.detail as string | undefined,
          timestamp: Date.now(),
        });
        log('MCP', `Status → ${status} ${args.tool_name ?? ''} ${args.detail ?? ''}`);
        return ok('Status updated');
      }

      case 'update_session_info': {
        state.setSessionInfo({
          model: args.model as string | undefined,
          session_id: args.session_id as string | undefined,
          cwd: args.cwd as string | undefined,
          tokens_used: args.tokens_used as number | undefined,
          tokens_limit: args.tokens_limit as number | undefined,
          cost_usd: args.cost_usd as number | undefined,
        });
        log('MCP', 'Session info updated');
        return ok('Session info updated');
      }

      case 'report_tool_use': {
        const tool_event_id = args.tool_event_id as string;
        const tool_name = args.tool_name as string;
        const input_summary = args.input_summary as string;
        const status = args.status as 'running' | 'completed' | 'error';
        if (!tool_event_id || !tool_name || !input_summary || !status) {
          return err('tool_event_id, tool_name, input_summary, and status are required');
        }
        state.addToolEvent({
          id: tool_event_id,
          timestamp: Date.now(),
          tool_name,
          input_summary,
          output_summary: args.output_summary as string | undefined,
          status,
        });
        log('MCP', `Tool event ${tool_event_id}: ${tool_name} → ${status}`);
        return ok('Tool event recorded');
      }

      case 'update_background_process': {
        const process_id = args.process_id as string;
        const command = args.command as string;
        const procStatus = args.status as 'running' | 'completed' | 'failed';
        if (!process_id || !command || !procStatus) {
          return err('process_id, command, and status are required');
        }
        const existing = state.backgroundProcesses.get(process_id);
        state.upsertBackgroundProcess({
          process_id,
          command,
          status: procStatus,
          output: args.output as string | undefined,
          exit_code: args.exit_code as number | undefined,
          started_at: existing?.started_at ?? Date.now(),
          updated_at: Date.now(),
        });
        log('MCP', `Background process ${process_id}: ${procStatus}`);
        return ok('Background process updated');
      }

      case 'share_file': {
        let file_path = args.file_path as string;
        if (!file_path) return err('file_path is required');

        log('MCP', `share_file called with path: "${file_path}", caption: "${args.caption ?? '(none)'}"`);

        // Expand ~ to home directory
        if (file_path.startsWith('~/')) {
          file_path = file_path.replace('~', process.env.HOME ?? '');
        }

        log('MCP', `Resolved file path: "${file_path}"`);

        try {
          // Check if file exists and get stats
          const { stat } = await import('node:fs/promises');
          try {
            const stats = await stat(file_path);
            log('MCP', `File stats: size=${stats.size} bytes, modified=${stats.mtime.toISOString()}`);
            if (stats.size === 0) {
              log('MCP', `WARNING: File is empty (0 bytes): ${file_path}`);
              return err(`File is empty (0 bytes): ${file_path}`);
            }
          } catch (statErr: any) {
            log('MCP', `File does not exist or is inaccessible: ${file_path} — ${statErr.message}`);
            return err(`File not found: ${file_path}`);
          }

          const data = await readFile(file_path);
          const ext = extname(file_path).toLowerCase();
          const mime_type = MIME_TYPES[ext] || 'application/octet-stream';
          const name = basename(file_path);
          const base64Data = data.toString('base64');

          log('MCP', `File read OK: ${name}, ext=${ext}, mime=${mime_type}, raw=${data.length} bytes, base64=${base64Data.length} chars`);

          // Validate the data looks like what we expect
          if (ext === '.gif' && data[0] !== 0x47) { // GIF magic: "GIF"
            log('MCP', `WARNING: File has .gif extension but does not start with GIF magic bytes (first bytes: ${data.slice(0, 8).toString('hex')})`);
          }
          if (ext === '.png' && data[0] !== 0x89) { // PNG magic
            log('MCP', `WARNING: File has .png extension but does not start with PNG magic bytes (first bytes: ${data.slice(0, 8).toString('hex')})`);
          }

          const fileId = crypto.randomUUID();
          log('MCP', `Emitting file event with id=${fileId}`);

          state.shareFile({
            id: fileId,
            timestamp: Date.now(),
            name,
            mime_type,
            data_base64: base64Data,
            caption: args.caption as string | undefined,
          });

          log('MCP', `File shared successfully: ${name} (${mime_type}, ${data.length} bytes, base64: ${base64Data.length} chars)`);
          return ok(`File shared: ${name}`);
        } catch (e: any) {
          log('MCP', `Error reading file ${file_path}:`, e.message, e.stack);
          return err(`Failed to read file: ${e.message}`);
        }
      }

      default:
        return err(`Unknown tool: ${name}`);
    }
  });

  // Listen for permission request notifications from Claude Code
  server.fallbackNotificationHandler = async (notification: any) => {
    log('MCP', 'Fallback notification:', notification.method);
    if (notification.method === 'notifications/claude/channel/permission_request') {
      const params = notification.params as {
        request_id: string;
        tool_name: string;
        description: string;
        input_preview: string;
      };
      state.addPermissionRequest({ ...params, timestamp: Date.now() });
      log('MCP', `Permission request: ${params.tool_name} (${params.request_id})`);
    }
  };

  return server;
}

/** Push a message from the channel into Claude's session */
export async function sendToChannel(
  content: string,
  meta?: Record<string, string>,
) {
  const msg: ChannelMessage = {
    id: crypto.randomUUID(),
    timestamp: Date.now(),
    direction: 'inbound',
    content,
    format: 'plain',
    meta,
  };
  state.addMessage(msg);
  log('CHANNEL', `Inbound message queued: "${content.slice(0, 100)}"`);

  if (!transportConnected) {
    log('CHANNEL', 'WARNING: Transport not connected yet, skipping notification');
    return;
  }

  try {
    log('CHANNEL', 'Sending notifications/claude/channel...');
    await server.notification({
      method: 'notifications/claude/channel',
      params: { content, meta: meta ?? {} },
    } as any);
    log('CHANNEL', 'Notification sent successfully');
  } catch (e) {
    log('CHANNEL', 'ERROR sending notification:', e);
  }
}

/** Send a permission verdict back to Claude Code */
export async function sendPermissionVerdict(
  request_id: string,
  behavior: 'allow' | 'deny',
) {
  state.resolvePermission(request_id);
  log('CHANNEL', `Permission verdict: ${request_id} → ${behavior}`);

  if (!transportConnected) {
    log('CHANNEL', 'WARNING: Transport not connected, skipping permission notification');
    return;
  }

  try {
    await server.notification({
      method: 'notifications/claude/channel/permission',
      params: { request_id, behavior },
    } as any);
    log('CHANNEL', 'Permission notification sent');
  } catch (e) {
    log('CHANNEL', 'ERROR sending permission notification:', e);
  }
}

export async function connectStdio() {
  const transport = new StdioServerTransport();

  transport.onerror = (e) => {
    log('STDIO', 'Transport error:', e);
  };

  transport.onclose = () => {
    log('STDIO', 'Transport closed');
    transportConnected = false;
  };

  log('STDIO', 'Connecting transport...');
  await server.connect(transport);
  log('STDIO', 'Transport connected (awaiting client init)');
}
