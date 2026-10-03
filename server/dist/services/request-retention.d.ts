import { getDb } from '../db/index.js';
type RetentionDb = ReturnType<typeof getDb>;
export interface RequestAnalyticsRetentionConfig {
    retentionDays: number;
    maxRows: number;
}
export declare function getRequestAnalyticsRetentionConfig(): RequestAnalyticsRetentionConfig;
export interface ServerLogRetentionConfig {
    retentionDays: number;
    maxRows: number;
}
/** Both knobs env-tunable, 0 on either disables that half. Same convention and
 *  same parser as the analytics pair above. */
export declare function getServerLogRetentionConfig(): ServerLogRetentionConfig;
/**
 * Age- and count-bound the persisted warn/error log rows.
 *
 * Folded into the existing prune pass rather than given a timer of its own: a
 * second interval would be a second thing to start, stop, test and leak in
 * embedders, for a table that grows far slower than `requests` does.
 *
 * Guarded against the table being absent, exactly like the hourly aggregate
 * below — tests that open a DB before migrations run must not crash the prune
 * loop. Rows are deleted by created_at_ms, never by id: the id space is shared
 * with the in-memory ring and is not a timestamp.
 */
export declare function pruneServerLogs(db: RetentionDb, nowMs: number): number;
export declare function pruneRequestAnalytics(options?: {
    db?: RetentionDb;
    force?: boolean;
    now?: Date;
}): {
    deleted: number;
    skipped: boolean;
};
export {};
//# sourceMappingURL=request-retention.d.ts.map