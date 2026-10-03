import type { Db } from '../db/types.js';
import type { Platform } from '@llmgateway/shared/types.js';
import type { Scheduler } from '../lib/scheduler.js';
export declare function nativeModelSyncIntervalMs(): number;
/** Default true: only models that aren't explicitly priced above zero are
 *  added. A model with no pricing info at all (the common case for a
 *  dedicated free-tier provider) is treated as free, not excluded — an
 *  absent price is not the same claim as a $0 price, but for this project's
 *  purpose (only registering providers known to offer a free tier) treating
 *  "provider didn't say" as "assume free" is the useful default. Explicitly
 *  paid models (isFree === false) are always excluded when this is on. */
export declare function nativeModelSyncFreeOnly(): boolean;
export interface NativeModelSyncResult {
    platformsChecked: number;
    /** Models inserted for the first time. */
    added: number;
    /** Models already on file for that platform — left untouched. */
    skipped: number;
    /** Models the operator deliberately deleted, so this pass declined to
     *  resurrect them (same #926 contract custom-model-sync follows). */
    tombstoned: number;
    /** Models a provider explicitly priced above zero, excluded by the
     *  free-only filter (see nativeModelSyncFreeOnly). Always 0 when that
     *  filter is disabled. */
    paidExcluded: number;
    failures: Array<{
        platform: Platform;
        error: string;
    }>;
}
/**
 * Run the native discovery pass once, across every registered provider that
 * both (a) exposes a `/models`-style discovery call and (b) has a usable key
 * on file. Exported so an admin route or a test can trigger it on demand
 * without waiting for the daily timer.
 */
export declare function runNativeModelSync(db: Db): Promise<NativeModelSyncResult>;
/** Register the daily native-discovery pass on the server's scheduler.
 *  Independent of startCatalogSync — safe to run with it enabled, disabled,
 *  or (Premium) replaced entirely, since this pass never reads or writes
 *  anything catalog-sync owns. Returns a stop function, or null when disabled
 *  via NATIVE_MODEL_SYNC_INTERVAL_MS=0. */
export declare function startNativeModelSync(db: Db, scheduler: Scheduler): (() => void) | null;
export declare function stopNativeModelSync(): void;
//# sourceMappingURL=native-model-sync.d.ts.map