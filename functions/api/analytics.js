import { verifyAdminRequest } from './admin-auth.js';

// ============================================================
// Analytics API — Phase 5
// ============================================================
// GET /api/analytics?action=grade-overview&grade=prep1
//     Returns top/worst students by offline average + combined online/offline data
//
// GET /api/analytics?action=student-detail&studentId=XX-XXXX
//     Returns complete data for one student: online scores, offline scores,
//     chronological exam histories, and the raw numbers needed to compute
//     the cheating-detection gap on the frontend.
// ============================================================

function getDb(env) {
    return env.DB || env.D1_DB;
}

export async function onRequestGet(context) {
    const { request, env } = context;

    // ── حماية: أدمن بس ──
    const isAdmin = await verifyAdminRequest(request, env);
    if (!isAdmin) {
        return Response.json({ error: 'غير مصرح — يرجى تسجيل الدخول كمسؤول' }, { status: 401 });
    }

    const url = new URL(request.url);
    const action = url.searchParams.get('action');
    const db = getDb(env);

    try {

        // ═══════════════════════════════════════════════════════════════
        // ACTION: grade-overview
        // For a given grade, returns every student with:
        //   - offlineAvgPercent  (average of per-exam percentages, offline only)
        //   - onlineAvgPercent   (average of per-exam percentages, online only)
        //   - offlineExamCount / onlineExamCount
        // The frontend uses this to build the Top/Worst bar charts and the
        // combined grouped bar chart.
        // ═══════════════════════════════════════════════════════════════
        if (action === 'grade-overview') {
            const grade = (url.searchParams.get('grade') || '').toLowerCase();
            if (!grade) {
                return Response.json({ error: 'المرحلة الدراسية مطلوبة' }, { status: 400 });
            }

            // 1. All students in this grade
            const { results: students } = await db.prepare(
                `SELECT student_id as studentId, first_name as firstName, last_name as lastName,
                        parent_phone as parentPhone
                 FROM students WHERE grade = ? ORDER BY first_name ASC`
            ).bind(grade).all();

            // 2. Offline exams + grades for this grade
            const { results: offlineExams } = await db.prepare(
                `SELECT id, exam_name as examName, total_marks as totalMarks, created_at as createdAt
                 FROM offline_exams WHERE grade = ? ORDER BY created_at ASC`
            ).bind(grade).all();

            let offlineGrades = [];
            if (offlineExams.length > 0) {
                const examIds = offlineExams.map(e => e.id);
                const placeholders = examIds.map(() => '?').join(',');
                const { results } = await db.prepare(
                    `SELECT exam_id as examId, student_id as studentId, score
                     FROM offline_grades WHERE exam_id IN (${placeholders})`
                ).bind(...examIds).all();
                offlineGrades = results;
            }

            // 3. Online exams + submissions for this grade
            //    Online exam "total" = JSON.parse(questions).length
            const { results: onlineSubs } = await db.prepare(
                `SELECT sub.student_id as studentId, sub.score, e.questions
                 FROM exam_submissions sub
                 JOIN exams e ON e.id = sub.exam_id
                 WHERE sub.status = 'submitted' AND e.grade = ?`
            ).bind(grade).all();

            // ── Build per-exam totalMarks lookup (offline) ──
            const offlineExamMap = {};
            offlineExams.forEach(e => { offlineExamMap[e.id] = e.totalMarks || 100; });

            // ── Compute per-student averages ──
            const list = students.map(s => {
                // Offline average: average of (score / totalMarks * 100) per exam
                const sOffline = offlineGrades.filter(g => g.studentId === s.studentId && g.score !== null);
                let offlineTotalPct = 0;
                let offlineRawScore = 0;
                let offlineRawTotal = 0;
                sOffline.forEach(g => {
                    const total = offlineExamMap[g.examId] || 100;
                    offlineTotalPct += (g.score / total) * 100;
                    offlineRawScore += g.score;
                    offlineRawTotal += total;
                });
                const offlineAvg = sOffline.length > 0 ? Math.round(offlineTotalPct / sOffline.length) : null;

                // Online average: average of (score / questionCount * 100) per exam
                const sOnline = onlineSubs.filter(r => r.studentId === s.studentId);
                let onlineTotalPct = 0;
                let onlineRawScore = 0;
                let onlineRawTotal = 0;
                sOnline.forEach(r => {
                    let total = 0;
                    try { total = JSON.parse(r.questions).length; } catch (e) { /* ignore */ }
                    if (total > 0) {
                        onlineTotalPct += (r.score / total) * 100;
                        onlineRawScore += r.score;
                        onlineRawTotal += total;
                    }
                });
                const onlineAvg = sOnline.length > 0 ? Math.round(onlineTotalPct / sOnline.length) : null;

                return {
                    studentId: s.studentId,
                    firstName: s.firstName,
                    lastName: s.lastName,
                    parentPhone: s.parentPhone,
                    offlineAvgPercent: offlineAvg,
                    onlineAvgPercent: onlineAvg,
                    offlineRawScore,
                    offlineRawTotal,
                    onlineRawScore,
                    onlineRawTotal,
                    offlineExamCount: sOffline.length,
                    onlineExamCount: sOnline.length
                };
            });

            return Response.json({
                students: list,
                totalOfflineExams: offlineExams.length,
                totalOnlineExams: new Set(onlineSubs.map(r => {
                    // Deduplicate by exam — we don't have exam_id in onlineSubs,
                    // but since questions JSON is per-exam, count unique JSON strings
                    return r.questions;
                })).size
            });
        }

        // ═══════════════════════════════════════════════════════════════
        // ACTION: student-detail
        // Returns chronological exam-by-exam scores for one student,
        // separated into online and offline, plus student info.
        // ═══════════════════════════════════════════════════════════════
        if (action === 'student-detail') {
            const studentId = url.searchParams.get('studentId');
            if (!studentId) {
                return Response.json({ error: 'كود الطالب مطلوب' }, { status: 400 });
            }

            // Student info
            const student = await db.prepare(
                `SELECT student_id as studentId, first_name as firstName, last_name as lastName,
                        grade, phone, parent_phone as parentPhone
                 FROM students WHERE student_id = ?`
            ).bind(studentId).first();

            if (!student) {
                return Response.json({ error: 'الطالب غير موجود' }, { status: 404 });
            }

            // ── Offline exam history (chronological) ──
            const { results: offlineExams } = await db.prepare(
                `SELECT id, exam_name as examName, total_marks as totalMarks, created_at as createdAt
                 FROM offline_exams WHERE grade = ? ORDER BY created_at ASC`
            ).bind(student.grade).all();

            let offlineHistory = [];
            if (offlineExams.length > 0) {
                const examIds = offlineExams.map(e => e.id);
                const placeholders = examIds.map(() => '?').join(',');
                const { results: grades } = await db.prepare(
                    `SELECT exam_id as examId, score
                     FROM offline_grades WHERE student_id = ? AND exam_id IN (${placeholders})`
                ).bind(studentId, ...examIds).all();

                const gradeMap = {};
                grades.forEach(g => { gradeMap[g.examId] = g.score; });

                offlineHistory = offlineExams.map(e => ({
                    examName: e.examName,
                    totalMarks: e.totalMarks || 100,
                    score: gradeMap[e.id] !== undefined ? gradeMap[e.id] : null,
                    percent: gradeMap[e.id] !== undefined && gradeMap[e.id] !== null
                        ? Math.round((gradeMap[e.id] / (e.totalMarks || 100)) * 100)
                        : null,
                    createdAt: e.createdAt
                })).filter(e => e.score !== null);
            }

            // ── Online exam history (chronological) ──
            const { results: onlineRaw } = await db.prepare(
                `SELECT sub.score, sub.submitted_at as submittedAt,
                        e.title as examName, e.questions, e.created_at as createdAt
                 FROM exam_submissions sub
                 JOIN exams e ON e.id = sub.exam_id
                 WHERE sub.student_id = ? AND sub.status = 'submitted' AND e.grade = ?
                 ORDER BY e.created_at ASC`
            ).bind(studentId, student.grade).all();

            const onlineHistory = onlineRaw.map(r => {
                let total = 0;
                try { total = JSON.parse(r.questions).length; } catch (e) { /* ignore */ }
                return {
                    examName: r.examName,
                    totalQuestions: total,
                    score: r.score,
                    percent: total > 0 ? Math.round((r.score / total) * 100) : 0,
                    createdAt: r.createdAt
                };
            });

            return Response.json({
                student,
                offlineHistory,
                onlineHistory
            });
        }

        return Response.json({ error: 'Invalid action' }, { status: 400 });

    } catch (err) {
        return Response.json({ error: err.message }, { status: 500 });
    }
}
