// =====================================================================
// /api/lesson-pdf — study-summary PDFs stored on the platform (R2 "MEDIA"), so Assistant Pro can read them.
//
//   POST ?action=upload  (staff, lessons.create)  multipart: lessonId, file (PDF), text (JSON array of page texts)
//        → the PDF goes to R2 at lessons/<lessonId>/<hash>.pdf; its text (pulled out in Miss Marwa's browser with
//          pdf.js — free) is saved in D1 (lesson_files). Uploading again REPLACES it (new hash → old AI summaries
//          are never served again). Works before the lesson row exists, so "upload then publish" never leaves a
//          broken link. Existing Google-Drive summaries can get a PDF attached too (their link stays as it is).
//   GET  ?action=file&id=<lessonId>                → the PDF (what students open)
//   GET  ?action=ids&grade=prep2                    → lesson ids that Assistant Pro can summarize (text found)
//   GET  ?action=list (staff)                        → every attached PDF with pages / text size
//   POST ?action=remove { lessonId } (staff, lessons.delete)
// =====================================================================
import { requireStaff, audit, ensureAppSchema, verifyStudentRequest, verifyAdminRequest } from './admin-auth.js';
import { sha256 } from './ai-cache.js';

const getDb = (env) => [env.DB, env.D1_DB].find(d => d && typeof d.prepare === 'function');
const json = (d, s = 200) => Response.json(d, { status: s });
const bad = (m, s = 400, extra = {}) => json({ error: m, ...extra }, s);
const MAX_BYTES = 30 * 1024 * 1024;          // 30 MB per PDF
const MAX_TEXT = 150000;                     // characters kept for the AI (~60k tokens, well under the 100k long-prompt price)
export const MIN_TEXT = 200;                 // less than this → a scanned (photo) PDF: no AI summary yet
const ID_RE = /^[A-Za-z0-9_-]{3,60}$/;

const readyDbs = new WeakSet();
export async function ensureLessonFiles(db) {
    if (readyDbs.has(db)) return;
    await db.prepare(`CREATE TABLE IF NOT EXISTS lesson_files (lesson_id TEXT PRIMARY KEY, r2_key TEXT NOT NULL, file_hash TEXT NOT NULL,
        text TEXT, chars INTEGER DEFAULT 0, pages INTEGER DEFAULT 0, text_pages INTEGER DEFAULT 0, size INTEGER DEFAULT 0, name TEXT,
        uploaded_by TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP)`).run();
    readyDbs.add(db);
}
/** { lessonId, hash, text, chars, pages } — the PDF's text for the AI, or null */
export async function lessonText(db, lessonId) {
    await ensureLessonFiles(db);
    const r = await db.prepare('SELECT lesson_id, file_hash, text, chars, pages FROM lesson_files WHERE lesson_id = ?').bind(lessonId).first();
    return r ? { lessonId: r.lesson_id, hash: r.file_hash, text: r.text || '', chars: r.chars || 0, pages: r.pages || 0 } : null;
}
// page texts → one text with page markers, tidied
export function joinPages(pages) {
    const out = [];
    (Array.isArray(pages) ? pages : []).slice(0, 400).forEach((t, i) => {
        const s = String(t || '').replace(/\u0000/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
        if (s) out.push(`[Page ${i + 1}]\n${s}`);
    });
    return out.join('\n\n').slice(0, MAX_TEXT);
}

export async function onRequest(context) {
    const { request, env } = context;
    const url = new URL(request.url), action = url.searchParams.get('action') || '';
    const db = getDb(env);
    if (!db) return bad('Database not connected', 500);
    const bucket = env.MEDIA && typeof env.MEDIA.put === 'function' ? env.MEDIA : null;
    try {
        await ensureAppSchema(db);
        await ensureLessonFiles(db);

        if (action === 'file') {
            // Miss Marwa's summary PDFs: signed-in students and staff only (pentest 23 Nov 2026 — it was open to anyone)
            const signedIn = (await verifyStudentRequest(request, env, db)) || (await verifyAdminRequest(request, env));
            if (!signedIn) return new Response('Please sign in first', { status: 401, headers: { 'Cache-Control': 'no-store' } });
            const id = url.searchParams.get('id') || '';
            const row = ID_RE.test(id) ? await db.prepare('SELECT r2_key, name FROM lesson_files WHERE lesson_id = ?').bind(id).first() : null;
            if (!row || !bucket) return new Response('Not found', { status: 404 });
            const obj = await bucket.get(row.r2_key);
            if (!obj) return new Response('Not found', { status: 404 });
            const name = String(row.name || 'summary.pdf').replace(/[^\w.\- ]+/g, '_');
            return new Response(obj.body, { headers: { 'Content-Type': 'application/pdf', 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff', 'Content-Disposition': `inline; filename="${name}"` } });
        }
        if (action === 'ids') {
            const grade = String(url.searchParams.get('grade') || '').toLowerCase();
            const { results } = await db.prepare(`SELECT f.lesson_id FROM lesson_files f JOIN lessons l ON l.id = f.lesson_id WHERE l.grade = ? AND f.chars >= ?`).bind(grade, MIN_TEXT).all();
            return json({ ids: (results || []).map(r => r.lesson_id) });
        }
        if (action === 'list') {
            const auth = await requireStaff(request, env, 'lessons.view');
            if (auth.error) return auth.error;
            const { results } = await db.prepare('SELECT lesson_id, chars, pages, text_pages, size, name, updated_at FROM lesson_files').all();
            return json({ files: (results || []).map(r => ({ lessonId: r.lesson_id, chars: r.chars, pages: r.pages, textPages: r.text_pages, size: r.size, name: r.name, updatedAt: r.updated_at, readable: r.chars >= MIN_TEXT })) });
        }
        if (request.method !== 'POST') return bad('POST only', 405);

        if (action === 'upload') {
            const auth = await requireStaff(request, env, 'lessons.create');
            if (auth.error) return auth.error;
            if (!bucket) return bad('Cloudflare R2 (MEDIA) is not connected', 503);
            const form = await request.formData().catch(() => null);
            if (!form) return bad('Send the PDF as a form');
            const lessonId = String(form.get('lessonId') || '');
            const file = form.get('file');
            if (!ID_RE.test(lessonId)) return bad('Bad lesson id');
            if (!file || typeof file.arrayBuffer !== 'function') return bad('Choose a PDF file');
            const bytes = new Uint8Array(await file.arrayBuffer());
            if (!bytes.length || bytes.length > MAX_BYTES) return bad(`The PDF must be smaller than ${MAX_BYTES / 1024 / 1024} MB`, 413);
            if (String.fromCharCode(...bytes.slice(0, 5)) !== '%PDF-') return bad('This file is not a PDF');
            let pages = [];
            try { pages = JSON.parse(String(form.get('text') || '[]')); } catch (e) { pages = []; }
            const text = joinPages(pages);
            const textPages = (Array.isArray(pages) ? pages : []).filter(t => String(t || '').trim().length >= 40).length;
            // fingerprint of the file + its text → part of the AI-summary key (a replaced PDF never gets the old summary)
            const fileHash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2, '0')).join('');
            const hash = (await sha256(fileHash + ':' + text)).slice(0, 24);
            const key = `lessons/${lessonId}/${hash}.pdf`;
            const before = await db.prepare('SELECT r2_key FROM lesson_files WHERE lesson_id = ?').bind(lessonId).first();
            await bucket.put(key, bytes, { httpMetadata: { contentType: 'application/pdf' }, customMetadata: { lessonId } });
            const name = String(file.name || 'summary.pdf').slice(0, 120);
            await db.prepare(`INSERT INTO lesson_files (lesson_id, r2_key, file_hash, text, chars, pages, text_pages, size, name, uploaded_by, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                ON CONFLICT(lesson_id) DO UPDATE SET r2_key = excluded.r2_key, file_hash = excluded.file_hash, text = excluded.text, chars = excluded.chars,
                    pages = excluded.pages, text_pages = excluded.text_pages, size = excluded.size, name = excluded.name, uploaded_by = excluded.uploaded_by, updated_at = CURRENT_TIMESTAMP`)
                .bind(lessonId, key, hash, text, text.length, Array.isArray(pages) ? pages.length : 0, textPages, bytes.length, name, auth.staff.name || auth.staff.username || null).run();
            if (before && before.r2_key !== key) { try { await bucket.delete(before.r2_key); } catch (e) { /* an orphan file costs nothing much */ } }
            await audit(db, request, auth.staff, before ? 'lessons.pdf.replace' : 'lessons.pdf.upload', lessonId, { name, size: bytes.length, pages: pages.length, chars: text.length });
            return json({ ok: true, lessonId, url: `${url.origin}/api/lesson-pdf?action=file&id=${encodeURIComponent(lessonId)}`, pages: pages.length, chars: text.length, readable: text.length >= MIN_TEXT, replaced: !!before });
        }
        if (action === 'remove') {
            const auth = await requireStaff(request, env, 'lessons.delete');
            if (auth.error) return auth.error;
            const data = await request.json().catch(() => ({}));
            const id = String(data.lessonId || '');
            const row = await db.prepare('SELECT r2_key FROM lesson_files WHERE lesson_id = ?').bind(id).first();
            if (!row) return bad('No PDF on this item', 404);
            await db.prepare('DELETE FROM lesson_files WHERE lesson_id = ?').bind(id).run();
            if (bucket) { try { await bucket.delete(row.r2_key); } catch (e) { } }
            await audit(db, request, auth.staff, 'lessons.pdf.remove', id, {});
            return json({ ok: true });
        }
        return bad('Unknown action', 404);
    } catch (err) {
        console.error('lesson-pdf error', err);
        return bad('Something went wrong — try again', 500);
    }
}
