// =====================================================================
// AI layer — one way to talk to every model the platform uses.
//
//   tier 'free' → Cloudflare Workers AI, paid for by the FREE daily allowance only.
//                 The 10,000 free units/day are split into pools (set by the user 17 Nov 2026):
//                   staff   (Miss Marwa's AI Assistant) AI_POOL_STAFF   default   500 guaranteed
//                   student (Mini Assistant for students) AI_POOL_STUDENT default 9,500
//                 Flexible sharing — "released leftover": units the students are not expected to need any more today.
//                   reserve(now) = student pool × (hours left until the 2:00 am reset ÷ 24)
//                   leftover     = students' units still left − reserve(now)        (grows as the day goes on)
//                 • Miss Marwa past her 500 → borrows from that leftover (charged to the students' pool too).
//                 • A student past their personal daily messages → "bonus" messages only from that leftover.
//                 Nothing can ever go past the pools; when they're empty everything stops cleanly (no paid overage, ever).
//   tier 'pro' → Claude Haiku   (env CLAUDE_FAST_MODEL, default claude-haiku-5-5)
//   (Pro Max / Claude Sonnet was dropped on 17 Nov 2026 — too expensive; all effort goes into Pro)
//                 Needs the Cloudflare secret ANTHROPIC_API_KEY. Every call's cost is
//                 metered; daily / monthly caps (AI_DAILY_USD default 1, AI_MONTHLY_USD
//                 default 15) stop paid calls before they overspend.
//
// Callers never see provider names — screens use the branded names below.
// =====================================================================
import { aiReady, addUsage, estimateNeurons, markQuotaHit, quotaHitToday, textOf, usageToday, DAILY_FREE_NEURONS } from './ai-engine.js';

export const BRANDS = {
    free: { name: 'Mini Assistant', note: 'Free', ar: 'مجاني' },
    pro: { name: 'Miss Marwa Assistant Pro', note: 'Science, exams & summaries', ar: 'ذكي' }
};
const FREE_MODEL = '@cf/meta/llama-4-scout-17b-16e-instruct';          // photos (it can see) + backup for text
// Text questions go to the strongest free text model (17 Nov 2026): OpenAI gpt-oss-120b — much better at
// science reasoning than Llama 4 Scout / Llama 3.3 70B. Set FREE_TEXT_MODEL to change it (or to the Scout id to switch back).
// If it fails or answers empty, the same question goes to Scout; after 3 failures in a day it is skipped until tomorrow.
const FREE_TEXT_MODEL = '@cf/openai/gpt-oss-120b';
export const freeTextModel = (env) => (env && env.FREE_TEXT_MODEL) || FREE_TEXT_MODEL;
const isOss = (m) => /gpt-oss/i.test(m || '');
// Text out of any Workers AI reply shape (chat-completions, Responses API, classic { response })
export function replyText(res) {
    if (res == null) return '';
    if (typeof res === 'string') return res;
    if (typeof res.response === 'string') return res.response;
    if (res.result && typeof res.result === 'object') return replyText(res.result);
    const c = Array.isArray(res.choices) && res.choices[0];
    if (c) { const m = c.message || {}; if (typeof m.content === 'string') return m.content; if (Array.isArray(m.content)) return m.content.map(x => x && (x.text || '')).join(''); if (typeof c.text === 'string') return c.text; }
    if (typeof res.output_text === 'string') return res.output_text;
    if (Array.isArray(res.output)) return res.output.filter(o => o && o.type === 'message').flatMap(o => o.content || []).filter(x => x && /text/.test(x.type || 'text')).map(x => x.text || '').join('');
    return '';
}
// gpt-oss sometimes leaks its channel markers — keep only the final message
const cleanOss = (t) => { let s = String(t || ''); if (/<\|(channel|message|start|end|return)\|>/.test(s)) { const i = s.lastIndexOf('<|message|>'); if (i >= 0) s = s.slice(i + 11); s = s.replace(/<\|[a-z_]+\|>/g, ''); } return s.trim(); };
// USD per 1M tokens [input, output] — Anthropic pricing page, checked 16 Nov 2026
const CLAUDE_PRICES = {
    'claude-haiku-5-5': [0.10, 0.50],
    'claude-sonnet-5-5': [2, 10]
};
const POOL_DEFAULTS = { staff: 500, student: 9500 };    // set by the user 17 Nov 2026 (was 1,500 / 8,500, before that 4,000 / 6,000)
// Fraction of the day still to come before the free allowance resets (00:00 UTC = 2:00 am Cairo)
export const dayLeft = (now = new Date()) => { const n = new Date(now); const reset = Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate() + 1); return Math.max(0, Math.min(1, (reset - n.getTime()) / 86400000)); };
/** The students' pool right now: { cap, used (students + borrowed by staff), left, reserve, leftover } */
export async function studentPool(env, db, now = new Date()) {
    const cap = poolCap(env, 'student');
    const used = await kvNum(db, `ai_pool_student_${day()}`) + await kvNum(db, `ai_pool_borrow_${day()}`);
    const left = Math.max(0, cap - used), reserve = Math.round(cap * dayLeft(now));
    return { cap, used: Math.round(used), left: Math.round(left), reserve, leftover: Math.max(0, Math.round(left - reserve)) };
}
/** Can a student's bonus message (past their personal daily number) run now? */
export async function bonusOpen(env, db, guess = 150) { return (await studentPool(env, db)).leftover >= guess; }

export class AiLimitError extends Error {
    constructor(code, message, extra = {}) { super(message); this.code = code; Object.assign(this, extra); }
}

const day = () => new Date().toISOString().slice(0, 10);
const month = () => new Date().toISOString().slice(0, 7);
const num = (v, d) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : d; };
export const poolCap = (env, pool) => num(env && env[pool === 'student' ? 'AI_POOL_STUDENT' : 'AI_POOL_STAFF'], POOL_DEFAULTS[pool] || 0);
export const dailyUsdCap = (env) => num(env && env.AI_DAILY_USD, 1);
export const monthlyUsdCap = (env) => num(env && env.AI_MONTHLY_USD, 15);
export const claudeReady = (env) => !!(env && env.ANTHROPIC_API_KEY);
export const modelFor = (env, tier) => tier === 'pro' ? (env.CLAUDE_FAST_MODEL || 'claude-haiku-5-5') : (env.COPILOT_FREE_MODEL || FREE_MODEL);

async function kvNum(db, key) {
    try { const r = await db.prepare(`SELECT value FROM app_kv WHERE "key" = ?`).bind(key).first(); return r ? Number(r.value) || 0 : 0; } catch (e) { return 0; }
}
async function kvAdd(db, key, amount) {
    if (!(amount > 0)) return;
    try {
        await db.prepare(`INSERT INTO app_kv ("key", value) VALUES (?, ?) ON CONFLICT("key") DO UPDATE SET value = CAST(CAST(value AS REAL) + CAST(excluded.value AS REAL) AS TEXT), updated_at = CURRENT_TIMESTAMP`).bind(key, String(amount)).run();
    } catch (e) { /* meter only */ }
}
export const claudeCost = (model, usage) => {
    const [pin, pout] = CLAUDE_PRICES[model] || CLAUDE_PRICES['claude-sonnet-5-5'];   // unknown model → priced like the expensive one (safe side)
    const tin = (usage.input_tokens || 0) + (usage.cache_creation_input_tokens || 0) * 1.25 + (usage.cache_read_input_tokens || 0) * 0.1;
    return (tin * pin + (usage.output_tokens || 0) * pout) / 1e6;
};

/** Today's / this month's meters (for the usage bar and Settings). */
export async function usageSummary(env, db) {
    const pools = {};
    for (const p of Object.keys(POOL_DEFAULTS)) pools[p] = { used: Math.round(await kvNum(db, `ai_pool_${p}_${day()}`)), cap: poolCap(env, p) };
    const SP = await studentPool(env, db);
    pools.staff.borrowed = Math.round(await kvNum(db, `ai_pool_borrow_${day()}`));
    pools.staff.extra = SP.leftover;                 // what she can borrow right now
    pools.student = { ...pools.student, ...SP };
    return {
        pools, freeQuotaHit: await quotaHitToday(db), freeReady: aiReady(env), paidReady: claudeReady(env),
        spend: { today: await kvNum(db, `ai_spend_${day()}`), month: await kvNum(db, `ai_spend_${month()}`), dailyCap: dailyUsdCap(env), monthlyCap: monthlyUsdCap(env) },
        brands: BRANDS, resetsAt: new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate() + 1)).toISOString()
    };
}

// [{role, content}] → strictly alternating user/assistant turns that start with the user
function tidyTurns(messages) {
    const out = [];
    for (const m of messages || []) {
        const role = m.role === 'assistant' ? 'assistant' : 'user';
        const content = String(m.content ?? '').trim(); if (!content) continue;
        if (out.length && out[out.length - 1].role === role) out[out.length - 1].content += '\n\n' + content;
        else out.push({ role, content });
    }
    while (out.length && out[0].role !== 'user') out.shift();
    return out;
}

/**
 * chat(env, db, { tier, pool, system, messages, maxTokens, temperature })
 * → { text, tier, brand, model, ms, neurons?, costUsd?, usage }
 * Throws AiLimitError with code: POOL_EMPTY | FREE_OFF | PAID_OFF | DAILY_CAP | MONTHLY_CAP | AI_ERROR
 */
export async function chat(env, db, { tier = 'free', pool = 'staff', system = '', messages = [], maxTokens = 1200, temperature = 0.4, image = null, thinking = 0, bonus = false }) {
    const turns = tidyTurns(messages);
    // image = { mime, b64 } → attached to the LAST user turn (the photo she/he just sent)
    const img = image && image.b64 && /^image\/(jpeg|png|webp)$/.test(image.mime || '') ? image : null;
    if (!turns.length) throw new AiLimitError('AI_ERROR', 'Nothing to send');
    const model = modelFor(env, tier);
    const t0 = Date.now();

    if (tier === 'free') {
        if (!aiReady(env)) throw new AiLimitError('FREE_OFF', 'The free model is not connected (Workers AI binding AI)');
        const cap = poolCap(env, pool), key = `ai_pool_${pool}_${day()}`;
        const used = await kvNum(db, key);
        const chars = system.length + turns.reduce((t, m) => t + m.content.length, 0);
        const guess = estimateNeurons(img ? model : freeTextModel(env), { prompt_tokens: Math.ceil(chars / 3.5) + (img ? 1600 : 0), completion_tokens: Math.min(maxTokens, 400) });
        const empty = () => new AiLimitError('POOL_EMPTY', `Today's free ${pool === 'staff' ? 'AI Assistant' : 'student'} allowance is used up — it resets at 2:00 am (Cairo).`, { used: Math.round(used), cap });
        if (await quotaHitToday(db)) throw empty();
        const SP = await studentPool(env, db);
        if (pool === 'student') {
            if (SP.left < guess) throw empty();
            if (bonus && SP.leftover < guess) throw new AiLimitError('BONUS_CLOSED', 'Extra messages are closed right now — the free units left are kept for the rest of the day.');
        } else if (used + guess > cap && SP.leftover < guess) throw empty();   // staff past 500 → only from the students' released leftover
        if (await usageToday(db) + guess > DAILY_FREE_NEURONS) throw empty();     // whole account (homework / AI Lab included)
        // after a call: charge this pool; staff units above the 500 are also taken from the students' pool ("borrowed")
        const charge = async (neurons) => {
            await addUsage(db, neurons); await kvAdd(db, key, neurons);
            if (pool === 'staff') { const before = await kvNum(db, key) - neurons; const over = Math.max(0, before + neurons - cap) - Math.max(0, before - cap); await kvAdd(db, `ai_pool_borrow_${day()}`, over); }
        };
        // 1) text → the stronger text model first (one try; anything wrong → Scout below)
        const tm = freeTextModel(env), failKey = `ai_free_text_fail_${day()}`;
        if (!img && tm !== model && await kvNum(db, failKey) < 3) {
            try {
                const sys = system ? [{ role: 'system', content: (isOss(tm) ? 'Reasoning: low\n\n' : '') + system }] : (isOss(tm) ? [{ role: 'system', content: 'Reasoning: low' }] : []);
                const r = await env.AI.run(tm, { messages: [...sys, ...turns], max_tokens: maxTokens + (isOss(tm) ? 700 : 0), temperature });   // + room for its short private reasoning
                const text = cleanOss(replyText(r));
                const neurons = estimateNeurons(tm, r && r.usage, chars, text.length + (isOss(tm) ? 1200 : 0));
                await charge(neurons);
                if (text) return { text, tier, brand: BRANDS.free.name, model: tm, ms: Date.now() - t0, neurons, usage: (r && r.usage) || null };
                await kvAdd(db, failKey, 1);
            } catch (e) {
                const m = String(e && e.message || e);
                if (/3036|daily free allocation/i.test(m)) { await markQuotaHit(db); throw new AiLimitError('POOL_EMPTY', "Today's free allowance is used up — it resets at 2:00 am (Cairo).", { used: Math.round(used), cap }); }
                await kvAdd(db, failKey, 1);
            }
        }
        // 2) Scout (photos, or the backup for text)
        let res = null, lastErr = null;
        for (let k = 0; k < 3 && !res; k++) {
            const sys = system ? [{ role: 'system', content: system }] : [];
            let input;
            if (!img) input = { messages: [...sys, ...turns], max_tokens: maxTokens, temperature };
            else if (k === 0) {   // OpenAI-style parts (what Llama 4 Scout reads — same as the homework AI Lab)
                const last = turns[turns.length - 1];
                input = { messages: [...sys, ...turns.slice(0, -1), { role: 'user', content: [{ type: 'text', text: last.content }, { type: 'image_url', image_url: { url: `data:${img.mime};base64,${img.b64}` } }] }], max_tokens: maxTokens, temperature };
            } else input = { messages: [...sys, ...turns], image: `data:${img.mime};base64,${img.b64}`, max_tokens: maxTokens, temperature };   // older image field
            try { res = await env.AI.run(model, input); }
            catch (e) {
                lastErr = e;
                const m = String(e && e.message || e);
                if (/3036|daily free allocation/i.test(m)) { await markQuotaHit(db); throw new AiLimitError('POOL_EMPTY', "Today's free allowance is used up — it resets at 2:00 am (Cairo).", { used: Math.round(used), cap }); }
                if (/3040|capacity/i.test(m) && k < 2) { await new Promise(r => setTimeout(r, 1000 * (k + 1))); continue; }
                if (img && k === 0) continue;   // try the other image format once
                break;
            }
        }
        if (!res) throw new AiLimitError('AI_ERROR', 'The free model did not answer — try again, or switch to Miss Marwa Assistant Pro. ' + String(lastErr && lastErr.message || '').slice(0, 160));
        const text = (replyText(res) || textOf(res)).trim();
        const neurons = estimateNeurons(model, res.usage, chars + (img ? 5600 : 0), text.length);
        await charge(neurons);                     // platform-wide meter + this pool (+ borrowed part)
        return { text, tier, brand: BRANDS.free.name, model, ms: Date.now() - t0, neurons, usage: res.usage || null };
    }

    // ---- paid (Claude) ----
    if (!claudeReady(env)) throw new AiLimitError('PAID_OFF', 'Miss Marwa Assistant Pro is not connected yet — add the ANTHROPIC_API_KEY secret in Cloudflare.');
    const spentDay = await kvNum(db, `ai_spend_${day()}`), spentMonth = await kvNum(db, `ai_spend_${month()}`);
    if (spentDay >= dailyUsdCap(env)) throw new AiLimitError('DAILY_CAP', `Today's paid AI budget ($${dailyUsdCap(env).toFixed(2)}) is used up — use Mini Assistant until tomorrow, or raise AI_DAILY_USD.`);
    if (spentMonth >= monthlyUsdCap(env)) throw new AiLimitError('MONTHLY_CAP', `This month's paid AI budget ($${monthlyUsdCap(env).toFixed(2)}) is used up — raise AI_MONTHLY_USD to continue.`);
    let res = null, body = null, lastErr = '';
    for (let k = 0; k < 2 && !res; k++) {
        const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 90000);
        try {
            const r = await fetch('https://api.anthropic.com/v1/messages', {
                method: 'POST', signal: ctl.signal,
                headers: { 'content-type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
                // thinking > 0 → Claude's extended thinking (the API needs the default temperature then)
                body: JSON.stringify({ model, max_tokens: maxTokens + (thinking > 0 ? thinking : 0), ...(thinking > 0 ? { thinking: { type: 'enabled', budget_tokens: thinking } } : { temperature }), ...(system ? { system } : {}),
                    messages: img ? [...turns.slice(0, -1), { role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: img.mime, data: img.b64 } }, { type: 'text', text: turns[turns.length - 1].content }] }] : turns })
            });
            body = await r.json().catch(() => null);
            if (r.ok) { res = body; break; }
            const msg = (body && body.error && body.error.message) || `HTTP ${r.status}`;
            lastErr = msg;
            if (r.status === 401 || r.status === 403) throw new AiLimitError('PAID_OFF', 'The Claude API key was refused — check the ANTHROPIC_API_KEY secret in Cloudflare.');
            if (thinking > 0 && r.status === 400 && /think/i.test(msg)) throw new AiLimitError('AI_ERROR', `This model doesn't accept "thinking" — use another reasoning mode. (${msg.slice(0, 160)})`);
            if (r.status === 404 || /model/i.test(msg) && r.status === 400) throw new AiLimitError('AI_ERROR', `Model "${model}" isn't available — check CLAUDE_FAST_MODEL / CLAUDE_PRO_MODEL. (${msg.slice(0, 160)})`);
            if ([429, 500, 502, 503, 529].includes(r.status) && k === 0) { await new Promise(x => setTimeout(x, 1500)); continue; }
            break;
        } catch (e) {
            if (e instanceof AiLimitError) throw e;
            lastErr = e.name === 'AbortError' ? 'took too long' : String(e.message || e);
        } finally { clearTimeout(timer); }
    }
    if (!res) throw new AiLimitError('AI_ERROR', 'Miss Marwa Assistant Pro did not answer — try again in a moment. (' + String(lastErr).slice(0, 160) + ')');
    const text = (res.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n').trim();
    const usage = res.usage || {};
    const costUsd = claudeCost(model, usage);
    await kvAdd(db, `ai_spend_${day()}`, costUsd);
    await kvAdd(db, `ai_spend_${month()}`, costUsd);
    return { text, tier, brand: BRANDS[tier].name, model, ms: Date.now() - t0, costUsd, usage };
}

// shared module — not a page
export async function onRequest() { return new Response('Not found', { status: 404 }); }
