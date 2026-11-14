import { requireStaff, audit, auditStmt, ensureAppSchema, requireStudent, verifyStudentRequest, verifyAdminRequest } from './admin-auth.js';

// ── Timing rules shared by submit, review and reports ──
// Late submit grace: the timer length + 5 min, or 60 min when there is no timer.
function graceMinutes(exam) {
    const t = exam.time_limit_minutes ?? exam.timeLimitMinutes;
    return t ? Number(t) + 5 : 60;
}
// Questions, answers and the correct choices are revealed only when NOBODY can still submit:
// the deadline + the grace window. Before that a student sees only their score.
function reviewUnlockMs(exam) {
    return new Date(exam.expires_at).getTime() + graceMinutes(exam) * 60 * 1000;
}
// SQLite CURRENT_TIMESTAMP looks like "2026-11-14 17:13:51" and is UTC
function toMs(v) {
    if (!v) return 0;
    const str = String(v);
    return new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(str) || !/\d:\d/.test(str) ? str : str.replace(' ', 'T') + 'Z').getTime();
}
const isClosed = (exam, now = Date.now()) => new Date(exam.expires_at).getTime() <= now;

// ── Per-student question order (anti-sharing) ──
// Every student gets the questions and the choices in their own order. The server keeps a seed
// per attempt, so it can map the answers back; answers are always STORED in the original order.
function rng(seedStr) {
    let h = 1779033703 ^ seedStr.length;
    for (let i = 0; i < seedStr.length; i++) { h = Math.imul(h ^ seedStr.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
    let a = h >>> 0;
    return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function shuffled(n, rand) {
    const arr = Array.from({ length: n }, (_, i) => i);
    for (let i = n - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
    return arr;
}
// Choices like "all of the above" only make sense in their written place — keep that question's order
const FIXED_ORDER_RE = /(كل|جميع|كلا|لا شيء|لاشيء|ليس|غير).{0,4}(ما سبق|مما سبق|السابق)|(all|none|both|neither).{0,6}(above|of these)|^\s*(both|all|none)\b/i;
function buildPlan(questions, seed) {
    const rand = rng(String(seed));
    const order = shuffled(questions.length, rand);                  // displayed position → original question
    const options = questions.map(q => {                              // per original question: displayed choice → original choice
        const n = (q.options || []).length;
        if ((q.options || []).some(o => FIXED_ORDER_RE.test(String(o)))) return Array.from({ length: n }, (_, i) => i);
        return shuffled(n, rand);
    });
    return { order, options };
}
function toOriginalAnswers(displayed, questions, seed) {
    const out = new Array(questions.length).fill(-1);
    if (!seed) {
        questions.forEach((_, i) => { const v = displayed[i]; out[i] = Number.isInteger(v) ? v : -1; });
        return out;
    }
    const plan = buildPlan(questions, seed);
    plan.order.forEach((orig, pos) => {
        const v = displayed[pos];
        out[orig] = Number.isInteger(v) && v >= 0 && v < plan.options[orig].length ? plan.options[orig][v] : -1;
    });
    return out;
}
function newSeed() {
    const b = crypto.getRandomValues(new Uint8Array(8));
    return Array.from(b).map(x => x.toString(16).padStart(2, '0')).join('');
}
function validateQuestions(questions) {
    if (!Array.isArray(questions) || questions.length === 0) return 'لازم يكون فيه سؤال واحد على الأقل';
    if (questions.length > 200) return 'عدد الأسئلة كبير جداً';
    for (const q of questions) {
        if (!q || !q.question || !Array.isArray(q.options) || q.options.length < 2) return 'في سؤال ناقصه نص أو اختيارات كافية';
        if (typeof q.correctIndex !== 'number' || q.correctIndex < 0 || q.correctIndex >= q.options.length) return `السؤال "${q.question}" مفيهوش إجابة صح واضحة`;
    }
    return null;
}
const cleanQuestions = (qs) => qs.map(q => ({ question: String(q.question), options: q.options.map(String), correctIndex: q.correctIndex }));

// الداتا بيز ممكن تكون متسجلة في Cloudflare باسم DB أو D1_DB
// الدالة دي بتتأكد إننا بنمسك الاسم الصح مهما كان
function getDb(env) {
    return [env.DB, env.D1_DB].find(d => d && typeof d.prepare === "function");
}

// بتبعت إشعار Push للطلاب المشتركين. لو معانا "grade"، بتستهدف بس الطلاب
// المتعلّمين بتاج المرحلة دي (مش كل الطلاب)؛ لو مفيش، بتبعت للكل كحل احتياطي.
// لو الإرسال فشل لأي سبب، بترجع بس من غير ما توقف نشر الامتحان نفسه.
async function sendPushNotification(env, { title, message, grade }) {
    const appId = env.ONESIGNAL_APP_ID;
    const apiKey = env.ONESIGNAL_REST_API_KEY;

    if (!appId || !apiKey) {
        console.log('OneSignal غير مفعّل: ONESIGNAL_APP_ID أو ONESIGNAL_REST_API_KEY مش متسجلين كـ Environment Variables');
        return;
    }

    const body = {
        app_id: appId,
        target_channel: 'push',
        headings: { en: title, ar: title },
        contents: { en: message, ar: message }
    };

    if (grade) {
        body.filters = [
            { field: 'tag', key: 'grade', relation: '=', value: grade.toUpperCase() }
        ];
    } else {
        body.included_segments = ['Subscribed Users'];
    }

    try {
        await fetch('https://api.onesignal.com/notifications', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json; charset=utf-8',
                'Authorization': `Key ${apiKey}`
            },
            body: JSON.stringify(body)
        });
    } catch (err) {
        console.log('فشل إرسال إشعار Push:', err.message);
    }
}

export async function onRequestGet(context) {
    const { request, env } = context;
    const url = new URL(request.url);
    const action = url.searchParams.get('action');
    const db = getDb(env);

    try {
        if (db) await ensureAppSchema(db); // adds new columns once (cheap after the first call)
        // === تستخدمها لوحة الأدمن عشان تجيب كل الامتحانات ===
        if (action === 'list') {
            // ── حماية: أدمن بس ──
            const auth = await requireStaff(request, env, 'exams.view');
            if (auth.error) return auth.error;

            await ensureAppSchema(db);
            const { results } = await db.prepare(
                `SELECT e.id, e.title, e.grade, e.questions, e.duration_days as durationDays, e.time_limit_minutes as timeLimitMinutes,
                        e.shuffle, e.expires_at, e.created_at,
                        (SELECT COUNT(*) FROM exam_submissions s WHERE s.exam_id = e.id) as attempts
                 FROM exams e ORDER BY e.created_at DESC`
            ).all();
            return Response.json(results);
        }

        // === تستخدمها صفحة الطالب عشان تعرض الامتحانات المتاحة لمرحلته ===
        // بترجع بيانات الامتحان من غير الإجابات الصح، وبتقول حالة كل امتحان بالنسبالله
        if (action === 'list-for-student') {
            // The signed-in student sees their own grade with their own statuses.
            // Staff (Preview as student) may look at any grade, without statuses.
            let grade = (url.searchParams.get('grade') || '').toLowerCase();
            let studentId = '';
            const me = await verifyStudentRequest(request, env, db);
            if (me) { grade = me.grade; studentId = me.id; }
            else if (await verifyAdminRequest(request, env)) { studentId = ''; }
            else {
                const who = await requireStudent(request, env, db, url.searchParams.get('studentId'));
                if (who.error) return who.error;
                grade = who.grade; studentId = who.id;
            }

            if (!grade) {
                return Response.json({ error: 'المرحلة الدراسية مطلوبة' }, { status: 400 });
            }

            const { results: exams } = await db.prepare(
                "SELECT id, title, grade, questions, expires_at, created_at, time_limit_minutes FROM exams WHERE grade = ? ORDER BY created_at DESC"
            ).bind(grade).all();

            let submissions = [];
            if (studentId) {
                const subRes = await db.prepare(
                    "SELECT exam_id, status, score FROM exam_submissions WHERE student_id = ?"
                ).bind(studentId).all();
                submissions = subRes.results || [];
            }

            const now = new Date();
            const list = exams.map(ex => {
                let total = 0;
                try { total = JSON.parse(ex.questions).length; } catch (e) { /* ignore */ }

                const sub = submissions.find(s => s.exam_id === ex.id);
                const isExpired = new Date(ex.expires_at) < now;

                let status = 'available';
                if (sub && sub.status === 'submitted') status = 'submitted';
                else if (sub && sub.status === 'started') status = 'locked';
                else if (isExpired) status = 'expired';

                return {
                    id: ex.id,
                    title: ex.title,
                    grade: ex.grade,
                    total,
                    expiresAt: ex.expires_at,
                    createdAt: ex.created_at,
                    timeLimitMinutes: ex.time_limit_minutes || null,
                    reviewUnlocksAt: new Date(reviewUnlockMs(ex)).toISOString(),
                    status,
                    score: sub ? sub.score : null
                };
            });

            return Response.json(list);
        }

        // === Exam results for the staff portal (with Center / Private counts and a correct missed list) ===
        if (action === 'results') {
            const auth = await requireStaff(request, env, 'exams.view');
            if (auth.error) return auth.error;

            const examId = url.searchParams.get('examId');
            if (!examId) return Response.json({ error: 'كود الامتحان مطلوب' }, { status: 400 });
            const exam = await db.prepare("SELECT id, title, grade, questions, expires_at, created_at, time_limit_minutes FROM exams WHERE id = ?").bind(examId).first();
            if (!exam) return Response.json({ error: 'الامتحان غير موجود' }, { status: 404 });

            let total = 0;
            try { total = JSON.parse(exam.questions).length; } catch (e) { /* ignore */ }
            const closed = isClosed(exam);

            const { results: subs } = await db.prepare(
                `SELECT s.student_id as studentId, s.first_name as firstName, s.last_name as lastName, s.gender, s.branch,
                        s.phone, s.parent_phone as parentPhone, sub.status, sub.score, sub.submitted_at as submittedAt,
                        sub.leave_count as leaves, sub.auto_submitted as auto
                 FROM exam_submissions sub
                 JOIN students s ON s.student_id = sub.student_id
                 WHERE sub.exam_id = ?
                 ORDER BY s.first_name ASC`
            ).bind(examId).all();
            const list = subs.map(r => ({ ...r, total }));

            const { results: gradeStudents } = await db.prepare(
                `SELECT student_id as studentId, first_name as firstName, last_name as lastName, gender, branch,
                        phone, parent_phone as parentPhone, created_at as createdAt
                 FROM students WHERE grade = ? ORDER BY first_name ASC`
            ).bind(exam.grade).all();
            const closeMs = new Date(exam.expires_at).getTime();
            const subMap = Object.fromEntries(subs.map(r => [r.studentId, r]));
            // Only students who already had an account before the exam closed could have taken it
            const eligible = gradeStudents.filter(st => subMap[st.studentId] || toMs(st.createdAt) <= closeMs);
            const notTaken = eligible.filter(st => !subMap[st.studentId] || subMap[st.studentId].status !== 'submitted')
                .map(st => ({ ...st, reason: subMap[st.studentId] ? 'opened' : 'not-started' }));

            const byBranch = {};
            for (const b of ['center', 'private', 'none']) {
                const inB = (x) => (x.branch || 'none') === b;
                byBranch[b] = {
                    students: eligible.filter(inB).length,
                    completed: list.filter(r => r.status === 'submitted' && inB(r)).length,
                    notTaken: notTaken.filter(inB).length
                };
            }
            const stats = {
                totalAccessed: list.length,
                completed: list.filter(r => r.status === 'submitted').length,
                inProgress: closed ? 0 : list.filter(r => r.status === 'started').length,
                eligible: eligible.length,
                joinedAfterClose: gradeStudents.length - eligible.length,
                byBranch
            };
            return Response.json({
                exam: { id: exam.id, title: exam.title, grade: exam.grade, total, closed, expiresAt: exam.expires_at, reviewUnlocksAt: new Date(reviewUnlockMs(exam)).toISOString() },
                stats,
                results: list,
                // "missed" only means something once the exam has closed; while it's open these are "not yet"
                missed: closed ? notTaken : [],
                notYet: closed ? [] : notTaken
            });
        }

        // === A student's own results page ===
        // While the exam can still be submitted by anyone, only the score goes out — no questions,
        // no chosen answers, no correct answers. Nothing to screenshot and pass around.
        if (action === 'my-results') {
            // Only the signed-in student's own results (the code in the URL is ignored)
            const who = await requireStudent(request, env, db, url.searchParams.get('studentId'));
            if (who.error) return who.error;
            const studentId = who.id;

            const { results } = await db.prepare(
                `SELECT sub.exam_id as examId, sub.score, sub.answers, sub.submitted_at as submittedAt,
                        e.title, e.grade, e.questions, e.expires_at, e.time_limit_minutes
                 FROM exam_submissions sub
                 JOIN exams e ON e.id = sub.exam_id
                 WHERE sub.student_id = ? AND sub.status = 'submitted'
                 ORDER BY sub.submitted_at DESC`
            ).bind(studentId).all();

            const nowMs = Date.now();
            const list = results.map(r => {
                let questionsArr = [];
                try { questionsArr = JSON.parse(r.questions); } catch (e) { /* ignore */ }
                const unlock = reviewUnlockMs(r);
                const base = {
                    examId: r.examId, title: r.title, grade: r.grade, score: r.score, total: questionsArr.length,
                    submittedAt: r.submittedAt, expiresAt: r.expires_at, reviewUnlocksAt: new Date(unlock).toISOString()
                };
                if (nowMs < unlock) return { ...base, locked: true, questions: [], answers: [] };
                let studentAnswers = [];
                try { studentAnswers = r.answers ? JSON.parse(r.answers) : []; } catch (e) { /* ignore */ }
                return { ...base, locked: false, questions: questionsArr, answers: studentAnswers };
            });
            return Response.json(list);
        }

        // === Staff: one student's full online record (taken / missed / still open) for parent reports ===
        if (action === 'student-report') {
            const auth = await requireStaff(request, env, 'exams.view');
            if (auth.error) return auth.error;
            const studentId = url.searchParams.get('studentId');
            const st = await db.prepare(
                "SELECT student_id as studentId, first_name as firstName, last_name as lastName, gender, branch, grade, parent_phone as parentPhone, created_at as createdAt FROM students WHERE student_id = ?"
            ).bind(studentId || '').first();
            if (!st) return Response.json({ error: 'الطالب غير موجود' }, { status: 404 });
            const { results: exams } = await db.prepare(
                "SELECT id, title, questions, expires_at, created_at FROM exams WHERE grade = ? ORDER BY expires_at ASC"
            ).bind(st.grade).all();
            const { results: subs } = await db.prepare(
                "SELECT exam_id, status, score FROM exam_submissions WHERE student_id = ?"
            ).bind(studentId).all();
            const subMap = Object.fromEntries(subs.map(r => [r.exam_id, r]));
            const rows = [];
            for (const e of exams) {
                let total = 0; try { total = JSON.parse(e.questions).length; } catch (x) { }
                const sub = subMap[e.id];
                const closedE = isClosed(e);
                if (sub && sub.status === 'submitted') rows.push({ examId: e.id, title: e.title, date: e.expires_at, status: 'taken', score: sub.score, total });
                else if (!closedE) continue; // still open — not counted yet
                else if (toMs(st.createdAt) > new Date(e.expires_at).getTime()) continue; // joined after it closed
                else rows.push({ examId: e.id, title: e.title, date: e.expires_at, status: 'missed', score: 0, total });
            }
            const earned = rows.reduce((a, r) => a + (r.score || 0), 0);
            const possible = rows.reduce((a, r) => a + r.total, 0);
            return Response.json({
                student: st, exams: rows,
                taken: rows.filter(r => r.status === 'taken').length, missed: rows.filter(r => r.status === 'missed').length,
                earned, possible, percent: possible > 0 ? (earned / possible) * 100 : null
            });
        }

        // === Parent reports list: per student, exams taken, missed and one honest percentage ===
        // percent = marks earned ÷ marks possible, where a missed (closed) exam counts as 0.
        if (action === 'grade-overview') {
            const auth = await requireStaff(request, env, 'exams.view');
            if (auth.error) return auth.error;

            const grade = (url.searchParams.get('grade') || '').toLowerCase();
            if (!grade) return Response.json({ error: 'المرحلة الدراسية مطلوبة' }, { status: 400 });

            const { results: students } = await db.prepare(
                "SELECT student_id as studentId, first_name as firstName, last_name as lastName, gender, branch, parent_phone as parentPhone, created_at as createdAt FROM students WHERE grade = ? ORDER BY first_name ASC"
            ).bind(grade).all();
            const { results: exams } = await db.prepare("SELECT id, questions, expires_at FROM exams WHERE grade = ?").bind(grade).all();
            const totals = {};
            exams.forEach(e => { let t = 0; try { t = JSON.parse(e.questions).length; } catch (x) { } totals[e.id] = t; });
            const { results: subRows } = await db.prepare(
                `SELECT sub.student_id as studentId, sub.exam_id as examId, sub.score
                 FROM exam_submissions sub JOIN exams e ON e.id = sub.exam_id
                 WHERE sub.status = 'submitted' AND e.grade = ?`
            ).bind(grade).all();
            const byStudent = {};
            subRows.forEach(r => { (byStudent[r.studentId] ||= {})[r.examId] = r.score; });
            const nowMs = Date.now();

            const list = students.map(s => {
                const mine = byStudent[s.studentId] || {};
                let earned = 0, possible = 0, taken = 0, missed = 0;
                for (const e of exams) {
                    const t = totals[e.id] || 0;
                    if (mine[e.id] !== undefined) { earned += mine[e.id]; possible += t; taken++; }
                    else if (new Date(e.expires_at).getTime() <= nowMs && toMs(s.createdAt) <= new Date(e.expires_at).getTime()) { possible += t; missed++; }
                }
                return {
                    studentId: s.studentId, firstName: s.firstName, lastName: s.lastName, gender: s.gender, branch: s.branch,
                    parentPhone: s.parentPhone, examsCount: taken, missedCount: missed, earned, possible,
                    avgPercent: possible > 0 ? Math.round((earned / possible) * 100) : null
                };
            });
            return Response.json(list);
        }

        return Response.json({ error: 'إجراء غير معروف' }, { status: 400 });
    } catch (err) {
        return Response.json({ error: err.message }, { status: 500 });
    }
}

export async function onRequestPost(context) {
    const { request, env } = context;
    const url = new URL(request.url);
    const action = url.searchParams.get('action');
    const db = getDb(env);

    try {
        if (db) await ensureAppSchema(db);
        const data = await request.json();

        // === الأدمن بتنشئ امتحان جديد ===
        if (action === 'create') {
            // ── حماية: أدمن بس ──
            const auth = await requireStaff(request, env, 'exams.create');
            if (auth.error) return auth.error;

            if (!data.title || !data.grade) {
                return Response.json({ error: 'عنوان الامتحان والمرحلة الدراسية مطلوبين' }, { status: 400 });
            }
            const qErr = validateQuestions(data.questions);
            if (qErr) return Response.json({ error: qErr }, { status: 400 });
            await ensureAppSchema(db);
            const shuffle = data.shuffle === false ? 0 : 1;

            const durationDays = parseInt(data.durationDays, 10) > 0 ? parseInt(data.durationDays, 10) : 3;
            // تايمر الامتحان اختياري: لو مبعتوش رقم صحيح موجب، يبقى مفيش وقت محدد (NULL)
            const timeLimitMinutes = parseInt(data.timeLimitMinutes, 10) > 0 ? parseInt(data.timeLimitMinutes, 10) : null;
            const examId = `EX-${Math.floor(100000 + Math.random() * 900000)}`;
            const now = new Date();
            const expiresAt = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000);

            await db.prepare(
                "INSERT INTO exams (id, title, grade, questions, duration_days, time_limit_minutes, expires_at, shuffle) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
            ).bind(
                examId, data.title, data.grade, JSON.stringify(cleanQuestions(data.questions)), durationDays, timeLimitMinutes, expiresAt.toISOString(), shuffle
            ).run();
            await audit(db, request, auth.staff, 'exams.create', examId, { title: data.title, grade: data.grade, questions: data.questions.length, durationDays, timeLimitMinutes, shuffle: !!shuffle });

            // بمجرد ما الامتحان يتحفظ بنجاح، ابعتي إشعار لطلاب نفس المرحلة بس
            await sendPushNotification(env, {
                title: '📝 امتحان جديد',
                message: `${data.title} — متاح الآن لطلاب ${(data.grade || '').toUpperCase()}`,
                grade: data.grade
            });

            return Response.json({ success: true, examId });
        }

        // === Edit an exam — only while NO student has opened it (so nobody's score can change) ===
        if (action === 'update') {
            const auth = await requireStaff(request, env, 'exams.edit');
            if (auth.error) return auth.error;
            await ensureAppSchema(db);
            const { examId } = data;
            const exam = await db.prepare("SELECT * FROM exams WHERE id = ?").bind(examId || '').first();
            if (!exam) return Response.json({ error: 'الامتحان غير موجود' }, { status: 404 });
            if (isClosed(exam)) return Response.json({ error: 'الامتحان ده انتهى — مينفعش يتعدل.', code: 'EXAM_CLOSED' }, { status: 409 });
            const used = await db.prepare("SELECT COUNT(*) as c FROM exam_submissions WHERE exam_id = ?").bind(examId).first();
            if (used && used.c > 0) {
                return Response.json({ error: `فيه ${used.c} طالب فتحوا الامتحان بالفعل — التعديل دلوقتي هيغيّر درجات. اعملي امتحان جديد بدل كده.`, code: 'HAS_ATTEMPTS' }, { status: 409 });
            }
            const title = String(data.title || '').trim();
            if (!title) return Response.json({ error: 'عنوان الامتحان مطلوب' }, { status: 400 });
            const qErr = validateQuestions(data.questions);
            if (qErr) return Response.json({ error: qErr }, { status: 400 });
            const timeLimitMinutes = parseInt(data.timeLimitMinutes, 10) > 0 ? parseInt(data.timeLimitMinutes, 10) : null;
            const shuffle = data.shuffle === false ? 0 : 1;
            const questions = cleanQuestions(data.questions);
            // Guard against a student opening it between the check above and this update
            const r = await db.prepare(
                `UPDATE exams SET title = ?, questions = ?, time_limit_minutes = ?, shuffle = ?
                 WHERE id = ? AND NOT EXISTS (SELECT 1 FROM exam_submissions WHERE exam_id = ?)`
            ).bind(title, JSON.stringify(questions), timeLimitMinutes, shuffle, examId, examId).run();
            if (!r.meta || r.meta.changes === 0) {
                return Response.json({ error: 'طالب فتح الامتحان في نفس اللحظة — مااتعدلش.', code: 'HAS_ATTEMPTS' }, { status: 409 });
            }
            let before = []; try { before = JSON.parse(exam.questions); } catch (e) { }
            await audit(db, request, auth.staff, 'exams.edit', examId, {
                before: { title: exam.title, timeLimitMinutes: exam.time_limit_minutes, questions: before },
                after: { title, timeLimitMinutes, questions: questions.length, shuffle: !!shuffle }
            });
            return Response.json({ success: true });
        }

        // === الأدمن بتمسح امتحان ===
        if (action === 'delete') {
            // ── حماية: أدمن بس ──
            const auth = await requireStaff(request, env, 'exams.delete');
            if (auth.error) return auth.error;

            const { examId } = data;
            if (!examId) {
                return Response.json({ error: 'كود الامتحان مطلوب' }, { status: 400 });
            }
            const exam = await db.prepare("SELECT * FROM exams WHERE id = ?").bind(examId).first();
            if (!exam) return Response.json({ error: 'الامتحان غير موجود' }, { status: 404 });
            const { results: subs } = await db.prepare(
                "SELECT student_id as s, status as st, score as sc, submitted_at as at FROM exam_submissions WHERE exam_id = ?"
            ).bind(examId).all();
            // batch = الحذف وسجل النشاط يتنفذوا مع بعض أو ميتنفذوش خالص.
            // نسخة من الامتحان ودرجات الطلاب بتتحفظ في السجل عشان لو اتمسح بالغلط.
            await db.batch([
                db.prepare("DELETE FROM exam_submissions WHERE exam_id = ?").bind(examId),
                db.prepare("DELETE FROM exams WHERE id = ?").bind(examId),
                auditStmt(db, request, auth.staff, 'exams.delete', examId, { exam, submissions: subs })
            ]);
            return Response.json({ success: true });
        }

        // === الأدمن بتفتح المحاولة تاني لطالب معين (لو اتقفل عليه بالغلط أو النت قطع معاه) ===
        if (action === 'reset-attempt') {
            // ── حماية: أدمن بس ──
            const auth = await requireStaff(request, env, 'exams.reset-attempt');
            if (auth.error) return auth.error;

            const { examId, studentId } = data;
            if (!examId || !studentId) {
                return Response.json({ error: 'بيانات ناقصة' }, { status: 400 });
            }
            const exam = await db.prepare("SELECT id, title, expires_at FROM exams WHERE id = ?").bind(examId).first();
            if (!exam) return Response.json({ error: 'الامتحان غير موجود' }, { status: 404 });
            // بعد ما الامتحان يقفل، الطالب مش هيقدر يدخله تاني — فإعادة الفتح كانت بتمسح درجته وخلاص.
            if (new Date(exam.expires_at).getTime() <= Date.now()) {
                return Response.json({ error: 'الامتحان ده انتهى — إعادة الفتح هتمسح درجة الطالب ومش هيقدر يدخل تاني.', code: 'EXAM_CLOSED' }, { status: 409 });
            }
            const previous = await db.prepare(
                "SELECT status, score, answers, started_at, submitted_at FROM exam_submissions WHERE exam_id = ? AND student_id = ?"
            ).bind(examId, studentId).first();
            if (!previous) return Response.json({ success: true, nothingToReset: true });
            const reason = typeof data.reason === 'string' ? data.reason.trim().slice(0, 300) : '';
            await db.batch([
                db.prepare("DELETE FROM exam_submissions WHERE exam_id = ? AND student_id = ?").bind(examId, studentId),
                auditStmt(db, request, auth.staff, 'exams.reset-attempt', studentId, { examId, examTitle: exam.title, reason: reason || null, previous })
            ]);
            return Response.json({ success: true });
        }

        // === الطالب بيفتح الامتحان لأول مرة (وده اللي بيقفل الدخول تاني) ===
        if (action === 'start') {
            const who = await requireStudent(request, env, db, data.studentId);
            if (who.error) return who.error;
            const studentId = who.id;
            const { examId } = data;
            if (!examId) {
                return Response.json({ error: 'بيانات ناقصة' }, { status: 400 });
            }

            await ensureAppSchema(db);
            const exam = await db.prepare(
                "SELECT id, title, grade, questions, expires_at, shuffle, time_limit_minutes FROM exams WHERE id = ?"
            ).bind(examId).first();

            if (!exam) {
                return Response.json({ error: 'الامتحان غير موجود' }, { status: 404 });
            }
            exam.timeLimitMinutes = exam.time_limit_minutes;

            // Only a real student of this exam's grade can open it
            const student = await db.prepare("SELECT grade FROM students WHERE student_id = ?").bind(studentId).first();
            if (!student || String(student.grade).toLowerCase() !== String(exam.grade).toLowerCase()) {
                return Response.json({ status: 'forbidden', error: 'الامتحان ده مش لمرحلتك.' }, { status: 403 });
            }

            const isExpired = new Date(exam.expires_at) < new Date();

            const existing = await db.prepare(
                "SELECT status, score, answers FROM exam_submissions WHERE exam_id = ? AND student_id = ?"
            ).bind(examId, studentId).first();

            let questionsObj = [];
            try { questionsObj = JSON.parse(exam.questions); } catch (e) { /* ignore */ }
            const total = questionsObj.length;

            if (existing && existing.status === 'submitted') {
                // Review opens only when nobody can still submit (deadline + grace window)
                if (Date.now() >= reviewUnlockMs(exam)) {
                    // State D (Expired + Already Taken)
                    let parsedAnswers = [];
                    try { parsedAnswers = existing.answers ? JSON.parse(existing.answers) : []; } catch (e) { }
                    return Response.json({ 
                        status: 'expired_taken', 
                        score: existing.score, 
                        total, 
                        answers: parsedAnswers, 
                        questions: questionsObj, 
                        title: exam.title 
                    });
                } else {
                    // State B (Active + Already Taken)
                    return Response.json({
                        status: 'active_taken',
                        score: existing.score,
                        total,
                        title: exam.title,
                        reviewUnlocksAt: new Date(reviewUnlockMs(exam)).toISOString(),
                        error: 'لقد قمت بأداء هذا الامتحان بالفعل. ستتمكن من مراجعة إجاباتك بعد انتهاء مدة الامتحان.'
                    }, { status: 403 });
                }
            } else if (existing && existing.status === 'started') {
                return Response.json({
                    status: 'locked',
                    error: 'أنتِ دخلتِ هذا الامتحان قبل كده ولم تقم بتسليمه، ومينفعش تدخلي مرة تانية'
                }, { status: 403 });
            }

            if (isExpired) {
                // State C (Expired + Not Taken)
                return Response.json({ status: 'expired_nottaken', error: 'انتهى وقت الامتحان ولم تقم بأدائه.' }, { status: 403 });
            }

            // State A (Active + Not Taken)
            const seed = exam.shuffle === 0 ? null : newSeed();
            try {
                await db.prepare(
                    "INSERT INTO exam_submissions (exam_id, student_id, status, shuffle_seed, leave_count, auto_submitted) VALUES (?, ?, 'started', ?, 0, '')"
                ).bind(examId, studentId, seed).run();
            } catch (insertErr) {
                return Response.json({ status: 'locked', error: 'لا يمكن بدء الامتحان الآن' }, { status: 403 });
            }

            // This student's own order of questions and choices (never the correct answers)
            let questionsForStudent;
            if (seed) {
                const plan = buildPlan(questionsObj, seed);
                questionsForStudent = plan.order.map(orig => ({
                    question: questionsObj[orig].question,
                    options: plan.options[orig].map(o => questionsObj[orig].options[o])
                }));
            } else {
                questionsForStudent = questionsObj.map(q => ({ question: q.question, options: q.options }));
            }

            return Response.json({
                status: 'started',
                examId: exam.id,
                title: exam.title,
                timeLimitMinutes: exam.timeLimitMinutes || null,
                questions: questionsForStudent
            });
        }

        // === The student left the exam page (sent the moment it happens, so it's kept even if they never return) ===
        if (action === 'leave') {
            const who = await requireStudent(request, env, db, data.studentId);
            if (who.error) return who.error;
            const examId = String(data.examId || '');
            if (!examId) return Response.json({ error: 'بيانات ناقصة' }, { status: 400 });
            await db.prepare(
                "UPDATE exam_submissions SET leave_count = MIN(COALESCE(leave_count, 0) + 1, 50) WHERE exam_id = ? AND student_id = ? AND status = 'started'"
            ).bind(examId, who.id).run();
            return Response.json({ ok: true });
        }

        // === الطالب بيسلم إجاباته، والسيرفر هو اللي بيحسب الدرجة ===
        if (action === 'submit') {
            const who = await requireStudent(request, env, db, data.studentId);
            if (who.error) return who.error;
            const studentId = who.id;
            const { examId, answers } = data;
            if (!examId || !Array.isArray(answers)) {
                return Response.json({ error: 'بيانات ناقصة' }, { status: 400 });
            }

            await ensureAppSchema(db);
            const submission = await db.prepare(
                "SELECT status, shuffle_seed FROM exam_submissions WHERE exam_id = ? AND student_id = ?"
            ).bind(examId, studentId).first();

            if (!submission) {
                return Response.json({ error: 'لازم تبدئي الامتحان الأول قبل ما تسلمي' }, { status: 403 });
            }
            if (submission.status === 'submitted') {
                return Response.json({ error: 'الامتحان ده اتسلم قبل كده، مينفعش تسلمي مرتين' }, { status: 403 });
            }

            const exam = await db.prepare(
                "SELECT questions, expires_at, time_limit_minutes as timeLimitMinutes FROM exams WHERE id = ?"
            ).bind(examId).first();
            if (!exam) {
                return Response.json({ error: 'الامتحان غير موجود' }, { status: 404 });
            }

            // بعد ما الامتحان يخلص، الإجابات الصح بتبقى ظاهرة لكل اللي حلّوا (صفحة المراجعة).
            // فمنقبلش تسليم متأخر جداً، وإلا طالب فاتح الامتحان من بدري يقدر يستنى ويشوف الإجابات
            // من حد تاني ويسلّمها. بنسيب مهلة = مدة التايمر (لو موجود) أو ساعة، عشان اللي
            // بدأ قبل النهاية بشوية يلحق يسلّم عادي.
            const deadlineMs = reviewUnlockMs(exam);
            if (Date.now() > deadlineMs) {
                return Response.json({ error: 'انتهى وقت تسليم هذا الامتحان. كلّم مس مروة لو حصلت مشكلة.' }, { status: 403 });
            }

            let questions = [];
            try {
                questions = JSON.parse(exam.questions);
            } catch (e) {
                return Response.json({ error: 'حصل خطأ في قراءة أسئلة الامتحان' }, { status: 500 });
            }

            // Answers arrive in the student's own order → map back to the original order before marking/storing
            const original = toOriginalAnswers(answers, questions, submission.shuffle_seed);
            const leaves = Math.max(0, Math.min(50, parseInt(data.leaves, 10) || 0));
            const autoReason = ['left-page', 'time-up'].includes(data.autoReason) ? data.autoReason : '';
            let correctCount = 0;
            questions.forEach((q, i) => {
                if (original[i] === q.correctIndex) correctCount++;
            });

            const upd = await db.prepare(
                `UPDATE exam_submissions SET status = 'submitted', score = ?, answers = ?, submitted_at = CURRENT_TIMESTAMP,
                    leave_count = MAX(COALESCE(leave_count, 0), ?), auto_submitted = ?
                 WHERE exam_id = ? AND student_id = ? AND status = 'started'`
            ).bind(correctCount, JSON.stringify(original), leaves, autoReason, examId, studentId).run();
            if (upd.meta && upd.meta.changes === 0) {
                return Response.json({ error: 'الامتحان ده اتسلم قبل كده، مينفعش تسلمي مرتين' }, { status: 403 });
            }

            return Response.json({ success: true, score: correctCount, total: questions.length, reviewUnlocksAt: new Date(reviewUnlockMs(exam)).toISOString() });
        }

        return Response.json({ error: 'إجراء غير معروف' }, { status: 400 });
    } catch (err) {
        return Response.json({ error: err.message }, { status: 500 });
    }
}
