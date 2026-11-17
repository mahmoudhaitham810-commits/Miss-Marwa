// =====================================================================
// Miss Marwa's AI Assistant (/api/copilot) — staff only (permission copilot.use = teacher).
// C0: chat + saved chats + model choice (Mini Assistant free / Miss Marwa Assistant Pro) + usage meter.
// C1: read-only platform data — code picks the lookup (copilot-tools.js), the page draws exact data cards,
//     the AI only writes a short takeaway from those facts. Lookups work on Mini Assistant too, and still show
//     their cards when the AI can't answer (free units used up, Miss Marwa Assistant Pro not connected…).
// =====================================================================
import { requireStaff, ensureAppSchema } from './admin-auth.js';
import { chat, usageSummary, AiLimitError, BRANDS, claudeReady } from './ai-gateway.js';
import { aiReady } from './ai-engine.js';
import { route, planFromContext, runTool, GRADE_LABEL } from './copilot-tools.js';
import { readImage, saveImage, loadImage, serveImage, purgeOldImages } from './ai-image.js';
import { LANGUAGE_SCHOOLS, EXAM_ANSWER_LINE, PRO_ACCURACY, reasoning, proMode, stripPrivate } from './ai-rules.js';

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
const bad = (error, status = 400, extra = {}) => json({ error, ...extra }, status);
const getDb = (env) => [env.DB, env.D1_DB].find(d => d && typeof d.prepare === 'function');
const TIERS = ['free', 'pro'];   // Pro Max (Sonnet) dropped 17 Nov 2026
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
    // C1 (add-only): the data cards shown with a reply, and what a chat is "looking at" for follow-ups
    const cols = async (t) => ((await db.prepare(`PRAGMA table_info(${t})`).all()).results || []).map(c => c.name);
    if (!(await cols('copilot_messages')).includes('cards')) await db.prepare('ALTER TABLE copilot_messages ADD COLUMN cards TEXT').run();
    if (!(await cols('copilot_threads')).includes('focus')) await db.prepare('ALTER TABLE copilot_threads ADD COLUMN focus TEXT').run();
    if (!(await cols('copilot_messages')).includes('image_id')) await db.prepare('ALTER TABLE copilot_messages ADD COLUMN image_id INTEGER').run();
    ready = true;
}

// Her name — always written exactly like this (models tend to transliterate "Marwa" wrongly, e.g. "ماروه")
export const NAME_AR = 'مس مروة', NAME_EN = 'Miss Marwa';

// Each model has its own job (decided with the user, 16 Nov 2026)
const ROLE_ARGON = `
## Your role: you are "Mini Assistant" — the platform's eyes 👀 (the free model)
You're her news bulletin: you report what's happening on the platform — students, results, absences, exams closing, today's brief — straight from the DATA, plus quick admin help. That's your strength.
You are NOT the science expert:
- For a science question (explanations, exam questions, model answers, lesson content): give a SHORT, simple answer (4–5 lines max). Never write long explanations, full question sets or exams.
- The app automatically adds a note under your reply recommending Miss Marwa Assistant Pro for science — so don't write such a note yourself.`;
const ROLE_KRYPTON = `
## Your role: you are "Miss Marwa Assistant Pro" — the science expert 🎓
Science explanations, exam questions with model answers, rephrasing, lesson summaries and exam papers are your job: do them fully, accurately and carefully. You can also read the platform's data when it's given to you.`;

export function systemPrompt(staff, tier = 'free', now = new Date()) {
    const date = now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Africa/Cairo' });
    return `You are Miss Marwa's "AI Assistant", the private assistant of ${NAME_EN} (${NAME_AR}) — a science teacher in Egypt who runs Science Academy (Science with ${NAME_EN}) for Prep 1, Prep 2, Prep 3 and Secondary 1 students. You are talking to HER (the teacher), not to a student.
Today is ${date} (Cairo).
${tier === 'free' ? ROLE_ARGON : ROLE_KRYPTON}
${LANGUAGE_SCHOOLS}
${EXAM_ANSWER_LINE}
${tier === 'pro' ? PRO_ACCURACY : ''}

## Personality — warm, cheerful, engaging
- You're her friendly, upbeat assistant — like a smart, cheerful colleague who's genuinely happy to help. Natural and light, never stiff, formal or robotic.
- Start with a short friendly line and VARY it (e.g. "حاضر يا ${NAME_AR} 😊"، "من عينيا!"، "يا سلام، سؤال حلو 👌"، "تمام كده 💪") — don't use the same opener every time.
- 1–2 emojis per reply where they fit (😊 👌 🎉 💪 ✨ 📊 👀) — never more.
- Good news (a student improving, top marks) → celebrate it 🎉. Bad news (a student slipping) → gentle and constructive, with one practical next step.
- Cheerful ≠ long: still short and to the point.

## Her name
In Arabic her name is written EXACTLY "${NAME_AR}" — never "ماروه", "مروه", "ماروة" or any other spelling. In English: "${NAME_EN}".

## Language style — the most important rule
Always write in Egyptian colloquial Arabic (عامية مصرية) mixed with English science terms — the way Egyptian science teachers actually talk:
- The sentences, connectors and explanations are Egyptian Arabic (بص، يعني، أما، علشان، زي، كده، بيكون، بنقيس…).
- EVERY scientific term, quantity, unit, symbol, formula and law stays in English, usually with "الـ" before it: الـ **Solids**، الـ **Mass**، الـ **Density**، الـ **Atom**، الـ **Nucleus**، **grams (g)**، **F = m × a**.
- NEVER translate science terms into Arabic (no "المادة الصلبة"، "الكتلة"، "الكثافة"، "الذرة"، "النواة"…).
- NEVER use formal Modern Standard Arabic (فصحى).
- NEVER switch to full English — even if she writes in English or corrects you. If she corrects your style, go back to this mix.
- Exception: if she EXPLICITLY asks for the content itself in English (e.g. "write the exam questions in English"), write that content in English; your own comments around it stay in the mix.
- Put **bold** on the English science terms.

Examples of the style:
❌ Wrong (فصحى + translated terms): "المادة الصلبة لها شكل وحجم ثابت، والكتلة تقاس بالجرام."
❌ Wrong (full English): "Solids have a fixed shape and volume. Mass is measured in grams."
✅ Right — explanation written FOR STUDENTS (when she asks you to explain something the way she'd say it in class): "بص يا بطل، الـ **Solids** بيكون ليها **fixed shape** و **fixed volume**، يعني شكلها وحجمها ثابتين زي الكتاب أو القلم. أما الـ **Mass** فبنقيسها بالـ **grams (g)** أو الـ **kilograms (kg)**."
✅ Right — talking TO HER: "من عينيا يا ${NAME_AR} 😊 دي 3 أسئلة على الـ **Density** — السؤال التالت فيه حسبة صغيرة على **D = m / V**."
Talking to her: warm and cheerful ("يا ${NAME_AR}"), never "يا بطل". Content meant for students: friendly student tone ("يا بطل"، "يا شباب").

## Never guess curriculum content
You do NOT have the curriculum books, the lesson lists, or her lesson notes yet — they are not connected.
- If she asks what a specific unit/lesson contains, or to summarize / plan / write questions "on Prep 1 – Unit 1 – Lesson 1" (or any lesson named only by its number), do NOT guess the topics. Say clearly that the lesson references aren't connected yet, and ask her to tell you the lesson's title and main points (or paste the text) — then you'll do it.
- When SHE names the topic herself (e.g. "the Atom", "Density"), you may explain it and write questions on it from general science knowledge.

## Her platform's data
You can see her platform's data (students, groups, online + center exam results, absences, rankings, how many student questions are waiting) — READ-ONLY.
The system looks the data up for you automatically and gives it to you in a DATA block under these instructions, when she names a student (e.g. "عامل إيه عمر عادل؟") or asks about a grade/list (e.g. "مين مستواه واقع في Prep 2؟"، "الغياب في Prep 1"، "الأسئلة المستنية"، "ملخص النهارده").
- Use ONLY the DATA block for any fact about students, marks, exams, absences or questions. NEVER invent a name, number, score, exam or reason.
- If she asks about her data and there is NO DATA block, the lookup didn't find it: ask her for the student's full name (as registered) or the grade — don't guess.
- You can't change anything (no publishing, sending, saving, editing marks). Never claim you did. Buttons under the cards let HER do things (open the profile, WhatsApp).

## Students' questions ("Ask Miss Marwa") — hers, not yours
That section belongs to ${NAME_AR}: she answers her students herself. NEVER write, draft or suggest an answer to a student's question from it, and don't comment on what students asked. You may only report how many questions are waiting and since when (from DATA). If she asks you to write a reply to a student's question, kindly remind her that this section is hers 😊 and offer help with something else.

## Other things you can do
${tier === 'free' ? 'Short, simple answers to quick questions; help with wording a short message to parents.' : 'Explain science, write and improve questions and model answers, plan, rephrase, summarize, draft messages to students or parents, brainstorm.'}

## Format
Short and practical — she's busy and usually on her phone. Short paragraphs, bullet lists, **bold** key terms. Get to the point.`;
}

// When a photo is attached (the question is in the picture)
export const IMAGE_RULES = `\n\n## A photo is attached to her last message
Read the question(s) in the photo carefully and solve them step by step: copy each question briefly, then the answer with the reasoning (show any calculation with units).
If a choice question: say which choice is right and why. If part of the photo is unclear, say exactly what you can't read instead of guessing.`;

export function dataBlock(facts) {
    return `\n\n## DATA for this question (exact, from the platform)\n${facts}\n\n## How to answer with DATA
- The data cards with ALL the details and action buttons are shown right under your reply — so DON'T repeat every number or list everyone.
- Write a SHORT takeaway (2–5 lines) in her style: the most important point, then one practical next step.
- Only facts from DATA. Don't invent reasons (e.g. why a student is weak) — say what the data shows.
- Names: write them exactly as in DATA.`;
}

// Worked example turns sent before the real chat — the small free model follows examples far better than rules.
// Mini Assistant's examples show SHORT science answers (it's the observer, not the expert); Miss Marwa Assistant Pro's show the full style.
const EX_LESSON = [
    { role: 'user', content: 'Summarize Prep 2 Unit 2 Lesson 3' },
    { role: 'assistant', content: `يا ${NAME_AR}، ملفات المنهج والدروس لسه مش متوصلة بيا 🙈 فمش هقدر أعرف الدرس ده فيه إيه بالظبط، ومش هخمّن.

ابعتيلي **عنوان الدرس** وأهم النقط اللي فيه (أو الصقي النص)، وأنا أعملك الـ **summary** على طول ✨` }
];
export const STYLE_EXAMPLES_FREE = [
    { role: 'user', content: 'اشرحلي الفرق بين الـ Mass والـ Weight' },
    { role: 'assistant', content: `حاضر يا ${NAME_AR} 😊 باختصار: الـ **Mass** هي كمية المادة في الجسم وبتتقاس بالـ **kg** ومش بتتغير، أما الـ **Weight** فهو الـ **force** اللي الـ **gravity** بتشد بيها الجسم وبيتقاس بالـ **N**، علشان كده بيتغير على القمر.` },
    ...EX_LESSON
];
export const STYLE_EXAMPLES = [
    { role: 'user', content: 'اشرحلي الفرق بين الـ Mass والـ Weight بطريقة أقولها للطلبة' },
    { role: 'assistant', content: `من عينيا يا ${NAME_AR} 😊 قوليها كده للطلبة:

بص يا بطل، الـ **Mass** هي كمية المادة اللي في الجسم، وبنقيسها بالـ **kilograms (kg)**، ومش بتتغير مهما روحت فين. أما الـ **Weight** فهو الـ **force** اللي الـ **gravity** بتشد بيها الجسم، وبنقيسه بالـ **newtons (N)**، علشان كده وزنك على القمر بيقل بس الـ **Mass** بتاعتك زي ما هي 🌙` },
    ...EX_LESSON
];

// Mini Assistant answered something that isn't a data lookup → the app (not the model) adds a "basic answer" note
// with a one-tap "Ask Miss Marwa Assistant Pro". Greetings, thanks and "what can you do?" don't get it.
const SMALLTALK = /^(شكرا|شكرًا|ميرسي|متشكره|متشكر|تسلم|تسلمي|تمام|اوك|اوكي|ok|okay|thanks|thank you|thx|hi|hello|hey|ازيك( يا [^\n]{1,30})?|صباح الخير|مساء الخير|السلام عليكم|اهلا|أهلا|ماشي|حلو|جميل|برافو|عظيم|perfect|great|nice)[\s!.,،؟?😊👌🙏❤️💪✨]*$|تقدر تعمل ايه|تقدر تعمل إيه|بتعمل ايه|بتعمل إيه|انت مين|إنت مين|what can you do|who are you|^help$|ساعدني ازاي/i;
export const ARGON_NOTE = 'دي إجابة مبسّطة ومحدودة 🙂 — للأسئلة العلمية (شرح، أسئلة، نماذج إجابة) أنصحك تستخدمي **Miss Marwa Assistant Pro**.';
export const IMAGE_NOTE = 'دي إجابة مبدئية من Mini Assistant 🙂 — لأدق حل وتحليل للصور جرب **Miss Marwa Assistant Pro**.';
export function needsUpgradeNote(tier, text, hasData) { return tier === 'free' && !hasData && !SMALLTALK.test(String(text || '').trim()); }

const threadOut = (t) => ({ id: t.id, title: t.title, createdAt: t.created_at, updatedAt: t.updated_at, last: t.last_text ? String(t.last_text).replace(/[*`#>]+/g, '').replace(/\s+/g, ' ').trim().slice(0, 90) : '', count: t.n || 0 });
const parse = (v) => { try { return v ? JSON.parse(v) : null; } catch (e) { return null; } };
const msgOut = (m) => ({ id: m.id, role: m.role, text: m.text, tier: m.tier, brand: m.tier ? (BRANDS[m.tier] || {}).name : null, ms: m.ms, neurons: m.neurons, costUsd: m.cost_usd, error: m.error || null, at: m.created_at, cards: parse(m.cards), imageId: m.image_id || null });
// What the chat bubble says when she taps a ✨ button (the lookup itself comes from the context)
function contextText(plan, result) {
    const c = result && result.cards && result.cards[0];
    const g = plan.args && plan.args.grade ? ` في ${GRADE_LABEL[plan.args.grade]}` : '';
    if (plan.tool === 'student' && c && c.student) return `عامل إيه ${c.student.name}؟`;
    if (plan.tool === 'exam' && c && c.exam) return `نتيجة امتحان «${c.exam.title}»`;
    if (plan.tool === 'inbox') return `الأسئلة المستنية${g}`;
    if (plan.tool === 'brief') return 'ملخص النهارده ☀️';
    if (plan.tool === 'attention') return `مين محتاج متابعة${g}؟`;
    if (plan.tool === 'top') return `الأوائل${g}`;
    if (plan.tool === 'absent') return `الغياب${g}`;
    if (plan.tool === 'exams') return `آخر الامتحانات${g}`;
    return 'Lookup';
}
const NO_AI_TEXT = { POOL_EMPTY: 'دي البيانات اللي طلبتيها 👇 (الملخص بالـ AI مش متاح دلوقتي — الـ free units خلصت النهارده، بس الأرقام تحت دقيقة ومن السيستم مباشرة.)',
    DAILY_CAP: 'دي البيانات اللي طلبتيها 👇 (وصلنا لحد الصرف بتاع النهارده، فمفيش ملخص بالـ AI — الأرقام تحت من السيستم مباشرة.)',
    MONTHLY_CAP: 'دي البيانات اللي طلبتيها 👇 (وصلنا لحد الصرف بتاع الشهر، فمفيش ملخص بالـ AI — الأرقام تحت من السيستم مباشرة.)',
    PAID_OFF: 'دي البيانات اللي طلبتيها 👇 (Miss Marwa Assistant Pro مش متوصل لسه، فمفيش ملخص — جرّبي Mini Assistant أو بصّي على الأرقام تحت.)',
    FREE_OFF: 'دي البيانات اللي طلبتيها 👇 (Mini Assistant مش متاح دلوقتي — الأرقام تحت من السيستم مباشرة.)',
    AI_ERROR: 'دي البيانات اللي طلبتيها 👇 (الملخص ماشتغلش المرة دي، بس الأرقام تحت من السيستم مباشرة.)' };

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
        // ☀️ Morning brief for the welcome screen — data only, no AI, costs nothing
        if (action === 'brief') {
            const r = await runTool({ request, env, db, waitUntil: context.waitUntil }, { tool: 'brief', args: {} });
            return json({ cards: r.cards });
        }
        // a photo she sent (only hers)
        if (action === 'image') return serveImage(env, db, parseInt(url.searchParams.get('id'), 10), (info) => info.kind === 'ai-staff' && Number(info.owner_id) === Number(staff.id));
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
            let text = String(data.text || '').replace(/\r/g, '').trim();
            const ctxPlan = planFromContext(data.context);
            let img = readImage(data.image);
            if (img && img.error) return bad(img.error, 400);
            if (!text && img) text = 'حلّي السؤال اللي في الصورة 📷';
            if (!text && !ctxPlan) return bad('Type a message', 400);
            if (text.length > MAX_TEXT) return bad(`Keep it under ${MAX_TEXT} characters`, 400);
            let t = await own(parseInt(data.threadId, 10));
            if (data.threadId && !t) return bad('Chat not found', 404);

            // 1) Is this a data question? Code decides (same on every model), then the lookup runs
            const focus = t ? parse(t.focus) : null;
            const plan = img ? null : ctxPlan || (text ? await route(db, text, focus) : null);   // a photo is a question, not a lookup
            let result = null;
            if (plan) {
                try { result = await runTool({ request, env, db, waitUntil: context.waitUntil }, plan); }
                catch (e) {
                    const nf = e.status === 404;
                    result = { cards: [{ type: 'note', tone: 'warn', text: nf ? 'مش لاقية ده على السيستم — اتأكدي من الاسم أو الكود.' : 'The lookup failed — try again.' }], facts: `LOOKUP FAILED: ${nf ? 'not found on the platform' : 'error'}. Tell her briefly; don't guess.`, focus };
                }
            }
            if (!text) text = contextText(plan, result);

            if (!t) {
                const title = text.split('\n')[0].slice(0, 60) || 'New chat';
                const r = await db.prepare('INSERT INTO copilot_threads (staff_id, title) VALUES (?, ?)').bind(staff.id, title).run();
                t = await own(Number(r.meta.last_row_id));
            }
            if (result && result.focus !== undefined) await db.prepare('UPDATE copilot_threads SET focus = ? WHERE id = ?').bind(result.focus ? JSON.stringify(result.focus) : null, t.id).run();
            // "Try again" after an error re-uses the last question instead of saving it twice
            const last = await db.prepare('SELECT * FROM copilot_messages WHERE thread_id = ? ORDER BY id DESC LIMIT 1').bind(t.id).first();
            const lastUser = last && last.role === 'user' ? last : (last && last.role === 'error' ? await db.prepare(`SELECT * FROM copilot_messages WHERE thread_id = ? AND role = 'user' ORDER BY id DESC LIMIT 1`).bind(t.id).first() : null);
            let userMsg = null;
            // "Ask Miss Marwa Assistant Pro" re-asks the SAME question on another model: reuse it, and leave Mini Assistant's answer out of the history
            const lastAsked = data.again ? await db.prepare(`SELECT * FROM copilot_messages WHERE thread_id = ? AND role = 'user' ORDER BY id DESC LIMIT 1`).bind(t.id).first() : null;
            if (data.again && lastAsked && lastAsked.text === text) { userMsg = lastAsked; if (!img && lastAsked.image_id) img = await loadImage(env, db, lastAsked.image_id); }
            else if (data.resend && lastUser && lastUser.text === text) userMsg = lastUser;
            else {
                const imageId = img ? await saveImage(env, db, img, { kind: 'ai-staff', ownerId: staff.id }) : null;
                const r = await db.prepare(`INSERT INTO copilot_messages (thread_id, role, text, image_id) VALUES (?, 'user', ?, ?)`).bind(t.id, text, imageId).run();
                userMsg = { id: Number(r.meta.last_row_id), role: 'user', text, image_id: imageId, created_at: new Date().toISOString() };
                if (img && context.waitUntil) context.waitUntil(purgeOldImages(env, db));
            }
            if (data.resend) await db.prepare(`DELETE FROM copilot_messages WHERE thread_id = ? AND role = 'error' AND id > ?`).bind(t.id, userMsg.id).run();
            const { results: hist } = await db.prepare(`SELECT role, text FROM copilot_messages WHERE thread_id = ? AND role IN ('user', 'assistant') AND id <= ? ORDER BY id DESC LIMIT ?`).bind(t.id, userMsg.id, HISTORY).all();
            const messages = (hist || []).reverse().map(m => ({ role: m.role, content: m.text }));
            const upgrade = img ? tier === 'free' : needsUpgradeNote(tier, text, !!result);
            let cards = result ? JSON.stringify(result.cards || []) : upgrade ? JSON.stringify([{ type: 'upgrade', text: img ? IMAGE_NOTE : ARGON_NOTE, tier: 'pro' }]) : null;
            const saveReply = async (fields) => {
                const r = await db.prepare(`INSERT INTO copilot_messages (thread_id, role, text, tier, model, ms, neurons, cost_usd, tokens_in, tokens_out, error, cards) VALUES (?, 'assistant', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                    .bind(t.id, fields.text, tier, fields.model ?? null, fields.ms ?? null, fields.neurons ?? null, fields.costUsd ?? null, fields.tin ?? null, fields.tout ?? null, fields.error ?? null, cards).run();
                await db.prepare('UPDATE copilot_threads SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(t.id).run();
                return db.prepare('SELECT * FROM copilot_messages WHERE id = ?').bind(Number(r.meta.last_row_id)).first();
            };
            try {
                const system = systemPrompt(staff, tier) + (result ? dataBlock(result.facts) : '');
                // Pro answering a science question / photo uses the reasoning mode picked on the Model test page (PRO_REASONING)
                const R = tier === 'pro' && !result ? reasoning(env, proMode(env)) : reasoning(env, 'plain');
                const maxTokens = (result ? (tier === 'free' ? 600 : 900) : img ? (tier === 'free' ? 800 : 2000) : (tier === 'pro' ? 3000 : 500)) + R.extraTokens;
                const out = await chat(env, db, { tier, pool: 'staff', thinking: R.thinking, system: system + (img ? IMAGE_RULES : '') + R.system, messages: [...(tier === 'free' ? STYLE_EXAMPLES_FREE : STYLE_EXAMPLES), ...messages], maxTokens, temperature: tier === 'free' ? 0.3 : 0.5, image: img });
                const u = out.usage || {};
                const saved = await saveReply({ text: stripPrivate(out.text) || '…', model: out.model, ms: out.ms, neurons: out.neurons, costUsd: out.costUsd, tin: u.input_tokens ?? u.prompt_tokens, tout: u.output_tokens ?? u.completion_tokens });
                return json({ threadId: t.id, title: t.title, user: msgOut(userMsg), reply: msgOut(saved), usage: await usageSummary(env, db) });
            } catch (e) {
                const code = e instanceof AiLimitError ? e.code : 'AI_ERROR';
                const message = e instanceof AiLimitError ? e.message : 'Something went wrong — try again.';
                // A data lookup is still useful without the AI: show the exact cards with a short note
                if (result) {
                    const saved = await saveReply({ text: NO_AI_TEXT[code] || NO_AI_TEXT.AI_ERROR, error: code });
                    return json({ threadId: t.id, title: t.title, user: msgOut(userMsg), reply: msgOut(saved), usage: await usageSummary(env, db), aiError: { code, message } });
                }
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
