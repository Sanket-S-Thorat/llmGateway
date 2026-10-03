// Migration: models.billing_uncertain flag for models with unknown pricing
// Created: 2026-08-29
//
// When the native model sync discovers models from a provider's /models endpoint,
// some providers (like dedicated free-tier platforms) don't report pricing at all.
// In that case `isFree === undefined` — we treat them as free for sync purposes
// (NATIVE_MODEL_SYNC_FREE_ONLY keeps them), but the operator should be aware
// that billing is not explicitly confirmed. This column tracks that uncertainty.
//
// DOWN: reversible
function hasColumn(db, table, column) {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all();
    return columns.some((candidate) => candidate.name === column);
}
export function up(db) {
    if (!hasColumn(db, 'models', 'billing_uncertain')) {
        db.prepare('ALTER TABLE models ADD COLUMN billing_uncertain INTEGER NOT NULL DEFAULT 0').run();
    }
}
export function down(db) {
    if (hasColumn(db, 'models', 'billing_uncertain')) {
        db.prepare('ALTER TABLE models DROP COLUMN billing_uncertain').run();
    }
}
//# sourceMappingURL=20260829_000001_model_billing_uncertain.js.map