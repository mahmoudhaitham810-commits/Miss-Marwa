// =====================================================================
// Parent Portal sessions (18 Nov 2026). Shared module — not a page (onRequest → 404).
//
// A parent signs in with TWO numbers: their own (= the student's registered parent_phone) and the child's
// own phone. The account is the parent phone; all children registered under it are theirs (siblings).
// One device at a time: every sign-in writes a new random session_key into `parents`; the cookie carries
// it, so the previous device's cookie stops matching and that device is signed out.
// =====================================================================
import { normalizeEgyptPhone, readParentCookie } from './admin-auth.js';

export async function onRequest() { return new Response('Not found', { status: 404 }); }

export const phoneKey = (v) => { const p = normalizeEgyptPhone(v); return /^01\d{9}$/.test(p) ? p : null; };

/** Every student whose registered parent phone is this number (any format stored) */
export async function childrenOf(db, phone) {
    if (!phone) return [];
    const { results } = await db.prepare(
        `SELECT student_id as studentId, first_name as firstName, last_name as lastName, gender, grade, branch, phone, parent_phone as parentPhone
         FROM students WHERE parent_phone LIKE ? ORDER BY grade, first_name`
    ).bind('%' + phone.slice(-9)).all();
    return (results || []).filter(s => normalizeEgyptPhone(s.parentPhone) === phone)
        .map(s => ({ studentId: s.studentId, firstName: s.firstName || '', lastName: s.lastName || '', gender: s.gender, grade: String(s.grade || '').toLowerCase(), branch: s.branch || null, phone: normalizeEgyptPhone(s.phone) }));
}

/** → { parent: { phone, children, active } } or { reason: 'NONE' | 'REPLACED' | 'NO_CHILDREN' } */
export async function parentSession(request, env, db) {
    const tok = await readParentCookie(request, env);
    if (!tok || !tok.pp || !tok.k) return { reason: 'NONE' };
    const row = await db.prepare('SELECT phone, session_key, active_student FROM parents WHERE phone = ?').bind(tok.pp).first();
    if (!row) return { reason: 'NONE' };
    if (row.session_key !== tok.k) return { reason: 'REPLACED' };           // signed in on another device since
    const children = await childrenOf(db, row.phone);
    if (!children.length) return { reason: 'NO_CHILDREN' };
    const active = children.find(c => c.studentId === row.active_student) ? row.active_student : children[0].studentId;
    return { parent: { phone: row.phone, children, active } };
}
export async function parentFromRequest(request, env, db) { return (await parentSession(request, env, db)).parent || null; }
