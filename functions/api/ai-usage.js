// =====================================================================
// /api/ai-usage — Miss Marwa's "AI usage" page (teacher only, permission ai.manage).
//   GET  ?action=overview           → settings, this month's totals, every student's usage and budget
//   GET  ?action=student&id=MM-…    → that student's latest Pro calls
//   POST ?action=set      { studentId, enabled?, budgetEgp? }  (budgetEgp null → back to the default)
//   POST ?action=bulk     { studentIds: [], enabled }
//   POST ?action=reset    { studentId }   → this month's budget starts again from now
//   POST ?action=settings { rate?, budget?, open?, freeOpen?, trial?: {start, end, budget}, daily?: {images, pdfIn, pdfOut},
//                           price?, wallet?, rateAuto?, rateBuffer? }
//   POST ?action=rate-now   → fetch today's dollar rate now (applies it + the safety margin)
//   POST ?action=daily    { studentId, daily: {images, pdfIn, pdfOut} | null }   (own daily file allowance; null → default)
// Every change goes to the activity log.
// =====================================================================
import { requireStaff, ensureAppSchema, audit } from './admin-auth.js';
import { ensureQuotaTables, quotaSettings, saveQuotaSettings, studentQuota, period, dailyDefaults, dailyLimits, dailyState, saveStudentDaily, refreshRate, subExpired, cairoDay } from './ai-quota.js';

const getDb = (env) => [env.DB, env.D1_DB].find(d => d && typeof d.prepare === 'function');
const json = (d, s = 200) => Response.json(d, { status: s });
const bad = (m, s = 400) => json({ error: m }, s);
const money = (v) => Math.round((Number(v) || 0) * 1e6) / 1e6;
// Midnight in Cairo as a UTC "YYYY-MM-DD HH:MM:SS" string (the ledger's created_at is UTC)
export function cairoDayStart(now = new Date()) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
        .formatToParts(now).map(p => [p.type, p.value]));
    const localAsUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
    const offset = localAsUtc - Math.floor(now.getTime() / 1000) * 1000;            // Cairo − UTC (2 or 3 hours)
    const midnight = Date.UTC(+parts.year, +parts.month - 1, +parts.day) - offset;
    return new Date(midnight).toISOString().replace('T', ' ').slice(0, 19);
}
const okAmount = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 && n <= 100000 ? Math.round(n * 100) / 100 : null; };

export async function onRequest(context) {
    const { request, env } = context;
    const url = new URL(request.url), action = url.searchParams.get('action') || '';
    const db = getDb(env);
    if (!db) return bad('Database not connected', 500);
    try {
        await ensureAppSchema(db);
        const auth = await requireStaff(request, env, 'ai.manage');
        if (auth.error) return auth.error;
        await ensureQuotaTables(db);
        if (action === 'overview') await refreshRate(db);   // the dollar rate: today's, when automatic (at most every 6 hours, fast otherwise)
        const S = await quotaSettings(db), per = period();
        const studentExists = async (id) => !!(id && await db.prepare('SELECT 1 FROM students WHERE student_id = ?').bind(id).first());

        if (action === 'overview') {
            const { results: studs } = await db.prepare('SELECT student_id, first_name, last_name, grade FROM students ORDER BY grade, first_name, last_name').all();
            const { results: plans } = await db.prepare('SELECT * FROM ai_student_plan').all();
            const { results: use } = await db.prepare(`SELECT u.student_id,
                    COUNT(*) AS all_n, COALESCE(SUM(u.cost_usd), 0) AS all_usd,
                    COALESCE(SUM(u.input_tokens + u.cache_read + u.cache_write), 0) AS all_in, COALESCE(SUM(u.output_tokens), 0) AS all_out,
                    SUM(CASE WHEN u.period = ? THEN 1 ELSE 0 END) AS m_n,
                    COALESCE(SUM(CASE WHEN u.period = ? THEN u.cost_usd ELSE 0 END), 0) AS m_usd,
                    COALESCE(SUM(CASE WHEN u.trial = 0 AND (CASE WHEN p.paid_from IS NOT NULL
                            THEN u.created_at >= (CASE WHEN p.reset_at > p.paid_from THEN p.reset_at ELSE p.paid_from END)
                            ELSE u.period = ? AND u.created_at >= (CASE WHEN p.reset_period = ? THEN COALESCE(p.reset_at, '') ELSE '' END) END) THEN u.cost_usd ELSE 0 END), 0) AS q_usd,
                    COALESCE(SUM(CASE WHEN u.trial = 1 THEN u.cost_usd ELSE 0 END), 0) AS t_usd, SUM(CASE WHEN u.trial = 1 THEN 1 ELSE 0 END) AS t_n,
                    COALESCE(SUM(CASE WHEN u.period = ? THEN u.cached ELSE 0 END), 0) AS m_cached
                FROM ai_usage u LEFT JOIN ai_student_plan p ON p.student_id = u.student_id
                WHERE u.student_id IS NOT NULL GROUP BY u.student_id`).bind(per, per, per, per, per).all();
            const { results: kinds } = await db.prepare(`SELECT student_id, kind, COUNT(*) AS n, COALESCE(SUM(cost_usd), 0) AS usd FROM ai_usage
                WHERE student_id IS NOT NULL AND period = ? GROUP BY student_id, kind`).bind(per).all();
            const topKind = new Map();
            for (const k of (kinds || [])) { const t = topKind.get(k.student_id); if (!t || k.usd > t.usd) topKind.set(k.student_id, { kind: k.kind, usd: k.usd, n: k.n }); }
            const staffUse = await db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(cost_usd), 0) AS usd FROM ai_usage WHERE student_id IS NULL AND period = ?`).bind(per).first();
            // grand totals — everyone (students + Miss Marwa + assistants)
            const day0 = cairoDayStart();
            const G = await db.prepare(`SELECT
                    COALESCE(SUM(CASE WHEN created_at >= ? THEN cost_usd ELSE 0 END), 0) AS d_usd, SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS d_n,
                    COALESCE(SUM(CASE WHEN created_at >= ? AND student_id IS NOT NULL THEN cost_usd ELSE 0 END), 0) AS d_st,
                    COALESCE(SUM(CASE WHEN period = ? THEN cost_usd ELSE 0 END), 0) AS m_usd, SUM(CASE WHEN period = ? THEN 1 ELSE 0 END) AS m_n,
                    COALESCE(SUM(cost_usd), 0) AS a_usd, COUNT(*) AS a_n, COALESCE(SUM(CASE WHEN student_id IS NOT NULL THEN cost_usd ELSE 0 END), 0) AS a_st,
                    MIN(created_at) AS since
                FROM ai_usage`).bind(day0, day0, day0, per, per).first();
            // Claude spend from before this ledger existed (the gateway's monthly meters, kept since Pro was connected)
            const kvAll = await db.prepare(`SELECT COALESCE(SUM(CAST(value AS REAL)), 0) AS usd FROM app_kv WHERE "key" LIKE 'ai_spend_%' AND length("key") = 16`).first();
            const allUsd = Math.max(Number(G && G.a_usd) || 0, Number(kvAll && kvAll.usd) || 0);
            const P = new Map((plans || []).map(p => [p.student_id, p])), U = new Map((use || []).map(u => [u.student_id, u]));
            const trialOn = !!(S.trial && S.trial.budget > 0 && S.trial.phase === 'on');
            const students = (studs || []).map(s => {
                const p = P.get(s.student_id) || {}, u = U.get(s.student_id) || {};
                const budgetEgp = p.budget_egp > 0 ? p.budget_egp : S.budget, usedUsd = Number(u.q_usd) || 0;
                const on = !!p.enabled && !subExpired(p), trialEgp = (Number(u.t_usd) || 0) * S.rate;
                // what the student has to spend RIGHT NOW (28 Nov 2026 — Mahmoud: "how much each student spent and has left"):
                // Pro → their monthly / paid budget; no Pro but the trial is running → the trial credits; otherwise nothing
                const credits = on ? { mode: 'pro', totalEgp: budgetEgp, usedEgp: money(usedUsd * S.rate), leftEgp: money(Math.max(0, budgetEgp - usedUsd * S.rate)) }
                    : trialOn ? { mode: 'trial', totalEgp: S.trial.budget, usedEgp: money(trialEgp), leftEgp: money(Math.max(0, S.trial.budget - trialEgp)) }
                    : { mode: 'off', totalEgp: 0, usedEgp: 0, leftEgp: 0 };
                return {
                    studentId: s.student_id, firstName: s.first_name, lastName: s.last_name, grade: String(s.grade || '').toLowerCase(),
                    enabled: !!p.enabled && !subExpired(p), budgetEgp, customBudget: p.budget_egp > 0, resetAt: p.reset_period === per ? p.reset_at : null,
                    paid: p.paid_until ? { from: p.paid_from, until: p.paid_until, expired: subExpired(p) } : null,
                    month: { messages: Number(u.m_n) || 0, usd: money(u.m_usd), cached: Number(u.m_cached) || 0 },
                    top: topKind.get(s.student_id) ? { kind: topKind.get(s.student_id).kind, usd: money(topKind.get(s.student_id).usd), n: topKind.get(s.student_id).n } : null,
                    quota: { usedUsd: money(usedUsd), usedEgp: money(usedUsd * S.rate), leftEgp: money(Math.max(0, budgetEgp - usedUsd * S.rate)) },
                    trial: { messages: Number(u.t_n) || 0, usd: money(u.t_usd), egp: money((Number(u.t_usd) || 0) * S.rate) },
                    credits, avgEgp: Number(u.all_n) ? money((Number(u.all_usd) || 0) * S.rate / Number(u.all_n)) : null,
                    allTime: { messages: Number(u.all_n) || 0, usd: money(u.all_usd), tokensIn: Number(u.all_in) || 0, tokensOut: Number(u.all_out) || 0 }
                };
            });
            const on = students.filter(s => s.enabled);
            return json({
                settings: S, daily: await dailyDefaults(db), period: per, students,
                totals: {
                    enabled: on.length, studentsUsd: money(students.reduce((t, s) => t + s.month.usd, 0)), staffUsd: money(staffUse && staffUse.usd), staffMessages: Number(staffUse && staffUse.n) || 0,
                    messages: students.reduce((t, s) => t + s.month.messages, 0), cached: students.reduce((t, s) => t + s.month.cached, 0),
                    budgetEgp: money(on.reduce((t, s) => t + s.budgetEgp, 0)),
                    trialStudents: students.filter(s => s.trial.messages > 0).length, trialUsd: money(students.reduce((t, s) => t + s.trial.usd, 0))
                },
                grand: {
                    today: { usd: money(G && G.d_usd), messages: Number(G && G.d_n) || 0, studentsUsd: money(G && G.d_st), staffUsd: money((Number(G && G.d_usd) || 0) - (Number(G && G.d_st) || 0)) },
                    month: { usd: money(G && G.m_usd), messages: Number(G && G.m_n) || 0, studentsUsd: money(students.reduce((t, s) => t + s.month.usd, 0)), staffUsd: money(staffUse && staffUse.usd) },
                    allTime: { usd: money(allUsd), messages: Number(G && G.a_n) || 0, studentsUsd: money(G && G.a_st), staffUsd: money(allUsd - (Number(G && G.a_st) || 0)), since: (G && G.since) || null }
                },
                proOpenForStudents: S.open      // Miss Marwa's switch: until ON, students see "coming soon"
            });
        }
        if (action === 'student') {
            const id = (url.searchParams.get('id') || '').trim();
            if (!await studentExists(id)) return bad('Student not found', 404);
            const { results } = await db.prepare(`SELECT kind, model, input_tokens, output_tokens, cache_read, cache_write, cost_usd, cached, pending, created_at
                FROM ai_usage WHERE student_id = ? ORDER BY id DESC LIMIT 50`).bind(id).all();
            const { results: byKind } = await db.prepare(`SELECT kind, COUNT(*) AS n, COALESCE(SUM(cost_usd), 0) AS usd, COALESCE(SUM(cached), 0) AS cached
                FROM ai_usage WHERE student_id = ? AND period = ? GROUP BY kind ORDER BY usd DESC`).bind(id, per).all();
            const lim = await dailyLimits(db, id);
            return json({ quota: await studentQuota(db, id, S), recent: results || [], byKind: byKind || [], daily: { limits: lim, today: await dailyState(db, id, lim) } });
        }
        if (request.method !== 'POST') return bad('POST only', 405);
        const data = await request.json().catch(() => ({}));
        const who = auth.staff.name || auth.staff.username || String(auth.staff.id);

        if (action === 'set') {
            const id = String(data.studentId || '').trim();
            if (!await studentExists(id)) return bad('Student not found', 404);
            const fields = {};
            if (data.enabled !== undefined) fields.enabled = data.enabled ? 1 : 0;
            if (data.enabled) {   // switching ON by hand someone whose paid 30 days are over → Miss Marwa's decision: back to the normal monthly budget
                const cur = await db.prepare('SELECT paid_from, paid_until FROM ai_student_plan WHERE student_id = ?').bind(id).first();
                if (cur && cur.paid_until && cairoDay() > cur.paid_until) { fields.paid_from = null; fields.paid_until = null; }
            }
            if (data.budgetEgp !== undefined) {
                if (data.budgetEgp === null || data.budgetEgp === '') fields.budget_egp = null;
                else { const b = okAmount(data.budgetEgp); if (b == null) return bad('Budget must be a number above 0'); fields.budget_egp = b; }
            }
            if (!Object.keys(fields).length) return bad('Nothing to change');
            await db.prepare('INSERT OR IGNORE INTO ai_student_plan (student_id) VALUES (?)').bind(id).run();
            const cols = Object.keys(fields);
            await db.prepare(`UPDATE ai_student_plan SET ${cols.map(c => c + ' = ?').join(', ')}, updated_at = CURRENT_TIMESTAMP, updated_by = ? WHERE student_id = ?`)
                .bind(...cols.map(c => fields[c]), who, id).run();
            await audit(db, request, auth.staff, 'ai.student.set', id, fields);
            return json({ ok: true, quota: await studentQuota(db, id, S) });
        }
        if (action === 'bulk') {
            const ids = [...new Set((Array.isArray(data.studentIds) ? data.studentIds : []).map(x => String(x || '').trim()).filter(Boolean))].slice(0, 2000);
            if (!ids.length) return bad('No students chosen');
            const en = data.enabled ? 1 : 0, st = [];
            for (const id of ids) {
                st.push(db.prepare('INSERT OR IGNORE INTO ai_student_plan (student_id) SELECT student_id FROM students WHERE student_id = ?').bind(id));
                st.push(db.prepare('UPDATE ai_student_plan SET enabled = ?, updated_at = CURRENT_TIMESTAMP, updated_by = ? WHERE student_id = ?').bind(en, who, id));
            }
            await db.batch(st);
            await audit(db, request, auth.staff, 'ai.student.bulk', null, { enabled: en, count: ids.length, students: ids });
            return json({ ok: true, count: ids.length });
        }
        if (action === 'reset') {
            const id = String(data.studentId || '').trim();
            if (!await studentExists(id)) return bad('Student not found', 404);
            const before = await studentQuota(db, id, S);
            await db.prepare('INSERT OR IGNORE INTO ai_student_plan (student_id) VALUES (?)').bind(id).run();
            await db.prepare(`UPDATE ai_student_plan SET reset_at = strftime('%Y-%m-%d %H:%M:%f', 'now'), reset_period = ?, updated_at = CURRENT_TIMESTAMP, updated_by = ? WHERE student_id = ?`).bind(per, who, id).run();
            await audit(db, request, auth.staff, 'ai.student.reset', id, { usedEgpBefore: money(before.usedEgp), period: per });
            return json({ ok: true, quota: await studentQuota(db, id, S) });
        }
        if (action === 'daily') {
            const id = String(data.studentId || '').trim();
            if (!await studentExists(id)) return bad('Student not found', 404);
            let own = null;
            if (data.daily) {
                const g = (v) => { const n = Math.floor(Number(v)); return Number.isFinite(n) && n >= 0 && n <= 200 ? n : null; };
                own = { images: g(data.daily.images), pdfIn: g(data.daily.pdfIn), pdfOut: g(data.daily.pdfOut) };
                if (Object.values(own).some(v => v == null)) return bad('Each daily number must be between 0 and 200');
            }
            await saveStudentDaily(db, id, own);
            await audit(db, request, auth.staff, 'ai.student.daily', id, { daily: own });
            const lim = await dailyLimits(db, id);
            return json({ ok: true, daily: { limits: lim, today: await dailyState(db, id, lim) } });
        }
        if (action === 'settings') {
            const next = {};
            if (data.rate !== undefined) { const r = okAmount(data.rate); if (r == null || r > 1000) return bad('The EGP rate must be between 1 and 1000'); next.rate = r; }
            if (data.budget !== undefined) { const b = okAmount(data.budget); if (b == null) return bad('The default budget must be a number above 0'); next.budget = b; }
            if (data.open !== undefined) next.open = !!data.open;
            if (data.freeOpen !== undefined) next.freeOpen = !!data.freeOpen;
            if (data.price !== undefined) { const v = okAmount(data.price); if (v == null || v > 5000) return bad('The price must be a number above 0'); next.price = v; }
            if (data.wallet !== undefined) { const w = String(data.wallet || '').replace(/\D/g, ''); if (!/^01[0125]\d{8}$/.test(w)) return bad('The wallet must be an Egyptian mobile number (11 digits)'); next.wallet = w; }
            if (data.rateAuto !== undefined) next.rateAuto = !!data.rateAuto;
            if (data.rateBuffer !== undefined) { const v = Number(data.rateBuffer); if (!(v >= 0 && v <= 30)) return bad('The safety margin must be between 0 and 30 %'); next.rateBuffer = v; }
            if (data.trial) {
                const day = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : null;
                const t = { start: day(data.trial.start) || S.trial.start, end: day(data.trial.end) || S.trial.end, budget: data.trial.budget === undefined || data.trial.budget === '' ? S.trial.budget : Number(data.trial.budget) };
                if (!(t.budget >= 0 && t.budget <= 500)) return bad('Trial credits must be between 0 and 500 EGP');
                if (t.end < t.start) return bad('The trial must end on or after its first day');
                next.trial = t;
            }
            if (data.daily) {
                const g = (v) => { const n = Math.floor(Number(v)); return Number.isFinite(n) && n >= 0 && n <= 200 ? n : null; };
                const dl = { images: g(data.daily.images), pdfIn: g(data.daily.pdfIn), pdfOut: g(data.daily.pdfOut) };
                if (Object.values(dl).some(v => v == null)) return bad('Each daily number must be between 0 and 200');
                next.daily = dl;
            }
            if (!Object.keys(next).length) return bad('Nothing to change');
            await saveQuotaSettings(db, next);
            await audit(db, request, auth.staff, 'ai.settings', null, { before: S, after: { ...S, ...next } });
            if (next.rateAuto && !S.rateAuto) await refreshRate(db, { force: true });   // turned automatic on → today's rate right away
            return json({ ok: true, settings: await quotaSettings(db) });
        }
        if (action === 'rate-now') {
            const r = await refreshRate(db, { force: true });
            await audit(db, request, auth.staff, 'ai.rate-now', null, { before: S.rate, result: r });
            if (!r.ok) return bad("Couldn't get today's rate: " + (r.error || 'no source answered') + ' — the old rate stays.', 502);
            return json({ ok: true, result: r, settings: await quotaSettings(db) });
        }
        return bad('Unknown action', 404);
    } catch (err) {
        console.error('ai-usage error', err);
        return bad('Something went wrong — try again', 500);
    }
}
