import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getDb, initDb } from '../../db/index.js';
import {
  runNativeModelSync,
  nativeModelSyncIntervalMs,
  nativeModelSyncFreeOnly,
  startNativeModelSync,
  stopNativeModelSync,
} from '../../services/native-model-sync.js';
import { recordCatalogModelTombstone } from '../../services/model-state.js';

// The sync pass talks to the outside world ONLY through each provider's
// fetchModelCatalog — stub the registry so no test ever makes a real HTTP call.
vi.mock('../../providers/index.js', () => ({ getAllProviders: vi.fn() }));

vi.mock('../../lib/crypto.js', async () => {
  const actual = await vi.importActual('../../lib/crypto.js');
  return { ...actual, decrypt: vi.fn(() => 'mocked-api-key') };
});

import { getAllProviders } from '../../providers/index.js';

const ORIGINAL_INTERVAL = process.env.NATIVE_MODEL_SYNC_INTERVAL_MS;
const ORIGINAL_FREE_ONLY = process.env.NATIVE_MODEL_SYNC_FREE_ONLY;

function fakeProvider(platform: string, name: string, fetchModelCatalog: ReturnType<typeof vi.fn>) {
  return { platform, name, fetchModelCatalog };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function addKey(platform: string, status = 'healthy', enabled = 1): void {
  getDb().prepare(`
    INSERT INTO api_keys (platform, label, encrypted_key, iv, auth_tag, status, enabled)
    VALUES (?, 'key', 'enc', 'iv', 'tag', ?, ?)
  `).run(platform, status, enabled);
}

function modelIds(platform: string): string[] {
  const rows = getDb().prepare('SELECT model_id FROM models WHERE platform = ?').all(platform) as { model_id: string }[];
  return rows.map(r => r.model_id).sort();
}

describe('native model sync (independent of llmgateway.co)', () => {
  beforeEach(() => {
    process.env.DEV_MODE = 'true';
    process.env.NODE_ENV = 'test';
    initDb(':memory:');
    getDb().exec('DELETE FROM fallback_config; DELETE FROM api_keys; DELETE FROM models; DELETE FROM requests;');
    vi.clearAllMocks();
    stopNativeModelSync();
  });

  afterEach(() => {
    if (ORIGINAL_INTERVAL === undefined) delete process.env.NATIVE_MODEL_SYNC_INTERVAL_MS;
    else process.env.NATIVE_MODEL_SYNC_INTERVAL_MS = ORIGINAL_INTERVAL;
    if (ORIGINAL_FREE_ONLY === undefined) delete process.env.NATIVE_MODEL_SYNC_FREE_ONLY;
    else process.env.NATIVE_MODEL_SYNC_FREE_ONLY = ORIGINAL_FREE_ONLY;
    stopNativeModelSync();
  });

  it('checks nothing when no providers are registered', async () => {
    (getAllProviders as unknown as ReturnType<typeof vi.fn>).mockReturnValue([]);
    const result = await runNativeModelSync(getDb());
    expect(result.platformsChecked).toBe(0);
    expect(result.added).toBe(0);
    expect(result.failures).toEqual([]);
  });

  it('skips a provider with no fetchModelCatalog method (no generic discovery support yet)', async () => {
    (getAllProviders as unknown as ReturnType<typeof vi.fn>).mockReturnValue([
      { platform: 'google', name: 'Google' }, // no fetchModelCatalog
    ]);
    addKey('google');
    const result = await runNativeModelSync(getDb());
    expect(result.platformsChecked).toBe(0);
    expect(result.failures).toEqual([]);
  });

  it('skips a provider with no key on file', async () => {
    const fetchModelCatalog = vi.fn();
    (getAllProviders as unknown as ReturnType<typeof vi.fn>).mockReturnValue([
      fakeProvider('groq', 'Groq', fetchModelCatalog),
    ]);
    const result = await runNativeModelSync(getDb());
    expect(fetchModelCatalog).not.toHaveBeenCalled();
    expect(result.platformsChecked).toBe(0);
  });

  it('never asks a disabled key\'s provider', async () => {
    const fetchModelCatalog = vi.fn();
    (getAllProviders as unknown as ReturnType<typeof vi.fn>).mockReturnValue([
      fakeProvider('groq', 'Groq', fetchModelCatalog),
    ]);
    addKey('groq', 'healthy', 0);
    const result = await runNativeModelSync(getDb());
    expect(fetchModelCatalog).not.toHaveBeenCalled();
    expect(result.platformsChecked).toBe(0);
  });

  it('pulls the model list straight from the provider and adds new models with source=user', async () => {
    const fetchModelCatalog = vi.fn().mockResolvedValue(
      jsonResponse({ data: [{ id: 'llama-3.3-70b-versatile' }, { id: 'llama-3.1-8b-instant' }] }),
    );
    (getAllProviders as unknown as ReturnType<typeof vi.fn>).mockReturnValue([
      fakeProvider('groq', 'Groq', fetchModelCatalog),
    ]);
    addKey('groq');

    const result = await runNativeModelSync(getDb());

    expect(result.platformsChecked).toBe(1);
    expect(result.added).toBe(2);
    expect(fetchModelCatalog).toHaveBeenCalledWith('mocked-api-key');
    expect(modelIds('groq')).toEqual(['llama-3.1-8b-instant', 'llama-3.3-70b-versatile']);

    const rows = getDb().prepare("SELECT source, enabled FROM models WHERE platform = 'groq'").all() as
      { source: string; enabled: number }[];
    for (const row of rows) {
      expect(row.source).toBe('user'); // never catalog-owned, so catalog-sync can't prune it
      expect(row.enabled).toBe(1);
    }

    // Routable: every new model lands in the fallback chain.
    const chainCount = getDb().prepare(`
      SELECT COUNT(*) AS c FROM fallback_config fc
      JOIN models m ON m.id = fc.model_db_id
      WHERE m.platform = 'groq'
    `).get() as { c: number };
    expect(chainCount.c).toBe(2);
  });

  it('leaves an already-known model untouched (add-only, never overwrites)', async () => {
    getDb().prepare(`
      INSERT INTO models (platform, model_id, display_name, intelligence_rank, speed_rank, size_label, enabled, source)
      VALUES ('groq', 'llama-3.3-70b-versatile', 'Custom Name', 90, 90, 'Large', 1, 'user')
    `).run();
    const fetchModelCatalog = vi.fn().mockResolvedValue(
      jsonResponse({ data: [{ id: 'llama-3.3-70b-versatile' }, { id: 'new-model' }] }),
    );
    (getAllProviders as unknown as ReturnType<typeof vi.fn>).mockReturnValue([
      fakeProvider('groq', 'Groq', fetchModelCatalog),
    ]);
    addKey('groq');

    const result = await runNativeModelSync(getDb());

    expect(result.added).toBe(1);
    expect(result.skipped).toBe(1);
    const row = getDb().prepare(
      "SELECT display_name, intelligence_rank FROM models WHERE platform = 'groq' AND model_id = 'llama-3.3-70b-versatile'",
    ).get() as { display_name: string; intelligence_rank: number };
    expect(row.display_name).toBe('Custom Name'); // untouched
    expect(row.intelligence_rank).toBe(90); // untouched
  });

  it('free-only (default): keeps zero-priced and unpriced models, excludes explicitly-paid ones', async () => {
    delete process.env.NATIVE_MODEL_SYNC_FREE_ONLY; // default
    const fetchModelCatalog = vi.fn().mockResolvedValue(
      jsonResponse({
        data: [
          { id: 'llama-3.3-70b-versatile:free', pricing: { prompt: '0', completion: '0' } }, // explicitly free
          { id: 'gpt-5-paid', pricing: { prompt: '5', completion: '15' } }, // explicitly paid
          { id: 'no-pricing-reported' }, // provider didn't say — treated as free
        ],
      }),
    );
    (getAllProviders as unknown as ReturnType<typeof vi.fn>).mockReturnValue([
      fakeProvider('openrouter', 'OpenRouter', fetchModelCatalog),
    ]);
    addKey('openrouter');

    const result = await runNativeModelSync(getDb());

    expect(result.added).toBe(2);
    expect(result.paidExcluded).toBe(1);
    expect(modelIds('openrouter')).toEqual(['llama-3.3-70b-versatile:free', 'no-pricing-reported']);
  });

  it('NATIVE_MODEL_SYNC_FREE_ONLY=false pulls paid models too', async () => {
    process.env.NATIVE_MODEL_SYNC_FREE_ONLY = 'false';
    expect(nativeModelSyncFreeOnly()).toBe(false);
    const fetchModelCatalog = vi.fn().mockResolvedValue(
      jsonResponse({ data: [{ id: 'gpt-5-paid', pricing: { prompt: '5', completion: '15' } }] }),
    );
    (getAllProviders as unknown as ReturnType<typeof vi.fn>).mockReturnValue([
      fakeProvider('openrouter', 'OpenRouter', fetchModelCatalog),
    ]);
    addKey('openrouter');

    const result = await runNativeModelSync(getDb());

    expect(result.paidExcluded).toBe(0);
    expect(result.added).toBe(1);
    expect(modelIds('openrouter')).toEqual(['gpt-5-paid']);
  });

  it('does not resurrect a model the operator deleted', async () => {
    recordCatalogModelTombstone(getDb(), 'chat', 'groq', 'retired-model');
    const fetchModelCatalog = vi.fn().mockResolvedValue(
      jsonResponse({ data: [{ id: 'retired-model' }, { id: 'fresh-model' }] }),
    );
    (getAllProviders as unknown as ReturnType<typeof vi.fn>).mockReturnValue([
      fakeProvider('groq', 'Groq', fetchModelCatalog),
    ]);
    addKey('groq');

    const result = await runNativeModelSync(getDb());

    expect(result.tombstoned).toBe(1);
    expect(result.added).toBe(1);
    expect(modelIds('groq')).toEqual(['fresh-model']);
  });

  it('isolates a failing provider and keeps syncing the rest', async () => {
    const failing = vi.fn().mockRejectedValue(new Error('boom'));
    const working = vi.fn().mockResolvedValue(jsonResponse({ data: [{ id: 'ok-model' }] }));
    (getAllProviders as unknown as ReturnType<typeof vi.fn>).mockReturnValue([
      fakeProvider('bai', 'B.AI', failing),
      fakeProvider('mistral', 'Mistral', working),
    ]);
    addKey('bai');
    addKey('mistral');

    const result = await runNativeModelSync(getDb());

    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]!.platform).toBe('bai');
    expect(result.failures[0]!.error).toContain('boom');
    expect(result.added).toBe(1);
    expect(modelIds('mistral')).toEqual(['ok-model']);
  });

  it('treats a non-2xx /models response as a failure, not zero models', async () => {
    const fetchModelCatalog = vi.fn().mockResolvedValue(jsonResponse({ error: 'nope' }, 401));
    (getAllProviders as unknown as ReturnType<typeof vi.fn>).mockReturnValue([
      fakeProvider('groq', 'Groq', fetchModelCatalog),
    ]);
    addKey('groq');

    const result = await runNativeModelSync(getDb());

    expect(result.failures).toHaveLength(1);
    expect(result.added).toBe(0);
  });

  it('parses the interval env: daily default, 0 disables the scheduled pass', () => {
    delete process.env.NATIVE_MODEL_SYNC_INTERVAL_MS;
    expect(nativeModelSyncIntervalMs()).toBe(24 * 60 * 60 * 1000);

    process.env.NATIVE_MODEL_SYNC_INTERVAL_MS = '3600000';
    expect(nativeModelSyncIntervalMs()).toBe(3600000);

    process.env.NATIVE_MODEL_SYNC_INTERVAL_MS = '0';
    expect(nativeModelSyncIntervalMs()).toBe(0);
    expect(startNativeModelSync(getDb(), { every: vi.fn(), after: vi.fn() } as never)).toBeNull();
  });
});
