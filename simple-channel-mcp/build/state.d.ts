import { EventEmitter } from 'node:events';
import type { ActivityStatus, BackgroundProcess, ChannelMessage, PermissionRequest, SessionInfo, SessionState, SharedFile, ToolEvent } from './types.js';
declare class State extends EventEmitter {
    messages: ChannelMessage[];
    pendingPermissions: Map<string, PermissionRequest>;
    connectedSince: number;
    activity: ActivityStatus;
    sessionInfo: SessionInfo;
    backgroundProcesses: Map<string, BackgroundProcess>;
    toolEvents: ToolEvent[];
    addMessage(msg: ChannelMessage): void;
    addPermissionRequest(req: PermissionRequest): void;
    resolvePermission(request_id: string): void;
    setActivity(activity: ActivityStatus): void;
    setSessionInfo(info: Partial<SessionInfo>): void;
    addToolEvent(event: ToolEvent): void;
    clearSession(): void;
    shareFile(file: SharedFile): void;
    upsertBackgroundProcess(proc: BackgroundProcess): void;
    getSessionState(): SessionState;
}
export declare const state: State;
export {};
