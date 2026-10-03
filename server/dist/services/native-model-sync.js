import { decrypt } from '../lib/crypto.js';
import { getAllProviders } from '../providers/index.js';
import { hasModelList, parseModelCatalog, readCappedBody, ModelDiscoveryError, } from './model-discovery.js';
import { isCatalogModelTombstoned } from './model-state.js';
import { customModelSeed } from './custom-model-seed.js';
import { ensureModelInProfiles } from './profile-models.js';
import { isAbortLikeError } from '../lib/error-classify.js';
// ── Native provider model sync (independent of llmgateway.co) ───────────────
//
// catalog-sync.ts keeps the local catalog aligned with the SIGNED feed published
// at llmgateway.co — that requires no per-provider work from the operator, but
// it is a hosted, paid-tier-gated service the operator does not control.
//
// This module is a completely separate path to the same goal (a fresh model
// list) that never talks to llmgateway.co at all: once a day it asks each
// REGISTERED provider's own API, with the operator's OWN stored key, what
// models it currently serves — the same `/models` endpoint any OpenAI SDK
// would call — and adds anything new straight into the local `models` table.
//
// Deliberate bounds, mirrored from custom-model-sync.ts (#674) so the two
// scheduled passes behave identically from an operator's point of view:
//  - ADD ONLY. A model that stops appearing upstream is left alone — a
//    background pass must never delete a row the operator (or catalog-sync)
//    has since tuned, and a provider dropping a model from /models for one
//    call is far too weak a signal to act on automatically.
//  - Rows this pass creates are written with source='user' (the same
//    provenance dashboard/custom-endpoint writes use), so catalog-sync's own
//    prune guard can never delete them — the two passes cannot fight.
//  - One provider failing (bad key, timeout, non-JSON body, no /models
//    support) is logged and skipped; the rest still sync.
//  - Only providers that actually expose a generic `/models` discovery call
//    are covered (everything built on OpenAICompatProvider: Groq, Cerebras,
//    Mistral, OpenRouter, GitHub Models, NVIDIA NIM, Zhipu, ModelScope,
//    Pollinations, and friends). Providers with a bespoke, non-OpenAI wire
//    format (Google Gemini, Cohere's native endpoint, Cloudflare Workers AI,
//    AI Horde) are skipped here rather than guessed at — add a
//    `fetchModelCatalog` method to that provider adapter (see
//    OpenAICompatProvider.fetchModelCatalog) to bring it into this pass.
//  - Needs an enabled, non-failing key on file for the platform. A platform
//    with no key yet has nothing to ask.
//  - FREE-ONLY BY DEFAULT (#matches the project's whole premise). A model is
//    kept unless the provider's own /models response explicitly prices it
//    (model-discovery.ts's `isFree` verdict, from an OpenRouter-style
//    `pricing: {prompt, completion}` object or a plain `"price"` string) and
//    that price is nonzero. Most registered providers here (Groq, Cerebras,
//    Mistral, NVIDIA NIM, ...) don't report pricing in /models at all because
//    the whole platform is free-tier — those models pass straight through.
//    Marketplaces that host a genuine free/paid mix and DO report pricing per
//    model (OpenRouter and similar routers) get filtered down to their
//    zero-cost slugs only. Set NATIVE_MODEL_SYNC_FREE_ONLY=false to disable
//    this filter and pull every model a provider lists, paid included.
/** Once a day by default; 0 disables the pass. Separate from
 *  CUSTOM_MODEL_SYNC_INTERVAL_MS and CATALOG_SYNC (llmgateway.co) on purpose —
 *  each of the three passes has its own cadence knob. */
const DEFAULT_SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000;
const BOOT_DELAY_MS = 30 * 1000; // after catalog-sync's own boot delay, so the two don't race
const FETCH_TIMEOUT_MS = 20 * 1000;
export function nativeModelSyncIntervalMs() {
    const raw = process.env.NATIVE_MODEL_SYNC_INTERVAL_MS;
    if (raw === undefined || raw.trim() === '')
        return DEFAULT_SYNC_INTERVAL_MS;
    const ms = Number(raw);
    return Number.isFinite(ms) && ms >= 0 ? ms : DEFAULT_SYNC_INTERVAL_MS;
}
/** Default true: only models that aren't explicitly priced above zero are
 *  added. A model with no pricing info at all (the common case for a
 *  dedicated free-tier provider) is treated as free, not excluded — an
 *  absent price is not the same claim as a $0 price, but for this project's
 *  purpose (only registering providers known to offer a free tier) treating
 *  "provider didn't say" as "assume free" is the useful default. Explicitly
 *  paid models (isFree === false) are always excluded when this is on. */
export function nativeModelSyncFreeOnly() {
    const raw = process.env.NATIVE_MODEL_SYNC_FREE_ONLY;
    if (raw === undefined || raw.trim() === '')
        return true;
    return raw.trim().toLowerCase() !== 'false' && raw.trim() !== '0';
}
function supportsModelCatalog(provider) {
    return typeof provider?.fetchModelCatalog === 'function';
}
/** One usable key per platform is enough — the model list is provider-wide,
 *  not per-key. Prefers a healthy key, falls back to 'unknown' (never probed
 *  yet) the same way the router's own key selection does; a key already
 *  marked failing is skipped so a dead credential can't spuriously report
 *  "provider has zero models". */
function pickKeyForPlatform(db, platform) {
    return db.prepare(`
    SELECT id, encrypted_key, iv, auth_tag FROM api_keys
     WHERE platform = ? AND enabled = 1 AND status IN ('healthy', 'unknown')
     ORDER BY (status = 'healthy') DESC, last_checked_at DESC
     LIMIT 1
  `).get(platform);
}
async function withTimeout(promise, ms) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    try {
        return await promise;
    }
    finally {
        clearTimeout(timer);
    }
}
/** Ask one provider what it currently serves, using the operator's own stored
 *  key. Throws on any failure — the caller records it against that platform
 *  and moves on to the next one. */
async function discoverProviderModels(provider, apiKey) {
    let res;
    try {
        res = await withTimeout(provider.fetchModelCatalog(apiKey), FETCH_TIMEOUT_MS);
    }
    catch (err) {
        const reason = isAbortLikeError(err) ? 'timed out' : (err?.message ?? 'unknown error');
        throw new ModelDiscoveryError(502, `${provider.name}: could not reach /models: ${reason}`);
    }
    const bodyText = await readCappedBody(res);
    if (!res.ok) {
        throw new ModelDiscoveryError(res.status, `${provider.name}: /models returned HTTP ${res.status}`);
    }
    let payload;
    try {
        payload = JSON.parse(bodyText);
    }
    catch {
        throw new ModelDiscoveryError(502, `${provider.name}: /models did not return JSON`);
    }
    if (!hasModelList(payload)) {
        throw new ModelDiscoveryError(502, `${provider.name}: /models response had no recognizable model list`);
    }
    return parseModelCatalog(payload);
}
/**
 * Run the native discovery pass once, across every registered provider that
 * both (a) exposes a `/models`-style discovery call and (b) has a usable key
 * on file. Exported so an admin route or a test can trigger it on demand
 * without waiting for the daily timer.
 */
export async function runNativeModelSync(db) {
    const result = {
        platformsChecked: 0, added: 0, skipped: 0, tombstoned: 0, paidExcluded: 0, failures: [],
    };
    const seed = customModelSeed(db);
    const freeOnly = nativeModelSyncFreeOnly();
    for (const provider of getAllProviders()) {
        if (!supportsModelCatalog(provider))
            continue; // no generic discovery call on this adapter yet
        const key = pickKeyForPlatform(db, provider.platform);
        if (!key)
            continue; // nothing to ask this provider with
        result.platformsChecked += 1;
        let apiKey;
        try {
            apiKey = decrypt(key.encrypted_key, key.iv, key.auth_tag);
        }
        catch (err) {
            result.failures.push({ platform: provider.platform, error: `key decrypt failed: ${err?.message ?? err}` });
            continue;
        }
        let discovered;
        try {
            discovered = await discoverProviderModels(provider, apiKey);
        }
        catch (err) {
            const message = err?.message ?? String(err);
            result.failures.push({ platform: provider.platform, error: message });
            console.error(`[native-model-sync] ${provider.platform}: ${message}`);
            continue;
        }
        const onFile = new Set(db.prepare('SELECT model_id FROM models WHERE platform = ?').all(provider.platform)
            .map(row => row.model_id));
        const insertModel = db.prepare(`
      INSERT INTO models
        (platform, model_id, display_name, intelligence_rank, speed_rank, size_label,
         rpm_limit, rpd_limit, tpm_limit, tpd_limit, monthly_token_budget, context_window,
         enabled, supports_vision, source, billing_uncertain)
      VALUES (@platform, @modelId, @displayName, @intelligenceRank, @speedRank, @sizeLabel,
              NULL, NULL, NULL, NULL, '', @contextWindow,
              1, @supportsVision, 'user', @billingUncertain)
    `);
        const insert = db.transaction((models) => {
            for (const model of models) {
                if (onFile.has(model.id)) {
                    result.skipped += 1;
                    continue;
                }
                // Only exclude models the provider EXPLICITLY priced above zero.
                // isFree === undefined (provider didn't report pricing at all, the
                // common case for a dedicated free-tier provider) is treated as
                // free, not excluded.
                if (freeOnly && model.isFree === false) {
                    result.paidExcluded += 1;
                    continue;
                }
                // #926 contract: a model the operator explicitly removed stays
                // removed — a provider that still lists it on /models is not consent
                // to re-add it. (Upstream-retirement tombstones aren't 'user'
                // sourced, so a genuinely reinstated model still gets added.)
                if (isCatalogModelTombstoned(db, 'chat', provider.platform, model.id)) {
                    result.tombstoned += 1;
                    continue;
                }
                // billing_uncertain = 1 when the provider didn't report pricing at all (isFree === undefined).
                // This means we're not sure if the model is actually free or if it might incur charges.
                // When isFree === true, the provider explicitly said "free" (billing_uncertain = 0).
                // When isFree === false, the model is explicitly paid and would be excluded by freeOnly.
                const billingUncertain = model.isFree === undefined ? 1 : 0;
                insertModel.run({
                    platform: provider.platform,
                    modelId: model.id,
                    displayName: model.id,
                    intelligenceRank: seed.intelligenceRank,
                    speedRank: seed.speedRank,
                    sizeLabel: seed.sizeLabel,
                    contextWindow: model.contextWindow ?? null,
                    supportsVision: model.vision ? 1 : 0,
                    billingUncertain,
                });
                const row = db.prepare('SELECT id FROM models WHERE platform = ? AND model_id = ?').get(provider.platform, model.id);
                const inChain = db.prepare('SELECT 1 FROM fallback_config WHERE model_db_id = ?').get(row.id);
                if (!inChain) {
                    const max = db.prepare('SELECT COALESCE(MAX(priority), 0) AS m FROM fallback_config').get();
                    db.prepare('INSERT INTO fallback_config (model_db_id, priority, enabled) VALUES (?, ?, 1)').run(row.id, max.m + 1);
                }
                ensureModelInProfiles(db, row.id);
                onFile.add(model.id);
                result.added += 1;
            }
        });
        insert(discovered);
    }
    return result;
}
let cancelBootTimer = null;
let cancelInterval = null;
/** Register the daily native-discovery pass on the server's scheduler.
 *  Independent of startCatalogSync — safe to run with it enabled, disabled,
 *  or (Premium) replaced entirely, since this pass never reads or writes
 *  anything catalog-sync owns. Returns a stop function, or null when disabled
 *  via NATIVE_MODEL_SYNC_INTERVAL_MS=0. */
export function startNativeModelSync(db, scheduler) {
    if (cancelInterval)
        return cancelInterval;
    const intervalMs = nativeModelSyncIntervalMs();
    if (intervalMs <= 0) {
        console.log('[native-model-sync] disabled via NATIVE_MODEL_SYNC_INTERVAL_MS=0');
        return null;
    }
    const run = () => {
        void runNativeModelSync(db).then((result) => {
            console.log(`[native-model-sync] checked ${result.platformsChecked} provider(s): `
                + `+${result.added} added, ${result.skipped} already on file, `
                + `${result.paidExcluded} paid (excluded), `
                + `${result.tombstoned} tombstoned, ${result.failures.length} failed`);
        }).catch((err) => {
            console.error(`[native-model-sync] pass failed: ${err instanceof Error ? err.message : err}`);
        });
    };
    cancelBootTimer = scheduler.after(BOOT_DELAY_MS, run);
    cancelInterval = scheduler.every(intervalMs, run, { name: 'native-model-sync' });
    console.log(`[native-model-sync] polling registered providers directly every ${intervalMs / 3600000}h (no llmgateway.co dependency)`);
    return stopNativeModelSync;
}
export function stopNativeModelSync() {
    if (cancelBootTimer) {
        cancelBootTimer();
        cancelBootTimer = null;
    }
    if (cancelInterval) {
        cancelInterval();
        cancelInterval = null;
    }
}
//# sourceMappingURL=native-model-sync.js.map