import { log } from './log.js';

export interface SlackThread {
  thread_ts: string;
  channel_id: string;
  started_at: number;
  started_by: string;
  /** Maps permission request_id → Slack message_ts (for updating buttons after verdict) */
  pendingPermissions: Map<string, string>;
}

class ThreadManager {
  private threads: Map<string, SlackThread> = new Map();
  private activeThreadTs: string | null = null;

  startThread(thread_ts: string, channel_id: string, user_id: string): SlackThread {
    const thread: SlackThread = {
      thread_ts,
      channel_id,
      started_at: Date.now(),
      started_by: user_id,
      pendingPermissions: new Map(),
    };
    this.threads.set(thread_ts, thread);
    const oldTs = this.activeThreadTs;
    this.activeThreadTs = thread_ts;
    log('THREAD', `Active thread: ${thread_ts} (was: ${oldTs ?? 'none'})`);
    return thread;
  }

  getActiveThread(): SlackThread | null {
    if (!this.activeThreadTs) return null;
    return this.threads.get(this.activeThreadTs) ?? null;
  }

  isActiveThread(thread_ts: string): boolean {
    return this.activeThreadTs === thread_ts;
  }

  addPendingPermission(request_id: string, message_ts: string) {
    const thread = this.getActiveThread();
    if (thread) thread.pendingPermissions.set(request_id, message_ts);
  }

  findPermission(request_id: string): { thread: SlackThread; message_ts: string } | null {
    for (const thread of this.threads.values()) {
      const message_ts = thread.pendingPermissions.get(request_id);
      if (message_ts) return { thread, message_ts };
    }
    return null;
  }

  resolvePermission(request_id: string) {
    for (const thread of this.threads.values()) {
      thread.pendingPermissions.delete(request_id);
    }
  }
}

export const threadManager = new ThreadManager();
