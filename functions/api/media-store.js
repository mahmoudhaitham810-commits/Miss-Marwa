// =====================================================================
// Unified media storage — photos, voice notes, homework pages.
//
//   • Primary: Cloudflare R2 bucket bound as `MEDIA` (10 GB free, no egress fees).
//   • Fallback: D1 (base64 in media_objects.data) when the binding is missing,
//     so the site keeps working before R2 is set up (or on a preview without it).
//   • Legacy: files Questions saved before this module existed stay in the old
//     ask_media table under the SAME id; a background job copies them to R2,
//     checks the copy, and only then frees the D1 space.
//
// Every feature talks to this module only — swapping backends never touches feature code.
// Text, grades and records stay in D1 (miss-marwa-db); only heavy files go to R2.
// =====================================================================

export const R2_BINDING = 'MEDIA';

export function r2(env) {
    const b = env && env[R2_BINDING];
    return b && typeof b.put === 'function' && typeof b.get === 'function' ? b : null;
}
export const mediaBackend = (env) => (r2(env) ? 'r2' : 'd1');

const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf', 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a', 'audio/mpeg': 'mp3', 'audio/aac': 'aac', 'audio/x-m4a': 'm4a', 'audio/wav': 'wav' };

function b64ToBytes(b64) { const s = atob(b64); const out = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i); return out; }
function bytesToB64(bytes) { let s = ''; const CH = 0x8000; for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH)); return btoa(s); }
async function sha256(bytes) { const h = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)); return [...h].map(b => b.toString(16).padStart(2, '0')).join(''); }
const safe = (s) => String(s || 'x').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40) || 'x';

// Schema (called from ensureAppSchema — add-only, never touches existing tables' data)
export function mediaSchemaSteps() {
    return [
        `CREATE TABLE IF NOT EXISTS media_objects (
            id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, owner_id INTEGER, student_id TEXT,
            mime TEXT NOT NULL, size INTEGER NOT NULL DEFAULT 0, storage TEXT NOT NULL, r2_key TEXT, data TEXT, sha TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP, purge_after TEXT)`,
        'CREATE INDEX IF NOT EXISTS idx_media_kind ON media_objects(kind, created_at)',
        'CREATE INDEX IF NOT EXISTS idx_media_storage ON media_objects(storage)',
        'CREATE INDEX IF NOT EXISTS idx_media_student ON media_objects(student_id)'
    ];
}

// Register files Questions saved in ask_media (same id → every message keeps pointing at the right file).
// The first time, also reserve an id gap so a brand-new file can never take the id of an old one
// that is still being registered (e.g. while an older version of the site finishes a request).
export async function registerLegacy(db) {
    try {
        await db.prepare(`INSERT OR IGNORE INTO media_objects (id, kind, student_id, mime, size, storage, created_at)
            SELECT id, 'ask', student_id, mime, size, 'legacy', created_at FROM ask_media`).run();
        const first = await db.prepare(`INSERT OR IGNORE INTO app_kv ("key", value) VALUES ('media_id_gap', datetime('now'))`).run();
        if (first.meta && first.meta.changes) {
            await db.prepare(`INSERT INTO media_objects (id, kind, mime, size, storage)
                SELECT MAX(m) + 1000, 'reserved', '-', 0, 'none' FROM (SELECT COALESCE(MAX(id), 0) AS m FROM ask_media UNION ALL SELECT COALESCE(MAX(id), 0) FROM media_objects)`).run();
        }
    } catch (e) { /* ask_media may not exist yet on a brand-new database */ }
}

/**
 * Save a file. `data` is base64 (what the browser sends) or bytes.
 * Returns { id, storage, size }.
 */
export async function putMedia(env, db, { kind, studentId = null, ownerId = null, mime, data, purgeAfter = null }) {
    const bytes = typeof data === 'string' ? b64ToBytes(data) : data;
    const size = bytes.length, sha = await sha256(bytes);
    const bucket = r2(env);
    if (bucket) {
        const key = `${safe(kind)}/${safe(studentId)}/${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}.${EXT[mime] || 'bin'}`;
        let stored = false;
        try { await bucket.put(key, bytes, { httpMetadata: { contentType: mime }, customMetadata: { kind: String(kind), student: String(studentId || '') } }); stored = true; }
        catch (e) { console.warn('R2 put failed — saving in D1 instead (moved to R2 later):', e && e.message); }
        if (stored) try {
            const r = await db.prepare('INSERT INTO media_objects (kind, owner_id, student_id, mime, size, storage, r2_key, sha, purge_after) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
                .bind(kind, ownerId, studentId, mime, size, 'r2', key, sha, purgeAfter).run();
            return { id: Number(r.meta.last_row_id), storage: 'r2', size };
        } catch (e) { await bucket.delete(key).catch(() => { }); throw e; }   // never leave an orphan file behind
    }
    // D1 (no R2 binding, or R2 hiccup) — the background job moves it to R2 once R2 is available
    const r = await db.prepare('INSERT INTO media_objects (kind, owner_id, student_id, mime, size, storage, data, sha, purge_after) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(kind, ownerId, studentId, mime, size, 'd1', typeof data === 'string' ? data : bytesToB64(bytes), sha, purgeAfter).run();
    return { id: Number(r.meta.last_row_id), storage: 'd1', size };
}

// Who owns a file / what is it (no bytes) — for permission checks before streaming.
export async function mediaInfo(db, id) {
    const row = await db.prepare('SELECT id, kind, owner_id, student_id, mime, size, storage, r2_key, created_at FROM media_objects WHERE id = ?').bind(id).first();
    if (row && row.storage !== 'reserved' && row.kind !== 'reserved') return row;
    // not registered yet → an old Questions file
    const legacy = await db.prepare('SELECT id, student_id, mime, size, created_at FROM ask_media WHERE id = ?').bind(id).first().catch(() => null);
    return legacy ? { ...legacy, kind: 'ask', storage: 'legacy' } : null;
}

/** Returns a Response with the file (or null if it is gone). */
export async function mediaResponse(env, db, info, { cache = 'private, max-age=604800, immutable' } = {}) {
    const headers = { 'Content-Type': info.mime, 'Cache-Control': cache, 'X-Content-Type-Options': 'nosniff' };
    if (info.storage === 'r2') {
        const bucket = r2(env);
        if (!bucket) return null;
        const obj = await bucket.get(info.r2_key);
        if (!obj) return null;
        return new Response(obj.body, { headers: { ...headers, 'Content-Length': String(obj.size) } });
    }
    const row = info.storage === 'legacy'
        ? await db.prepare('SELECT data FROM ask_media WHERE id = ?').bind(info.id).first()
        : await db.prepare('SELECT data FROM media_objects WHERE id = ?').bind(info.id).first();
    if (!row || !row.data) return null;
    const bytes = b64ToBytes(row.data);
    return new Response(bytes, { headers: { ...headers, 'Content-Length': String(bytes.length) } });
}

/** Delete files by id (R2 object / D1 data / legacy row) and their registry rows. Returns { files, bytes }. */
export async function deleteMedia(env, db, ids) {
    ids = [...new Set((ids || []).map(Number).filter(n => n > 0))];
    let files = 0, bytes = 0;
    for (let i = 0; i < ids.length; i += 90) {          // D1: max 100 bound values per query
        const part = ids.slice(i, i + 90), ph = part.map(() => '?').join(',');
        const { results } = await db.prepare(`SELECT id, size, storage, r2_key FROM media_objects WHERE id IN (${ph}) AND kind != 'reserved'`).bind(...part).all();
        const rows = results || [];
        const known = new Set(rows.map(r => r.id));
        // old files that were never registered
        const { results: leg } = await db.prepare(`SELECT id, size FROM ask_media WHERE id IN (${ph})`).bind(...part).all().catch(() => ({ results: [] }));
        for (const l of leg || []) if (!known.has(l.id)) rows.push({ id: l.id, size: l.size, storage: 'legacy' });
        const keys = rows.filter(r => r.storage === 'r2' && r.r2_key).map(r => r.r2_key);
        const bucket = r2(env);
        if (keys.length && bucket) { try { await bucket.delete(keys); } catch (e) { /* the registry row goes anyway; an orphan costs only storage */ } }
        const sids = rows.map(r => r.id);
        if (sids.length) {
            const ph2 = sids.map(() => '?').join(',');
            await db.batch([
                db.prepare(`DELETE FROM media_objects WHERE id IN (${ph2})`).bind(...sids),
                db.prepare(`DELETE FROM ask_media WHERE id IN (${ph2})`).bind(...sids)
            ]);
        }
        files += rows.length; bytes += rows.reduce((t, r) => t + (r.size || 0), 0);
    }
    return { files, bytes };
}

/**
 * Move files that are still inside D1 (old Questions files + anything saved while R2 was not connected)
 * into R2, a few at a time. Each copy is read back and compared before the D1 copy is removed.
 */
export async function migrateToR2(env, db, limit = 8) {
    const bucket = r2(env);
    if (!bucket) return { moved: 0, left: null };
    await registerLegacy(db);
    const { results } = await db.prepare(`SELECT id, kind, student_id, mime, size, storage FROM media_objects WHERE storage IN ('legacy', 'd1') ORDER BY id LIMIT ?`).bind(limit).all();
    let moved = 0;
    for (const m of results || []) {
        const src = m.storage === 'legacy'
            ? await db.prepare('SELECT data FROM ask_media WHERE id = ?').bind(m.id).first()
            : await db.prepare('SELECT data FROM media_objects WHERE id = ?').bind(m.id).first();
        if (!src || !src.data) {   // nothing to move (already deleted) → drop the dangling registry row
            await db.prepare('DELETE FROM media_objects WHERE id = ?').bind(m.id).run();
            continue;
        }
        const bytes = b64ToBytes(src.data), sha = await sha256(bytes);
        const key = `${safe(m.kind)}/${safe(m.student_id)}/m${m.id}-${sha.slice(0, 10)}.${EXT[m.mime] || 'bin'}`;
        await bucket.put(key, bytes, { httpMetadata: { contentType: m.mime }, customMetadata: { kind: String(m.kind), student: String(m.student_id || ''), migrated: '1' } });
        const back = await bucket.head(key);
        if (!back || back.size !== bytes.length) continue;      // keep the D1 copy; try again next time
        // registry first (so reads switch to R2), then free the D1 bytes
        const upd = await db.prepare(`UPDATE media_objects SET storage = 'r2', r2_key = ?, data = NULL, sha = ?, size = ? WHERE id = ? AND storage = ?`)
            .bind(key, sha, bytes.length, m.id, m.storage).run();
        if (!upd.meta || !upd.meta.changes) { await bucket.delete(key).catch(() => { }); continue; }   // someone else moved/deleted it
        if (m.storage === 'legacy') await db.prepare('DELETE FROM ask_media WHERE id = ?').bind(m.id).run();
        moved++;
    }
    const left = await db.prepare(`SELECT COUNT(*) AS n FROM media_objects WHERE storage IN ('legacy', 'd1')`).first();
    return { moved, left: left ? left.n : 0 };
}

/** Totals for the Storage card. */
export async function mediaStats(env, db, kind = null) {
    await registerLegacy(db);
    const where = kind ? `WHERE kind = ?` : `WHERE kind != 'reserved'`;
    const { results } = await db.prepare(`SELECT storage, COUNT(*) AS files, COALESCE(SUM(size), 0) AS bytes FROM media_objects ${where} GROUP BY storage`).bind(...(kind ? [kind] : [])).all();
    const by = {}; let files = 0, bytes = 0;
    for (const r of results || []) { by[r.storage] = { files: r.files, bytes: r.bytes }; files += r.files; bytes += r.bytes; }
    const inD1 = ['d1', 'legacy'].reduce((t, k) => t + (by[k] ? by[k].bytes : 0), 0);
    const filesInD1 = ['d1', 'legacy'].reduce((t, k) => t + (by[k] ? by[k].files : 0), 0);
    return { backend: mediaBackend(env), files, bytes, inR2: by.r2 ? by.r2.bytes : 0, inD1, filesInD1, filesInR2: by.r2 ? by.r2.files : 0 };
}

// Not a page — this file is a shared module. (Pages would otherwise expose it as /api/media-store.)
export async function onRequest() { return new Response('Not found', { status: 404 }); }
