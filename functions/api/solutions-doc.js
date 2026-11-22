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
        given: (Array.isArray(it.given) ? it.given : []).map(g => str(g, 120)).filter(Boolean).slice(0, 12),
        find: str(it.find, 120),
        convert: (Array.isArray(it.convert) ? it.convert : []).map(x => ({ text: str(x && x.text, 200), why: str(x && x.why, 300) })).filter(x => x.text).slice(0, 8),
        parts: (Array.isArray(it.parts) ? it.parts : []).map(p => ({ label: str(p && p.label, 20), law: str(p && p.law, 160), why: str(p && p.why, 400),
            steps: (Array.isArray(p && p.steps) ? p.steps : []).map(x => str(x, 300)).filter(Boolean).slice(0, 8), answer: str(p && p.answer, 600) })).filter(p => p.answer || p.steps.length || p.law).slice(0, 10),
        tip: str(it.tip, 400)
    })).filter(it => it.q && it.parts.length);
    return items.length ? { title: str(j.title || 'Worked solutions', 160), subtitle: str(j.subtitle, 200), items } : null;
}

/** messages = the chat ({role, text}), newest last. → { content, costUsd } (throws on failure) */
export async function makeSolutions(env, db, { messages, worksheet, gradeLabel, meter }) {
    // the solutions = the long answers since the worksheet was sent (up to the last 4)
    const sols = messages.filter(m => m.role === 'assistant' && String(m.text || '').length > 300).slice(-4).map(m => m.text).join('\n\n---\n\n').slice(0, 40000);
    if (!sols && !worksheet) { const e = new Error('NO_SOLUTIONS'); e.code = 'NO_SOLUTIONS'; throw e; }
    const system = [
        { type: 'text', text: `You prepare study material for Miss Marwa's ${gradeLabel || 'science'} students (Egyptian curriculum, language schools).${PRO_ACCURACY}\n\n${TASK}` },
        { type: 'text', text: (worksheet ? `## The worksheet ("${worksheet.name}") — the questions exactly:\n"""\n${String(worksheet.text).slice(0, 30000)}\n"""\n\n` : '') + (sols ? `## The solutions from the chat:\n"""\n${sols}\n"""` : `## No solutions in the chat yet — SOLVE every question of the worksheet yourself, fully and carefully, straight into the document.`) }
    ];
    const r = await chat(env, db, { tier: 'pro', system, messages: [{ role: 'user', content: 'Go.' }], maxTokens: 16000, meter });
    const content = cleanSolutions(parse(r.text));
    if (!content) { const e = new Error('BAD_JSON'); e.code = 'BAD_JSON'; throw e; }
    return { content, costUsd: r.costUsd || 0, model: r.model };
}
