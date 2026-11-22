// "Make it a PDF" — for Miss Marwa's AI Assistant AND the students' chat (same content, same template).
// The chat's own solutions (+ the questions of the worksheet attached in that chat) → a structured worked-solutions
// document: each question followed by its full answer (given, conversions + why, law + why, steps, answer, tip).
// The browser draws it with StudioRender.solutionsHtml and downloads the branded PDF.
import { chat } from './ai-gateway.js';
import { PRO_ACCURACY } from './ai-rules.js';

// "put it in a PDF / اعمله PDF / حطهم في ملف PDF" — a request to MAKE a PDF (not "here is a PDF, solve it")
const VERB = '(حط|عمل|خلي|خلى|حول|طلع|جهز|نزل|ابعت|بعت|عايز|عاوز|محتاج|ممكن|اكتب|put|make|turn|export|convert|save|give me|create|generate|want|need|prepare)';
const PDFW = '(pdf|بي ?دي ?[اإ]ف|بى ?دى ?[اإ]ف)';
const MAKE_PDF = new RegExp(`${VERB}[^\\n]{0,60}${PDFW}|${PDFW}[^\\n]{0,25}(فيه|فيها|بالاجابات|بالإجابات|بالحل|with the answers|of the answers)`, 'i');
export const wantsPdf = (text) => MAKE_PDF.test(String(text || ''));
/** "اعملي امتحان … PDF" → a practice exam (questions, then a Model Answer page) instead of the chat's solutions */
export const wantsExam = (text) => /امتحان|امتحني|اختبار|اختبرني|كويز|exam|quiz|\btest\b/i.test(String(text || ''));
/** "سيب بصمتك" / "with your mark" → the AI mark on the PDF (Miss Marwa: on request; students: always) */
export const wantsMark = (text) => /بصم|بصمت|بصمه|بصمة|توقيع|ختم|signature|watermark|imprint|your mark|ai mark/i.test(String(text || ''));

// the worksheet attached in a chat (its text) — kept so a later "make it a PDF" can quote the questions exactly
async function ensure(db) {
    await db.prepare(`CREATE TABLE IF NOT EXISTS ai_thread_docs (scope TEXT NOT NULL, thread_id INTEGER NOT NULL, name TEXT, text TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (scope, thread_id))`).run();
}
export async function keepDoc(db, scope, threadId, doc) {
    if (!doc || !threadId) return;
    await ensure(db);
    await db.prepare(`INSERT OR REPLACE INTO ai_thread_docs (scope, thread_id, name, text, created_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)`)
        .bind(scope, threadId, doc.name, String(doc.text).slice(0, 30000)).run();
}
/** The worksheet of a chat, for EVERY later message of that chat (live 22 Nov: "حل الـ 30 مرة واحدة" → "I can't see the
 *  file" because the text went with one message only). A cached block: re-read at 10% of the price on each turn. */
export function worksheetBlock(w, who = 'the student') {
    return { type: 'text', cache_control: { type: 'ephemeral' }, text: `## The worksheet ${who} attached in this chat ("${w.name}") — its full text:
"""
${String(w.text).slice(0, 30000)}
"""
- It stays available for the WHOLE chat: never say you can't see it, and never ask for it again (or for photos of it).
- Asked to solve it (حل / حلي / solve / the questions / الشيت / الملف): solve EVERY question of it in THIS one answer, in order — each with its number and a full worked solution as in the rules — never stop after one question to ask whether to continue. Only go one question at a time if they explicitly ask for that ("واحدة واحدة", "one at a time"), or if they ask about specific questions.
- Before you write each answer, recompute it yourself (units, conversions, which law) — no careless mistakes.` };
}
export async function threadDoc(db, scope, threadId) {
    await ensure(db);
    return db.prepare('SELECT name, text FROM ai_thread_docs WHERE scope = ? AND thread_id = ?').bind(scope, threadId).first();
}

const TASK = `## Task: turn the solutions in this chat into a WORKED-SOLUTIONS document (it becomes a branded PDF for students)
Output ONLY JSON:
{"title":"…","subtitle":"…","items":[{"n":"1","q":"the full question text","given":["Q = 30 C","t = 5 s"],"find":"I = ?",
 "convert":[{"text":"2 min = 2 × 60 = 120 s","why":"Q = I × t needs the time in seconds"}],
 "parts":[{"label":"(a)","law":"I = Q / t","why":"we know Q and t and want I — this law links them","steps":["I = 30 C / 5 s"],"answer":"I = 6 A"}],
 "tip":"…"}]}
Rules:
- EVERY question, in order, each with its full answer. "q" = the question exactly as in the worksheet (when the worksheet is given), else as in the chat.
- Keep every number and answer that is in the chat's solutions unless it is clearly wrong — then correct it.
- Make it TEACH, not just list results: every unit conversion has its "why"; every law has its "why" (which quantities it links / why this method); two-step problems: a first part explains why we need the middle quantity, then the next part. 1–3 short "steps" lines with the substitution and units. "answer" = the final result with its unit.
- Questions that HAVE parts (a), (b)… → one part each, "label":"(a)"… A single question solved in two steps → "label":"Step 1", "Step 2" — NEVER (a)/(b) when the question itself has no parts. A one-step question → one part with "label":"".
- Non-calculation questions (define, give reason, compare…) → "given":[] and one part with only "answer" (the model answer in the book's English, "Because …" for reasons).
- Recompute EVERY answer yourself before writing it (don't trust the chat blindly): units, conversions, the right law, the arithmetic. Fix anything wrong.
- Every statement must match the Egyptian curriculum book (e.g. identical cells in parallel: the emf stays the same and the battery works for a longer time — not "supplies more current").
- "tip" (optional, short): a common mistake, a quick check, or the book's faster method (e.g. identical resistors in parallel: R = r / n).
- Simple English, the book's own symbols and terms (emf, not ε). No markdown or emoji inside the JSON values.
- "title": e.g. "Unit 2 – Electricity: Worked Solutions"; "subtitle": grade + what it is.`;

function parse(text) {
    const s = String(text || '').replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
    const a = s.indexOf('{'), b = s.lastIndexOf('}');
    if (a < 0 || b <= a) return null;
    try { return JSON.parse(s.slice(a, b + 1)); } catch (e) { return null; }
}
const str = (v, n = 600) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n);
export function cleanSolutions(j) {
    if (!j || !Array.isArray(j.items)) return null;
    const items = j.items.slice(0, 80).map((it, i) => ({
        n: str(it.n || i + 1, 8), q: str(it.q, 1500),
        options: (Array.isArray(it.options) ? it.options : []).map(x => str(x, 200)).filter(Boolean).slice(0, 6),
        given: (Array.isArray(it.given) ? it.given : []).map(g => str(g, 120)).filter(Boolean).slice(0, 12),
        find: str(it.find, 120),
        convert: (Array.isArray(it.convert) ? it.convert : []).map(x => ({ text: str(x && x.text, 200), why: str(x && x.why, 300) })).filter(x => x.text).slice(0, 8),
        parts: (Array.isArray(it.parts) ? it.parts : []).map(p => ({ label: str(p && p.label, 20), law: str(p && p.law, 160), why: str(p && p.why, 400),
            steps: (Array.isArray(p && p.steps) ? p.steps : []).map(x => str(x, 300)).filter(Boolean).slice(0, 8), answer: str(p && p.answer, 600) })).filter(p => p.answer || p.steps.length || p.law).slice(0, 10),
        tip: str(it.tip, 400)
    })).filter(it => it.q && it.parts.length);
    return items.length ? { title: str(j.title || 'Worked solutions', 160), subtitle: str(j.subtitle, 200), items, ...(j.mark ? { mark: true } : {}), ...(j.exam ? { exam: true } : {}) } : null;
}

const EXAM_TASK = (n) => `## Task: write a PRACTICE EXAM for the student, strictly from the book pages below, as JSON (it becomes a printable PDF: the questions, then a Model Answer page)
Output ONLY JSON: {"exam":true,"title":"Unit 2 – Lesson 1: Electric Forces — Practice Exam","subtitle":"Prep 3 · Science","items":[{"n":"1","q":"…","options":["a) …","b) …","c) …","d) …"],"given":[],"find":"","convert":[],"parts":[{"label":"","law":"","why":"…","steps":[],"answer":"b) …"}],"tip":""}]}
- ${n} questions, a real exam mix in the book's English: choose (exactly 4 options a)–d), ONE right), complete, give reason, what happens when, and calculation problems if the lesson has laws.
- "q" = the question exactly as the student will see it (no answer in it). "options" only for choose questions.
- The answers go in "parts" like worked solutions: for a problem — given, conversions with why, law with why, steps, answer with unit; for a choose / complete / reason — the answer + one line why.
- ONLY what is in these pages (no other lesson, nothing extra). Recompute every answer. The book's own symbols and terms (emf, not ε).`;

/** messages = the chat ({role, text}), newest last. → { content, costUsd } (throws on failure) */
export async function makeSolutions(env, db, { messages, worksheet, gradeLabel, meter, exam = null }) {
    if (exam) {
        if (!exam.bookText) { const e = new Error('NO_LESSON'); e.code = 'NO_LESSON'; throw e; }
        const system = [{ type: 'text', text: `You prepare study material for Miss Marwa's ${gradeLabel || 'science'} students (Egyptian curriculum, language schools).${PRO_ACCURACY}\n\n${EXAM_TASK(exam.count || 10)}` },
            { type: 'text', text: `## The student asked: ${String(exam.ask || '').slice(0, 400)}\n\n## Their book — the pages for it:\n${String(exam.bookText).slice(0, 30000)}` }];
        const r = await chat(env, db, { tier: 'pro', system, messages: [{ role: 'user', content: 'Go.' }], maxTokens: 12000, thinking: 4000, meter });
        const content = cleanSolutions(parse(r.text));
        if (!content) { const e = new Error('BAD_JSON'); e.code = 'BAD_JSON'; throw e; }
        content.exam = true;
        return { content, costUsd: r.costUsd || 0, model: r.model };
    }
    // the solutions = the long answers since the worksheet was sent (up to the last 4)
    const sols = messages.filter(m => m.role === 'assistant' && String(m.text || '').length > 300).slice(-4).map(m => m.text).join('\n\n---\n\n').slice(0, 40000);
    if (!sols && !worksheet) { const e = new Error('NO_SOLUTIONS'); e.code = 'NO_SOLUTIONS'; throw e; }
    const system = [
        { type: 'text', text: `You prepare study material for Miss Marwa's ${gradeLabel || 'science'} students (Egyptian curriculum, language schools).${PRO_ACCURACY}\n\n${TASK}` },
        { type: 'text', text: (worksheet ? `## The worksheet ("${worksheet.name}") — the questions exactly:\n"""\n${String(worksheet.text).slice(0, 30000)}\n"""\n\n` : '') + (sols ? `## The solutions from the chat:\n"""\n${sols}\n"""` : `## No solutions in the chat yet — SOLVE every question of the worksheet yourself, fully and carefully, straight into the document.`) }
    ];
    const r = await chat(env, db, { tier: 'pro', system, messages: [{ role: 'user', content: 'Go.' }], maxTokens: 16000, thinking: 5000, meter });
    const content = cleanSolutions(parse(r.text));
    if (!content) { const e = new Error('BAD_JSON'); e.code = 'BAD_JSON'; throw e; }
    return { content, costUsd: r.costUsd || 0, model: r.model };
}
