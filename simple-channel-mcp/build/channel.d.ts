import { Server } from '@modelcontextprotocol/sdk/server/index.js';
export declare function createChannelServer(): Server<{
    method: string;
    params?: {
        [x: string]: unknown;
        _meta?: {
            [x: string]: unknown;
            progressToken?: string | number | undefined;
            "io.modelcontextprotocol/related-task"?: {
                taskId: string;
            } | undefined;
        } | undefined;
    } | undefined;
}, {
    method: string;
    params?: {
        [x: string]: unknown;
        _meta?: {
            [x: string]: unknown;
            progressToken?: string | number | undefined;
            "io.modelcontextprotocol/related-task"?: {
                taskId: string;
            } | undefined;
        } | undefined;
    } | undefined;
}, {
    [x: string]: unknown;
    _meta?: {
        [x: string]: unknown;
        progressToken?: string | number | undefined;
        "io.modelcontextprotocol/related-task"?: {
            taskId: string;
        } | undefined;
    } | undefined;
}>;
/** Push a message from the channel into Claude's session */
export declare function sendToChannel(content: string, meta?: Record<string, string>): Promise<void>;
/** Send a permission verdict back to Claude Code */
export declare function sendPermissionVerdict(request_id: string, behavior: 'allow' | 'deny'): Promise<void>;
export declare function connectStdio(): Promise<void>;
