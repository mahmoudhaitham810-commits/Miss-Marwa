// =====================================================================
// /api/study-ai — Assistant Pro inside the study pages (19 Nov 2026).
//
//   GET  ?action=status                        → can this student use it? (+ how much of the month is left, as %)
//   POST ?action=explain  { examId, q }        → explain ONE mistake of a finished online exam
//
// Smart routing (no wasted lookups):
//   • explain → uses ONLY the stored exam data (question, choices, Miss Marwa's official answer, the student's
//     choice). No curriculum-book search — the material is already exact.
//
// Cost:
//   • answers are shared (ai-cache.js): the same question + same wrong choice is generated once and then served
//     to every student for free. The text is written for "any student" (no name, no gender) so it can be shared.
//   • the student who triggers a NEW answer pays it from their own monthly budget (ai-quota.js);
//     a saved answer costs nothing but is still counted as a message on the AI usage page.
//
// Access: the student's own session only (their own submission, review already unlocked), Pro opened by
// Miss Marwa, and switched ON for this student. Staff can try it as a student with ?as=<code> (counted as staff use).
// =====================================================================
import { requireStaff, ensureAppSchema, verifyStudentRequest } from './admin-auth.js';
import { chat, AiLimitError, claudeReady } from './ai-gateway.js';
import { studentAccess, logUsage, ensureQuotaTables } from './ai-quota.js';
import { getOrMake, sha256, CacheBusyError } from './ai-cache.js';
import { LANGUAGE_SCHOOLS } from './ai-rules.js';

const getDb = (env) => [env.DB, env.D1_DB].find(d => d && typeof d.prepare === 'function');
const json = (d, s = 200) => Response.json(d, { status: s });
const bad = (m, s = 400, extra = {}) => json({ error: m, ...extra }, s);
export const GRADE_LABEL = { prep1: 'Prep 1', prep2: 'Prep 2', prep3: 'Prep 3', sec1: 'Sec 1' };
const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];
const EXPLAIN_VERSION = 'v1';     // bump when EXPLAIN_SYSTEM changes → fresh explanations

export const FRIENDLY = {
    PRO_CLOSED: 'الميزة دي هتفتح قريب جداً 🚀',
    STUDENT_OFF: 'الشرح ده جزء من اشتراك Assistant Pro ✨ — كلّم مس مروة عشان تفعّله.',
    STUDENT_CAP: 'خلص رصيد Assistant Pro بتاعك الشهر ده 🙏 — بيتجدد أول الشهر الجاي.',
    CACHE_BUSY: 'الشرح بيتجهز دلوقتي ⏳ — جرّب تاني بعد ثواني.',
    PAID_OFF: 'Assistant Pro مش متاح دلوقتي — جرّب كمان شوية 🙏',
    AI_ERROR: 'حصلت مشكلة وإحنا بنجهز الشرح 😅 — جرّب تاني.'
};
const STATUS = { PRO_CLOSED: 403, STUDENT_OFF: 403, STUDENT_CAP: 429, CACHE_BUSY: 503, PAID_OFF: 503, DAILY_CAP: 429, MONTHLY_CAP: 429, AI_ERROR: 502 };

export const EXPLAIN_SYSTEM = `You are the teaching assistant of مس مروة (Miss Marwa), a science teacher in Egypt, on her online platform. A student got ONE question of Miss Marwa's online exam wrong (or left it blank). Explain it.

## Source of truth — strict
- Use ONLY the question, the choices and the OFFICIAL correct answer given in the message. They come from Miss Marwa's own exam.
- The official answer is always right: never contradict it, never say another choice could also be right.
- Explain at the student's grade level only. No extra or advanced information beyond what's needed for this question.
- If the question depends on a picture or table you can't see, explain from the text only and don't invent what the picture shows.

## Language
- Egyptian colloquial Arabic (عامية مصرية) — never فصحى.
- EVERY science term, unit, symbol and formula stays in English and **bold**: الـ **Density**، **kg**، **D = m / V**. Never translate science terms into Arabic.
- This same explanation is shown to MANY students → no name, no "يا بطل/يا بطلة", no masculine or feminine verbs. Use neutral wording: "يلا نشوف"، "خلّينا نفتكر"، "الاختيار ده".
${LANGUAGE_SCHOOLS}

## Format — short, for a phone (max ~120 words), exactly these parts, no greeting, no sign-off:
✅ **الإجابة الصح:** <letter> — <the choice text>
**ليه؟** 1–3 short lines with the science idea behind it.
❌ **ليه <the student's letter> غلط؟** 1–2 lines: the exact misunderstanding that leads to that choice. (If the student left it blank, skip this part.)
💡 **تريكة:** one short way to remember it.`;

/** The question as text for the model, and the fingerprint of everything that decides the answer. */
export async function explainInput(exam, qi, chosen) {
    const q = exam.questions[qi];
    const opts = (q.options || []).map((o, i) => `${LETTERS[i] || i + 1}) ${String(o).trim()}`);
    const ci = Number(q.correctIndex);
    const lines = [
        `Grade: ${GRADE_LABEL[String(exam.grade || '').toLowerCase()] || exam.grade}`,
        `Question: ${String(q.question || '').trim()}`,
        'Choices:', ...opts,
        `Official correct answer: ${opts[ci] || '?'}`,
        chosen >= 0 && chosen !== ci ? `The student chose: ${opts[chosen] || '?'}` : 'The student left it blank.'
    ];
    const hash = (await sha256(JSON.stringify({ g: exam.grade, q: q.question, o: q.options, c: ci }))).slice(0, 24);
    return { text: lines.join('\n'), hash };
}

async function who(request, env, db, url) {
    const as = (url.searchParams.get('as') || '').trim();
    if (as) {
        const auth = await requireStaff(request, env, 'students.view');
        if (auth.error) return { error: auth.error };
        const row = await db.prepare('SELECT student_id, grade, first_name, gender FROM students WHERE student_id = ?').bind(as).first();
        if (!row) return { error: bad('Student not found', 404) };
        return { preview: true, staff: auth.staff, student: { id: row.student_id, grade: String(row.grade || '').toLowerCase(), firstName: row.first_name, gender: row.gender } };
    }
    const st = await verifyStudentRequest(request, env, db);
    if (!st) return { error: bad('سجّل دخولك تاني من فضلك 🙏', 401, { code: 'STUDENT_SESSION_REQUIRED' }) };
    return { preview: false, staff: null, student: st };
}

export async function onRequest(context) {
    const { request, env } = context;
    const url = new URL(request.url), action = url.searchParams.get('action') || '';
    const db = getDb(env);
    if (!db) return bad('Database not connected', 500);
    try {
        await ensureAppSchema(db);
        await ensureQuotaTables(db);
        const W = await who(request, env, db, url);
        if (W.error) return W.error;
        const sid = W.student.id;
        const access = async () => W.preview ? { ok: true, quota: null } : studentAccess(db, sid);
        const leftPct = (q) => q && q.budgetUsd > 0 ? Math.max(0, Math.min(100, Math.round(q.leftUsd / q.budgetUsd * 100))) : null;

        if (action === 'status') {
            const a = await access();
            return json({ ok: a.ok && claudeReady(env), code: a.ok ? (claudeReady(env) ? null : 'PAID_OFF') : a.code, preview: W.preview, leftPct: leftPct(a.quota) });
        }
        if (request.method !== 'POST') return bad('POST only', 405);
        const data = await request.json().catch(() => ({}));
        const fail = (code, extra = {}) => bad(FRIENDLY[code] || FRIENDLY.AI_ERROR, STATUS[code] || 502, { code, ...extra });
        // who pays: the student's own budget, or (Preview) staff use
        const meter = (kind) => W.preview ? { staffId: W.staff.id, kind } : { studentId: sid, kind };
        const logHit = (kind) => logUsage(db, W.preview ? { staffId: W.staff.id, kind, cached: true } : { studentId: sid, kind, cached: true });

        if (action === 'explain') {
            const examId = String(data.examId || ''), qi = parseInt(data.q, 10);
            const row = await db.prepare(`SELECT s.answers, s.status, e.id, e.grade, e.questions, e.expires_at, e.time_limit_minutes
                FROM exam_submissions s JOIN exams e ON e.id = s.exam_id WHERE s.exam_id = ? AND s.student_id = ?`).bind(examId, sid).first();
            if (!row || row.status !== 'submitted') return bad('مش لاقيين الامتحان ده في نتايجك', 404, { code: 'NO_RESULT' });
            const grace = row.time_limit_minutes ? Number(row.time_limit_minutes) + 5 : 60;
            if (Date.now() < new Date(row.expires_at).getTime() + grace * 60000) return bad('الشرح بيفتح بعد ما الامتحان يقفل للكل 🔒', 403, { code: 'REVIEW_LOCKED' });
            let questions = [], answers = [];
            try { questions = JSON.parse(row.questions) || []; } catch (e) { }
            try { answers = JSON.parse(row.answers || '[]') || []; } catch (e) { }
            const q = questions[qi];
            if (!q || !Array.isArray(q.options) || q.correctIndex === undefined) return bad('السؤال ده مش موجود', 404, { code: 'NO_QUESTION' });
            const chosen = Number(answers[qi] ?? -1);
            if (chosen === Number(q.correctIndex)) return bad('إنت جاوبت السؤال ده صح أصلاً 🎉', 400, { code: 'NOT_WRONG' });
            const a = await access();
            if (!a.ok) return fail(a.code, { leftPct: leftPct(a.quota) });
            const inp = await explainInput({ grade: row.grade, questions }, qi, chosen);
            const key = `exp:${EXPLAIN_VERSION}:${row.id}:${qi}:${chosen < 0 ? 'blank' : chosen}:${inp.hash}`;
            let out;
            try {
                out = await getOrMake(db, key, {
                    kind: 'explain', ref: row.id,
                    make: async () => {
                        const r = await chat(env, db, { tier: 'pro', system: EXPLAIN_SYSTEM, messages: [{ role: 'user', content: inp.text }], maxTokens: 600, meter: meter('explain') });
                        return { text: r.text, model: r.model, costUsd: r.costUsd };
                    }
                });
            } catch (e) {
                if (e instanceof CacheBusyError) return fail('CACHE_BUSY');
                if (e instanceof AiLimitError) return fail(e.code, { leftPct: leftPct(e.quota || a.quota) });
                throw e;
            }
            if (out.cached) await logHit('explain');
            const after = W.preview ? null : await studentAccess(db, sid);
            return json({ text: out.text, cached: out.cached, leftPct: leftPct(after && after.quota) });
        }
        return bad('Unknown action', 404);
    } catch (err) {
        console.error('study-ai error', err);
        return bad(FRIENDLY.AI_ERROR, 500, { code: 'AI_ERROR' });
    }
}
