// =====================================================================
// Shared teaching rules for every AI prompt (staff AI Assistant, students' assistant, Model test),
// so all of them say exactly the same thing. Shared module — not a page (onRequest → 404).
//
// Pro reasoning modes (compared on the Model test page, the winner is set with PRO_REASONING):
//   plain    – answer directly
//   check    – the model checks its work first inside <check>…</check>; the app hides that part
//   thinking – Claude's built-in "extended thinking" (PRO_THINKING_BUDGET tokens, default 1500)
// =====================================================================
export async function onRequest() { return new Response('Not found', { status: 404 }); }

// Miss Marwa's students are in LANGUAGE SCHOOLS (decided 17 Nov 2026)
export const LANGUAGE_SCHOOLS = `
## Language schools — the students study Science IN ENGLISH
- Their book, definitions, laws, rules and exams are in English. Whenever you give a definition, a law/rule, a scientific reason ("Give reason"), a "what happens when…" answer, or the exact sentence to write in the exam, write THAT sentence in English the way the book / model answer says it (in **bold** or on its own line) — then explain it in Egyptian Arabic.
- Calculations: the law, the substitution and the result with units in English/symbols (e.g. **D = m / V = 20 ÷ 5 = 4 g/cm³**); explain the steps in Egyptian Arabic.
- A question written in English stays in English — never translate the question or the choices.`;

export const EXAM_ANSWER_LINE = `
## Exam-style questions (choose, complete, true/false, give reason, what happens, problems)
Explain briefly, then end with a final line exactly like this:
✅ **الإجابة:** <the answer to write in the exam, in English>
- Choose: the letter and the option, e.g. ✅ **الإجابة:** (b) neutrons
- True/False: True, or False + the correct statement
- Several parts: one final line per part, e.g. ✅ **الإجابة (a):** …`;

export const PRO_ACCURACY = `
## Accuracy — you are the paid model, students and Miss Marwa rely on you
- Answer at the level of the Egyptian curriculum for that grade (Prep 1–3, Sec 1 Integrated Sciences): the book's standard definitions and wording; no university-level detail.
- Double-check every fact, number, unit and calculation before you write. In a choose question, test EVERY option and make sure exactly one is right.
- If a question is ambiguous or depends on something you can't see (a figure, a table), say what's missing instead of guessing.`;

export const REASONING_MODES = ['plain', 'check', 'thinking'];
const CHECK_RULES = `
## Check your work first (private)
Before the answer, think it through inside <check>…</check>: what exactly is asked, the curriculum fact or law that applies, the calculation with units, and for a choose question why each wrong option is wrong. Then write the answer for the reader. Everything inside <check> is hidden — never refer to it.`;

/** What a reasoning mode adds: { system, thinking (token budget or 0), extraTokens } */
export function reasoning(env, mode) {
    const m = REASONING_MODES.includes(mode) ? mode : 'plain';
    if (m === 'check') return { mode: m, system: CHECK_RULES, thinking: 0, extraTokens: 900 };
    if (m === 'thinking') { const b = Math.max(1024, parseInt(env.PRO_THINKING_BUDGET, 10) || 1500); return { mode: m, system: '', thinking: b, extraTokens: 0 }; }
    return { mode: 'plain', system: '', thinking: 0, extraTokens: 0 };
}
/** The mode Pro uses for real answers (set after the Model test): PRO_REASONING = plain | check | thinking */
export const proMode = (env) => (REASONING_MODES.includes(env.PRO_REASONING) ? env.PRO_REASONING : 'plain');

/** Remove the private <check> part (also an unfinished one at the end). */
export function stripPrivate(text) {
    return String(text || '').replace(/<check>[\s\S]*?<\/check>/gi, '').replace(/<check>[\s\S]*$/i, '').replace(/^\s+/, '').trim();
}

/** Pull the "✅ الإجابة:" line(s) out of an answer (for auto-marking). */
export function finalAnswers(text) {
    const out = [];
    const re = /✅\s*\**\s*(?:الإجابة|الاجابة|Answer)\s*(?:\(([a-z0-9ivx]+)\))?\s*\**\s*[:：]\s*\**\s*([^\n]+)/gi;
    let m; while ((m = re.exec(String(text || '')))) out.push({ part: m[1] || null, text: m[2].replace(/\*+/g, '').trim() });
    return out;
}
