import { type IncomingMessage, type ServerResponse } from 'node:http';
export declare function startHttpServer(port: number): import("node:http").Server<typeof IncomingMessage, typeof ServerResponse>;
