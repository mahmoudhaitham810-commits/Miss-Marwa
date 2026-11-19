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
export const BUDGET_DEFAULT = 44;    // EGP of AI cost per student per month
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
        db.prepare(`CREATE TABLE IF NOT EXISTS app_kv ("key" TEXT PRIMARY KEY, value TEXT, updated_at TEXT DEFAULT CURRENT_TIMESTAMP)`)
    ]);
    readyDbs.add(db);
}

const posNum = (v, d) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : d; };
/** { rate, budget } — EGP per USD and the default budget per student (EGP). */
export async function quotaSettings(db) {
    const { results } = await db.prepare(`SELECT "key", value FROM app_kv WHERE "key" IN ('aiq_rate', 'aiq_budget')`).all();
    const m = Object.fromEntries((results || []).map(r => [r.key, r.value]));
    return { rate: posNum(m.aiq_rate, RATE_DEFAULT), budget: posNum(m.aiq_budget, BUDGET_DEFAULT) };
}
export async function saveQuotaSettings(db, { rate, budget }) {
    const st = [];
    const put = (k, v) => db.prepare(`INSERT INTO app_kv ("key", value) VALUES (?, ?) ON CONFLICT("key") DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`).bind(k, String(v));
    if (rate !== undefined) st.push(put('aiq_rate', rate));
    if (budget !== undefined) st.push(put('aiq_budget', budget));
    if (st.length) await db.batch(st);
}

// What counts this month: rows of this period, after the last reset (a reset only counts in the month it was made)
const since = (plan, per) => (plan && plan.reset_period === per && plan.reset_at) || '';

/** One student's quota right now. */
export async function studentQuota(db, studentId, S = null) {
    await ensureQuotaTables(db);
    S = S || await quotaSettings(db);
    const per = period();
    const plan = await db.prepare('SELECT * FROM ai_student_plan WHERE student_id = ?').bind(studentId).first();
    const u = await db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(cost_usd), 0) AS usd FROM ai_usage WHERE student_id = ? AND period = ? AND created_at >= ?`)
        .bind(studentId, per, since(plan, per)).first();
    const budgetEgp = plan && plan.budget_egp > 0 ? plan.budget_egp : S.budget;
    const usedUsd = Number(u && u.usd) || 0, budgetUsd = budgetEgp / S.rate;
    return {
        studentId, period: per, enabled: !!(plan && plan.enabled), customBudget: !!(plan && plan.budget_egp > 0),
        budgetEgp, budgetUsd, usedUsd, usedEgp: usedUsd * S.rate, leftUsd: Math.max(0, budgetUsd - usedUsd), leftEgp: Math.max(0, (budgetUsd - usedUsd) * S.rate),
        messages: Number(u && u.n) || 0, rate: S.rate
    };
}

/** Worst-case cost of one call — what gets reserved before it runs. */
export function worstCaseUsd(model, { chars = 0, images = 0, maxTokens = 1200 } = {}) {
    const [pin, pout] = priceOf(model);
    const inTok = Math.ceil(chars / 2.5) + images * 2500 + 500;     // Arabic ≈ 2–3 chars a token; +500 margin
    return (inTok * pin * 1.25 + maxTokens * pout) / 1e6;            // ×1.25 = even if all of it is written to the prompt cache
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
    if (!plan || !plan.enabled) throw new QuotaError('STUDENT_OFF', 'Assistant Pro is not switched on for this student.', await studentQuota(db, studentId, S));
    const budgetUsd = (plan.budget_egp > 0 ? plan.budget_egp : S.budget) / S.rate;
    // check + reserve in ONE statement → two messages at the same moment can't both slip past the budget
    const r = await db.prepare(`INSERT INTO ai_usage (student_id, kind, model, period, cost_usd, pending)
        SELECT ?, ?, ?, ?, ?, 1 WHERE (SELECT COALESCE(SUM(cost_usd), 0) FROM ai_usage WHERE student_id = ? AND period = ? AND created_at >= ?) + ? <= ?`)
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
