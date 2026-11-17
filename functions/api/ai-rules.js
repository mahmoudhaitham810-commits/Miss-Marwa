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
- A question written in English stays in English — never translate the question or the choices.
- The subject is called **Science** ("الـ Science") — never "العلوم". Its branches: **Physics**, **Chemistry**, **Biology**, **Earth Science** — never الفيزياء / الكيمياء / الأحياء.`;

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


// ---------- what kind of message is this? (decided by code, not by the AI) ----------
const nrm = (t) => String(t || '').toLowerCase().replace(/[ً-ٰٟـ]/g, '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/\s+/g, ' ').trim();

/** "What can you do / how will you help me / who are you?" */
export function isCapabilityQuestion(text) {
    const s = nrm(text);
    return /(هتفيدني|تفيدني|بتفيدني|هتفيديني|تفيديني|بتفيديني|هتفيدنا|هتنفعني|تنفعني|هتنفعيني)\s*(ب|في)?\s*ايه|(تقدر|تقدري|ممكن)\s*(تعمل|تعملي|تساعد|تساعدي)\w*\s*(لي|ليا)?\s*(في)?\s*ايه|(بتعمل|بتعملي|وظيفتك|شغلتك)\s*(ايه)?|(تساعدني|تساعدنا|هتساعدني|هتساعدنا|ساعدني)\s*(ازاي|في ايه|ب ايه|بايه)|(انت|انتي|إنت)\s*مين|مين\s*(انت|انتي)|ايه\s*(اللي|الي)\s*(تقدر|بتقدر|تعرف)|what can you do|how (can|will|could) you help|what do you do|who are you|what are you|^help\??$|^مساعده\??$/.test(s);
}

// Words that are just chat, not science (so "hi", "how are you" never count as a science question)
const CHAT_EN = new Set('mini assistant miss marwa pro argon bot chatgpt claude gemini hi hello hey hii thanks thank you thx ok okay yes no yeah yep nope how are you fine good great nice cool what who can do help me please pls sorry bye see later morning evening night the and for with this that is it its am im not really very much'.split(' '));
const SCIENCE_AR = /(اشرح|اشرحي|اشرحلي|اشرحيلي|يعني ايه|يعني اية|معني|عرف|عرفي|تعريف|الفرق بين|قارن|ليه|علل|سبب|احسب|احسبي|حل|حلي|حللي|مساله|مسأله|قانون|معادله|وحده|وحدة|تجربه|ماذا يحدث|ايه اللي بيحصل|بيحصل ايه|صح ولا غلط|اختار|اكمل|كمل|سؤال|اسئله|امتحان|درس|ماده|عنصر|ذره|طاقه|قوه|سرعه|كثافه|كتله|خليه)/;
/** Is this a science / study question (→ the Pro note may follow a Mini Assistant answer)? */
export function isScienceQuestion(text) {
    const raw = String(text || '');
    if (!raw.trim() || isCapabilityQuestion(raw)) return false;
    const s = nrm(raw);
    if (SCIENCE_AR.test(s)) return true;
    const words = (raw.match(/[A-Za-z][A-Za-z'-]{2,}/g) || []).map(w => w.toLowerCase().replace(/'.*$/, ''));
    if (words.some(w => !CHAT_EN.has(w))) return true;            // English science terms (language schools)
    return /[=+×÷^]|\d\s*(kg|g|cm|m|s|n|j|w|°c|k)\b/i.test(raw);   // formulas / units
}

// ---------- "what can you do?" — fixed, always-correct answers (no AI needed, free) ----------
export function capabilitiesForStudent(st, tier = 'free') {
    const f = st && st.gender === 'female';
    const name = st && st.firstName ? ` ${st.firstName}` : '';
    const g = (m, w) => (f ? w : m);
    return `أكيد يا ${g('بطل', 'بطلة')}${name}! 😄 دي الحاجات اللي أقدر أعملها ${g('لك', 'ليكي')} على المنصة:

1. 📊 **مستواك ودرجاتك** — متوسطك في امتحانات الـ Center والـ Online، ترتيبك، آخر نتايجك، ومستواك رايح على فين.
2. 📝 **امتحاناتك** — الامتحانات المفتوحة اللي لسه ${g('ماحلّتهاش', 'ماحلّتيهاش')} وآخر ميعاد لكل واحد، واللي ${g('فاتك', 'فاتك')}.
3. 📚 **الجديد** — آخر الدروس والملفات اللي نزلت لصفّك.
4. 📷 **صورة سؤال** — ${g('ابعتلي', 'ابعتيلي')} صورة سؤال${tier === 'free' ? ' (صورة واحدة في اليوم)' : ''} وأحاول أحلّه${g('ولك', 'ولِك')}.
5. 🤓 **أسئلة الـ Science** — ${tier === 'free' ? 'شرح سريع ومبسّط لأي حاجة في المنهج.' : 'شرح كامل خطوة بخطوة، والإجابة اللي تتكتب في الامتحان بالـ English.'}

${tier === 'free'
        ? `أقدر أساعد${g('ك', 'كي')} في المحتوى العلمي، بس ${g('متعتمدش', 'متعتمديش')} عليا بالكامل — أنا موديل محدود 🙂 ${g('جرّب تسألني', 'جرّبي تسأليني')}: «عامل${g('', 'ة')} إيه في درجاتي؟» أو «عندي امتحانات مفتوحة؟»`
        : `${g('جرّب تسألني', 'جرّبي تسأليني')}: «عامل${g('', 'ة')} إيه في درجاتي؟» أو ${g('ابعتلي', 'ابعتيلي')} أي سؤال من الكتاب 💪`}`;
}
export function capabilitiesForStaff(tier = 'free') {
    return `أكيد يا مس مروة 😊 دي الحاجات اللي أقدر أعملها لك على المنصة:

1. 👀 **أي طالب** — اكتبي اسمه (عربي أو English) أو الكود: مستواه، درجاته في الـ Center والـ Online، ترتيبه، غيابه، الامتحانات اللي فاتته، وأسئلته.
2. ⚠️ **مين محتاج متابعة** في أي صف — درجاته نازلة، فاته امتحانات، أو متوسطه ضعيف.
3. 🏆 **الأوائل** — الـ Top 10 لكل صف.
4. 🚫 **الغياب** — مين غاب في آخر امتحانات السنتر، ومين غيابه بيتكرر.
5. 📊 **نتايج الامتحانات** — مين حل ومين محلش، والمتوسط، والدرجات الضعيفة.
6. ☀️ **ملخص النهارده** — الامتحانات اللي هتقفل، الأسئلة المستنية، ومين محتاج متابعة.
7. 📲 **رسايل واتساب** لأولياء الأمور — من الكروت على طول.
8. 📷 **صورة سؤال** — ابعتيها وأحاول أحلّها.

${tier === 'free'
        ? 'أقدر أساعدك في المحتوى العلمي كمان، بس متعتمديش عليا بالكامل — أنا موديل محدود 🙂 للشرح والأسئلة ونماذج الإجابة استخدمي **Miss Marwa Assistant Pro**.'
        : 'وكمان كـ Pro: أشرح أي حاجة في المنهج، أكتب أسئلة بنماذج إجابة، وأجهّز امتحانات وملخصات 🎓'}`;
}
