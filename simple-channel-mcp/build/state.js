import { EventEmitter } from 'node:events';
class State extends EventEmitter {
    messages = [];
    pendingPermissions = new Map();
    connectedSince = Date.now();
    activity = { status: 'idle', timestamp: Date.now() };
    sessionInfo = {};
    backgroundProcesses = new Map();
    toolEvents = [];
    addMessage(msg) {
        this.messages.push(msg);
        this.emit('message', msg);
    }
    addPermissionRequest(req) {
        this.pendingPermissions.set(req.request_id, req);
        this.emit('permission_request', req);
    }
    resolvePermission(request_id) {
        this.pendingPermissions.delete(request_id);
        this.emit('permission_resolved', request_id);
    }
    setActivity(activity) {
        this.activity = activity;
        this.emit('activity', activity);
    }
    setSessionInfo(info) {
        Object.assign(this.sessionInfo, info);
        this.emit('session_info', this.sessionInfo);
    }
    addToolEvent(event) {
        // Update existing event if same id
        const idx = this.toolEvents.findIndex(e => e.id === event.id);
        if (idx >= 0) {
            this.toolEvents[idx] = event;
        }
        else {
            this.toolEvents.push(event);
        }
        this.emit('tool_event', event);
    }
    clearSession() {
        this.messages = [];
        this.pendingPermissions.clear();
        this.toolEvents = [];
        this.backgroundProcesses.clear();
        this.activity = { status: 'idle', timestamp: Date.now() };
        this.sessionInfo = {};
        this.connectedSince = Date.now();
        this.emit('session_cleared');
    }
    shareFile(file) {
        this.emit('file', file);
    }
    upsertBackgroundProcess(proc) {
        this.backgroundProcesses.set(proc.process_id, proc);
        this.emit('background_process', proc);
    }
    getSessionState() {
        return {
            connectedSince: this.connectedSince,
            messageCount: this.messages.length,
            pendingPermissions: Array.from(this.pendingPermissions.values()),
            activity: this.activity,
            sessionInfo: this.sessionInfo,
            backgroundProcesses: Array.from(this.backgroundProcesses.values()),
            toolEvents: this.toolEvents.slice(-50), // last 50 events
        };
    }
}
export const state = new State();
//# sourceMappingURL=state.js.map