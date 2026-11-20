// =====================================================================
// Students' "Miss Marwa AI Assistant" (/api/tutor) — the free model "Mini Assistant".
//
// HIDDEN until it is opened on purpose: real students get "coming soon" unless the Cloudflare
// variable TUTOR_OPEN = 1. Staff can try it as any student (Preview) with ?as=<student code>.
//
// Privacy (enforced in CODE, not by the AI): whose data the assistant sees comes ONLY from the
// login — the student's own session, or the student a staff member picked for Preview. Nothing in
// the chat text can change it, and there is no lookup of any other student at all.
//
// Free limits (shared 9,500 free units a day for all students):
//   • TUTOR_FREE_DAILY replies per student per day, always available while the pool has units (default 10)
//   • after that, "bonus" replies up to TUTOR_FREE_MAX (default 25) — only from the released leftover of the
//     students' pool (units nobody is expected to need any more today, see ai-gateway.js), so one student can't
//     drain the pool early in the day
//   • TUTOR_FREE_IMAGES photos per student per day (default 1)
//   • while the student is IN an online exam, the assistant is closed (no help during exams)
// Preview chats are kept apart from the student's own chats and have their own counters.
//
// Assistant Pro (19 Nov 2026): open to a student when Miss Marwa has opened Pro to students AND switched it ON for
// them (AI usage page). Paid from the student's own monthly budget (no daily counters). Every science question is
// answered from the student's own grade's curriculum book (curriculum.js — the best few passages, with pages).
// A student with Pro can open the assistant even while the free Mini Assistant is still closed (TUTOR_OPEN).
// =====================================================================
import { requireStaff, ensureAppSchema, verifyStudentRequest } from './admin-auth.js';
import { chat, usageSummary, bonusOpen, AiLimitError, BRANDS, claudeReady } from './ai-gateway.js';
import { studentAccess } from './ai-quota.js';
import { searchBook, bookRules } from './curriculum.js';
import { aiReady } from './ai-engine.js';
import { studentProfile } from './analytics.js';
import { readImage, saveImage, serveImage, purgeOldImages } from './ai-image.js';
import { LANGUAGE_SCHOOLS, EXAM_ANSWER_LINE, PRO_ACCURACY, askKind, taskRules, dropAnswerLine, isScienceQuestion, isCapabilityQuestion, capabilitiesForStudent } from './ai-rules.js';

const getDb = (env) => [env.DB, env.D1_DB].find(d => d && typeof d.prepare === 'function');
const json = (d, s = 200) => Response.json(d, { status: s });
const bad = (m, s = 400, extra = {}) => json({ error: m, ...extra }, s);
const MAX_TEXT = 2000, HISTORY = 12;
const GRADE_LABEL = { prep1: 'Prep 1', prep2: 'Prep 2', prep3: 'Prep 3', sec1: 'Sec 1' };
const day = () => new Date().toISOString().slice(0, 10);
const num = (v, d) => { const n = parseInt(v, 10); return Number.isFinite(n) && n >= 0 ? n : d; };
export const limits = (env) => { const m = num(env.TUTOR_FREE_DAILY, 10); return { messages: m, max: Math.max(m, num(env.TUTOR_FREE_MAX, 25)), images: num(env.TUTOR_FREE_IMAGES, 1) }; };
export const isOpen = (env) => String(env.TUTOR_OPEN || '') === '1';

let ready = false;
async function ensureTables(db) {
    if (ready) return;
    await db.batch([
        db.prepare(`CREATE TABLE IF NOT EXISTS tutor_threads (id INTEGER PRIMARY KEY AUTOINCREMENT, student_id TEXT NOT NULL, staff_id INTEGER,
            title TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP)`),
        db.prepare(`CREATE TABLE IF NOT EXISTS tutor_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, thread_id INTEGER NOT NULL, role TEXT NOT NULL,
            text TEXT NOT NULL, tier TEXT, model TEXT, ms INTEGER, neurons REAL, cost_usd REAL, error TEXT, cards TEXT, image_id INTEGER,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP)`),
        db.prepare('CREATE INDEX IF NOT EXISTS idx_tutor_threads_owner ON tutor_threads(student_id, staff_id, updated_at)'),
        db.prepare('CREATE INDEX IF NOT EXISTS idx_tutor_messages_thread ON tutor_messages(thread_id, id)')
    ]);
    ready = true;
}

// ---------- counters (per student per day; Preview has its own) ----------
const kvGet = async (db, k) => Number((await db.prepare('SELECT value FROM app_kv WHERE "key" = ?').bind(k).first())?.value || 0);
const kvAdd = (db, k, n) => db.prepare(`INSERT INTO app_kv ("key", value) VALUES (?, ?) ON CONFLICT("key") DO UPDATE SET value = CAST(CAST(value AS REAL) + CAST(excluded.value AS REAL) AS TEXT), updated_at = CURRENT_TIMESTAMP`).bind(k, String(n)).run();
const counterKey = (who, what) => `tutor_${what}_${who.preview ? 'p' + who.staff.id + '_' : ''}${who.student.id}_${day()}`;

// ---------- who is this? ----------
async function whoIs(request, env, db, url) {
    const as = (url.searchParams.get('as') || '').trim();
    if (as) {   // staff Preview: act as this student (read-only view of their data)
        const auth = await requireStaff(request, env, 'students.view');
        if (auth.error) return { error: auth.error };
        const row = await db.prepare('SELECT student_id, grade, first_name, last_name, gender, branch FROM students WHERE student_id = ?').bind(as).first();
        if (!row) return { error: bad('Student not found', 404) };
        return { preview: true, staff: auth.staff, student: { id: row.student_id, grade: String(row.grade || '').toLowerCase(), firstName: row.first_name, lastName: row.last_name, gender: row.gender, branch: row.branch } };
    }
    const st = await verifyStudentRequest(request, env, db);
    if (!st) return { error: bad('Please sign in again.', 401, { code: 'STUDENT_SESSION_REQUIRED' }) };
    const pro = claudeReady(env) ? await studentAccess(db, st.id).catch(() => ({ ok: false })) : { ok: false };
    if (!isOpen(env) && !pro.ok) return { error: bad('Miss Marwa AI Assistant is coming soon 🚀', 403, { code: 'NOT_OPEN' }) };
    return { preview: false, staff: null, student: st, pro };
}

// ---------- this student's own data (and only theirs) ----------
const pct = (v) => (v === null || v === undefined ? '—' : `${Math.round(v)}%`);
const LEVEL_AR = { excellent: 'ممتاز', good: 'جيد جداً', average: 'متوسط', weak: 'محتاج شغل' };
export async function myData(db, student) {
    const P = await studentProfile(db, student.id);
    if (!P) return null;
    const sm = P.summary;
    const taken = [...(P.center || []).filter(h => h.status === 'taken').map(h => ({ name: h.name, date: h.date, pct: h.pct, kind: 'center' })),
        ...(P.online || []).filter(o => o.status === 'taken').map(o => ({ name: o.name, date: o.date, pct: o.pct, kind: 'online' }))]
        .sort((a, b) => String(b.date).localeCompare(String(a.date)));
    const openExams = (P.online || []).filter(o => o.status === 'not-yet' || o.status === 'in-progress').map(o => ({ id: o.id, name: o.name, expiresAt: o.expiresAt, status: o.status }))
        .sort((a, b) => String(a.expiresAt).localeCompare(String(b.expiresAt)));
    const missed = (P.online || []).filter(o => o.status === 'missed' || o.status === 'opened').slice(0, 5).map(o => ({ name: o.name, date: o.date }));
    const absent = (P.center || []).filter(h => h.status === 'absent').slice(-5).map(h => ({ name: h.name, date: h.date }));
    const { results: lessons } = await db.prepare(`SELECT id, title, category, url, created_at as createdAt FROM lessons WHERE LOWER(TRIM(grade)) = ? ORDER BY created_at DESC, rowid DESC LIMIT 6`).bind(student.grade).all().catch(() => ({ results: [] }));
    const last3 = taken.slice(0, 3).map(t => t.pct).filter(v => v !== null && v !== undefined);
    const trend = last3.length >= 2 ? (last3[0] - last3[last3.length - 1] >= 8 ? 'up' : last3[last3.length - 1] - last3[0] >= 8 ? 'down' : 'steady') : null;
    const best = taken.filter(t => t.pct !== null).sort((a, b) => b.pct - a.pct)[0] || null;
    return {
        student: { id: student.id, firstName: student.firstName, lastName: student.lastName, gender: student.gender, grade: student.grade, gradeLabel: GRADE_LABEL[student.grade] || student.grade },
        summary: { combinedPct: sm.combinedPct, centerPct: sm.centerPct, onlinePct: sm.onlinePct, level: sm.level, rank: sm.combinedRank, gradeSize: sm.gradeSize, centerTaken: sm.centerTaken, onlineTaken: sm.onlineTaken, centerAbsent: sm.centerAbsent, onlineMissed: sm.onlineMissed },
        recent: taken.slice(0, 6), last: taken[0] || null, best, trend, openExams, missed, absent,
        lessons: (lessons || []).map(l => ({ id: l.id, title: l.title, category: l.category, url: l.url, at: String(l.createdAt || '').slice(0, 10) }))
    };
}
function factsOf(d) {
    if (!d) return 'No data found for this student.';
    const s = d.summary, st = d.student;
    return [
        `STUDENT (the person you're talking to): ${st.firstName} ${st.lastName}, ${st.gender === 'female' ? 'girl' : 'boy'}, ${st.gradeLabel}.`,
        `Overall ${pct(s.combinedPct)}${s.level ? ` (${LEVEL_AR[s.level]})` : ' (not enough exams yet)'}; center exams ${pct(s.centerPct)} (${s.centerTaken} taken, absent ${s.centerAbsent}); online ${pct(s.onlinePct)} (${s.onlineTaken} taken, missed ${s.onlineMissed}).`,
        s.rank ? `Rank in ${st.gradeLabel}: ${s.rank} of ${s.gradeSize}.` : 'Not ranked yet.',
        d.last ? `Last result: ${d.last.name} — ${pct(d.last.pct)} (${d.last.date}).` : 'No results yet.',
        d.recent.length ? `Recent results (newest first): ${d.recent.map(r => `${r.name} ${pct(r.pct)}`).join('; ')}. Trend: ${d.trend || 'not enough results'}.` : '',
        d.best ? `Best result: ${d.best.name} ${pct(d.best.pct)}.` : '',
        d.openExams.length ? `Online exams open now and NOT done yet: ${d.openExams.map(o => `${o.name} (closes ${String(o.expiresAt).slice(0, 16).replace('T', ' ')})`).join('; ')}.` : 'No open online exams waiting.',
        d.missed.length ? `Missed online exams: ${d.missed.map(m => m.name).join(', ')}.` : '',
        d.absent.length ? `Absent from center exams: ${d.absent.map(a => a.name).join(', ')}.` : '',
        d.lessons.length ? `Latest lessons/files for ${st.gradeLabel}: ${d.lessons.slice(0, 5).map(l => `"${l.title}" (${l.category}, ${l.at})`).join('; ')}.` : ''
    ].filter(Boolean).join('\n');
}

// What should the page show as exact cards? (code decides — never the AI)
const n = (t) => String(t || '').toLowerCase().replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي');
const RX = {
    me: /درجاتي|درجتي|مستوايا|مستواي|ترتيبي|نتيجتي|نتايجي|انا عامل ايه|عامل ايه في|مستوايا|my (grades|marks|level|rank|results)|how am i doing|اخباري ايه/,
    todo: /امتحانات? (مفتوح|جديد|فاضل|لسه|عليا|ليا)|عندي امتحان|ورايا ايه|اخر ميعاد|ميعاد الامتحان|deadline|open exams?|exams? (due|open)|what('?s| is) due|لسه محلتش|امتحان النهارده/,
    lessons: /دروس جديده|درس جديد|حاجه جديده|نزل ايه|اتنزل|ملفات جديده|ملزمه|new lessons?|what('?s| is) new|ايه الجديد/
};
export function studentIntent(text) {
    const s = n(text);
    const out = [];
    if (RX.me.test(s)) out.push('me');
    if (RX.todo.test(s)) out.push('todo');
    if (RX.lessons.test(s)) out.push('lessons');
    return out;
}
function cardsFor(intents, d) {
    if (!d) return [];
    const c = [];
    if (intents.includes('me')) c.push({ type: 'me', student: d.student, summary: d.summary, recent: d.recent, trend: d.trend, best: d.best });
    if (intents.includes('todo')) c.push({ type: 'todo', openExams: d.openExams, missed: d.missed });
    if (intents.includes('lessons')) c.push({ type: 'lessons', lessons: d.lessons, gradeLabel: d.student.gradeLabel });
    return c;
}

// ---------- personality ----------
const ME = 'Miss Marwa AI Assistant';
// opts.bench = { grade } → the Model test: same tutor, no real student's data
export function tutorPrompt(d, tier = 'free', opts = {}) {
    const st = opts.bench ? { firstName: 'a student', gender: 'male', gradeLabel: GRADE_LABEL[opts.bench.grade] || 'Prep' } : d ? d.student : { firstName: '', gender: 'male', gradeLabel: '' };
    const girl = st.gender === 'female';
    return `You are "${ME}" (model: ${BRANDS[tier].name}) — the study buddy of the students of ${'مس مروة'} (Miss Marwa), a science teacher in Egypt (Science Academy). You're talking to ONE student: ${st.firstName} (${girl ? 'a girl — talk to her in the feminine: يا بطلة، إنتِ، عملتي' : 'a boy — talk to him in the masculine: يا بطل، إنت، عملت'}), ${st.gradeLabel}.

## Personality — دمه خفيف موت 😄
- Super lively, witty, warm and encouraging — like the coolest older sibling who loves science. Light Egyptian humor, playful comparisons from daily life (الأكل، الكورة، الموبايل، المواصلات), but always kind — never make fun of the student.
- Good grades → celebrate loudly 🎉 ("إيه الحلاوة دي!"). A score dropped → cheer them up and give one small, practical step ("ولا يهمك، المرة الجاية هنكسّرها 💪").
- Make science feel exciting, never boring. 1–3 emojis per reply.
- Vary how you start — don't open every reply the same way.

## Language — strict
- Egyptian colloquial Arabic (عامية مصرية) — never فصحى.
- EVERY science term, unit, symbol and formula stays in English, usually with "الـ": الـ **Atom**، الـ **Density**، **D = m / V**، **kg**. NEVER translate science terms into Arabic. Never switch fully to English unless the student asks for English.
- Put **bold** on the English science terms. Short paragraphs; the student is on a phone.
Example: "بص يا ${girl ? 'بطلة' : 'بطل'}، الـ **Density** دي ببساطة هي الـ **mass** مقسومة على الـ **volume**: **D = m / V** — يعني لو حاجتين نفس الحجم، اللي أتقل فيهم كثافته أعلى 🧱🪶"

${LANGUAGE_SCHOOLS}
${EXAM_ANSWER_LINE}

## Your job as ${BRANDS[tier].name}
${tier === 'pro'
        ? `- You're the paid model — the student pays for real, high-value teaching. Explain clearly and completely at their grade's level: the idea, why it's true, a quick everyday example, and the exact exam answer. Problems: every step with units.${PRO_ACCURACY}`
        : `- Help with SCIENCE and with their own progress on the platform. You're the free model: quick questions get clear, SHORT answers (up to ~6 lines); when they ask you to summarize or explain a topic (لخصلي / اشرحلي), give a complete, organized summary of all its main points (see "This message" below). The app automatically adds a note under science answers suggesting ${BRANDS.pro.name} for deeper explanations — never write such a note yourself.`}
- Use ONLY the "MY DATA" block below for anything about their grades, rank, exams, absences or lessons. Never invent a number, exam, lesson or date. If something isn't there, say you don't see it.
- Cards with their exact numbers appear under your reply when they ask about their grades, open exams or new lessons — so keep that part short and fun, don't repeat every number.
- You can ONLY see this student's own data. If they ask about another student's grades or anything private about someone else, say kindly that you can't see that 🙂.
${opts.books ? `- Passages from their own curriculum book for this question are at the end ("Curriculum book") — they are your source of truth for science content.` : `- Never guess what's inside a specific lesson of their book ("Unit 2 Lesson 3") — ${tier === 'pro' ? "no passage of their book was found for it" : "the books aren't connected yet"}; ask them to tell you the topic.`}
- Stay on studies. Off-topic chat → one friendly line, then steer back to science. Keep everything appropriate for school students.
- Never claim you did something on the platform (you can't submit, change marks or send anything).
- If they ask what you can do, list (numbered) what you do on the platform — their level & grades, open exams & deadlines, new lessons, one photo question a day, quick Science help — then say honestly that you're a limited model and they shouldn't rely on you entirely for the academic content.

## MY DATA (exact, from the platform — this student only)
${opts.bench ? '(Model test — no student data. Answer the science question only.)' : factsOf(d)}`;
}
const SMALL = /^(شكرا|شكرًا|ميرسي|تسلم|تسلمي|تمام|اوك|اوكي|ok|okay|thanks|thank you|hi|hello|hey|ازيك|اهلا|أهلا|السلام عليكم|صباح الخير|مساء الخير|ماشي|حلو|جميل|برافو|يس|نو|اه|لا)[\s!.,،؟?😊👌🙏❤️💪✨😂]*$|انت مين|إنت مين|تقدر تعمل ايه|تقدر تعمل إيه|بتعمل ايه/i;
export const NOTE_TEXT = 'دي إجابة مبسّطة من Mini Assistant 🙂 — لشرح أعمق وأدق جرّب **Miss Marwa Assistant Pro**.';
export const NOTE_IMAGE = 'دي إجابة مبدئية من Mini Assistant 🙂 — لأدق حل وتحليل للصور جرب **Miss Marwa Assistant Pro**.';
const IMAGE_RULES = `\n\n## The student attached a photo
Read the question(s) in the photo carefully. Solve step by step: a short copy of each question, then the answer and why (show any calculation with units). For a choice question say which choice is right and why. If part of the photo is unclear, say exactly what you can't read — never guess.`;
const EXAMPLES = [
    { role: 'user', content: 'يعني إيه Mass؟' },
    { role: 'assistant', content: 'سؤال جامد 😎 الـ **Mass** هي كمية المادة اللي في أي جسم، وبنقيسها بالـ **kilogram (kg)**. يعني إنت على الأرض أو على القمر، الـ **Mass** بتاعتك هي هي — اللي بيتغير هو الـ **Weight** 🌙' }
];

// ---------- messages ----------
const parse = (v) => { try { return v ? JSON.parse(v) : null; } catch (e) { return null; } };
const msgOut = (m) => ({ id: m.id, role: m.role, text: m.text, tier: m.tier, model: m.model || null, brand: m.tier ? (BRANDS[m.tier] || {}).name : null, ms: m.ms, error: m.error || null, cards: parse(m.cards), imageId: m.image_id || null, at: m.created_at });
const PRO_MSG = {
    STUDENT_OFF: 'Miss Marwa Assistant Pro جزء من الاشتراك ✨ — كلّم مس مروة عشان تفعّله.',
    STUDENT_CAP: 'خلص رصيد Miss Marwa Assistant Pro بتاعك الشهر ده 🙏 — بيتجدد أول الشهر الجاي.',
    PRO_CLOSED: 'Miss Marwa Assistant Pro جاي قريب جداً 🚀',
    PAID_OFF: 'Miss Marwa Assistant Pro مش متاح دلوقتي 🙏'
};
const FRIENDLY = {
    STUDENT_OFF: PRO_MSG.STUDENT_OFF, STUDENT_CAP: PRO_MSG.STUDENT_CAP, PAID_OFF: PRO_MSG.PAID_OFF,
    DAILY_CAP: 'Miss Marwa Assistant Pro خد استراحة النهارده 🙏 — جرّب بكره.', MONTHLY_CAP: 'Miss Marwa Assistant Pro خد استراحة 🙏 — كلّم مس مروة.',
    POOL_EMPTY: 'Mini Assistant خد استراحة النهارده 😴 — بيرجع الساعة 2 بالليل. لو محتاج دلوقتي جرّب Miss Marwa Assistant Pro.',
    BONUS_CLOSED: 'خلصت رسايلك النهارده 😅 — رسايل زيادة بتفتح لما يكون فيه رصيد فاضي، جرّب كمان شوية أو بكره.',
    FREE_OFF: 'Mini Assistant مش متاح دلوقتي 🙏 جرّب كمان شوية.',
    AI_ERROR: 'حصلت لخبطة صغيرة 😅 جرّب تبعت تاني.'
};

export async function onRequest(context) {
    const { request, env } = context;
    const url = new URL(request.url);
    const action = url.searchParams.get('action') || '';
    const db = getDb(env);
    if (!db) return bad('Database not connected', 500);
    try {
        await ensureAppSchema(db);
        await ensureTables(db);
        const who = await whoIs(request, env, db, url);
        if (who.error) return who.error;
        const sid = who.student.id, staffId = who.preview ? who.staff.id : null;
        const L = limits(env);
        const ownThread = async (id) => id ? await db.prepare(`SELECT * FROM tutor_threads WHERE id = ? AND student_id = ? AND ${staffId ? 'staff_id = ?' : 'staff_id IS NULL'}`).bind(...[id, sid, ...(staffId ? [staffId] : [])]).first() : null;
        const today = async () => ({ messages: await kvGet(db, counterKey(who, 'msgs')), images: await kvGet(db, counterKey(who, 'imgs')), limits: L });
        // in an online exam RIGHT NOW? → the assistant waits. "Right now" = a started, unsubmitted attempt on an exam that
        // is still open AND began within the exam's time limit (or the last 3 hours if it has none) — so a student who
        // opened an exam and walked away isn't locked out for days. julianday() reads both stored date formats.
        const inExam = async () => !!(await db.prepare(`SELECT 1 FROM exam_submissions s JOIN exams e ON e.id = s.exam_id
            WHERE s.student_id = ? AND s.status = 'started' AND julianday(e.expires_at) > julianday('now')
              AND (s.started_at IS NULL OR (julianday('now') - julianday(s.started_at)) * 1440 < COALESCE(NULLIF(e.time_limit_minutes, 0), 180)) LIMIT 1`).bind(sid).first().catch(() => null));

        // Pro for this student right now? (Preview: always, paid as staff use)
        const proNow = async () => !claudeReady(env) ? { ok: false, code: 'PAID_OFF' } : who.preview ? { ok: true } : await studentAccess(db, sid);
        if (action === 'status') {
            const u = await usageSummary(env, db);
            const pa = await proNow();
            const proModel = { tier: 'pro', name: BRANDS.pro.name, ready: !!pa.ok, locked: !pa.ok, code: pa.ok ? null : pa.code,
                note: pa.ok ? 'من كتابك · From your book' : pa.code === 'STUDENT_CAP' ? 'خلص رصيد الشهر' : pa.code === 'STUDENT_OFF' ? 'اطلب تفعيله من مس مروة' : 'Coming soon',
                leftPct: pa.quota && pa.quota.budgetUsd > 0 ? Math.max(0, Math.min(100, Math.round(pa.quota.leftUsd / pa.quota.budgetUsd * 100))) : null };
            return json({
                preview: who.preview, open: isOpen(env), title: ME,
                student: { id: sid, firstName: who.student.firstName, gender: who.student.gender, grade: who.student.grade },
                models: [
                    { tier: 'free', name: BRANDS.free.name, note: 'Free', ready: aiReady(env) && (who.preview || isOpen(env)) },
                    proModel
                ],
                today: await today(), available: !u.freeQuotaHit && u.pools.student.left > 0, inExam: await inExam()   // no unit numbers on the student side
            });
        }
        if (action === 'thread') {   // the latest chat (students see one running chat + "New chat")
            const t = await db.prepare(`SELECT * FROM tutor_threads WHERE student_id = ? AND ${staffId ? 'staff_id = ?' : 'staff_id IS NULL'} ORDER BY updated_at DESC, id DESC LIMIT 1`).bind(...[sid, ...(staffId ? [staffId] : [])]).first();
            if (!t) return json({ thread: null, messages: [] });
            const { results } = await db.prepare('SELECT * FROM tutor_messages WHERE thread_id = ? ORDER BY id DESC LIMIT 200').bind(t.id).all();
            return json({ thread: { id: t.id, title: t.title }, messages: (results || []).reverse().map(msgOut) });
        }
        if (action === 'image') return serveImage(env, db, parseInt(url.searchParams.get('id'), 10), (info) => info.kind === 'ai-student' && info.student_id === sid && (staffId ? Number(info.owner_id) === Number(staffId) : !info.owner_id));
        if (action === 'mine') {   // exact data for the welcome screen (no AI, costs nothing)
            const d = await myData(db, who.student);
            return json({ cards: cardsFor(['me', 'todo', 'lessons'], d) });
        }
        if (request.method !== 'POST') return bad('POST only', 405);
        const data = await request.json().catch(() => ({}));

        if (action === 'new') {
            const r = await db.prepare('INSERT INTO tutor_threads (student_id, staff_id, title) VALUES (?, ?, ?)').bind(sid, staffId, 'New chat').run();
            return json({ thread: { id: Number(r.meta.last_row_id), title: 'New chat' }, messages: [] });
        }

        if (action === 'send') {
            const tier = data.tier === 'pro' ? 'pro' : 'free';
            if (tier === 'pro') {
                const pa = await proNow();
                if (!pa.ok) return bad(PRO_MSG[pa.code] || `${BRANDS.pro.name} جاي قريب جداً 🚀`, pa.code === 'STUDENT_CAP' ? 429 : 403, { code: pa.code === 'PRO_CLOSED' || pa.code === 'PAID_OFF' ? 'PRO_LOCKED' : pa.code });
            } else if (!who.preview && !isOpen(env)) return bad('Mini Assistant جاي قريب 🚀 — استخدم Miss Marwa Assistant Pro.', 403, { code: 'FREE_CLOSED' });
            let text = String(data.text || '').replace(/\r/g, '').trim();
            const img = readImage(data.image);
            if (img && img.error) return bad(img.error, 400);
            if (!text && img) text = 'حل السؤال اللي في الصورة 📷';
            if (!text) return bad('اكتب سؤالك الأول 🙂', 400);
            if (text.length > MAX_TEXT) return bad(`السؤال طويل شوية — خليه أقل من ${MAX_TEXT} حرف`, 400);
            if (await inExam()) return bad('إنت في امتحان دلوقتي 📝 — خلّص امتحانك الأول وبعدين أنا معاك على طول 😉', 423, { code: 'EXAM_LOCK' });
            // "what can you do?" → a fixed, always-correct list (no AI, doesn't use a daily message)
            const cap = !img && isCapabilityQuestion(text);
            const t0 = await today();
            const free = tier === 'free';
            const bonus = free && !cap && t0.messages >= L.messages;   // past their own daily messages → only from today's leftover
            if (free && !cap && t0.messages >= L.max) return bad(`خلصت رسايل Mini Assistant بتاعة النهارده 😅 — بترجع بكره الساعة 2 بالليل، أو جرّب ${BRANDS.pro.name}.`, 429, { code: 'DAILY_LIMIT', today: t0 });
            if (free && bonus && !(await bonusOpen(env, db))) return bad(`خلصت رسايلك النهارده (${L.messages}) 😅 — رسايل زيادة بتفتح لما يكون فيه رصيد فاضي، جرّب كمان شوية أو بكره.`, 429, { code: 'BONUS_CLOSED', today: t0 });
            if (free && img && t0.images >= L.images) return bad(`مسموح بصورة واحدة في اليوم على Mini Assistant 📷 — لو عايز تبعت صور أكتر جرّب ${BRANDS.pro.name} 🚀`, 429, { code: 'IMAGE_LIMIT', today: t0 });

            let t = await ownThread(parseInt(data.threadId, 10));
            if (data.threadId && !t) return bad('Chat not found', 404);
            if (!t) {
                const r = await db.prepare('INSERT INTO tutor_threads (student_id, staff_id, title) VALUES (?, ?, ?)').bind(sid, staffId, text.split('\n')[0].slice(0, 60)).run();
                t = await ownThread(Number(r.meta.last_row_id));
            }
            const imageId = img ? await saveImage(env, db, img, { kind: 'ai-student', studentId: sid, ownerId: staffId }) : null;
            const ur = await db.prepare(`INSERT INTO tutor_messages (thread_id, role, text, image_id) VALUES (?, 'user', ?, ?)`).bind(t.id, text, imageId).run();
            const userMsg = { id: Number(ur.meta.last_row_id), role: 'user', text, image_id: imageId, created_at: new Date().toISOString() };
            if (img && context.waitUntil) context.waitUntil(purgeOldImages(env, db));

            if (cap) {
                const r = await db.prepare(`INSERT INTO tutor_messages (thread_id, role, text, tier, model, ms) VALUES (?, 'assistant', ?, 'free', 'built-in', 0)`).bind(t.id, capabilitiesForStudent(who.student, 'free')).run();
                await db.prepare('UPDATE tutor_threads SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(t.id).run();
                const saved = await db.prepare('SELECT * FROM tutor_messages WHERE id = ?').bind(Number(r.meta.last_row_id)).first();
                return json({ threadId: t.id, user: msgOut(userMsg), reply: msgOut(saved), today: await today() });
            }
            const d = await myData(db, who.student);
            const intents = img ? [] : studentIntent(text);
            const cards = cardsFor(intents, d);
            const science = !intents.length && isScienceQuestion(text);   // the Pro note follows real science questions only
            const kind = img ? 'exam' : intents.length ? 'other' : askKind(text);   // ✅ answer line only on real exam questions
            if (free && img) cards.push({ type: 'upgrade', text: NOTE_IMAGE, tier: 'pro' });
            else if (free && science) cards.push({ type: 'upgrade', text: NOTE_TEXT, tier: 'pro' });
            const { results: hist } = await db.prepare(`SELECT role, text FROM tutor_messages WHERE thread_id = ? AND role IN ('user', 'assistant') AND id <= ? ORDER BY id DESC LIMIT ?`).bind(t.id, userMsg.id, HISTORY).all();
            const messages = (hist || []).reverse().map(m => ({ role: m.role, content: m.text }));
            const save = async (f) => {
                const r = await db.prepare(`INSERT INTO tutor_messages (thread_id, role, text, tier, model, ms, neurons, cost_usd, error, cards) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                    .bind(t.id, f.role || 'assistant', f.text, tier, f.model ?? null, f.ms ?? null, f.neurons ?? null, f.cost ?? null, f.error ?? null, f.cards ?? null).run();
                await db.prepare('UPDATE tutor_threads SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(t.id).run();
                return db.prepare('SELECT * FROM tutor_messages WHERE id = ?').bind(Number(r.meta.last_row_id)).first();
            };
            try {
                let out;
                if (free) {
                    out = await chat(env, db, { tier: 'free', pool: 'student', system: tutorPrompt(d, 'free') + (img ? IMAGE_RULES : '') + (intents.length ? '' : taskRules(kind, 'free')), messages: [...EXAMPLES, ...messages], maxTokens: img ? 900 : 850, temperature: 0.5, image: img && !img.error ? img : null, bonus });
                    await kvAdd(db, counterKey(who, 'msgs'), 1);
                    if (img) await kvAdd(db, counterKey(who, 'imgs'), 1);
                } else {
                    // Pro: the student's own grade book is the ONLY source for science (strict — audited 20 Nov 2026).
                    // The question (+ the previous one, for follow-ups like «طب والوحدة؟») or the PHOTO → search terms → passages.
                    const payer = who.preview ? { staffId: who.staff.id } : { studentId: sid };
                    const prevQ = messages.filter(m => m.role === 'user').slice(-2, -1).map(m => m.content).join(' ');
                    const found = intents.length ? null : await searchBook(env, db, { grade: who.student.grade, text: `${text} ${prevQ}`.trim(), refText: text, image: img && !img.error ? img : null, meter: payer, unitChars: 9000 });
                    const gl = GRADE_LABEL[who.student.grade] || who.student.grade;
                    const books = !found || !found.science ? '' : bookRules(found.ctx, gl, { indexed: found.indexed, ref: found.ref, refMissing: found.refMissing });
                    out = await chat(env, db, { tier: 'pro', system: tutorPrompt(d, 'pro', { books: !!(found && found.ctx.text) }) + (img ? IMAGE_RULES : '') + books + (intents.length ? '' : taskRules(kind, 'pro')),
                        messages: [...EXAMPLES, ...messages], maxTokens: img ? 1300 : 1100, image: img && !img.error ? img : null,
                        meter: who.preview ? { staffId: who.staff.id, kind: 'chat' } : { studentId: sid, kind: 'chat' } });
                }
                const saved = await save({ text: (kind === 'exam' ? out.text : dropAnswerLine(out.text)) || '…', model: out.model, ms: out.ms, neurons: out.neurons, cost: out.costUsd, cards: cards.length ? JSON.stringify(cards) : null });
                return json({ threadId: t.id, user: msgOut(userMsg), reply: msgOut(saved), today: await today() });
            } catch (e) {
                const code = e instanceof AiLimitError ? e.code : 'AI_ERROR';
                // their own data is still shown even when the AI can't answer (costs nothing)
                const dataCards = cards.filter(c => c.type !== 'upgrade');
                if (dataCards.length) {
                    const saved = await save({ text: 'دي أرقامك من على المنصة 👇', error: code, cards: JSON.stringify(dataCards) });
                    return json({ threadId: t.id, user: msgOut(userMsg), reply: msgOut(saved), today: await today(), aiError: { code } });
                }
                await save({ role: 'error', text: FRIENDLY[code] || FRIENDLY.AI_ERROR, error: code });
                return json({ error: FRIENDLY[code] || FRIENDLY.AI_ERROR, code, threadId: t.id, user: msgOut(userMsg), today: await today() }, ['POOL_EMPTY', 'BONUS_CLOSED', 'STUDENT_CAP', 'DAILY_CAP', 'MONTHLY_CAP'].includes(code) ? 429 : code === 'STUDENT_OFF' ? 403 : ['FREE_OFF', 'PAID_OFF'].includes(code) ? 503 : 502);
            }
        }
        return bad('Unknown action', 404);
    } catch (err) {
        console.error('tutor error', err);
        return bad('حصلت مشكلة — جرّب تاني 🙏', 500);
    }
}
