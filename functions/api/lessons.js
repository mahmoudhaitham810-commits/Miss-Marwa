import { requireStaff, audit, auditStmt, requireStudent, verifyStudentRequest, verifyAdminRequest, ensureAppSchema } from './admin-auth.js';
import { pushToGrade } from './push.js';

// الداتا بيز ممكن تكون متسجلة في Cloudflare باسم DB أو D1_DB
// الدالة دي بتتأكد إننا بنمسك الاسم الصح مهما كان
function getDb(env) {
    return [env.DB, env.D1_DB].find(d => d && typeof d.prepare === "function");
}

// بتبعت إشعار Push للطلاب المشتركين. لو معانا "grade"، بتستهدف بس الطلاب
// المتعلّمين بتاج المرحلة دي (مش كل الطلاب)؛ لو مفيش، بتبعت للكل كحل احتياطي.
// لو الإرسال فشل لأي سبب (مفاتيح مش مظبوطة، مشكلة نت...) بترجع بس من غير ما توقف
// حفظ المحتوى نفسه - نشر المحتوى أهم بكتير من نجاح الإشعار.
// New content → everyone in that grade (shared helper: both OneSignal key styles, result kept for "Send a test")
async function sendPushNotification(env, { title, message, grade }) {
    const db = [env.DB, env.D1_DB].find(d => d && typeof d.prepare === 'function');
    return pushToGrade(env, db, grade, { title, message });
}

const CATEGORY_LABELS = {
    videos: '🎥 فيديو جديد',
    summaries: '📄 ملخص جديد',
    exams: '📝 امتحان جديد'
};

export async function onRequestGet(context) {
    const { request, env } = context;
    const url = new URL(request.url);
    const db = getDb(env);

    // بنقرأ الفلاتر اللي جاية من الفرونت إند
    const grade = url.searchParams.get('grade') || 'ALL';
    const category = url.searchParams.get('category') || 'ALL';

    try {
        // Signed-in students and staff only — the lesson links are never shown to guests (audit 23 Nov 2026)
        if (!db) return Response.json({ error: 'Database not connected' }, { status: 500 });
        await ensureAppSchema(db);
        const signedIn = (await verifyStudentRequest(request, env, db)) || (await verifyAdminRequest(request, env));
        if (!signedIn) return Response.json({ error: 'سجّل دخول الأول', code: 'STUDENT_SESSION_REQUIRED' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
        let query = "SELECT *, rowid AS _order FROM lessons ORDER BY rowid DESC";
        let params = [];

        // فلترة على حسب اختيارات الأدمن
        if (grade !== 'ALL' && category !== 'ALL') {
            query = "SELECT *, rowid AS _order FROM lessons WHERE grade = ? AND category = ? ORDER BY rowid DESC";
            params = [grade, category];
        } else if (grade !== 'ALL') {
            query = "SELECT *, rowid AS _order FROM lessons WHERE grade = ? ORDER BY rowid DESC";
            params = [grade];
        } else if (category !== 'ALL') {
            query = "SELECT *, rowid AS _order FROM lessons WHERE category = ? ORDER BY rowid DESC";
            params = [category];
        }

        const { results } = await db.prepare(query).bind(...params).all();
        return Response.json(results);
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
        // === تسجيل مشاهدة محتوى (فيديو/ملخص/امتحان قديم) من طالب ===
        // بتُستخدم من صفحة materials.html كل ما طالب يفتح حاجة
        if (action === 'view') {
            const body = await request.json();
            const { contentId, contentType } = body;
            const who = await requireStudent(request, env, db, body.studentId);
            if (who.error) return who.error;
            const studentId = who.id;
            if (!contentId) {
                return Response.json({ error: 'بيانات ناقصة' }, { status: 400 });
            }
            await db.prepare(
                "INSERT INTO content_views (student_id, content_id, content_type) VALUES (?, ?, ?)"
            ).bind(studentId, contentId, contentType || 'unknown').run();
            return Response.json({ success: true });
        }

        // === إضافة محتوى جديد (السلوك الأصلي، من غير أي action محدد) ===
        // ── حماية: لازم يكون أدمن عشان يضيف محتوى ──
        const auth = await requireStaff(request, env, 'lessons.create');
        if (auth.error) return auth.error;
        const lesson = await request.json();
        if (!lesson || !lesson.id || !lesson.title || !lesson.grade || !lesson.category || !lesson.url) {
            return Response.json({ error: 'بيانات المحتوى ناقصة' }, { status: 400 });
        }
        // Only real web links (a "javascript:" link would run code on students' phones)
        let parsedUrl = null;
        try { parsedUrl = new URL(String(lesson.url).trim()); } catch (e) { }
        if (!parsedUrl || !['http:', 'https:'].includes(parsedUrl.protocol)) {
            return Response.json({ error: 'الرابط لازم يبدأ بـ https://' }, { status: 400 });
        }
        if (!['prep1', 'prep2', 'prep3', 'sec1'].includes(String(lesson.grade).toLowerCase()) || !['videos', 'summaries', 'exams'].includes(String(lesson.category).toLowerCase())) {
            return Response.json({ error: 'المرحلة أو القسم غير صحيح' }, { status: 400 });
        }
        lesson.grade = String(lesson.grade).toLowerCase();
        lesson.category = String(lesson.category).toLowerCase();
        lesson.title = String(lesson.title).trim().slice(0, 150);
        lesson.url = parsedUrl.toString();
        // Always a sortable server time (older entries were saved with a local Arabic date)
        lesson.createdAt = new Date().toISOString();

        // إدخال الدرس الجديد في الداتا بيز
        await db.prepare(
            "INSERT INTO lessons (id, title, grade, category, url, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
        ).bind(
            lesson.id, lesson.title, lesson.grade, lesson.category, lesson.url, lesson.notes || '', lesson.createdAt || new Date().toISOString()
        ).run();
        await audit(db, request, auth.staff, 'lessons.create', lesson.id, { title: lesson.title, grade: lesson.grade, category: lesson.category });

        // بمجرد ما المحتوى يتحفظ بنجاح، ابعتي إشعار لطلاب نفس المرحلة بس
        const label = CATEGORY_LABELS[(lesson.category || '').toLowerCase()] || '📚 محتوى جديد';
        await sendPushNotification(env, {
            title: label,
            message: `${lesson.title} — متاح الآن لطلاب ${(lesson.grade || '').toUpperCase()}`,
            grade: lesson.grade
        });

        return Response.json({ success: true, id: lesson.id });
    } catch (err) {
        return Response.json({ error: err.message }, { status: 500 });
    }
}

export async function onRequestDelete(context) {
    const { request, env } = context;
    const db = getDb(env);
    const url = new URL(request.url);
    const id = url.searchParams.get('id');

    // ── حماية: لازم يكون أدمن عشان يمسح محتوى ──
    const auth = await requireStaff(request, env, 'lessons.delete');
    if (auth.error) return auth.error;

    try {
        // حذف الدرس بناءً على الـ ID (ونسخة كاملة منه بتتحفظ في سجل النشاط)
        if (id) {
            const row = await db.prepare("SELECT * FROM lessons WHERE id = ?").bind(id).first();
            if (!row) return Response.json({ error: 'المحتوى غير موجود' }, { status: 404 });
            await db.batch([
                db.prepare("DELETE FROM lessons WHERE id = ?").bind(id),
                auditStmt(db, request, auth.staff, 'lessons.delete', id, { lesson: row })
            ]);
            return Response.json({ success: true });
        }
        return Response.json({ error: 'ID is required' }, { status: 400 });
    } catch (err) {

        return Response.json({ error: err.message }, { status: 500 });
    }
}
