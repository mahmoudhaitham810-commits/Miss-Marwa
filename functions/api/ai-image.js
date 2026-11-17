// =====================================================================
// Photos sent to the AI assistants (staff + students) — one place for the rules:
//   • only JPEG / PNG / WebP, at most ~1.5 MB (the page shrinks photos to ~1280 px before sending)
//   • saved through the normal media store (R2), tagged with who owns it
//   • kept 60 days, then removed by a small clean-up that runs in the background
// Shared module — not a page (onRequest → 404).
// =====================================================================
import { putMedia, mediaInfo, mediaResponse, deleteMedia } from './media-store.js';

export async function onRequest() { return new Response('Not found', { status: 404 }); }

export const IMAGE_KEEP_DAYS = 60;
const MAX_B64 = 2100000;   // ≈ 1.5 MB of image

/** Validate { mime, b64 } (or a data: URL) sent by the page. Returns { mime, b64 } | { error } | null. */
export function readImage(input) {
    if (!input) return null;
    let mime = '', b64 = '';
    if (typeof input === 'string') { const m = input.match(/^data:(image\/[a-z]+);base64,(.+)$/); if (m) { mime = m[1]; b64 = m[2]; } }
    else { mime = String(input.mime || ''); b64 = String(input.b64 || ''); }
    if (!/^image\/(jpeg|png|webp)$/.test(mime)) return { error: 'Send a photo (JPG, PNG or WebP).' };
    b64 = b64.replace(/\s/g, '');
    if (!b64 || b64.length > MAX_B64 || !/^[A-Za-z0-9+/]+=*$/.test(b64)) return { error: 'This photo is too big — try again (the app makes it smaller automatically).' };
    return { mime, b64 };
}

export async function saveImage(env, db, img, { kind, studentId = null, ownerId = null }) {
    const purge = new Date(Date.now() + IMAGE_KEEP_DAYS * 86400000).toISOString().slice(0, 19).replace('T', ' ');
    const r = await putMedia(env, db, { kind, studentId, ownerId, mime: img.mime, data: img.b64, purgeAfter: purge });
    return r.id;
}

/** Load a saved photo back as { mime, b64 } (used when the same question is re-asked on the Pro model). */
export async function loadImage(env, db, id) {
    const info = id ? await mediaInfo(db, id) : null;
    if (!info) return null;
    const res = await mediaResponse(env, db, info);
    if (!res) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return { mime: info.mime, b64: btoa(s) };
}

/** Stream a photo only to the person allowed to see it (check(info) decides). */
export async function serveImage(env, db, id, check) {
    const info = id ? await mediaInfo(db, id) : null;
    if (!info || !['ai-staff', 'ai-student'].includes(info.kind) || !check(info)) return Response.json({ error: 'Not found' }, { status: 404 });
    return (await mediaResponse(env, db, info)) || Response.json({ error: 'Not found' }, { status: 404 });
}

/** Remove expired AI photos (a few at a time — runs in the background after a message). */
export async function purgeOldImages(env, db) {
    try {
        const { results } = await db.prepare(`SELECT id FROM media_objects WHERE kind IN ('ai-staff', 'ai-student') AND purge_after IS NOT NULL AND purge_after < datetime('now') LIMIT 25`).all();
        if (results && results.length) await deleteMedia(env, db, results.map(r => r.id));
    } catch (e) { /* best effort */ }
}
