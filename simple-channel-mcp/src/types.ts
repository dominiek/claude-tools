export interface ChannelMessage {
  id: string;
  timestamp: number;
  direction: 'inbound' | 'outbound';
  content: string;
  format?: 'plain' | 'markdown';
  meta?: Record<string, string>;
}

export interface PermissionRequest {
  request_id: string;
  tool_name: string;
  description: string;
  input_preview: string;
  timestamp: number;
}

export interface ActivityStatus {
  status: 'idle' | 'thinking' | 'tool_running' | 'waiting_permission';
  tool_name?: string;
  detail?: string;
  timestamp: number;
}

export interface SessionInfo {
  model?: string;
  session_id?: string;
  cwd?: string;
  tokens_used?: number;
  tokens_limit?: number;
  cost_usd?: number;
}

export interface BackgroundProcess {
  process_id: string;
  command: string;
  status: 'running' | 'completed' | 'failed';
  output?: string;
  exit_code?: number;
  started_at: number;
  updated_at: number;
}

export interface ToolEvent {
  id: string;
  timestamp: number;
  tool_name: string;
  input_summary: string;
  output_summary?: string;
  status: 'running' | 'completed' | 'error';
}

export interface SessionState {
  connectedSince: number;
  messageCount: number;
  pendingPermissions: PermissionRequest[];
  activity: ActivityStatus;
  sessionInfo: SessionInfo;
  backgroundProcesses: BackgroundProcess[];
  toolEvents: ToolEvent[];
}

// WebSocket message types (browser → server)
export type WsClientMessage =
  | { type: 'send'; text: string; meta?: Record<string, string> }
  | { type: 'permission'; request_id: string; behavior: 'allow' | 'deny' }
  | { type: 'command'; command: string };

// WebSocket message types (server → browser)
export type WsServerMessage =
  | { type: 'message'; message: ChannelMessage }
  | { type: 'permission_request'; request: PermissionRequest }
  | { type: 'permission_resolved'; request_id: string }
  | { type: 'status'; state: SessionState }
  | { type: 'activity'; activity: ActivityStatus }
  | { type: 'session_info'; info: SessionInfo }
  | { type: 'background_process'; process: BackgroundProcess }
  | { type: 'tool_event'; event: ToolEvent }
  | { type: 'file'; file: SharedFile };

export interface SharedFile {
  id: string;
  timestamp: number;
  name: string;
  mime_type: string;
  data_base64: string;
  caption?: string;
}
