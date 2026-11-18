// =====================================================================
// Push notifications (OneSignal) — one place for every push the platform sends.
//
// Who gets it: each device signs in to OneSignal with an "external ID" (the browser calls OneSignal.login):
//   students → "student-MM-123456"      staff → "staff-<id>"
// so a push reaches EVERY device of that person. Devices that registered before 18 Nov 2026 only carry tags
// ("sid" for students, "staff" for staff); anyone the external-ID push didn't reach gets a second push by tag,
// so nobody gets it twice and nobody is missed.
//
// Keys: ONESIGNAL_APP_ID + ONESIGNAL_REST_API_KEY (Cloudflare → Settings → Variables and Secrets).
// Both key styles work: the new "App API key" (Authorization: Key …) and the older REST key (Authorization: Basic …).
// The last result is kept in app_kv ('push_last') so the staff "Send a test" button can show what happened.
// Shared module — not a page (onRequest → 404).
// =====================================================================
export async function onRequest() { return new Response('Not found', { status: 404 }); }

export const CLIENT_APP_ID = 'a5d058a6-b45e-46a5-aa86-014309b7c7d2';   // the App ID the web pages use (student.js / admin.js)
const API = 'https://api.onesignal.com/notifications';
export const studentAlias = (id) => `student-${id}`;
export const staffAlias = (id) => `staff-${id}`;
export const pushConfigured = (env) => !!(env && env.ONESIGNAL_APP_ID && env.ONESIGNAL_REST_API_KEY);

async function post(env, body) {
    const key = String(env.ONESIGNAL_REST_API_KEY || '').trim();
    const send = (scheme) => fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8', Authorization: `${scheme} ${key}` }, body: JSON.stringify({ app_id: env.ONESIGNAL_APP_ID, target_channel: 'push', ...body }) });
    let res = await send('Key');
    if (res.status === 401 || res.status === 403) res = await send('Basic');       // the older REST API key style
    const data = await res.json().catch(() => ({}));
    return { status: res.status, data };
}
// Which of the aliases did NOT get it (not subscribed / unknown)?
function missed(data, aliases) {
    if (!data || !data.id) return aliases;                                            // "All included players are not subscribed"
    const inv = data.errors && data.errors.invalid_aliases && data.errors.invalid_aliases.external_id;
    return Array.isArray(inv) ? aliases.filter(a => inv.includes(a)) : [];
}
async function remember(db, rec) {
    if (!db) return;
    try { await db.prepare(`INSERT INTO app_kv ("key", value) VALUES ('push_last', ?) ON CONFLICT("key") DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`).bind(JSON.stringify({ ...rec, at: new Date().toISOString() })).run(); } catch (e) { }
}

/**
 * Push to people. who = [{ alias: 'student-MM-1', tag: ['sid', 'MM-1'] }, …]
 * → { ok, sent, viaTag, status, errors, reason }
 */
export async function pushTo(env, db, who, { title, message, url, data = null }) {
    if (!pushConfigured(env)) { const r = { ok: false, reason: 'NOT_CONFIGURED', sent: 0 }; await remember(db, r); return r; }
    if (!who.length) return { ok: true, sent: 0 };
    const content = { headings: { en: title, ar: title }, contents: { en: message, ar: message }, ...(url ? { url } : {}), ...(data ? { data } : {}) };
    const out = { ok: true, sent: 0, viaTag: 0, status: null, errors: [] };
    try {
        for (let i = 0; i < who.length; i += 1500) {                                   // OneSignal: ≤ 2,000 aliases per push
            const part = who.slice(i, i + 1500), aliases = part.map(w => w.alias);
            const r = await post(env, { ...content, include_aliases: { external_id: aliases } });
            out.status = r.status;
            if (r.status >= 400) { out.ok = false; out.errors.push(r.data && r.data.errors ? r.data.errors : `HTTP ${r.status}`); }
            const miss = r.status >= 400 ? aliases : missed(r.data, aliases);
            out.sent += aliases.length - miss.length;
            // older devices: by tag, 90 people per push (OneSignal allows 200 filter entries; each "OR" counts)
            const left = part.filter(w => miss.includes(w.alias) && w.tag);
            for (let k = 0; k < left.length; k += 90) {
                const filters = left.slice(k, k + 90).flatMap((w, n) => [...(n ? [{ operator: 'OR' }] : []), { field: 'tag', key: w.tag[0], relation: '=', value: String(w.tag[1]) }]);
                const t = await post(env, { ...content, filters });
                if (t.status >= 400) { out.ok = false; out.errors.push(t.data && t.data.errors ? t.data.errors : `HTTP ${t.status}`); }
                else if (t.data && t.data.id) out.viaTag += left.slice(k, k + 90).length;
            }
        }
    } catch (e) { out.ok = false; out.errors.push(String(e && e.message || e)); }
    if (!out.sent && !out.viaTag && out.ok) out.reason = 'NO_DEVICE';                 // nobody has notifications on yet
    await remember(db, { ...out, title, people: who.length });
    return out;
}
/** Everyone in a grade (tag "grade", e.g. PREP1) or everyone subscribed — new lessons / exams / homework */
export async function pushToGrade(env, db, grade, { title, message, url }) {
    if (!pushConfigured(env)) return { ok: false, reason: 'NOT_CONFIGURED' };
    try {
        // students of that grade (tag grade = PREP1) + parents with a child in it (tag pg_prep1 = 1)
        const g = String(grade || '').toLowerCase();
        const target = grade ? { filters: [{ field: 'tag', key: 'grade', relation: '=', value: g.toUpperCase() }, { operator: 'OR' }, { field: 'tag', key: 'pg_' + g, relation: '=', value: '1' }] } : { included_segments: ['Subscribed Users'] };
        const r = await post(env, { headings: { en: title, ar: title }, contents: { en: message, ar: message }, ...(url ? { url } : {}), ...target });
        const out = { ok: r.status < 400, status: r.status, id: r.data && r.data.id || null, errors: r.data && r.data.errors || null };
        await remember(db, { ...out, title, grade });
        return out;
    } catch (e) { return { ok: false, reason: String(e && e.message || e) }; }
}
export const students = (ids) => ids.map(id => ({ alias: studentAlias(id), tag: ['sid', id] }));
export const parentAlias = (phone) => `parent-${phone}`;
export const parents = (phones) => phones.map(p => ({ alias: parentAlias(p), tag: ['parent', p] }));
export const staffList = (ids) => ids.map(id => ({ alias: staffAlias(id), tag: ['staff', id] }));

/** Every active staff member who answers questions (teacher + assistants) */
export async function inboxStaffIds(db) {
    const { results } = await db.prepare(`SELECT id FROM staff WHERE active = 1 AND role IN ('teacher', 'assistant')`).all().catch(() => ({ results: [] }));
    return (results || []).map(r => r.id);
}
/** Run a push without slowing the request down (and without ever breaking it) */
export function background(context, p) {
    const safe = Promise.resolve(p).catch(() => null);
    if (context && context.waitUntil) context.waitUntil(safe);
    return safe;
}
