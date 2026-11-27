// =====================================================================
// Assistant Pro — usage ledger + per-student budget (set by the user 19 Nov 2026).
//
//   • Every paid (Claude) call is written to ai_usage: who, what, tokens, exact cost in USD.
//   • Students: Pro works only when Miss Marwa switches it ON for that student (they paid 50 EGP / month).
//     Their AI cost per month (Cairo calendar month) can NEVER pass their budget — default 44 EGP
//     (what's left of the 50 EGP after the discount), editable per student and as a default.
//   • Hard guarantee, even with two messages at the same moment: before the call, ONE SQL statement
//     reserves the worst-case cost of that call only if it still fits in the budget (SQLite runs a
//     single statement atomically). After the call the reservation becomes the real cost; if the call
//     fails, the reservation is removed.
//   • Staff (Miss Marwa + assistants): logged for the usage page only — no personal limit at all.
//   • Answers served from the shared cache (later phases) are logged with cost 0.
// =====================================================================

export const RATE_DEFAULT = 53;      // EGP per 1 USD (editable on the AI usage page)
export const BUDGET_DEFAULT = 65;    // EGP of AI cost per student per month (22 Nov: price 75 EGP, stop at 65 — Miss Marwa can change it per student)
const PRICES = { 'claude-haiku-5-5': [0.10, 0.50], 'claude-sonnet-5-5': [2, 10] };   // USD per 1M tokens [in, out]
const priceOf = (model) => PRICES[model] || PRICES['claude-sonnet-5-5'];           // unknown → the expensive price (safe side)

/** Calendar month in Cairo, e.g. "2026-11" — budgets restart on the 1st. */
export function period(now = new Date()) {
    const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit' }).formatToParts(now);
    return `${p.find(x => x.type === 'year').value}-${p.find(x => x.type === 'month').value}`;
}

const readyDbs = new WeakSet();
export async function ensureQuotaTables(db) {
    if (readyDbs.has(db)) return;
    await db.batch([
        db.prepare(`CREATE TABLE IF NOT EXISTS ai_usage (id INTEGER PRIMARY KEY AUTOINCREMENT, student_id TEXT, staff_id INTEGER,
            kind TEXT, model TEXT, period TEXT NOT NULL, input_tokens INTEGER DEFAULT 0, output_tokens INTEGER DEFAULT 0,
            cache_read INTEGER DEFAULT 0, cache_write INTEGER DEFAULT 0, cost_usd REAL NOT NULL DEFAULT 0, cached INTEGER DEFAULT 0,
            pending INTEGER DEFAULT 0, created_at TEXT DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')))`),   // ms precision: a budget restart splits the same second correctly
        db.prepare('CREATE INDEX IF NOT EXISTS idx_ai_usage_student ON ai_usage(student_id, period)'),
        db.prepare('CREATE INDEX IF NOT EXISTS idx_ai_usage_period ON ai_usage(period)'),
        db.prepare(`CREATE TABLE IF NOT EXISTS ai_student_plan (student_id TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 0,
            budget_egp REAL, reset_at TEXT, reset_period TEXT, updated_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_by TEXT)`),
        db.prepare(`CREATE TABLE IF NOT EXISTS ai_daily_use (student_id TEXT NOT NULL, day TEXT NOT NULL, images INTEGER NOT NULL DEFAULT 0,
            pdf_in INTEGER NOT NULL DEFAULT 0, pdf_out INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (student_id, day))`),
        db.prepare(`CREATE TABLE IF NOT EXISTS app_kv ("key" TEXT PRIMARY KEY, value TEXT, updated_at TEXT DEFAULT CURRENT_TIMESTAMP)`)
    ]);
    // 27 Nov 2026 — trial calls are marked trial = 1, so they never count against a subscriber's monthly budget
    try { await db.prepare('ALTER TABLE ai_usage ADD COLUMN trial INTEGER NOT NULL DEFAULT 0').run(); } catch (e) { /* already there */ }
    readyDbs.add(db);
}

const posNum = (v, d) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : d; };
// ---------- launch trial (27 Nov 2026, Mahmoud): students WITHOUT a subscription can use Pro from Saturday 28 Nov to
//   Thursday 3 Dec (Cairo days, both included), up to 15 EGP of AI cost each ("15 credits", 1 credit = 1 EGP) — kept apart
//   from the 65 EGP monthly budget of subscribers. No daily message limit; when the credits or the days run out → subscribe.
export const TRIAL_DEFAULT = { start: '2026-11-28', end: '2026-12-03', budget: 15 };
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const dayIn = (v, d) => DAY_RE.test(String(v || '')) ? String(v) : d;
/** 'before' | 'on' | 'after' — by Cairo calendar day */
export function trialPhase(T, now = new Date()) { const d = cairoDay(now); return d < T.start ? 'before' : d > T.end ? 'after' : 'on'; }

/** { rate, budget, open, freeOpen, trial } — EGP per USD, the default budget per student (EGP), whether Pro is open to
 *  students at all (Miss Marwa's own switch on the AI usage page), whether the free Mini Assistant is open (her switch,
 *  or the Cloudflare variable TUTOR_OPEN = 1), and the launch trial { start, end, budget, phase }. */
export async function quotaSettings(db) {
    const { results } = await db.prepare(`SELECT "key", value FROM app_kv WHERE "key" IN ('aiq_rate', 'aiq_budget', 'aiq_open', 'aiq_free_open', 'aiq_trial_start', 'aiq_trial_end', 'aiq_trial_budget')`).all();
    const m = Object.fromEntries((results || []).map(r => [r.key, r.value]));
    const trial = { start: dayIn(m.aiq_trial_start, TRIAL_DEFAULT.start), end: dayIn(m.aiq_trial_end, TRIAL_DEFAULT.end), budget: m.aiq_trial_budget === '0' ? 0 : posNum(m.aiq_trial_budget, TRIAL_DEFAULT.budget) };
    trial.phase = trial.budget > 0 ? trialPhase(trial) : 'off';
    return { rate: posNum(m.aiq_rate, RATE_DEFAULT), budget: posNum(m.aiq_budget, BUDGET_DEFAULT), open: m.aiq_open === '1', freeOpen: m.aiq_free_open === '1', trial };
}
export async function saveQuotaSettings(db, { rate, budget, open, freeOpen, trial, daily }) {
    const st = [];
    const put = (k, v) => db.prepare(`INSERT INTO app_kv ("key", value) VALUES (?, ?) ON CONFLICT("key") DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`).bind(k, String(v));
    if (rate !== undefined) st.push(put('aiq_rate', rate));
    if (budget !== undefined) st.push(put('aiq_budget', budget));
    if (open !== undefined) st.push(put('aiq_open', open ? '1' : '0'));
    if (freeOpen !== undefined) st.push(put('aiq_free_open', freeOpen ? '1' : '0'));
    if (trial) {
        if (trial.start !== undefined && DAY_RE.test(String(trial.start))) st.push(put('aiq_trial_start', trial.start));
        if (trial.end !== undefined && DAY_RE.test(String(trial.end))) st.push(put('aiq_trial_end', trial.end));
        if (trial.budget !== undefined && Number(trial.budget) >= 0 && Number(trial.budget) <= 500) st.push(put('aiq_trial_budget', Number(trial.budget)));
    }
    if (daily) { st.push(put('aiq_d_images', daily.images)); st.push(put('aiq_d_pdfin', daily.pdfIn)); st.push(put('aiq_d_pdfout', daily.pdfOut)); }
    if (st.length) await db.batch(st);
}

// ---------- daily file allowance (22 Nov 2026, Miss Marwa): messages are NOT limited per day — only photos and PDFs ----------
//   images = photos sent · pdfIn = PDFs the student uploads · pdfOut = PDFs the assistant makes (solutions / exams — the costly ones)
export const DAILY_DEFAULT = { images: 5, pdfIn: 3, pdfOut: 2 };
const DAILY_COL = { images: 'images', pdfIn: 'pdf_in', pdfOut: 'pdf_out' };
const intIn = (v, d) => { const n = Math.floor(Number(v)); return Number.isFinite(n) && n >= 0 && n <= 200 ? n : d; };
/** Cairo calendar day, e.g. "2026-11-22" */
export function cairoDay(now = new Date()) { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now); }
/** The default daily allowance (editable on the AI usage page) */
export async function dailyDefaults(db) {
    const { results } = await db.prepare(`SELECT "key", value FROM app_kv WHERE "key" IN ('aiq_d_images', 'aiq_d_pdfin', 'aiq_d_pdfout')`).all();
    const m = Object.fromEntries((results || []).map(r => [r.key, r.value]));
    return { images: intIn(m.aiq_d_images, DAILY_DEFAULT.images), pdfIn: intIn(m.aiq_d_pdfin, DAILY_DEFAULT.pdfIn), pdfOut: intIn(m.aiq_d_pdfout, DAILY_DEFAULT.pdfOut) };
}
/** One student's allowance: the default, or Miss Marwa's own numbers for them (app_kv aiq_dx_<id>) */
export async function dailyLimits(db, studentId, defaults = null) {
    const d = defaults || await dailyDefaults(db);
    const row = await db.prepare('SELECT value FROM app_kv WHERE "key" = ?').bind('aiq_dx_' + studentId).first();
    let own = null; try { own = row && row.value ? JSON.parse(row.value) : null; } catch (e) { own = null; }
    return own ? { images: intIn(own.images, d.images), pdfIn: intIn(own.pdfIn, d.pdfIn), pdfOut: intIn(own.pdfOut, d.pdfOut), custom: true } : { ...d, custom: false };
}
export async function saveStudentDaily(db, studentId, own) {
    if (!own) { await db.prepare('DELETE FROM app_kv WHERE "key" = ?').bind('aiq_dx_' + studentId).run(); return; }
    const v = JSON.stringify({ images: intIn(own.images, DAILY_DEFAULT.images), pdfIn: intIn(own.pdfIn, DAILY_DEFAULT.pdfIn), pdfOut: intIn(own.pdfOut, DAILY_DEFAULT.pdfOut) });
    await db.prepare(`INSERT INTO app_kv ("key", value) VALUES (?, ?) ON CONFLICT("key") DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`).bind('aiq_dx_' + studentId, v).run();
}
/** Today's use + the allowance → { images:{used,max}, pdfIn:{…}, pdfOut:{…} } */
export async function dailyState(db, studentId, limits = null) {
    await ensureQuotaTables(db);
    const L = limits || await dailyLimits(db, studentId);
    const r = await db.prepare('SELECT images, pdf_in, pdf_out FROM ai_daily_use WHERE student_id = ? AND day = ?').bind(studentId, cairoDay()).first();
    return { images: { used: Number(r && r.images) || 0, max: L.images }, pdfIn: { used: Number(r && r.pdf_in) || 0, max: L.pdfIn }, pdfOut: { used: Number(r && r.pdf_out) || 0, max: L.pdfOut } };
}
/** Take one of today's allowance — atomic (two sends at the same moment can't both pass the last slot). → true / false */
export async function claimDaily(db, studentId, what, max) {
    const col = DAILY_COL[what]; if (!col) return false;
    await ensureQuotaTables(db);
    const day = cairoDay();
    await db.prepare('INSERT OR IGNORE INTO ai_daily_use (student_id, day) VALUES (?, ?)').bind(studentId, day).run();
    const r = await db.prepare(`UPDATE ai_daily_use SET ${col} = ${col} + 1 WHERE student_id = ? AND day = ? AND ${col} < ?`).bind(studentId, day, max).run();
    return !!(r.meta && r.meta.changes);
}
/** The send failed → give the slot back (the student lost nothing) */
export async function releaseDaily(db, studentId, what) {
    const col = DAILY_COL[what]; if (!col) return;
    try { await db.prepare(`UPDATE ai_daily_use SET ${col} = ${col} - 1 WHERE student_id = ? AND day = ? AND ${col} > 0`).bind(studentId, cairoDay()).run(); } catch (e) { /* harmless */ }
}

// What counts this month: rows of this period, after the last reset (a reset only counts in the month it was made)
const since = (plan, per) => (plan && plan.reset_period === per && plan.reset_at) || '';

/** One student's quota right now. */
export async function studentQuota(db, studentId, S = null) {
    await ensureQuotaTables(db);
    S = S || await quotaSettings(db);
    const per = period();
    const plan = await db.prepare('SELECT * FROM ai_student_plan WHERE student_id = ?').bind(studentId).first();
    const u = await db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(cost_usd), 0) AS usd FROM ai_usage WHERE student_id = ? AND period = ? AND created_at >= ? AND trial = 0`)
        .bind(studentId, per, since(plan, per)).first();
    const budgetEgp = plan && plan.budget_egp > 0 ? plan.budget_egp : S.budget;
    const usedUsd = Number(u && u.usd) || 0, budgetUsd = budgetEgp / S.rate;
    const enabled = !!(plan && plan.enabled);
    // the launch trial: everything this student spent with trial = 1 (any month)
    const T = S.trial, t = await db.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(cost_usd), 0) AS usd FROM ai_usage WHERE student_id = ? AND trial = 1').bind(studentId).first();
    const tUsed = Number(t && t.usd) || 0, tBudget = T.budget / S.rate;
    const trial = { phase: T.phase, start: T.start, end: T.end, budgetEgp: T.budget, budgetUsd: tBudget, usedUsd: tUsed, usedEgp: tUsed * S.rate,
        leftUsd: Math.max(0, tBudget - tUsed), leftEgp: Math.max(0, (tBudget - tUsed) * S.rate), messages: Number(t && t.n) || 0 };
    // what the student is using right now: their subscription, the trial, or nothing
    const mode = enabled ? 'plan' : T.phase === 'on' ? 'trial' : 'none';
    return {
        studentId, period: per, enabled, customBudget: !!(plan && plan.budget_egp > 0),
        budgetEgp, budgetUsd, usedUsd, usedEgp: usedUsd * S.rate, leftUsd: Math.max(0, budgetUsd - usedUsd), leftEgp: Math.max(0, (budgetUsd - usedUsd) * S.rate),
        messages: Number(u && u.n) || 0, rate: S.rate, trial, mode,
        active: mode === 'plan' ? { mode, budgetEgp, usedEgp: usedUsd * S.rate, leftEgp: Math.max(0, (budgetUsd - usedUsd) * S.rate), budgetUsd, leftUsd: Math.max(0, budgetUsd - usedUsd) }
            : mode === 'trial' ? { mode, budgetEgp: T.budget, usedEgp: trial.usedEgp, leftEgp: trial.leftEgp, budgetUsd: tBudget, leftUsd: trial.leftUsd, ends: T.end }
            : null
    };
}

/** Worst-case cost of one call — what gets reserved before it runs. */
export function worstCaseUsd(model, { chars = 0, images = 0, maxTokens = 1200 } = {}) {
    let [pin, pout] = priceOf(model);
    const inTok = Math.ceil(chars / 2.5) + images * 4000 + 500;     // Arabic ≈ 2–3 chars a token (Haiku 5.5 counts ~30% more than 4.5); +500 margin
    if (inTok > 90000) { pin *= 5; pout *= 5; }                      // Haiku 5.5 long-prompt prices (over 100k tokens)
    return (inTok * pin * 1.25 + maxTokens * pout) / 1e6;            // ×1.25 = even if all of it is written to the prompt cache
}

/**
 * Can this student use Pro right now?  → { ok, code?, message?, quota }
 * code: PRO_CLOSED (not opened to students yet) | STUDENT_OFF (not switched on for them) | STUDENT_CAP (month used up)
 *       | TRIAL_CAP (no subscription, trial credits used up) | TRIAL_OVER (no subscription, the trial days are over)
 */
export async function studentAccess(db, studentId) {
    const S = await quotaSettings(db), q = await studentQuota(db, studentId, S);
    if (!S.open) return { ok: false, code: 'PRO_CLOSED', quota: q };
    if (q.mode === 'plan') return q.leftUsd <= 0.0005 ? { ok: false, code: 'STUDENT_CAP', quota: q } : { ok: true, quota: q };
    if (q.mode === 'trial') return q.trial.leftUsd <= 0.0005 ? { ok: false, code: 'TRIAL_CAP', quota: q } : { ok: true, quota: q };
    return { ok: false, code: S.trial.phase === 'after' ? 'TRIAL_OVER' : 'STUDENT_OFF', quota: q };
}

/** Thrown when a student can't use Pro right now. */
export class QuotaError extends Error { constructor(code, message, quota) { super(message); this.code = code; this.quota = quota; } }

/**
 * Reserve a student's call. Returns the ledger row id (pass it to settle/release).
 * Throws QuotaError STUDENT_OFF (not switched on) or STUDENT_CAP (this call doesn't fit in what's left).
 */
export async function reserve(db, { studentId, model, kind = 'chat', usd }) {
    await ensureQuotaTables(db);
    const S = await quotaSettings(db), per = period();
    const plan = await db.prepare('SELECT * FROM ai_student_plan WHERE student_id = ?').bind(studentId).first();
    if (!plan || !plan.enabled) {
        // no subscription → the launch trial, while its days last: its own 15-credit budget (trial = 1 rows only)
        if (S.trial.phase !== 'on') throw new QuotaError(S.trial.phase === 'after' ? 'TRIAL_OVER' : 'STUDENT_OFF', 'Assistant Pro is not switched on for this student.', await studentQuota(db, studentId, S));
        const t = await db.prepare(`INSERT INTO ai_usage (student_id, kind, model, period, cost_usd, pending, trial)
            SELECT ?, ?, ?, ?, ?, 1, 1 WHERE (SELECT COALESCE(SUM(cost_usd), 0) FROM ai_usage WHERE student_id = ? AND trial = 1) + ? <= ?`)
            .bind(studentId, kind, model, per, usd, studentId, usd, S.trial.budget / S.rate).run();
        if (!t.meta || !t.meta.changes) throw new QuotaError('TRIAL_CAP', 'The trial credits are used up.', await studentQuota(db, studentId, S));
        return Number(t.meta.last_row_id);
    }
    const budgetUsd = (plan.budget_egp > 0 ? plan.budget_egp : S.budget) / S.rate;
    // check + reserve in ONE statement → two messages at the same moment can't both slip past the budget
    const r = await db.prepare(`INSERT INTO ai_usage (student_id, kind, model, period, cost_usd, pending)
        SELECT ?, ?, ?, ?, ?, 1 WHERE (SELECT COALESCE(SUM(cost_usd), 0) FROM ai_usage WHERE student_id = ? AND period = ? AND created_at >= ? AND trial = 0) + ? <= ?`)
        .bind(studentId, kind, model, per, usd, studentId, per, since(plan, per), usd, budgetUsd).run();
    if (!r.meta || !r.meta.changes) throw new QuotaError('STUDENT_CAP', 'This month\'s Assistant Pro budget is used up.', await studentQuota(db, studentId, S));
    return Number(r.meta.last_row_id);
}
/** The call answered → the reservation becomes the real cost and tokens. */
export async function settle(db, id, { usage = {}, costUsd = 0, model } = {}) {
    if (!id) return;
    await db.prepare(`UPDATE ai_usage SET cost_usd = ?, input_tokens = ?, output_tokens = ?, cache_read = ?, cache_write = ?, model = COALESCE(?, model), pending = 0 WHERE id = ?`)
        .bind(costUsd, usage.input_tokens || 0, usage.output_tokens || 0, usage.cache_read_input_tokens || 0, usage.cache_creation_input_tokens || 0, model || null, id).run();
}
/** The call failed → nothing was spent, give the reservation back. */
export async function release(db, id) {
    if (!id) return;
    try { await db.prepare('DELETE FROM ai_usage WHERE id = ? AND pending = 1').bind(id).run(); } catch (e) { /* the stale row only blocks a few cents until next month */ }
}
/** Staff call, or any call already paid → just write it down. Never blocks. */
export async function logUsage(db, { studentId = null, staffId = null, kind = 'chat', model = null, usage = {}, costUsd = 0, cached = false }) {
    try {
        await ensureQuotaTables(db);
        await db.prepare(`INSERT INTO ai_usage (student_id, staff_id, kind, model, period, input_tokens, output_tokens, cache_read, cache_write, cost_usd, cached)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(studentId, staffId, kind, model, period(), usage.input_tokens || 0, usage.output_tokens || 0,
            usage.cache_read_input_tokens || 0, usage.cache_creation_input_tokens || 0, costUsd, cached ? 1 : 0).run();
    } catch (e) { /* the meter must never break an answer */ }
}

// shared module — not a page
export async function onRequest() { return new Response('Not found', { status: 404 }); }
