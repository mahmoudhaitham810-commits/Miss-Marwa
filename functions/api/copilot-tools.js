// =====================================================================
// AI Assistant data tools (Step C1) — READ-ONLY lookups for Miss Marwa.
//
// Every number comes from the platform's OWN endpoints (analytics, exams, ask), called internally
// with her login — so the AI Assistant always shows exactly what her Analytics / Student / Results /
// Inbox pages show, and the AI never computes or invents a number.
//
// Each tool returns { cards: [...], facts: "compact text for the AI", focus }.
//   cards  → drawn by the page as structured data cards with action buttons (always exact)
//   facts  → the AI writes a short takeaway from these, in Miss Marwa's style
// Which tool runs is decided by code (route()), not by the AI — so it works the same on Argon (free)
// and Marwa Cloud, and a lookup still shows its cards when the free units have run out.
// This module exports onRequest → 404 so it is never reachable as a URL.
// =====================================================================
import * as analytics from './analytics.js';
import * as exams from './exams.js';
import * as ask from './ask.js';

export async function onRequest() { return new Response('Not found', { status: 404 }); }

export const GRADES = ['prep1', 'prep2', 'prep3', 'sec1'];
export const GRADE_LABEL = { prep1: 'Prep 1', prep2: 'Prep 2', prep3: 'Prep 3', sec1: 'Sec 1' };
const BR_LABEL = { center: 'Center', private: 'Private' };
const r1 = (v) => (v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Math.round(Number(v) * 10) / 10);
const pctTxt = (v) => (v === null || v === undefined ? '—' : `${Math.round(v)}%`);
const nm = (s) => `${s.firstName || ''} ${s.lastName || ''}`.trim();
const DAY = 86400000;
function toMs(v) {
    if (!v) return 0;
    const s = String(v);
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(s + 'T23:59:59Z').getTime();
    return new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(s) || !/\d:\d/.test(s) ? s : s.replace(' ', 'T') + 'Z').getTime();
}

// ---------- calling the platform's own endpoints with her login ----------
async function callApi(ctx, mod, path) {
    const url = new URL(path, ctx.request.url);
    const req = new Request(url.toString(), { method: 'GET', headers: ctx.request.headers });
    const handler = mod.onRequestGet || mod.onRequest;
    const res = await handler({ request: req, env: ctx.env, waitUntil: ctx.waitUntil || (() => { }), params: {}, data: {} });
    const data = await res.json().catch(() => null);
    if (!res.ok) { const e = new Error((data && data.error) || `Lookup failed (${res.status})`); e.status = res.status; throw e; }
    return data;
}
const memo = (ctx, key, fn) => { ctx._memo ||= {}; return ctx._memo[key] ||= fn(); };
const leaderboard = (ctx, grade, branch = 'all') => memo(ctx, `lb:${grade}:${branch}`, () => callApi(ctx, analytics, `/api/analytics?action=leaderboard&grade=${grade}&branch=${branch}&board=combined`));
const quicklists = (ctx, grade, branch = 'all') => memo(ctx, `ql:${grade}:${branch}`, () => callApi(ctx, analytics, `/api/analytics?action=quicklists&grade=${grade}&branch=${branch}`));
const examList = (ctx) => memo(ctx, 'exams', () => callApi(ctx, exams, '/api/exams?action=list'));
const examResults = (ctx, id) => memo(ctx, `ex:${id}`, () => callApi(ctx, exams, `/api/exams?action=results&examId=${encodeURIComponent(id)}`));
const inbox = (ctx, grade) => memo(ctx, `in:${grade}`, () => callApi(ctx, ask, `/api/ask?action=inbox&grade=${grade}&status=waiting`));

// ---------- text normalising + matching ----------
export function norm(t) {
    return String(t || '').toLowerCase()
        .replace(/[\u064B-\u065F\u0670\u0640]/g, '')          // tashkeel + tatweel
        .replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي')
        .replace(/[٠-٩]/g, d => d.charCodeAt(0) - 0x0660)
        .replace(/\s+/g, ' ').trim();
}
const has = (t, re) => re.test(t);

export function detectGrade(t) {
    const s = norm(t);
    if (/\bsec(ondary)?\s*-?\s*1\b|(اولي|الاول|1)\s*ثانوي|\bs1\b/.test(s)) return 'sec1';
    if (/\bprep\s*-?\s*1\b|\bp1\b|(اولي|الاول|1)\s*(اعدادي|اعداديه)|الصف\s*الاول/.test(s)) return 'prep1';
    if (/\bprep\s*-?\s*2\b|\bp2\b|(تانيه|ثانيه|التاني|الثاني|2)\s*(اعدادي|اعداديه)|الصف\s*(التاني|الثاني)/.test(s)) return 'prep2';
    if (/\bprep\s*-?\s*3\b|\bp3\b|(تالته|ثالثه|التالت|الثالث|3)\s*(اعدادي|اعداديه)|الصف\s*(التالت|الثالث)/.test(s)) return 'prep3';
    return null;
}
function detectBranch(t) {
    const s = norm(t);
    if (/\bcenter\b|\bcentre\b|سنتر|السنتر/.test(s)) return 'center';
    if (/\bprivate\b|برايفت|خصوصي|البرايفت/.test(s)) return 'private';
    return 'all';
}

// Words that are never student names (they collide with name "keys" — e.g. مين ≈ Amin)
const STOP = new Set(('مين ايه اي عامل عامله عاملين اخبار اخباره اخبارها مستوي مستواه مستواها مستواهم درجات درجه درجاته نتيجه نتيجته طالب طالبه الطالب الطالبه طلبه الطلبه طلاب الطلاب ' +
    'في من علي على عن مع هو هي هم ده دي دول كده لسه بس و او يا ازاي إزاي فين امتي ليه كام ماله مالها واقع واقعه واقعين ضعيف ضعيفه غايب غايبه غياب حضور امتحان امتحانات ' +
    'اسئله سؤال ابعت ابعتي رساله ولي امر امره امرها النهارده انهارده اليوم بكره ملخص موجز الصبح صباح خير الخير اعدادي ثانوي اولي تانيه تالته الاول التاني التالت الثاني الثالث ' +
    'prep sec how is the of and in for show me his her student students grade grades exam exams level weak top absent today brief summary about doing').split(' ').map(norm));
const STUDENT_INTENT = /عامل|اخبار|مستوي|مستوا|درجات|درجه|نتيج|غياب|غايب|حضور|ملف|بروفايل|profile|how ('?s|is)|doing|grades?|results?|level|absen|طالب|ابعت|رساله|ولي امر|parent|متابع|امتحانات/;

// Arabic ↔ English name "sound key" for the AI Assistant (stricter than the duplicates check's nameKey):
// keeps h (ح/ه), long و (ou/oo) and long ي (i/ee/y) so محمد/Mohamed ≠ أحمد/Ahmed ≠ محمود/Mahmoud and
// عمر/Omar ≠ أميرة/Amira ≠ عمرو/Amr; ى and ة are vowels (مصطفى = Mostafa, سلمى = Salma).
const AR_KEY = { 'ا': '', 'أ': '', 'إ': '', 'آ': '', 'ء': '', 'ؤ': 'w', 'ئ': 'y', 'ب': 'b', 'ت': 't', 'ة': '', 'ث': 's', 'ج': 'g', 'ح': 'h', 'خ': 'k', 'د': 'd', 'ذ': 'z', 'ر': 'r', 'ز': 'z', 'س': 's', 'ش': 's', 'ص': 's', 'ض': 'd', 'ط': 't', 'ظ': 'z', 'ع': '', 'غ': 'g', 'ف': 'f', 'ق': 'k', 'ك': 'k', 'ل': 'l', 'م': 'm', 'ن': 'n', 'ه': 'h', 'و': 'w', 'ى': '', 'ي': 'y' };
export function matchKey(word) {
    let w = String(word || '').toLowerCase().replace(/[ً-ٰٟـ]/g, '');
    if (/[؀-ۿ]/.test(w)) return w.replace(/^ال(?=..)/, '').split('').map(c => AR_KEY[c] ?? '').join('').replace(/(.)\1+/g, '$1');
    w = w.replace(/[^a-z]/g, '');
    if (/^amr(o|ou|u)?$/.test(w)) return 'mrw';                       // عمرو
    w = w.replace(/^(el|al)(?=...)/, '')
        .replace(/sh/g, 's').replace(/kh/g, 'k').replace(/gh/g, 'g').replace(/ph/g, 'f').replace(/q/g, 'k').replace(/c/g, 'k').replace(/j/g, 'g').replace(/x/g, 'ks')
        .replace(/ou|oo/g, 'w').replace(/ee|ie|ey/g, 'y').replace(/(?!^)i/g, 'y');
    return w.replace(/[aeiou]/g, '').replace(/(.)\1+/g, '$1');
}

let STU_CACHE = null;
async function allStudents(db) {
    if (STU_CACHE && Date.now() - STU_CACHE.at < 60000) return STU_CACHE.rows;
    const { results } = await db.prepare(`SELECT student_id as studentId, first_name as firstName, last_name as lastName, grade, branch, gender FROM students`).all();
    const rows = (results || []).map(s => {
        const first = norm(s.firstName).split(' ')[0] || '';
        const last = norm(s.lastName).split(' ')[0] || '';
        return { ...s, grade: String(s.grade || '').toLowerCase(), _f: first, _l: last, _fk: matchKey(first), _lk: matchKey(last) };
    });
    STU_CACHE = { at: Date.now(), rows };
    return rows;
}
export function resetStudentCache() { STU_CACHE = null; }

// Find the student(s) a message talks about. Exact spelling beats a sound-alike key (عمر/Omar → "mr").
export async function findStudents(db, text, grade = null) {
    const idm = String(text).match(/\b(MM-\d{3,})\b/i);
    const rows = await allStudents(db);
    if (idm) { const s = rows.find(r => r.studentId.toUpperCase() === idm[1].toUpperCase()); return s ? { matches: [s], strong: true } : { matches: [], strong: false, notFound: idm[1].toUpperCase() }; }
    // keep each word's original spelling for the sound key (norm() turns ى→ي and ة→ه, which would change it)
    const raw = String(text).replace(/[\u064B-\u065F\u0670\u0640]/g, '').replace(/[^\p{L}\s]/gu, ' ').split(/\s+/).filter(Boolean)
        .map(w => (w.length > 3 && /^[وفلب]/.test(w) && !STOP.has(norm(w)) ? [w, w.slice(1)] : [w])).flat()
        .filter(w => !STOP.has(norm(w)));
    if (!raw.length) return { matches: [], strong: false };
    const words = raw.map(norm), keys = raw.map(w => matchKey(w));
    const scored = [];
    for (const s of rows) {
        if (grade && s.grade !== grade) continue;
        let best = 0;
        for (let i = 0; i < words.length; i++) {
            const fExact = s._f && words[i] === s._f, fKey = s._fk.length >= 2 && keys[i] === s._fk;
            if (!fExact && !fKey) continue;
            let sc = fExact ? 3 : 2;
            const j = i + 1;
            if (j < words.length && s._l && (words[j] === s._l || (s._lk.length >= 2 && keys[j] === s._lk))) sc += words[j] === s._l ? 4 : 3;
            best = Math.max(best, sc);
        }
        if (best) scored.push({ s, sc: best });
    }
    if (!scored.length) return { matches: [], strong: false };
    scored.sort((a, b) => b.sc - a.sc);
    const top = scored[0].sc;
    const fullName = top >= 5;
    // full name → the best match(es); first name only → everyone with that first name (any spelling)
    const matches = (fullName ? scored.filter(x => x.sc === top) : scored).map(x => x.s);
    const intent = STUDENT_INTENT.test(norm(text));
    // A single first name only counts when she is clearly asking about a student (or spelled it exactly)
    if (!fullName && !intent) return { matches: [], strong: false };
    return { matches: matches.slice(0, 12), strong: matches.length === 1 && (fullName || intent), total: matches.length };
}

// ---------- the router: which tool does this message need? ----------
const RX = {
    brief: /ملخص (النهارده|انهارده|اليوم)|موجز|brief|صباح الخير|اخبار (النهارده|اليوم)|ايه الاخبار|عندي ايه النهارده|^today\b|morning/,
    inbox: /((اسئله|سؤال|questions?)\s.*(مستني|waiting|ماتردش|متردش|من غير رد|unanswered|اتسالت|الانبوكس))|inbox|الانبوكس|اسئله الطلبه|الاسئله المستنيه|questions waiting/,
    exams: /(امتحان|امتحانات|exam|quiz|كويز).*(نتيج|نتايج|result|درجات|حلو|محلش|ماحلش|مخلص|اتقفل|missed|taken|مين)|(محلش|ماحلش|محلوش|ماحلوش|حلوا|حلو|دخل|مدخلش|ماخدش).*(امتحان|exam|كويز)|(نتيج|نتايج|results?).*(امتحان|exam|كويز)|اخر امتحان|last exam/,
    absent: /غياب|غايب|غايبين|absent|absence|attendance|حضور|مجاش|محضرش|ماحضرش/,
    top: /اوائل|الاوائل|\btop\b|الاحسن|احسن (طلبه|طلاب|الطلبه)|الشاطرين|\bbest\b|المتفوقين/,
    attention: /واقع|واقعين|ضعيف|ضعاف|\bweak|at.?risk|محتاج(ين)? متابعه|متابعه|slipping|بيقع|نازل|attention|الاضعف|weakest|struggl/
};
const FOLLOW = /غياب|غايب|درجات|امتحانات|اسئلته|اسئلتها|ابعت|رساله|ولي امر|parent|اخباره|اخبارها|مستواه|مستواها|\bhis\b|\bher\b|\bhe\b|\bshe\b|وهو|وهي|عنه|عنها|ليه|why/;

export async function route(db, text, focus = null) {
    const s = norm(text);
    const grade = detectGrade(text), branch = detectBranch(text);
    const listy = RX.top.test(s) || RX.attention.test(s) || RX.absent.test(s) || RX.inbox.test(s) || RX.exams.test(s) || RX.brief.test(s);
    // 1) a student by ID / name
    const f = await findStudents(db, text, null);
    if (f.notFound) return { tool: 'note', args: { text: `مفيش طالب بالكود ${f.notFound} على السيستم — اتأكدي من الكود.`, facts: `No student with code ${f.notFound} exists on the platform. Tell her briefly.` } };
    if (f.matches.length && (f.strong || !listy)) {
        if (f.matches.length === 1) return { tool: 'student', args: { id: f.matches[0].studentId } };
        const inGrade = grade ? f.matches.filter(m => m.grade === grade) : [];
        if (inGrade.length === 1) return { tool: 'student', args: { id: inGrade[0].studentId } };
        return { tool: 'pick', args: { matches: (inGrade.length ? inGrade : f.matches).map(m => m.studentId), total: f.total } };
    }
    if (RX.brief.test(s)) return { tool: 'brief', args: {} };
    if (RX.inbox.test(s)) return { tool: 'inbox', args: { grade } };
    if (RX.exams.test(s)) return { tool: 'exams', args: { grade: grade || (focus && focus.grade) || null } };
    if (RX.absent.test(s) && !(focus && focus.type === 'student' && !grade)) return { tool: 'absent', args: { grade: grade || (focus && focus.grade) || null, branch } };
    if (RX.top.test(s)) return { tool: 'top', args: { grade: grade || (focus && focus.grade) || null, branch } };
    if (RX.attention.test(s) && (grade || /طلبه|طلاب|students|مين|who|الطلبه/.test(s) || !focus || focus.type !== 'student')) return { tool: 'attention', args: { grade: grade || (focus && focus.grade && focus.type !== 'student' ? focus.grade : null), branch } };
    // 2) follow-ups on what we were just looking at
    if (focus && focus.type === 'student' && (FOLLOW.test(s) || RX.absent.test(s) || RX.attention.test(s))) return { tool: 'student', args: { id: focus.id } };
    if (focus && focus.tool && grade && s.replace(/[^\p{L}\d\s]/gu, '').split(' ').filter(Boolean).length <= 4) return { tool: focus.tool, args: { ...(focus.args || {}), grade, branch } };
    return null;
}
export function planFromContext(c) {
    if (!c || typeof c !== 'object') return null;
    const id = String(c.id || '').slice(0, 80);
    if (c.type === 'student' && id) return { tool: 'student', args: { id } };
    if (c.type === 'exam' && id) return { tool: 'exam', args: { id } };
    if (c.type === 'inbox') return { tool: 'inbox', args: { grade: GRADES.includes(c.grade) ? c.grade : null } };
    if (c.type === 'brief') return { tool: 'brief', args: {} };
    if (['attention', 'top', 'absent', 'exams'].includes(c.type)) return { tool: c.type, args: { grade: GRADES.includes(c.grade) ? c.grade : null, branch: ['center', 'private'].includes(c.branch) ? c.branch : 'all' } };
    return null;
}

// ---------- tools ----------
export async function runTool(ctx, plan) {
    const fn = TOOLS[plan.tool];
    if (!fn) return null;
    return fn(ctx, plan.args || {});
}

const TOOLS = {
    async note(ctx, { text, facts }) { return { cards: [{ type: 'note', tone: 'warn', text }], facts: facts || text, focus: undefined }; },

    // One student's full picture
    async student(ctx, { id }) {
        const P = await callApi(ctx, analytics, `/api/analytics?action=profile&studentId=${encodeURIComponent(id)}`);
        const st = P.student, sm = P.summary;
        const grade = st.grade;
        const extra = await ctx.db.prepare(`SELECT s.group_id as groupId, s.last_login as lastLogin, g.name as groupName FROM students s LEFT JOIN student_groups g ON g.id = s.group_id WHERE s.student_id = ?`).bind(id).first().catch(() => null);
        const { results: qs } = await ctx.db.prepare(`SELECT q.id, q.unit, q.lesson, q.status, q.waiting_since as waitingSince, q.created_at as createdAt,
                (SELECT text FROM ask_messages m WHERE m.question_id = q.id AND m.sender = 'student' ORDER BY m.id LIMIT 1) as firstText
            FROM ask_questions q WHERE q.student_id = ? ORDER BY q.id DESC LIMIT 5`).bind(id).all().catch(() => ({ results: [] }));
        const { results: qc } = await ctx.db.prepare(`SELECT status, COUNT(*) c FROM ask_questions WHERE student_id = ? GROUP BY status`).bind(id).all().catch(() => ({ results: [] }));
        let reasons = [];
        try { const lb = await leaderboard(ctx, grade, 'all'); const a = (lb.attention || []).find(x => x.studentId === id); reasons = a ? a.reasons.map(r => ({ code: r.code, text: r.text })) : []; } catch (e) { }
        const center = (P.center || []).filter(h => h.status !== 'not-entered');
        const online = (P.online || []).filter(o => o.status !== 'not-yet' && o.status !== 'in-progress');
        const recent = [...center.map(h => ({ ...h, kind: 'center' })), ...online.map(o => ({ name: o.name, date: o.date, status: o.status, score: o.score, total: o.total, pct: o.pct, kind: 'online' }))]
            .sort((a, b) => toMs(b.date) - toMs(a.date)).slice(0, 8);
        const missedOnline = online.filter(o => o.status === 'missed' || o.status === 'opened').map(o => ({ name: o.name, date: o.date, status: o.status }));
        const absences = center.filter(h => h.status === 'absent').map(h => ({ name: h.name, date: h.date }));
        const openNow = (P.online || []).filter(o => o.status === 'not-yet' || o.status === 'in-progress').map(o => ({ name: o.name, expiresAt: o.expiresAt, status: o.status }));
        const flags = (P.online || []).flatMap(o => (o.flags || []).filter(f => f.level !== 'info').map(f => ({ exam: o.name, text: f.text, level: f.level }))).slice(0, 5);
        const qCount = Object.fromEntries((qc || []).map(r => [r.status, r.c]));
        const card = {
            type: 'student',
            student: { id: st.studentId, name: nm(st), gender: st.gender, grade, gradeLabel: GRADE_LABEL[grade] || grade, branch: st.branch, branchLabel: BR_LABEL[st.branch] || '—', group: extra && extra.groupName || null, phone: st.phone, parentPhone: st.parentPhone, joined: String(st.createdAt || '').slice(0, 10), lastLogin: extra && extra.lastLogin || null },
            summary: { combinedPct: sm.combinedPct, centerPct: sm.centerPct, onlinePct: sm.onlinePct, level: sm.level, centerRank: sm.centerRank, combinedRank: sm.combinedRank, gradeSize: sm.gradeSize, participation: sm.participation, ranked: sm.ranked, centerTaken: sm.centerTaken, centerAbsent: sm.centerAbsent, onlineTaken: sm.onlineTaken, onlineMissed: sm.onlineMissed },
            recent, missedOnline, absences, openNow, flags, reasons,
            questions: { waiting: qCount.waiting || 0, total: Object.values(qCount).reduce((a, b) => a + b, 0), recent: (qs || []).map(q => ({ id: q.id, unit: q.unit, lesson: q.lesson, status: q.status, text: String(q.firstText || '').slice(0, 120), at: q.createdAt })) },
            gap: P.integrity && P.integrity.gap
        };
        const facts = [
            `STUDENT: ${card.student.name} (${card.student.id}) — ${card.student.gradeLabel}, ${card.student.branchLabel}${card.student.group ? ', group ' + card.student.group : ''}.`,
            `Overall ${pctTxt(sm.combinedPct)} (level: ${sm.level || 'not enough exams'}); center ${pctTxt(sm.centerPct)} from ${sm.centerTaken} exams, absent ${sm.centerAbsent}; online ${pctTxt(sm.onlinePct)} from ${sm.onlineTaken} exams, missed ${sm.onlineMissed}.`,
            sm.combinedRank ? `Rank ${sm.combinedRank} of ${sm.gradeSize} in ${card.student.gradeLabel}.` : `Not ranked yet (participation ${pctTxt(sm.participation)}).`,
            recent.length ? `Latest results (newest first): ${recent.slice(0, 6).map(r => `${r.name} ${r.status === 'taken' ? pctTxt(r.pct) : r.status}`).join('; ')}.` : 'No exam results yet.',
            missedOnline.length ? `Missed online exams: ${missedOnline.map(m => m.name).join(', ')}.` : '',
            absences.length ? `Absent from center exams: ${absences.map(a => a.name).join(', ')}.` : '',
            openNow.length ? `Open online exams not submitted yet: ${openNow.map(o => o.name).join(', ')}.` : '',
            reasons.length ? `Needs attention: ${reasons.map(r => r.text).join('; ')}.` : 'No attention flags.',
            flags.length ? `Exam integrity notes: ${flags.map(f => `${f.exam}: ${f.text}`).join('; ')}.` : '',
            `Questions asked: ${card.questions.total} (${card.questions.waiting} waiting).`
        ].filter(Boolean).join('\n');
        return { cards: [card], facts, focus: { type: 'student', id: st.studentId, grade } };
    },

    // Several students share that name → let her pick
    async pick(ctx, { matches, total }) {
        const rows = (await allStudents(ctx.db)).filter(s => matches.includes(s.studentId));
        const card = { type: 'pick', total: total || rows.length, rows: rows.map(s => ({ studentId: s.studentId, name: nm(s), grade: s.grade, gradeLabel: GRADE_LABEL[s.grade] || s.grade, branchLabel: BR_LABEL[s.branch] || '' })) };
        return { cards: [card], facts: `Several students match this name (${card.total}): ${card.rows.map(r => `${r.name} (${r.gradeLabel})`).join(', ')}. Ask her which one she means — the list is shown under your reply.`, focus: null };
    },

    // Students who need attention (falling marks, missing exams, weak average, online≫center gap) + weakest
    async attention(ctx, { grade, branch = 'all' }) {
        const grades = grade ? [grade] : GRADES;
        const cards = [], facts = [];
        for (const g of grades) {
            let lb, ql;
            try { [lb, ql] = await Promise.all([leaderboard(ctx, g, branch), quicklists(ctx, g, branch)]); } catch (e) { continue; }
            const pctOf = Object.fromEntries([...(lb.leaderboard || []), ...(lb.unranked || [])].map(r => [r.studentId, r]));
            const rows = (lb.attention || []).map(a => {
                const r = pctOf[a.studentId] || {};
                return { studentId: a.studentId, name: a.name, pct: r.pct ?? null, missed: r.missed ?? null, parentPhone: a.parentPhone, reasons: a.reasons.map(x => ({ code: x.code, text: x.text })) };
            }).sort((a, b) => b.reasons.length - a.reasons.length || (a.pct ?? 101) - (b.pct ?? 101));
            const weakest = (ql.weakest20 || []).slice(0, 10).map(r => ({ studentId: r.studentId, name: nm(r), pct: r.pct, missed: r.missed, parentPhone: r.parentPhone }));
            if (!grade && !rows.length) continue;
            cards.push({ type: 'list', kind: 'attention', grade: g, gradeLabel: GRADE_LABEL[g], branch, title: `Needs attention · ${GRADE_LABEL[g]}`, subtitle: `${rows.length} of ${lb.summary.students} students`, rows: rows.slice(0, 25), extra: { title: 'Lowest averages', rows: weakest }, empty: 'No warning signs right now 🎉' });
            facts.push(`${GRADE_LABEL[g]} (${lb.summary.students} students${branch !== 'all' ? ', ' + branch : ''}): ${rows.length} need attention${rows.length ? ' — ' + rows.slice(0, 8).map(r => `${r.name} (${pctTxt(r.pct)}; ${r.reasons.map(x => x.code).join('+')})`).join(', ') : ''}. Lowest averages: ${weakest.slice(0, 5).map(w => `${w.name} ${pctTxt(w.pct)}`).join(', ') || 'none'}.`);
        }
        if (!cards.length) return { cards: [{ type: 'note', text: 'No students need attention right now 🎉' }], facts: 'No student has any warning sign in any grade right now.', focus: { tool: 'attention', args: { grade, branch } } };
        facts.push('Reason codes: falling = marks fell in the last 2 exams; missing = missed 2+ of the last 5 exams; weak = average under 50%; gap = online much higher than center.');
        return { cards, facts: facts.join('\n'), focus: { tool: 'attention', args: { grade, branch }, grade } };
    },

    async top(ctx, { grade, branch = 'all' }) {
        const grades = grade ? [grade] : GRADES;
        const cards = [], facts = [];
        for (const g of grades) {
            let ql; try { ql = await quicklists(ctx, g, branch); } catch (e) { continue; }
            const rows = (ql.top10Combined || []).map(r => ({ studentId: r.studentId, name: nm(r), pct: r.pct, rank: r.rank, parentPhone: r.parentPhone }));
            const center = (ql.top10Center || []).map(r => ({ studentId: r.studentId, name: nm(r), pct: r.pct, rank: r.rank, parentPhone: r.parentPhone }));
            if (!grade && !rows.length) continue;
            cards.push({ type: 'list', kind: 'top', grade: g, gradeLabel: GRADE_LABEL[g], branch, title: `Top 10 · ${GRADE_LABEL[g]}`, subtitle: 'Center + online', rows, extra: { title: 'Top 10 · center exams only', rows: center }, empty: 'Not enough exams to rank yet' });
            facts.push(`${GRADE_LABEL[g]} top (center+online): ${rows.slice(0, 10).map(r => `#${r.rank} ${r.name} ${pctTxt(r.pct)}`).join(', ') || 'nobody ranked yet'}.`);
        }
        return { cards: cards.length ? cards : [{ type: 'note', text: 'Nobody is ranked yet.' }], facts: facts.join('\n') || 'Nobody is ranked yet.', focus: { tool: 'top', args: { grade, branch }, grade } };
    },

    // Attendance = absences from center (paper) exams + missed online exams
    async absent(ctx, { grade, branch = 'all' }) {
        const grades = grade ? [grade] : GRADES;
        const cards = [], facts = [];
        for (const g of grades) {
            const data = await analytics.loadGrade(ctx.db, g);
            const studs = data.students.filter(s => branch === 'all' || s.branch === branch);
            const centerEx = data.exams.filter(e => e.kind === 'center' && (branch === 'all' || !e.branch || e.branch === branch)).slice(-3).reverse();
            const sections = centerEx.map(e => {
                const rows = studs.filter(s => (!e.branch || e.branch === s.branch) && data.marks[e.key][s.studentId] && data.marks[e.key][s.studentId].absent)
                    .map(s => ({ studentId: s.studentId, name: nm(s), parentPhone: s.parentPhone }));
                return { exam: e.name, date: e.date, rows };
            });
            // repeated absences: 2+ of the last 5 center exams
            const last5 = data.exams.filter(e => e.kind === 'center').slice(-5);
            const repeat = studs.map(s => ({ s, n: last5.filter(e => (!e.branch || e.branch === s.branch) && data.marks[e.key][s.studentId] && data.marks[e.key][s.studentId].absent).length }))
                .filter(x => x.n >= 2).sort((a, b) => b.n - a.n).map(x => ({ studentId: x.s.studentId, name: nm(x.s), parentPhone: x.s.parentPhone, note: `Absent ${x.n} of last ${last5.length}` }));
            if (!grade && !sections.some(x => x.rows.length) && !repeat.length) continue;
            const first = sections[0];
            cards.push({ type: 'list', kind: 'absent', grade: g, gradeLabel: GRADE_LABEL[g], branch, title: `Absent · ${GRADE_LABEL[g]}`, subtitle: first ? `${first.exam} · ${first.date}` : 'No center exams yet', rows: first ? first.rows : [], extra: repeat.length ? { title: 'Absent again and again', rows: repeat } : null, sections: sections.slice(1).map(x => ({ title: `${x.exam} · ${x.date}`, rows: x.rows })), empty: first ? 'Nobody was absent 🎉' : 'No center exams recorded yet' });
            facts.push(`${GRADE_LABEL[g]}: ${sections.map(x => `${x.exam} (${x.date}): ${x.rows.length} absent${x.rows.length ? ' — ' + x.rows.slice(0, 10).map(r => r.name).join(', ') : ''}`).join(' | ') || 'no center exams yet'}. Repeated absences (2+ of last 5): ${repeat.map(r => r.name + ' ' + r.note.replace('Absent ', '')).join(', ') || 'none'}.`);
        }
        facts.push('Note: attendance on the platform = absence marks on center (paper) exams; there is no separate class register.');
        return { cards: cards.length ? cards : [{ type: 'note', text: 'No absences recorded recently.' }], facts: facts.join('\n'), focus: { tool: 'absent', args: { grade, branch }, grade } };
    },

    // Waiting questions in the Ask inbox
    async inbox(ctx, { grade }) {
        const first = await inbox(ctx, grade || 'prep1');
        const grades = grade ? [grade] : GRADES.filter(g => first.waiting[g] > 0);
        const sections = [];
        for (const g of grades) {
            const d = g === (grade || 'prep1') ? first : await inbox(ctx, g);
            sections.push({ grade: g, gradeLabel: GRADE_LABEL[g], count: d.waiting[g] || 0, rows: (d.items || []).slice(0, 8).map(q => ({ id: q.id, studentId: q.studentId, name: `${q.firstName} ${q.lastName}`.trim(), unit: q.unit, lesson: q.lesson, waitingSince: q.waitingSince, text: String(q.preview || '').slice(0, 110), kind: q.lastKind })) });
        }
        const total = Object.values(first.waiting).reduce((a, b) => a + b, 0);
        const card = { type: 'inbox', total, waiting: first.waiting, sections };
        const age = (t) => { const h = Math.round((Date.now() - toMs(t)) / 3600000); return h >= 48 ? `${Math.round(h / 24)} days` : `${h}h`; };
        // The AI only gets counts and waiting times — never what students asked (that section is Miss Marwa's own)
        const facts = `ASK INBOX: ${total} questions waiting (${GRADES.map(g => `${GRADE_LABEL[g]} ${first.waiting[g] || 0}`).join(', ')}).\n` +
            sections.map(s => `${s.gradeLabel}: oldest waiting ${s.rows.length ? age(s.rows[0].waitingSince) : '—'}`).join('\n') +
            `\nOnly report counts and how long they've waited; she answers the questions herself.`;
        return { cards: [card], facts, focus: { tool: 'inbox', args: { grade }, grade } };
    },

    // Recent exams of a grade (online + center) with completion and averages
    async exams(ctx, { grade }) {
        const list = (await examList(ctx)).map(e => ({ ...e, grade: String(e.grade || '').toLowerCase() }));
        const grades = grade ? [grade] : GRADES;
        const cards = [], facts = [];
        for (const g of grades) {
            const on = list.filter(e => e.grade === g).sort((a, b) => toMs(b.expires_at) - toMs(a.expires_at)).slice(0, 4);
            const rows = [];
            for (const e of on) {
                try {
                    const R = await examResults(ctx, e.id);
                    const done = (R.results || []).filter(r => r.status === 'submitted');
                    const avg = done.length && R.exam.total ? done.reduce((a, r) => a + Number(r.score || 0), 0) / done.length / R.exam.total * 100 : null;
                    rows.push({ id: e.id, kind: 'online', name: e.title, date: String(e.expires_at || '').slice(0, 10), closed: R.exam.closed, expiresAt: R.exam.expiresAt, completed: R.stats.completed, eligible: R.stats.eligible, avg: r1(avg), notTaken: (R.closed || R.exam.closed ? R.missed : R.notYet).length });
                } catch (x) { }
            }
            const data = await analytics.loadGrade(ctx.db, g);
            const cen = data.exams.filter(e => e.kind === 'center').slice(-3).reverse().map(e => {
                const ms = Object.values(data.marks[e.key]);
                const sc = ms.filter(m => !m.absent && m.score !== null);
                return { kind: 'center', name: e.name, date: e.date, completed: sc.length, absent: ms.filter(m => m.absent).length, avg: sc.length ? r1(sc.reduce((a, m) => a + m.score, 0) / sc.length / e.total * 100) : null };
            });
            if (!grade && !rows.length && !cen.length) continue;
            cards.push({ type: 'exams', grade: g, gradeLabel: GRADE_LABEL[g], online: rows, center: cen });
            facts.push(`${GRADE_LABEL[g]} online: ${rows.map(r => `${r.name} (${r.closed ? 'closed' : 'open until ' + String(r.expiresAt).slice(0, 16)}) ${r.completed}/${r.eligible} took it, avg ${pctTxt(r.avg)}, ${r.notTaken} ${r.closed ? 'missed' : 'not yet'}`).join('; ') || 'none'}. Center: ${cen.map(c => `${c.name} (${c.date}) avg ${pctTxt(c.avg)}, ${c.absent} absent`).join('; ') || 'none'}.`);
        }
        return { cards: cards.length ? cards : [{ type: 'note', text: 'No exams yet.' }], facts: facts.join('\n') || 'No exams yet.', focus: { tool: 'exams', args: { grade }, grade } };
    },

    // One online exam's results (✨ from the Results page)
    async exam(ctx, { id }) {
        const R = await examResults(ctx, id);
        const T = R.exam.total || 0;
        const done = (R.results || []).filter(r => r.status === 'submitted').map(r => ({ studentId: r.studentId, name: nm(r), score: Number(r.score), pct: T ? r1(Number(r.score) / T * 100) : null, parentPhone: r.parentPhone }));
        done.sort((a, b) => (b.pct ?? 0) - (a.pct ?? 0));
        const avg = done.length ? r1(done.reduce((a, r) => a + (r.pct || 0), 0) / done.length) : null;
        const bands = { excellent: 0, good: 0, average: 0, weak: 0 };
        done.forEach(r => { const p = r.pct ?? 0; bands[p >= 85 ? 'excellent' : p >= 70 ? 'good' : p >= 50 ? 'average' : 'weak']++; });
        const missing = (R.exam.closed ? R.missed : R.notYet).map(s => ({ studentId: s.studentId, name: nm(s), parentPhone: s.parentPhone, note: s.reason === 'opened' ? 'Opened, not submitted' : (R.exam.closed ? 'Missed' : 'Not yet') }));
        const card = { type: 'exam', exam: { id: R.exam.id, title: R.exam.title, grade: R.exam.grade, gradeLabel: GRADE_LABEL[String(R.exam.grade).toLowerCase()] || R.exam.grade, total: T, closed: R.exam.closed, expiresAt: R.exam.expiresAt }, completed: R.stats.completed, eligible: R.stats.eligible, avg, bands, top: done.slice(0, 5), low: done.slice(-5).reverse().filter(r => (r.pct ?? 0) < 60), missing };
        const facts = `EXAM "${card.exam.title}" (${card.exam.gradeLabel}, ${T} marks, ${R.exam.closed ? 'closed' : 'still open'}): ${card.completed}/${card.eligible} submitted, average ${pctTxt(avg)}. Bands: excellent ${bands.excellent}, good ${bands.good}, average ${bands.average}, weak ${bands.weak}. Top: ${card.top.map(r => `${r.name} ${pctTxt(r.pct)}`).join(', ') || '—'}. Under 60%: ${card.low.map(r => `${r.name} ${pctTxt(r.pct)}`).join(', ') || 'nobody'}. ${R.exam.closed ? 'Missed' : 'Not submitted yet'}: ${missing.length}${missing.length ? ' — ' + missing.slice(0, 12).map(m => m.name).join(', ') : ''}.`;
        return { cards: [card], facts, focus: { tool: 'exam', args: { id }, grade: String(R.exam.grade).toLowerCase() } };
    },

    // ☀️ Morning brief — the whole platform at a glance (no AI needed to read it)
    async brief(ctx) {
        const now = Date.now();
        const list = (await examList(ctx).catch(() => [])).map(e => ({ ...e, grade: String(e.grade || '').toLowerCase() }));
        const closing = [], closed = [];
        for (const e of list) {
            const end = toMs(e.expires_at);
            if (end > now && end - now <= 2 * DAY) closing.push(e);
            else if (end <= now && now - end <= 3 * DAY) closed.push(e);
        }
        const exam = async (e) => { try { const R = await examResults(ctx, e.id); return { id: e.id, name: e.title, grade: e.grade, gradeLabel: GRADE_LABEL[e.grade], expiresAt: R.exam.expiresAt, completed: R.stats.completed, eligible: R.stats.eligible, left: (R.exam.closed ? R.missed : R.notYet).length }; } catch (x) { return null; } };
        const closingRows = (await Promise.all(closing.slice(0, 6).map(exam))).filter(Boolean);
        const closedRows = (await Promise.all(closed.slice(0, 6).map(exam))).filter(Boolean);
        let waiting = {}, oldest = null;
        try {
            const d = await inbox(ctx, 'prep1'); waiting = d.waiting;
            const row = await ctx.db.prepare(`SELECT q.id, q.grade, q.waiting_since as since, s.first_name as firstName, s.last_name as lastName FROM ask_questions q LEFT JOIN students s ON s.student_id = q.student_id WHERE q.status = 'waiting' ORDER BY q.waiting_since ASC LIMIT 1`).first();
            if (row) oldest = { id: row.id, grade: row.grade, name: nm(row), since: row.since };
        } catch (e) { }
        const attention = [];
        for (const g of GRADES) {
            try { const lb = await leaderboard(ctx, g, 'all'); if (lb.summary.students) attention.push({ grade: g, gradeLabel: GRADE_LABEL[g], count: (lb.attention || []).length, students: lb.summary.students, names: (lb.attention || []).slice(0, 3).map(a => a.name), latest: lb.latestExam }); } catch (e) { }
        }
        const newSignups = await ctx.db.prepare(`SELECT COUNT(*) c FROM students WHERE created_at >= datetime('now', '-7 days')`).first().then(r => r.c).catch(() => 0);
        const card = { type: 'brief', date: new Date().toISOString(), closing: closingRows, closed: closedRows, waiting, waitingTotal: Object.values(waiting).reduce((a, b) => a + b, 0), oldest, attention, newSignups };
        const facts = [
            `MORNING BRIEF.`,
            `Online exams closing in the next 48h: ${closingRows.map(e => `${e.name} (${e.gradeLabel}) — ${e.completed}/${e.eligible} done, ${e.left} not yet`).join('; ') || 'none'}.`,
            `Closed in the last 3 days: ${closedRows.map(e => `${e.name} (${e.gradeLabel}) — ${e.completed}/${e.eligible} took it, ${e.left} missed`).join('; ') || 'none'}.`,
            `Questions waiting: ${card.waitingTotal}${card.waitingTotal ? ' (' + GRADES.filter(g => waiting[g]).map(g => `${GRADE_LABEL[g]} ${waiting[g]}`).join(', ') + ')' : ''}${oldest ? `; oldest from ${oldest.name} since ${oldest.since}` : ''}.`,
            `Needs attention: ${attention.map(a => `${a.gradeLabel} ${a.count}${a.names.length ? ' (' + a.names.join(', ') + ')' : ''}`).join('; ') || 'none'}.`,
            `New sign-ups this week: ${newSignups}.`
        ].join('\n');
        return { cards: [card], facts, focus: null };
    }
};
