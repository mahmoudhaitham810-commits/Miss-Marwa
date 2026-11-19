// =====================================================================
// Shared AI answer cache (Assistant Pro, 19 Nov 2026).
//
// One exam-mistake explanation or one study-summary is generated ONCE and then served to every student
// who asks for the same thing — instantly, at zero API cost.
//
//   • The key includes a fingerprint (SHA-256) of the exact content it was made from (the question + its
//     correct answer, or the PDF's text) and the prompt version. When Miss Marwa edits a question or
//     replaces a PDF the fingerprint changes → a new key → the old answer is simply never served again.
//     No manual "clear cache" is ever needed.
//   • Two students asking at the same moment: the first one claims the key (INSERT OR IGNORE, status
//     'pending'); the others wait for that answer instead of paying for a second one. A claim older than
//     2 minutes (a crashed request) is taken over. If the generation fails the claim is removed.
// =====================================================================
const STALE_MS = 120000;

export async function sha256(text) {
    const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(text)));
    return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
}

const readyDbs = new WeakSet();
export async function ensureCacheTable(db) {
    if (readyDbs.has(db)) return;
    await db.batch([
        db.prepare(`CREATE TABLE IF NOT EXISTS ai_cache ("key" TEXT PRIMARY KEY, kind TEXT, ref TEXT, status TEXT NOT NULL DEFAULT 'pending',
            text TEXT, model TEXT, cost_usd REAL DEFAULT 0, hits INTEGER DEFAULT 0, owner TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at INTEGER)`),
        db.prepare('CREATE INDEX IF NOT EXISTS idx_ai_cache_ref ON ai_cache(kind, ref)')
    ]);
    readyDbs.add(db);
}

export class CacheBusyError extends Error { constructor() { super('Someone else is preparing this answer — try again in a few seconds.'); this.code = 'CACHE_BUSY'; } }

/** A saved answer, or null. Counts the hit. */
export async function cached(db, key) {
    await ensureCacheTable(db);
    const row = await db.prepare(`SELECT text, model FROM ai_cache WHERE "key" = ? AND status = 'ready'`).bind(key).first();
    if (row) await db.prepare(`UPDATE ai_cache SET hits = hits + 1 WHERE "key" = ?`).bind(key).run();
    return row || null;
}

/**
 * The saved answer for `key`, or make it with `make()` (exactly once, even under concurrent requests).
 * make() → { text, model, costUsd }.  Returns { text, model, cached: boolean }.
 */
export async function getOrMake(db, key, { kind, ref = null, make, waitMs = 45000, pollMs = 700 }) {
    await ensureCacheTable(db);
    const owner = crypto.randomUUID();
    const deadline = Date.now() + waitMs;
    for (;;) {
        const hit = await cached(db, key);
        if (hit) return { text: hit.text, model: hit.model, cached: true };
        // claim it (new key) …
        let claim = await db.prepare(`INSERT OR IGNORE INTO ai_cache ("key", kind, ref, status, owner, updated_at) VALUES (?, ?, ?, 'pending', ?, ?)`)
            .bind(key, kind || null, ref, owner, Date.now()).run();
        // … or take over a claim whose request died
        if (!claim.meta.changes) claim = await db.prepare(`UPDATE ai_cache SET owner = ?, updated_at = ? WHERE "key" = ? AND status = 'pending' AND updated_at < ?`)
            .bind(owner, Date.now(), key, Date.now() - STALE_MS).run();
        if (claim.meta.changes) {
            let out;
            try { out = await make(); }
            catch (e) { await db.prepare(`DELETE FROM ai_cache WHERE "key" = ? AND owner = ? AND status = 'pending'`).bind(key, owner).run().catch(() => {}); throw e; }
            const text = String(out && out.text || '').trim();
            if (!text) { await db.prepare(`DELETE FROM ai_cache WHERE "key" = ? AND owner = ?`).bind(key, owner).run(); throw new Error('Empty answer'); }
            await db.prepare(`UPDATE ai_cache SET status = 'ready', text = ?, model = ?, cost_usd = ?, updated_at = ? WHERE "key" = ? AND owner = ?`)
                .bind(text, out.model || null, out.costUsd || 0, Date.now(), key, owner).run();
            return { text, model: out.model || null, cached: false, costUsd: out.costUsd || 0 };
        }
        // someone else is making it right now → wait for theirs
        if (Date.now() > deadline) throw new CacheBusyError();
        await new Promise(r => setTimeout(r, pollMs));
    }
}

/** Remove saved answers of one thing (e.g. an exam that was deleted). New keys make this optional. */
export async function forget(db, kind, ref) {
    await ensureCacheTable(db);
    await db.prepare('DELETE FROM ai_cache WHERE kind = ? AND ref = ?').bind(kind, ref).run();
}

// shared module — not a page
export async function onRequest() { return new Response('Not found', { status: 404 }); }
