import { requireStaff, ensureAppSchema } from './admin-auth.js';

// ============================================================
// Analytics API (staff only)
// ============================================================
// GET /api/analytics?action=leaderboard&grade=prep1&branch=center|private|all&board=center|online|combined
// GET /api/analytics?action=student&studentId=MM-123456
//
// One rule for every percentage: marks earned ÷ marks possible (never an average of percentages).
//   Center column  : a mark counts; "Absent" counts as 0; a cell not entered yet is skipped.
//                    A column with no marks at all yet is ignored (not graded yet).
//   Online exam    : a submission counts; a CLOSED exam the student never submitted counts as 0
//                    (only if they had an account before it closed); an open exam is skipped.
//   Combined       : the average of the center % and the online % (so a 100-mark paper exam
//                    doesn't drown a 10-question online quiz).
// Ranking: only students who took at least 60% of their exams are ranked; the rest are listed
// as "not ranked yet". Values are kept exact; rounding happens only on screen.
// Rank movement: the ranking now vs. the ranking without the newest exam.
// ============================================================

const GRADES = ['prep1', 'prep2', 'prep3', 'sec1'];
const MIN_PARTICIPATION = 0.6;
const GAP_THRESHOLD = 30;   // online % − center % worth a look
const GAP_MIN_EXAMS = 3;    // …only with 3+ exams of each kind

function getDb(env) { return [env.DB, env.D1_DB].find(d => d && typeof d.prepare === "function"); }
function toMs(v) {
    if (!v) return 0;
    const str = String(v);
    if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return new Date(str + 'T23:59:59Z').getTime(); // a paper exam date = that whole day
    return new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(str) || !/\d:\d/.test(str) ? str : str.replace(' ', 'T') + 'Z').getTime();
}
function levelOf(pct) {
    if (pct === null || pct === undefined) return null;
    return pct >= 85 ? 'excellent' : pct >= 70 ? 'good' : pct >= 50 ? 'average' : 'weak';
}

// Load everything about one grade once
export async function loadGrade(db, grade) {
    const { results: students } = await db.prepare(
        `SELECT student_id as studentId, first_name as firstName, last_name as lastName, gender, branch,
                parent_phone as parentPhone, created_at as createdAt
         FROM students WHERE grade = ? ORDER BY first_name ASC`
    ).bind(grade).all();

    const { results: cExams } = await db.prepare(
        `SELECT id, exam_name as name, total_marks as total, branch, exam_date as examDate, created_at as createdAt
         FROM offline_exams WHERE grade = ?`
    ).bind(grade).all();
    const { results: cMarks } = cExams.length ? await db.prepare(
        `SELECT g.exam_id as examId, g.student_id as studentId, g.score, g.absent
         FROM offline_grades g JOIN offline_exams e ON e.id = g.exam_id WHERE e.grade = ?`
    ).bind(grade).all() : { results: [] };

    const { results: oExams } = await db.prepare(
        "SELECT id, title as name, questions, expires_at as expiresAt, created_at as createdAt FROM exams WHERE grade = ?"
    ).bind(grade).all();
    const { results: oSubs } = oExams.length ? await db.prepare(
        `SELECT s.exam_id as examId, s.student_id as studentId, s.score
         FROM exam_submissions s JOIN exams e ON e.id = s.exam_id WHERE e.grade = ? AND s.status = 'submitted'`
    ).bind(grade).all() : { results: [] };

    const now = Date.now();
    const exams = [];
    const marks = {}; // examKey → studentId → { score, absent }
    for (const e of cExams) {
        const key = 'c' + e.id;
        marks[key] = {};
        exams.push({ key, kind: 'center', id: e.id, name: e.name, total: e.total || 100, branch: e.branch || null, at: toMs(e.examDate || e.createdAt), date: e.examDate || String(e.createdAt || '').slice(0, 10) });
    }
    for (const m of cMarks) {
        const key = 'c' + m.examId;
        const score = m.score === null || m.score === '' || !Number.isFinite(Number(m.score)) ? null : Number(m.score);
        if (marks[key] && (score !== null || m.absent)) marks[key][m.studentId] = { score: m.absent ? null : score, absent: !!m.absent };
    }
    for (const e of oExams) {
        let total = 0; try { total = JSON.parse(e.questions).length; } catch (x) { }
        const key = 'o' + e.id;
        marks[key] = {};
        exams.push({ key, kind: 'online', id: e.id, name: e.name, total, at: toMs(e.expiresAt), date: String(e.expiresAt || '').slice(0, 10), closed: toMs(e.expiresAt) <= now });
    }
    for (const s of oSubs) { if (marks['o' + s.examId]) marks['o' + s.examId][s.studentId] = { score: s.score, absent: false }; }
    // A center column with no marks yet hasn't been graded — leave it out entirely
    const graded = exams.filter(e => e.kind === 'online' || Object.keys(marks[e.key]).length > 0);
    graded.sort((a, b) => a.at - b.at || String(a.key).localeCompare(String(b.key)));
    const order = Object.fromEntries(graded.map((e, i) => [e.key, i]));
    return { students, exams: graded, marks, order };
}

// One student's standing on one kind of exam, optionally ignoring some exams (for "before" ranks)
function standing(student, exams, marks, kind, skipKeys) {
    let earned = 0, possible = 0, taken = 0, missed = 0, applicable = 0;
    const history = [];
    const joined = toMs(student.createdAt);
    for (const e of exams) {
        if (e.kind !== kind || (skipKeys && skipKeys.has(e.key)) || !e.total) continue;
        if (e.kind === 'center' && e.branch && e.branch !== student.branch) continue; // the other branch's exam
        const m = marks[e.key][student.studentId];
        if (!m && joined && joined > e.at) continue; // joined after this exam (a mark, if any, still counts)
        const row = (status, score) => ({ key: e.key, name: e.name, date: e.date, kind, status, score, total: e.total, pct: score === null ? null : (score / e.total) * 100 });
        if (e.kind === 'online') {
            if (m) { applicable++; taken++; earned += m.score; possible += e.total; history.push(row('taken', m.score)); }
            else if (e.closed) { applicable++; missed++; possible += e.total; history.push(row('missed', 0)); }
        } else {
            applicable++;
            if (m && m.absent) { missed++; possible += e.total; history.push(row('absent', 0)); }
            else if (m) { taken++; earned += m.score; possible += e.total; history.push(row('taken', m.score)); }
            else history.push(row('not-entered', null));
        }
    }
    return { earned, possible, taken, missed, applicable, pct: possible > 0 ? (earned / possible) * 100 : null, history };
}

export function boardValue(student, data, board, skipKeys) {
    const c = standing(student, data.exams, data.marks, 'center', skipKeys);
    const o = standing(student, data.exams, data.marks, 'online', skipKeys);
    let pct, taken, applicable;
    if (board === 'center') { pct = c.pct; taken = c.taken; applicable = c.applicable; }
    else if (board === 'online') { pct = o.pct; taken = o.taken; applicable = o.applicable; }
    else {
        const parts = [c.pct, o.pct].filter(v => v !== null);
        pct = parts.length ? parts.reduce((a, b) => a + b, 0) / parts.length : null;
        taken = c.taken + o.taken; applicable = c.applicable + o.applicable;
    }
    const participation = applicable > 0 ? taken / applicable : 0;
    const history = [...c.history, ...o.history]
        .filter(h => board === 'combined' || h.kind === board)
        .sort((a, b) => data.order[a.key] - data.order[b.key]);
    return { pct, taken, applicable, participation, ranked: pct !== null && taken > 0 && participation >= MIN_PARTICIPATION, center: c, online: o, history };
}

// Standard competition ranking (1, 2, 2, 4) on exact values
function rankMap(rows) {
    const sorted = rows.filter(r => r.ranked).sort((a, b) => b.pct - a.pct);
    const map = {};
    let prev = null, rank = 0;
    sorted.forEach((r, i) => {
        if (prev === null || Math.abs(r.pct - prev) > 1e-9) rank = i + 1;
        map[r.studentId] = rank; prev = r.pct;
    });
    return map;
}
const r1 = (v) => (v === null || v === undefined ? null : Math.round(v * 10) / 10);

export async function onRequestGet(context) {
    const { request, env } = context;
    const auth = await requireStaff(request, env, 'analytics.view');
    if (auth.error) return auth.error;

    const url = new URL(request.url);
    const action = url.searchParams.get('action');
    const db = getDb(env);

    try {
        await ensureAppSchema(db);

        if (action === 'leaderboard') {
            const grade = (url.searchParams.get('grade') || '').toLowerCase();
            const branch = (url.searchParams.get('branch') || 'center').toLowerCase();
            const board = ['center', 'online', 'combined'].includes(url.searchParams.get('board')) ? url.searchParams.get('board') : 'center';
            if (!GRADES.includes(grade)) return Response.json({ error: 'المرحلة الدراسية مطلوبة' }, { status: 400 });

            const data = await loadGrade(db, grade);
            const inGroup = (s) => branch === 'all' || s.branch === branch;
            const group = data.students.filter(inGroup);

            // The exams on this board for this group, oldest → newest
            const boardExams = data.exams.filter(e => {
                if (board !== 'combined' && e.kind !== board) return false;
                if (e.kind === 'center' && branch !== 'all' && e.branch && e.branch !== branch) return false;
                const anyMark = group.some(s => data.marks[e.key][s.studentId]);
                return anyMark || (e.kind === 'online' && e.closed);
            });
            const latest = boardExams[boardExams.length - 1] || null;
            const skip = latest ? new Set([latest.key]) : null;

            const values = {};
            const rows = group.map(s => {
                const now = boardValue(s, data, board, null);
                const before = latest ? boardValue(s, data, board, skip) : null;
                values[s.studentId] = { now, before };
                return {
                    studentId: s.studentId, firstName: s.firstName, lastName: s.lastName, gender: s.gender, branch: s.branch, parentPhone: s.parentPhone,
                    pct: r1(now.pct), _pct: now.pct, ranked: now.ranked, taken: now.taken, applicable: now.applicable,
                    centerPct: r1(now.center.pct), onlinePct: r1(now.online.pct),
                    centerTaken: now.center.taken, onlineTaken: now.online.taken,
                    missed: now.history.filter(h => h.status === 'missed' || h.status === 'absent').length,
                    level: levelOf(now.pct),
                    trend: now.history.filter(h => h.pct !== null).slice(-6).map(h => r1(h.pct))
                };
            });
            const nowRanks = rankMap(rows.map(r => ({ studentId: r.studentId, pct: r._pct, ranked: r.ranked })));
            const beforeRanks = rankMap(rows.map(r => {
                const b = values[r.studentId].before;
                return { studentId: r.studentId, pct: b ? b.pct : null, ranked: !!(b && b.ranked) };
            }));
            rows.forEach(r => {
                r.rank = nowRanks[r.studentId] || null;
                r.prevRank = beforeRanks[r.studentId] || null;
                r.move = r.rank && r.prevRank ? r.prevRank - r.rank : null;
            });

            // Celebrations: new #1 (and who they overtook), new top 3, big jumps
            const movers = [];
            const nm = (r) => `${r.firstName} ${r.lastName}`.trim();
            if (latest) {
                for (const r of rows.filter(x => x.rank === 1)) {
                    if (r.prevRank === 1) continue;
                    const old1 = rows.find(x => x.prevRank === 1 && x.rank !== 1);
                    movers.push({ type: 'new-first', studentId: r.studentId, name: nm(r), from: r.prevRank, to: 1, overtook: old1 ? nm(old1) : null });
                }
                rows.filter(r => r.rank && r.rank > 1 && r.rank <= 3 && (!r.prevRank || r.prevRank > 3))
                    .forEach(r => movers.push({ type: 'top-3', studentId: r.studentId, name: nm(r), from: r.prevRank, to: r.rank }));
                rows.filter(r => r.move >= 3 && !movers.some(m => m.studentId === r.studentId))
                    .sort((a, b) => b.move - a.move).slice(0, 6)
                    .forEach(r => movers.push({ type: 'jump', studentId: r.studentId, name: nm(r), from: r.prevRank, to: r.rank, places: r.move }));
            }

            // Needs attention
            const attention = [];
            for (const r of rows) {
                const v = values[r.studentId].now;
                const reasons = [];
                const taken = v.history.filter(h => h.status === 'taken');
                if (taken.length >= 3) {
                    const [a, b, c] = taken.slice(-3).map(h => h.pct);
                    if (b < a - 2 && c < b - 2) reasons.push({ code: 'falling', text: `Marks fell in the last 2 exams (${Math.round(a)}% → ${Math.round(b)}% → ${Math.round(c)}%)` });
                }
                const last5 = v.history.filter(h => h.status !== 'not-entered').slice(-5);
                const recentMissed = last5.filter(h => h.status === 'missed' || h.status === 'absent').length;
                if (recentMissed >= 2) reasons.push({ code: 'missing', text: `Missed ${recentMissed} of the last ${last5.length} exams` });
                if (v.center.taken >= GAP_MIN_EXAMS && v.online.taken >= GAP_MIN_EXAMS && v.online.pct - v.center.pct > GAP_THRESHOLD) {
                    reasons.push({ code: 'gap', text: `Online ${Math.round(v.online.pct)}% vs center ${Math.round(v.center.pct)}%`, onlinePct: r1(v.online.pct), centerPct: r1(v.center.pct) });
                }
                if (r.ranked && v.pct < 50) reasons.push({ code: 'weak', text: `Average under 50% (${Math.round(v.pct)}%)` });
                if (reasons.length) attention.push({ studentId: r.studentId, name: nm(r), parentPhone: r.parentPhone, gender: r.gender, reasons });
            }

            // Grade picture: level bands + the group average after each exam
            const bands = { excellent: 0, good: 0, average: 0, weak: 0 };
            rows.filter(r => r.ranked).forEach(r => { bands[r.level]++; });
            const series = boardExams.map(e => {
                let earned = 0, possible = 0, count = 0;
                for (const s of group) {
                    const m = data.marks[e.key][s.studentId];
                    if (m && !m.absent && m.score !== null) { earned += m.score; possible += e.total; count++; }
                }
                return { name: e.name, kind: e.kind, date: e.date, avg: possible > 0 ? r1((earned / possible) * 100) : null, count };
            });

            rows.forEach(r => { delete r._pct; });
            const ranked = rows.filter(r => r.ranked).sort((a, b) => a.rank - b.rank || String(a.firstName).localeCompare(String(b.firstName)));
            const unranked = rows.filter(r => !r.ranked);
            const avgOf = (key, takenKey) => {
                let e = 0, p = 0;
                for (const s of group) {
                    const v = values[s.studentId].now[key];
                    if (v[takenKey] !== undefined && v.possible > 0) { e += v.earned; p += v.possible; }
                }
                return p > 0 ? r1((e / p) * 100) : null;
            };
            return Response.json({
                grade, branch, board,
                latestExam: latest ? { name: latest.name, kind: latest.kind, date: latest.date } : null,
                summary: {
                    students: group.length, ranked: ranked.length, exams: boardExams.length,
                    centerAvg: avgOf('center', 'taken'), onlineAvg: avgOf('online', 'taken')
                },
                leaderboard: ranked, unranked, movers, attention, bands, series,
                rules: { minParticipation: MIN_PARTICIPATION, gapThreshold: GAP_THRESHOLD, gapMinExams: GAP_MIN_EXAMS }
            });
        }

        // Miss Marwa's three quick lists for one grade + group:
        //   top10Center   — best center-exam averages (ranked students only)
        //   top10Combined — best center + online averages (ranked students only)
        //   weakest20     — lowest combined averages, ALL students with at least one exam counted
        //                   (low attendance is a reason to follow up, so they are not filtered out)
        if (action === 'quicklists') {
            const grade = (url.searchParams.get('grade') || '').toLowerCase();
            const branch = (url.searchParams.get('branch') || 'center').toLowerCase();
            if (!GRADES.includes(grade)) return Response.json({ error: 'المرحلة الدراسية مطلوبة' }, { status: 400 });
            const data = await loadGrade(db, grade);
            const group = data.students.filter(s => branch === 'all' || s.branch === branch);
            const examCount = (kind) => data.exams.filter(e => {
                if (kind && e.kind !== kind) return false;
                if (e.kind === 'center' && branch !== 'all' && e.branch && e.branch !== branch) return false;
                return group.some(s => data.marks[e.key][s.studentId]) || (e.kind === 'online' && e.closed);
            }).length;
            const pack = (s, v) => ({
                studentId: s.studentId, firstName: s.firstName, lastName: s.lastName, gender: s.gender, branch: s.branch, parentPhone: s.parentPhone,
                pct: r1(v.pct), taken: v.taken, applicable: v.applicable, ranked: v.ranked,
                centerPct: r1(v.center.pct), onlinePct: r1(v.online.pct),
                missed: v.history.filter(h => h.status === 'missed' || h.status === 'absent').length
            });
            const top = (board) => {
                const rows = group.map(s => ({ s, v: boardValue(s, data, board, null) }));
                const ranks = rankMap(rows.map(r => ({ studentId: r.s.studentId, pct: r.v.pct, ranked: r.v.ranked })));
                // Top 10 by rank — a tie for 10th place keeps everyone on that mark (nobody is cut by alphabet)
                return rows.filter(r => r.v.ranked && ranks[r.s.studentId] <= 10)
                    .sort((a, b) => ranks[a.s.studentId] - ranks[b.s.studentId] || String(a.s.firstName).localeCompare(String(b.s.firstName)))
                    .map(r => ({ ...pack(r.s, r.v), rank: ranks[r.s.studentId] }));
            };
            const weakest = group.map(s => ({ s, v: boardValue(s, data, 'combined', null) }))
                .filter(r => r.v.pct !== null && r.v.applicable > 0)
                .sort((a, b) => a.v.pct - b.v.pct || b.v.applicable - b.v.taken - (a.v.applicable - a.v.taken))
                .slice(0, 20).map(r => pack(r.s, r.v));
            return Response.json({
                grade, branch,
                counts: { students: group.length, centerExams: examCount('center'), onlineExams: examCount('online') },
                top10Center: top('center'), top10Combined: top('combined'), weakest20: weakest,
                rules: { minParticipation: MIN_PARTICIPATION }
            });
        }

        // Student profile: every center + online exam with score, % and date, plus exam-integrity flags
        if (action === 'profile') {
            const studentId = url.searchParams.get('studentId') || '';
            const st = await db.prepare(
                `SELECT student_id as studentId, first_name as firstName, last_name as lastName, gender, branch, grade,
                        phone, parent_phone as parentPhone, created_at as createdAt FROM students WHERE student_id = ?`
            ).bind(studentId).first();
            if (!st) return Response.json({ error: 'الطالب غير موجود' }, { status: 404 });
            const grade = String(st.grade || '').toLowerCase();
            const data = await loadGrade(db, grade);
            const s = data.students.find(x => x.studentId === studentId) || { ...st };
            const v = boardValue(s, data, 'combined', null);
            const rows = data.students.map(x => ({ studentId: x.studentId, c: boardValue(x, data, 'center', null), b: boardValue(x, data, 'combined', null) }));
            const centerRanks = rankMap(rows.map(r => ({ studentId: r.studentId, pct: r.c.pct, ranked: r.c.ranked })));
            const combinedRanks = rankMap(rows.map(r => ({ studentId: r.studentId, pct: r.b.pct, ranked: r.b.ranked })));
            const sameGroup = data.students.filter(x => x.branch === s.branch).map(x => x.studentId);

            // Center: every graded column that applies to this student (the other group's columns are skipped)
            const center = v.center.history.map(h => ({ name: h.name, date: h.date, status: h.status, score: h.score, total: h.total, pct: r1(h.pct) }));

            // Online: straight from the submissions, with how the attempt went
            const { results: oRows } = await db.prepare(
                `SELECT e.id, e.title, e.questions, e.created_at as createdAt, e.expires_at as expiresAt, e.time_limit_minutes as timeLimit,
                        sub.status, sub.score, sub.started_at as startedAt, sub.submitted_at as submittedAt,
                        sub.leave_count as leaves, sub.auto_submitted as auto
                 FROM exams e LEFT JOIN exam_submissions sub ON sub.exam_id = e.id AND sub.student_id = ?
                 WHERE LOWER(TRIM(e.grade)) = ? ORDER BY e.expires_at DESC`
            ).bind(studentId, grade).all();
            const joined = toMs(st.createdAt), now = Date.now();
            const online = [];
            for (const e of oRows || []) {
                let total = 0; try { total = JSON.parse(e.questions).length; } catch (x) { }
                const closed = toMs(e.expiresAt) <= now;
                if (!e.status && joined && joined > toMs(e.expiresAt)) continue; // closed before they signed up
                const status = e.status === 'submitted' ? 'taken' : e.status === 'started' ? (closed ? 'opened' : 'in-progress') : (closed ? 'missed' : 'not-yet');
                const score = status === 'taken' ? Number(e.score) : null;
                const pct = status === 'taken' && total ? (score / total) * 100 : null;
                const mins = e.startedAt && e.submittedAt ? Math.max(0, (toMs(e.submittedAt) - toMs(e.startedAt)) / 60000) : null;
                const recorded = e.status ? e.leaves !== null && e.leaves !== undefined : null;
                const flags = [];
                if (recorded && e.leaves > 0) flags.push({ level: e.leaves >= 2 ? 'danger' : 'warn', code: 'left', text: `Left the exam page ${e.leaves} time${e.leaves > 1 ? 's' : ''}` });
                if (e.auto === 'left-page') flags.push({ level: 'danger', code: 'auto-left', text: 'Submitted automatically after leaving the page twice' });
                if (e.auto === 'time-up') flags.push({ level: 'info', code: 'time-up', text: 'Time ran out — submitted automatically' });
                if (status === 'opened') flags.push({ level: 'warn', code: 'opened', text: 'Opened the exam but never submitted' });
                if (status === 'taken' && mins !== null && total && pct >= 80 && mins * 60 < Math.max(60, total * 10)) flags.push({ level: 'warn', code: 'fast', text: `Very fast for a high score — ${mins < 1 ? 'under a minute' : Math.round(mins) + ' min'} for ${total} questions` });
                online.push({ id: e.id, name: e.title, date: String(e.expiresAt || '').slice(0, 10), expiresAt: e.expiresAt, status, score, total, pct: r1(pct), startedAt: e.startedAt, submittedAt: e.submittedAt, minutes: mins === null ? null : r1(mins), timeLimit: e.timeLimit || null, leaves: recorded ? e.leaves : null, recorded, flags });
            }

            // Online clearly above center → worth a look (same rule as the analytics page)
            const gap = v.online.pct !== null && v.center.pct !== null && v.online.taken >= GAP_MIN_EXAMS && v.center.taken >= GAP_MIN_EXAMS
                && v.online.pct - v.center.pct > GAP_THRESHOLD ? r1(v.online.pct - v.center.pct) : null;
            const flagged = online.filter(o => o.flags.some(f => f.level !== 'info')).length;
            return Response.json({
                student: { ...st, grade },
                summary: {
                    centerPct: r1(v.center.pct), centerTaken: v.center.taken, centerAbsent: v.center.missed,
                    onlinePct: r1(v.online.pct), onlineTaken: v.online.taken, onlineMissed: v.online.missed,
                    combinedPct: r1(v.pct), level: levelOf(v.pct), ranked: v.ranked, participation: r1(v.participation * 100),
                    centerRank: centerRanks[studentId] || null, combinedRank: combinedRanks[studentId] || null,
                    gradeSize: data.students.length, groupSize: sameGroup.length
                },
                center, online,
                integrity: { gap, flaggedExams: flagged, notRecorded: online.filter(o => o.recorded === false).length }
            });
        }

        // One student's full picture (both kinds, absences and missed exams included)
        if (action === 'student') {
            const studentId = url.searchParams.get('studentId') || '';
            const st = await db.prepare("SELECT grade, phone FROM students WHERE student_id = ?").bind(studentId).first();
            if (!st) return Response.json({ error: 'الطالب غير موجود' }, { status: 404 });
            const data = await loadGrade(db, st.grade);
            const s = data.students.find(x => x.studentId === studentId);
            const v = boardValue(s, data, 'combined', null);
            const round = (h) => ({ ...h, pct: r1(h.pct) });
            const pack = (x) => ({ pct: r1(x.pct), taken: x.taken, missed: x.missed, earned: x.earned, possible: x.possible, history: x.history.map(round) });
            return Response.json({
                student: { ...s, grade: st.grade, phone: st.phone },
                center: pack(v.center), online: pack(v.online),
                combinedPct: r1(v.pct), level: levelOf(v.pct)
            });
        }

        return Response.json({ error: 'Invalid action' }, { status: 400 });
    } catch (err) {
        return Response.json({ error: 'حصل خطأ في السيرفر' }, { status: 500 });
    }
}
