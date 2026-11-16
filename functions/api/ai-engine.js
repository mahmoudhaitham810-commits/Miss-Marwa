// =====================================================================
// Workers AI engine (binding `AI`) — shared by Homework (auto-solve, reading
// student pages, concept checks, weakness reports) and the staff AI Lab.
//
//   • 100% Cloudflare Workers AI (10,000 free neurons / day, reset 00:00 UTC).
//   • Models are configurable with env vars (no code change to compare models):
//       HW_VISION_MODEL  default @cf/meta/llama-4-scout-17b-16e-instruct  (reads pages)
//       HW_TEXT_MODEL    default same model                              (concepts, reports)
//   • Image input: OpenAI-style message parts first; falls back to the `image`
//     field (Llama 3.2 Vision style). Llama 3.2 Vision's one-time licence
//     ("agree") is accepted automatically.
//   • Every call is logged to a daily neuron estimate (app_kv ai_usage_YYYY-MM-DD).
//   • Daily allowance used up → AiQuotaError (callers queue the work for after the reset).
// =====================================================================

export const DEFAULT_VISION_MODEL = '@cf/meta/llama-4-scout-17b-16e-instruct';
export const DAILY_FREE_NEURONS = 10000;
export const VISION_MODELS = [
    '@cf/meta/llama-4-scout-17b-16e-instruct',
    '@cf/meta/llama-3.2-11b-vision-instruct',
    '@cf/mistralai/mistral-small-3.1-24b-instruct',
    '@cf/google/gemma-3-12b-it'
];
// neurons per 1M tokens [input, output] — Cloudflare pricing page (Nov 2026)
const RATES = {
    '@cf/meta/llama-4-scout-17b-16e-instruct': [24545, 77273],
    '@cf/meta/llama-3.2-11b-vision-instruct': [4410, 61493],
    '@cf/mistralai/mistral-small-3.1-24b-instruct': [31876, 50488],
    '@cf/google/gemma-3-12b-it': [31371, 50560]
};
export const visionModel = (env) => (env && env.HW_VISION_MODEL) || DEFAULT_VISION_MODEL;
export const textModel = (env) => (env && env.HW_TEXT_MODEL) || visionModel(env);
export const aiReady = (env) => !!(env && env.AI && typeof env.AI.run === 'function');

export class AiQuotaError extends Error { constructor(m) { super(m || 'Daily free AI allowance used up'); this.code = 'AI_QUOTA'; } }
export class AiUnavailableError extends Error { constructor(m) { super(m || 'Workers AI is not connected (binding AI)'); this.code = 'AI_OFF'; } }
const isQuota = (e) => /3036|daily free allocation|neurons/i.test(String(e && (e.message || e)));
const isBusy = (e) => /3040|capacity temporarily exceeded/i.test(String(e && (e.message || e)));
const needsAgree = (e) => /agree|licen[cs]e|acceptable use/i.test(String(e && (e.message || e)));

export function estimateNeurons(model, usage, promptChars = 0, outChars = 0) {
    if (usage && Number.isFinite(Number(usage.neurons)) && Number(usage.neurons) > 0) return Math.round(Number(usage.neurons) * 10) / 10;   // Cloudflare reports it exactly
    const [ri, ro] = RATES[model] || RATES[DEFAULT_VISION_MODEL];
    const pin = usage && (usage.prompt_tokens || usage.input_tokens), pout = usage && (usage.completion_tokens || usage.output_tokens);
    const tin = Number.isFinite(pin) ? pin : Math.ceil(promptChars / 3.5) + 1600;   // ≈1.6k tokens per image when unknown
    const tout = Number.isFinite(pout) ? pout : Math.ceil(outChars / 3.5);
    return Math.round((tin * ri + tout * ro) / 1e6 * 10) / 10;
}

const today = () => new Date().toISOString().slice(0, 10);
export async function addUsage(db, neurons) {
    if (!db || !(neurons > 0)) return;
    try {
        await db.prepare(`INSERT INTO app_kv ("key", value) VALUES (?, ?) ON CONFLICT("key") DO UPDATE SET value = CAST(CAST(value AS REAL) + CAST(excluded.value AS REAL) AS TEXT), updated_at = CURRENT_TIMESTAMP`)
            .bind(`ai_usage_${today()}`, String(neurons)).run();
    } catch (e) { /* stats only */ }
}
export async function usageToday(db) {
    try { const r = await db.prepare(`SELECT value FROM app_kv WHERE "key" = ?`).bind(`ai_usage_${today()}`).first(); return r ? Math.round(Number(r.value)) : 0; }
    catch (e) { return 0; }
}
export async function markQuotaHit(db) {
    try { await db.prepare(`INSERT INTO app_kv ("key", value) VALUES ('ai_quota_hit', ?) ON CONFLICT("key") DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`).bind(today()).run(); } catch (e) { }
}
// true when the allowance ran out earlier today (UTC) → don't even try until the reset
export async function quotaHitToday(db) {
    try { const r = await db.prepare(`SELECT value FROM app_kv WHERE "key" = 'ai_quota_hit'`).first(); return !!(r && r.value === today()); } catch (e) { return false; }
}

export function textOf(res) {
    if (res == null) return '';
    if (typeof res === 'string') return res;
    if (typeof res.response === 'string') return res.response;
    if (res.response && typeof res.response === 'object') return JSON.stringify(res.response);
    if (res.result) return textOf(res.result);
    if (Array.isArray(res.choices) && res.choices[0]) return (res.choices[0].message && res.choices[0].message.content) || res.choices[0].text || '';
    return JSON.stringify(res);
}

/**
 * Run a model. `image` = data URL ("data:image/jpeg;base64,…") or null.
 * Returns { text, model, format, ms, neurons, usage }.
 */
export async function runAI(env, db, { model, system, prompt, image = null, maxTokens = 2048, temperature = 0 }) {
    if (!aiReady(env)) throw new AiUnavailableError();
    model = model || (image ? visionModel(env) : textModel(env));
    const messages = [...(system ? [{ role: 'system', content: system }] : [])];
    const attempts = image
        ? [
            ['parts', { messages: [...messages, { role: 'user', content: [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: image } }] }], max_tokens: maxTokens, temperature }],
            ['image-field', { messages: [...messages, { role: 'user', content: prompt }], image, max_tokens: maxTokens, temperature }]
        ]
        : [['text', { messages: [...messages, { role: 'user', content: prompt }], max_tokens: maxTokens, temperature }]];
    if (image && /llama-3\.2-11b-vision/.test(model)) attempts.reverse();          // documented format for this model
    let lastErr = null;
    for (const [format, input] of attempts) {
        const t0 = Date.now();
        for (let tryNo = 0; tryNo < 3; tryNo++) {
            try {
                const res = await env.AI.run(model, input);
                const text = textOf(res);
                if (!text && format !== attempts[attempts.length - 1][0]) throw new Error('empty response');
                const neurons = estimateNeurons(model, res && res.usage, (system || '').length + prompt.length, text.length);
                await addUsage(db, neurons);
                return { text, model, format, ms: Date.now() - t0, neurons, usage: (res && res.usage) || null };
            } catch (e) {
                lastErr = e;
                if (isQuota(e)) { await markQuotaHit(db); throw new AiQuotaError(); }
                if (needsAgree(e) && tryNo === 0) { try { await env.AI.run(model, { prompt: 'agree' }); } catch (x) { } continue; }
                if (isBusy(e) && tryNo < 2) { await new Promise(r => setTimeout(r, 1200 * (tryNo + 1))); continue; }
                break;   // try the other input format
            }
        }
    }
    throw lastErr || new Error('Workers AI failed');
}

/** Pull the first JSON object/array out of a model reply (handles ```json fences, prose around it, trailing commas). */
export function parseJsonLoose(text) {
    if (text && typeof text === 'object') return text;
    let s = String(text || '').trim();
    const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) s = fence[1].trim();
    const start = s.search(/[\[{]/);
    if (start < 0) return null;
    // scan; remember the last point where a value closed cleanly, so a reply cut off by the token limit
    // still gives every complete item (e.g. 60 of 70 questions) instead of nothing
    const stack = []; let inStr = false, esc = false, end = -1, safe = -1, safeStack = null;
    for (let i = start; i < s.length; i++) {
        const c = s[i];
        if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
        if (c === '"') inStr = true;
        else if (c === '{' || c === '[') stack.push(c === '{' ? '}' : ']');
        else if (c === '}' || c === ']') { stack.pop(); if (!stack.length) { end = i; break; } safe = i; safeStack = stack.slice(); }
    }
    let body = end > 0 ? s.slice(start, end + 1)
        : safe > 0 ? s.slice(start, safe + 1) + safeStack.slice().reverse().join('')
        : s.slice(start) + stack.slice().reverse().join('');
    for (const attempt of [body, body.replace(/,\s*([}\]])/g, '$1'), body.replace(/,\s*([}\]])/g, '$1').replace(/[“”]/g, '"')]) {
        try { return JSON.parse(attempt); } catch (e) { }
    }
    return null;
}

// ---------------- Prompts ----------------
const SECTION_RULES = `Numbering: the booklet is split into numbered sections (e.g. "1 Choose the correct answer", "2 Complete the following table", "3 Complete the following statements", "4 Put (✓) or (✗)", "5 Give reasons"). Question numbers restart in each section. Label every question "section.question" — e.g. the 7th question of section 1 is "1.7". For a table, label each blank cell as its own question in reading order ("2.1", "2.2", …). Many booklets also split a lesson into PARTS with big headings such as "First: School Book Questions", "Second: …", "Third: …" — numbering restarts in every part. Report the part number (First = 1, Second = 2, …) in "part"; use "?" when the page starts without a part heading. If the page STARTS with questions that come before any numbered section heading (they continue a section from the previous page), label them "?.<question number>" (e.g. "?.8") — the previous page's section number is filled in later.`;

const TYPE_NAMES = { mcq: 'Choose the correct answer', short: 'Complete', tf: 'Put ✓ or ✗', essay: 'Give reason / explain' };
const typesNote = (types) => Array.isArray(types) && types.length ? `This homework ONLY contains these question types: ${types.map(t => `"${t}" (${TYPE_NAMES[t] || t})`).join(', ')}. Use only these types.` : '';
const TF_NOTE = `For "tf": set "requires_correction": true only if the instructions ask the student to correct the wrong statements (e.g. "Put (✓) or (✗) and correct the wrong one"), otherwise false.`;

export function solvePrompt({ grade, unit, lesson, continueFrom, types, pageNo }) {
    return `You are an expert Egyptian science teacher (${grade || 'preparatory'} stage, Unit ${unit || '?'}, Lesson ${lesson || '?'}).
This image is ONE page${pageNo ? ` (PDF page ${pageNo})` : ''} of a student homework booklet with PRINTED questions (usually unanswered).
Read every question on the page and SOLVE it yourself.
${SECTION_RULES}
${continueFrom ? `The previous page ended in section ${continueFrom.section}, last question "${continueFrom.label}".` : ''}
${typesNote(types)}
${TF_NOTE}
Types: "mcq" (choose the correct answer — answer = the letter a/b/c/d), "tf" (put ✓ or ✗ / true or false — answer = "true" or "false"; for false add the correct word in "correction"), "short" (complete / one word / table cell — answer = the missing word(s)), "essay" (give reason, what happens if, explain, compare — write a model answer and 1–4 key ideas).
STRICT RULES:
- If a question has lettered choices (a)(b)(c)(d) it is ALWAYS "mcq", even when the choices are symbols, numbers or pictures. Copy EVERY choice into "options" in order — normally exactly 4. Never drop a choice.
- Atom / isotope symbols: keep BOTH numbers. Write them as mass number (top) and atomic number (bottom) like "¹³₆X", "³₁H", "⁴₂He". Never write only one number.
- Diagrams: count what you see (electrons in each shell, protons, arrows …) before answering, and say the count in the explanation.
- Work the answer out FIRST, then write the explanation. The explanation states the reason confidently in at most 30 words — never "however", "re-evaluating", "actually", "might be misinterpreted". If you are unsure, still give your best answer and put "confidence" below 0.5 instead of writing doubts.
- Preparatory level only: use energy levels (K, L, M, N or 2, 8, 8, 1) — no orbitals like 4s, 3p, no sub-levels, no university terms.
- "confidence" must be honest: 1.0 only when you are certain AND read every word and choice clearly.
Return ONLY JSON, no prose:
{"page_sections":[{"number":1,"title":"Choose the correct answer"}],
 "questions":[{"label":"1.1","type":"mcq","question":"…","options":["…","…","…","…"],"answer":"b","answer_text":"text of the correct option","alternatives":[],"model_answer":"","ideas":[],"explanation":"one short sentence a 13-year-old understands, why this answer is right","requires_correction":false,"confidence":0.0-1.0}]}
For "essay": "model_answer" = full answer, "ideas" = [{"text":"short key idea"}].
For "short": "alternatives" = other accepted wordings (synonyms, Arabic/English, symbols).
Write questions, answers and explanations in the language of the booklet (usually English). Do not skip any question. If something is unreadable, still include it with "confidence" below 0.5.`;
}

/** Copy the printed questions only — no solving, no explanations (used when the official answer key is provided). */
export function extractPrompt({ grade, unit, lesson, types, pageNo }) {
    return `This image is ONE page${pageNo ? ` (PDF page ${pageNo})` : ''} of an Egyptian science homework booklet (${grade || 'preparatory'} stage, Unit ${unit || '?'}, Lesson ${lesson || '?'}).
COPY every printed question on the page. Do NOT solve anything and do NOT write explanations — the answers come from the official answer key.
${SECTION_RULES}
${typesNote(types)}
Types: "mcq" (choose — copy ALL lettered choices, normally 4, keeping atom symbols with both numbers like "¹³₆X"), "tf" (put ✓ or ✗), "short" (complete / one word / table cell), "essay" (give reason, what happens if, explain, compare).
${TF_NOTE}
Return ONLY JSON, no prose:
{"page_sections":[{"part":1,"number":1,"title":"Choose the correct answer","type":"mcq"}],
 "questions":[{"part":1,"label":"1.1","type":"mcq","question":"…","options":["…","…","…","…"],"requires_correction":false}]}
Do not skip any question. Keep the booklet's language (usually English).`;
}

/** Read an official answer-key page — copy answers, never solve. Compact lines (dense multi-column pages have 100+ answers). */
export function keyReadPrompt({ unit, lesson, pageNo }) {
    return `This image is a page${pageNo ? ` (PDF page ${pageNo})` : ''} of the OFFICIAL ANSWER KEY of an Egyptian science booklet${unit ? ` (we need Unit ${unit}${lesson ? `, Lesson ${lesson}` : ''})` : ''}.
The page is DENSE and usually printed in 2–3 narrow COLUMNS. Read column by column: the whole left column from top to bottom, then the next column, and so on.
COPY every answer exactly as printed. Do NOT solve or change anything. Do not skip answers.
Headings you will see:
- lesson headings ("Lesson 1", "الدرس الأول") → write a line: LESSON <number>
- part headings ("First: School Book Questions", "Second: …", "Third: …", or numbered groups whose numbering restarts) → write a line: PART <number> | <title>
- numbered sections ("1 Choose …", "2 Complete …", "3 Put ✓ or ✗ …", "4 Give reasons …"); question numbers restart in each section.
Write ONE answer per line as  section.question = answer  — examples:
1.1 = c
1.2 = d (fourth energy level)
2.3 = atomic number
3.1 = ✗ | mass number → atomic number
3.2 = ✓
4.1 = Because the number of protons equals the number of electrons.
For choose: the letter first (the words in brackets only if printed). For ✓/✗: the symbol, then " | " and the correction if printed. For a table, one line per cell in reading order.
If answers at the top of a column continue a section from before (no heading), write them as ?.<question number> = answer.
Output ONLY these lines — no JSON, no other text.`;
}

export function readPrompt({ key, pageNo, pages }) {
    const line = (q) => {
        if (q.type === 'mcq') return `${q.label} (choose)${(q.options || []).length ? ': ' + q.options.map((o, k) => `(${'abcdef'[k]}) ${o}`).join('  ') : ''}`;
        return `${q.label} (${q.type === 'tf' ? '✓ or ✗' : q.type === 'short' ? 'word(s) written in the blank' : 'sentences written by the student'})`;
    };
    return `This image is page ${pageNo} of ${pages} of a student's homework (printed booklet pages and/or notebook pages, photographed with a phone).
Your ONLY job is to REPORT what the student marked or wrote by hand. You are NOT solving the questions.
IMPORTANT: students often choose WRONG answers. Report exactly what THEY marked even when it is wrong — never what you think is correct. Grading happens later, by someone else.
How to read a choose question: look for the hand-drawn circle / oval / tick around one printed choice. Read the printed text INSIDE that drawn circle and copy it into "circled_text", then give its letter in "circled". If two or more choices are circled, list every circled letter. A choice that is crossed out or scribbled over does not count — mention it in "note". If nothing is marked, use an empty list.
${SECTION_RULES}
Questions to look for (the printed choices are listed so you can find them):
${key.map(line).join('\n')}
For each question visible on THIS page:
- choose: "circled": ["b"], "circled_text": "the printed words inside the student's circle"
- ✓/✗: "answer": "true" for ✓ or "false" for ✗; "correction": the student's correction if written
- words / sentences: "answer": copy exactly what the student wrote (do not fix mistakes)
Return ONLY JSON:
{"answers":[{"label":"1.1","circled":["b"],"circled_text":"Neutron","answer":"","correction":"","legible":true,"note":""}],"page_readable":true,"notes":""}
Use "legible": false when you cannot see the student's mark clearly. Leave out questions that are not on this page. Never invent answers.`;
}

// Second, independent check: solve the extracted questions from their TEXT only (no picture),
// without seeing the first answer. Disagreements are shown to staff.
const SUPD = '⁰¹²³⁴⁵⁶⁷⁸⁹', SUBD = '₀₁₂₃₄₅₆₇₈₉';
const digits = (t, set) => Number([...t].map(c => set.indexOf(c)).join(''));
// "³₁H" → "³₁H [1 proton, 2 neutrons]" — text models are bad at reading super/subscripts, so do the counting for them
export function annotateNuclides(text) {
    return String(text || '').replace(new RegExp(`([${SUPD}]+)([${SUBD}]+)\\s?([A-Z][a-z]?)`, 'g'), (m, A, Z, el) => {
        const mass = digits(A, SUPD), z = digits(Z, SUBD);
        return mass >= z ? `${m} [${z} proton${z === 1 ? '' : 's'}, ${mass - z} neutron${mass - z === 1 ? '' : 's'}, mass number ${mass}]` : `${m} [atomic number ${z}, mass number ${mass}]`;
    });
}
// Second, independent check: solve the extracted questions from their TEXT only (no picture),
// without seeing the first answer. Disagreements are shown to staff.
export function verifyPrompt(items) {
    return `You are an expert Egyptian preparatory science teacher. Solve each question below yourself, from the text only.
Facts for this level: atom symbols are written mass number on top and atomic number at the bottom (counts are given in [brackets]). Electrons fill energy levels K=2, L=8, M=8, then N (e.g. potassium 19 = 2, 8, 8, 1 → outermost electron in the 4th level). Atoms of the same element always have the same number of protons (atomic number) and, when neutral, the same number of electrons; their mass numbers / neutrons can differ (isotopes).
Think step by step for each question: write the short reasoning in "why" FIRST, then the answer.
If a question depends on a figure/diagram/table you cannot see, set "needs_figure": true.
If NONE of the choices is correct as written, answer "none".
Questions:
${items.map(q => q.type === 'mcq'
        ? `[${q.label}] ${annotateNuclides(q.prompt)}\n${q.options.map((o, k) => `(${'abcdef'[k]}) ${annotateNuclides(o)}`).join('   ')}`
        : `[${q.label}] True or false: ${annotateNuclides(q.prompt)}`).join('\n\n')}
Return ONLY JSON: {"results":[{"label":"1.1","why":"max 25 words","answer":"b","needs_figure":false}]} — for true/false questions answer "true" or "false".`;
}

export function conceptPrompt(items) {
    return `You are marking a student's homework. For each item, decide which KEY IDEAS the student's answer expresses — in any words, any language (English/Arabic), spelling mistakes are fine; judge the meaning, not the wording. An idea counts only if the student really states it (not just repeats the question).
Items:
${items.map(it => `[${it.label}] Question: ${it.question || '(see key)'}
Model answer: ${it.model || ''}
Key ideas: ${it.ideas.map((x, i) => `(${i + 1}) ${x}`).join(' ')}
Student wrote: "${String(it.student || '').slice(0, 800)}"`).join('\n\n')}
Return ONLY JSON: {"results":[{"label":"…","ideas_found":[1,3],"evidence":"short quote from the student","feedback":"one short sentence for the student"}]}`;
}

export function weaknessPrompt({ title, missed, strong = [], lang = 'ar' }) {
    return `A student did homework "${title}". These are the questions they got wrong or partly wrong, with the right answers:
${missed.map(m => `- ${m.label}: ${m.question || ''} | right answer: ${m.right} | student wrote: ${m.student || '(nothing)'}`).join('\n') || '(none)'}
${strong.length ? `Questions they got fully right: ${strong.map(x => `${x.label} ${x.question || ''}`.trim()).join(' | ')}` : ''}
Diagnose the student's weak points: name 1–3 specific lesson concepts/skills they need to revise (not generic advice). Also name 1–2 things they clearly did well.
Write in simple, warm ${lang === 'ar' ? 'Egyptian Arabic' : 'English'} for a parent, keeping scientific terms in English.
Return ONLY JSON: {"focus":["concept to revise — very short tip"],"strengths":["what they did well"],"summary":"one encouraging sentence"}`;
}

// ---------- AI Assistant (student) — Egyptian Arabic, science terms in English ----------
const STYLE = `Write in warm, fun, encouraging Egyptian Arabic (عامية مصرية بسيطة) like a kind older sibling who loves science.
Keep EVERY scientific term, unit, number, symbol and answer choice in ENGLISH exactly as given (e.g. "fourth energy level", "protons", "³₁H", "Each of neutron and proton") — never translate them.
Use the given right answer and explanation as the truth. Never change the right answer and never invent facts.
Short sentences. At most one emoji per paragraph.`;
const genderNote = (female) => female ? 'The student is a girl — use feminine Arabic forms (إنتِ، اخترتِ، شاطرة).' : 'The student is a boy — use masculine Arabic forms (إنت، اخترت، شاطر).';

export function assistPrompt({ name, female, title, items }) {
    return `You are "مساعد مس مروة 🤖", the AI study helper of Miss Marwa's science classes (Egyptian preparatory stage).
${STYLE}
${genderNote(female)}
The student ${name ? `"${name}" ` : ''}just finished the homework "${title}". Walk them through EACH mistake below:
say what they answered, what the right answer is, and WHY (2–4 short sentences), then a tiny tip to remember it.
Mistakes:
${items.map(i => `[${i.label}] ${i.question || '(question in the booklet)'}${i.options && i.options.length ? `\nChoices: ${i.options.map((o, k) => `(${'abcdef'[k]}) ${o}`).join('  ')}` : ''}
Student answered: ${i.student || '(left blank)'}
Right answer: ${i.right}
Explanation: ${i.explanation || 'NEEDS_EXPLANATION'}${i.feedback ? `\nTeacher's note: ${i.feedback}` : ''}`).join('\n\n')}
For every mistake marked NEEDS_EXPLANATION also add "explanation_en": one or two simple ENGLISH sentences (preparatory level, no doubts) explaining why the right answer is right — it will be saved for other students.
Return ONLY JSON: {"greeting":"one short warm opening line using their name","items":[{"label":"1.5","text":"…","explanation_en":"…"}],"closing":"one short motivating line"}`;
}

export function chatPrompt({ name, female, title, mistakes, history, question }) {
    return `You are "مساعد مس مروة 🤖", the AI study helper of Miss Marwa's science classes (Egyptian preparatory stage).
${STYLE}
${genderNote(female)}
The student${name ? ` "${name}"` : ''} finished the homework "${title}" and is asking a follow-up question.
Their mistakes in this homework (right answers are the truth):
${mistakes.length ? mistakes.map(m => `[${m.label}] ${m.question || ''} — student: ${m.student || '(blank)'} — right: ${m.right}${m.explanation ? ` — why: ${m.explanation}` : ''}`).join('\n') : '(no mistakes — they got everything right)'}
${history.length ? `Conversation so far:\n${history.map(h => `${h.role === 'user' ? 'Student' : 'You'}: ${h.text}`).join('\n')}` : ''}
Student now asks: "${question}"
Answer helpfully in at most 120 words. Only talk about science from this lesson / homework; if they ask about something else, gently bring them back. If you are not sure, tell them to ask Miss Marwa in "Ask Miss Marwa".
Reply with the answer text only (no JSON).`;
}

// Handwritten notebook answers for the written questions only (photo option)
export function writtenReadPrompt({ questions }) {
    return `This photo shows a student's HANDWRITTEN answers in their notebook (it may also show part of the printed booklet).
Copy EXACTLY what the student wrote for each question below — do not fix spelling, do not add anything, do not answer the questions yourself.
Questions (the student may write the number like "3.1" or "3)" next to the answer):
${questions.map(q => `[${q.label}] ${q.prompt || ''}`).join('\n')}
Return ONLY JSON: {"answers":[{"label":"3.1","text":"the student's words","legible":true}],"page_readable":true}
Use "legible": false when you cannot read the student's writing. Leave out questions you cannot find on this photo.`;
}

// Not a page — shared module. (Pages would otherwise expose it as /api/ai-engine.)
export async function onRequest() { return new Response('Not found', { status: 404 }); }
