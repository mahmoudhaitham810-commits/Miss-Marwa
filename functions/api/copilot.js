// =====================================================================
// Miss Marwa's Co-Pilot (/api/copilot) — staff only (permission copilot.use = teacher).
// Step C0: chat + saved chats + model choice (Argon free / Krypton / Krypton Max) + usage meter.
// No platform data tools yet (they arrive in C1) — the Co-Pilot is told so and must never invent data.
// =====================================================================
import { requireStaff, ensureAppSchema } from './admin-auth.js';
import { chat, usageSummary, AiLimitError, BRANDS, claudeReady } from './ai-gateway.js';
import { aiReady } from './ai-engine.js';

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
const bad = (error, status = 400, extra = {}) => json({ error, ...extra }, status);
const getDb = (env) => [env.DB, env.D1_DB].find(d => d && typeof d.prepare === 'function');
const TIERS = ['free', 'pro', 'max'];
const MAX_TEXT = 4000, HISTORY = 20;

let ready = false;
async function ensureTables(db) {
    if (ready) return;
    await db.batch([
        db.prepare(`CREATE TABLE IF NOT EXISTS copilot_threads (id INTEGER PRIMARY KEY AUTOINCREMENT, staff_id INTEGER NOT NULL, title TEXT NOT NULL,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP)`),
        db.prepare('CREATE INDEX IF NOT EXISTS idx_copilot_threads_staff ON copilot_threads(staff_id, updated_at)'),
        db.prepare(`CREATE TABLE IF NOT EXISTS copilot_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, thread_id INTEGER NOT NULL, role TEXT NOT NULL, text TEXT NOT NULL,
            tier TEXT, model TEXT, ms INTEGER, neurons REAL, cost_usd REAL, tokens_in INTEGER, tokens_out INTEGER, error TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP)`),
        db.prepare('CREATE INDEX IF NOT EXISTS idx_copilot_messages_thread ON copilot_messages(thread_id, id)')
    ]);
    ready = true;
}

export function systemPrompt(staff, now = new Date()) {
    const date = now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Africa/Cairo' });
    return `You are "Co-Pilot", the private assistant of ${staff && staff.name ? staff.name : 'Miss Marwa'} — a science teacher in Egypt who runs Science Academy (Science with Miss Marwa) for Prep 1, Prep 2, Prep 3 and Secondary 1 students.
Today is ${date} (Cairo).
How to reply:
- Reply in the language she writes in. In Arabic, use natural, warm Egyptian Arabic, but keep EVERY scientific term, unit, symbol and equation in English (e.g. "الـ Atom", "الـ Nucleus", "F = m × a").
- Be practical and concise: short paragraphs, bullet lists, **bold** for key terms. Get to the point — she is busy and usually on her phone.
- You are speaking to the teacher, not to a student.
What you can do now: explain science, write and improve questions and answer keys, plan lessons, draft messages to students or parents, brainstorm.
What you CANNOT do yet: you are not connected to the platform's data (students, grades, attendance, exams, questions inbox). That connection is coming soon. If she asks about her students or results, say clearly that you can't see that data yet — NEVER invent names, numbers, scores or results.
Never claim to have done something on the platform (publishing, sending, saving) — you can only write text here.`;
}

const threadOut = (t) => ({ id: t.id, title: t.title, createdAt: t.created_at, updatedAt: t.updated_at, last: t.last_text ? String(t.last_text).replace(/[*`#>]+/g, '').replace(/\s+/g, ' ').trim().slice(0, 90) : '', count: t.n || 0 });
const msgOut = (m) => ({ id: m.id, role: m.role, text: m.text, tier: m.tier, brand: m.tier ? (BRANDS[m.tier] || {}).name : null, ms: m.ms, neurons: m.neurons, costUsd: m.cost_usd, error: m.error || null, at: m.created_at });

export async function onRequest(context) {
    const { request, env } = context;
    const url = new URL(request.url);
    const action = url.searchParams.get('action') || '';
    const db = getDb(env);
    if (!db) return bad('Database not connected', 500);
    try {
        await ensureAppSchema(db);
        await ensureTables(db);
        const auth = await requireStaff(request, env, 'copilot.use');
        if (auth.error) return auth.error;
        const staff = auth.staff;
        const isPost = request.method === 'POST';
        const data = isPost ? await request.json().catch(() => ({})) : {};
        const own = async (id) => id ? await db.prepare('SELECT * FROM copilot_threads WHERE id = ? AND staff_id = ?').bind(id, staff.id).first() : null;

        if (action === 'status') {
            const u = await usageSummary(env, db);
            return json({ ...u, tiers: TIERS.map(t => ({ tier: t, ...BRANDS[t], ready: t === 'free' ? aiReady(env) : claudeReady(env) })) });
        }
        if (action === 'threads') {
            const { results } = await db.prepare(`SELECT t.*, (SELECT text FROM copilot_messages m WHERE m.thread_id = t.id AND m.role = 'assistant' AND m.error IS NULL ORDER BY m.id DESC LIMIT 1) AS last_text,
                (SELECT COUNT(*) FROM copilot_messages m WHERE m.thread_id = t.id) AS n FROM copilot_threads t WHERE t.staff_id = ? ORDER BY t.updated_at DESC, t.id DESC LIMIT 60`).bind(staff.id).all();
            return json({ threads: (results || []).map(threadOut) });
        }
        if (action === 'thread') {
            const t = await own(parseInt(url.searchParams.get('id'), 10)); if (!t) return bad('Chat not found', 404);
            const { results } = await db.prepare('SELECT * FROM copilot_messages WHERE thread_id = ? ORDER BY id LIMIT 400').bind(t.id).all();
            return json({ thread: threadOut(t), messages: (results || []).map(msgOut) });
        }
        if (!isPost) return bad('POST only', 405);

        if (action === 'send') {
            const tier = TIERS.includes(data.tier) ? data.tier : 'free';
            const text = String(data.text || '').replace(/\r/g, '').trim();
            if (!text) return bad('Type a message', 400);
            if (text.length > MAX_TEXT) return bad(`Keep it under ${MAX_TEXT} characters`, 400);
            let t = await own(parseInt(data.threadId, 10));
            if (data.threadId && !t) return bad('Chat not found', 404);
            if (!t) {
                const title = text.split('\n')[0].slice(0, 60) || 'New chat';
                const r = await db.prepare('INSERT INTO copilot_threads (staff_id, title) VALUES (?, ?)').bind(staff.id, title).run();
                t = await own(Number(r.meta.last_row_id));
            }
            // "Try again" after an error re-uses the last question instead of saving it twice
            const last = await db.prepare('SELECT * FROM copilot_messages WHERE thread_id = ? ORDER BY id DESC LIMIT 1').bind(t.id).first();
            const lastUser = last && last.role === 'user' ? last : (last && last.error ? await db.prepare(`SELECT * FROM copilot_messages WHERE thread_id = ? AND role = 'user' ORDER BY id DESC LIMIT 1`).bind(t.id).first() : null);
            let userMsg = null;
            if (data.resend && lastUser && lastUser.text === text) userMsg = lastUser;
            else {
                const r = await db.prepare(`INSERT INTO copilot_messages (thread_id, role, text) VALUES (?, 'user', ?)`).bind(t.id, text).run();
                userMsg = { id: Number(r.meta.last_row_id), role: 'user', text, created_at: new Date().toISOString() };
            }
            if (data.resend) await db.prepare(`DELETE FROM copilot_messages WHERE thread_id = ? AND role = 'error' AND id > ?`).bind(t.id, userMsg.id).run();
            const { results: hist } = await db.prepare(`SELECT role, text FROM copilot_messages WHERE thread_id = ? AND role IN ('user', 'assistant') ORDER BY id DESC LIMIT ?`).bind(t.id, HISTORY).all();
            const messages = (hist || []).reverse().map(m => ({ role: m.role, content: m.text }));
            try {
                const out = await chat(env, db, { tier, pool: 'staff', system: systemPrompt(staff), messages, maxTokens: tier === 'max' ? 2500 : 1500 });
                const u = out.usage || {};
                const r = await db.prepare(`INSERT INTO copilot_messages (thread_id, role, text, tier, model, ms, neurons, cost_usd, tokens_in, tokens_out) VALUES (?, 'assistant', ?, ?, ?, ?, ?, ?, ?, ?)`)
                    .bind(t.id, out.text || '…', tier, out.model, out.ms, out.neurons ?? null, out.costUsd ?? null, u.input_tokens ?? u.prompt_tokens ?? null, u.output_tokens ?? u.completion_tokens ?? null).run();
                await db.prepare('UPDATE copilot_threads SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(t.id).run();
                const saved = await db.prepare('SELECT * FROM copilot_messages WHERE id = ?').bind(Number(r.meta.last_row_id)).first();
                return json({ threadId: t.id, title: t.title, user: msgOut(userMsg), reply: msgOut(saved), usage: await usageSummary(env, db) });
            } catch (e) {
                const code = e instanceof AiLimitError ? e.code : 'AI_ERROR';
                const message = e instanceof AiLimitError ? e.message : 'Something went wrong — try again.';
                await db.prepare(`INSERT INTO copilot_messages (thread_id, role, text, tier, error) VALUES (?, 'error', ?, ?, ?)`).bind(t.id, message, tier, code).run();
                await db.prepare('UPDATE copilot_threads SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(t.id).run();
                const status = ['POOL_EMPTY', 'DAILY_CAP', 'MONTHLY_CAP'].includes(code) ? 429 : ['FREE_OFF', 'PAID_OFF'].includes(code) ? 503 : 502;
                return json({ error: message, code, threadId: t.id, title: t.title, user: msgOut(userMsg), usage: await usageSummary(env, db) }, status);
            }
        }
        if (action === 'rename') {
            const t = await own(parseInt(data.id, 10)); if (!t) return bad('Chat not found', 404);
            const title = String(data.title || '').trim().slice(0, 80); if (!title) return bad('Give it a name', 400);
            await db.prepare('UPDATE copilot_threads SET title = ? WHERE id = ?').bind(title, t.id).run();
            return json({ ok: true });
        }
        if (action === 'delete') {
            const t = await own(parseInt(data.id, 10)); if (!t) return bad('Chat not found', 404);
            await db.batch([db.prepare('DELETE FROM copilot_messages WHERE thread_id = ?').bind(t.id), db.prepare('DELETE FROM copilot_threads WHERE id = ?').bind(t.id)]);
            return json({ ok: true });
        }
        return bad('Unknown action', 404);
    } catch (err) {
        console.error('copilot error', err);
        return bad(err.message || 'Something went wrong', 500);
    }
}
