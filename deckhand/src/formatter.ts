/** Convert markdown to Slack mrkdwn */
export function mdToSlack(md: string): string {
  return md
    .replace(/^#{1,6}\s+(.+)$/gm, '*$1*')
    .replace(/\*\*(.+?)\*\*/g, '*$1*')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<$2|$1>');
}

// Minimal Block Kit types
interface MrkdwnText { type: 'mrkdwn'; text: string; }
interface PlainText { type: 'plain_text'; text: string; emoji?: boolean; }
interface SectionBlock { type: 'section'; text: MrkdwnText; }
interface ContextBlock { type: 'context'; elements: MrkdwnText[]; }
interface ActionsBlock { type: 'actions'; elements: ButtonElement[]; }
interface ButtonElement {
  type: 'button';
  text: PlainText;
  style?: 'primary' | 'danger';
  action_id: string;
  value: string;
}
export type Block = SectionBlock | ContextBlock | ActionsBlock;

export interface PermissionRequest {
  request_id: string;
  tool_name: string;
  description: string;
  input_preview: string;
  timestamp: number;
}

export interface ToolEvent {
  id: string;
  timestamp: number;
  tool_name: string;
  input_summary: string;
  output_summary?: string;
  status: 'running' | 'completed' | 'error';
}

/** Make MCP tool names human-readable */
function humanizeToolName(name: string): string {
  // mcp__dashboard__report_tool_use → "Report Tool Use (Dashboard)"
  // mcp__dashboard__reply → "Reply (Dashboard)"
  const mcpMatch = name.match(/^mcp__(\w+)__(.+)$/);
  if (mcpMatch) {
    const server = mcpMatch[1];
    const tool = mcpMatch[2]
      .replace(/_/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase());
    return `${tool} (${server})`;
  }
  return name;
}

/** Describe what a tool call does in plain English */
function describeToolCall(toolName: string, inputPreview: string): string {
  const parsed = tryParseJSON(inputPreview);

  // Handle our own MCP dashboard tools
  if (toolName.includes('report_tool_use') && parsed) {
    const innerTool = parsed.tool_name || 'a tool';
    const detail = parsed.input_summary || parsed.detail || '';
    const status = parsed.status || '';
    if (status === 'running') return `Run *${innerTool}*: ${detail}`;
    if (status === 'completed') return `Completed *${innerTool}*: ${detail}`;
    return `*${innerTool}*: ${detail}`;
  }

  if (toolName.includes('update_status') && parsed) {
    const status = parsed.status || '';
    const detail = parsed.detail || parsed.tool_name || '';
    if (status === 'idle') return 'Status: Idle';
    if (status === 'thinking') return 'Status: Thinking...';
    return `Status: ${status}${detail ? ` — ${detail}` : ''}`;
  }

  if (toolName.includes('reply') && parsed) {
    const text = parsed.text || '';
    return `Send reply (${text.length} chars)`;
  }

  if (toolName.includes('update_session_info') && parsed) {
    const parts: string[] = [];
    if (parsed.model) parts.push(`model: ${parsed.model}`);
    if (parsed.cwd) parts.push(`cwd: ${parsed.cwd}`);
    return `Update session info${parts.length ? ': ' + parts.join(', ') : ''}`;
  }

  // Fall through to the structured preview
  return formatInputPreview(toolName, inputPreview);
}

/** Format permission request as Block Kit with Allow/Deny buttons */
export function formatPermissionBlocks(req: PermissionRequest): Block[] {
  const friendlyName = humanizeToolName(req.tool_name);
  const description = describeToolCall(req.tool_name, req.input_preview);

  return [
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `:lock: *Permission Required: ${friendlyName}*` },
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: description.slice(0, 3000) },
    },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Allow', emoji: true },
          style: 'primary',
          action_id: 'permission_allow',
          value: req.request_id,
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Deny', emoji: true },
          style: 'danger',
          action_id: 'permission_deny',
          value: req.request_id,
        },
      ],
    },
  ];
}

/** Format resolved permission (replaces buttons with verdict) */
export function formatPermissionResolved(
  req: PermissionRequest,
  verdict: 'allow' | 'deny',
  userId: string,
): Block[] {
  const emoji = verdict === 'allow' ? ':white_check_mark:' : ':x:';
  const label = verdict === 'allow' ? 'Allowed' : 'Denied';
  const friendlyName = humanizeToolName(req.tool_name);
  const description = describeToolCall(req.tool_name, req.input_preview);

  return [
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `${emoji} *${friendlyName}* — ${label} by <@${userId}>` },
    },
    {
      type: 'context',
      elements: [
        { type: 'mrkdwn', text: description.slice(0, 500) },
      ],
    },
  ];
}

/** Format tool events as a compact batch */
export function formatToolEventBatch(events: ToolEvent[]): Block[] {
  const lines = events.map((evt) => {
    const icon = evt.status === 'completed' ? ':white_check_mark:'
      : evt.status === 'error' ? ':x:' : ':gear:';
    const summary = evt.input_summary.length > 80
      ? evt.input_summary.slice(0, 77) + '...'
      : evt.input_summary;
    return `${icon} *${evt.tool_name}* ${summary}`;
  });
  return [
    { type: 'context', elements: [{ type: 'mrkdwn', text: lines.join('\n').slice(0, 3000) }] },
  ];
}

function formatInputPreview(toolName: string, raw: string): string {
  const parsed = tryParseJSON(raw);
  if (!parsed) return `\`\`\`\n${raw.slice(0, 2900)}\n\`\`\``;

  if (parsed.file_path && (parsed.old_string != null || parsed.new_string != null)) {
    let text = `\`${parsed.file_path}\`\n\`\`\`diff\n`;
    if (parsed.old_string != null) {
      text += String(parsed.old_string).split('\n').map((l: string) => `- ${l}`).join('\n') + '\n';
    }
    if (parsed.new_string != null) {
      text += String(parsed.new_string).split('\n').map((l: string) => `+ ${l}`).join('\n') + '\n';
    }
    text += '```';
    return text;
  }

  if (parsed.file_path && parsed.content != null) {
    const preview = String(parsed.content).split('\n').slice(0, 20).join('\n');
    return `\`${parsed.file_path}\`\n\`\`\`\n${preview}\n\`\`\``;
  }

  if (parsed.file_path) return `\`${parsed.file_path}\``;

  if (parsed.command != null) return `\`\`\`\n$ ${parsed.command}\n\`\`\``;

  if (parsed.pattern != null) {
    const path = parsed.path ? `in \`${parsed.path}\` ` : '';
    return `Search ${path}for \`${parsed.pattern}\``;
  }

  return `\`\`\`\n${JSON.stringify(parsed, null, 2).slice(0, 2900)}\n\`\`\``;
}

function tryParseJSON(s: string): Record<string, any> | null {
  if (!s) return null;
  try { return JSON.parse(s); } catch {}
  const result: Record<string, any> = {};
  const strPattern = /"(\w+)"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
  const numPattern = /"(\w+)"\s*:\s*(-?\d+\.?\d*)/g;
  let m;
  while ((m = strPattern.exec(s)) !== null) {
    result[m[1]] = m[2].replace(/\\"/g, '"').replace(/\\n/g, '\n').replace(/\\\\/g, '\\');
  }
  while ((m = numPattern.exec(s)) !== null) {
    result[m[1]] = parseFloat(m[2]);
  }
  return Object.keys(result).length > 0 ? result : null;
}

export function splitText(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxLen) { chunks.push(remaining); break; }
    let splitAt = remaining.lastIndexOf('\n', maxLen);
    if (splitAt < maxLen * 0.5) splitAt = maxLen;
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt);
  }
  return chunks;
}
