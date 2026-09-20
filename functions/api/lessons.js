// الداتا بيز ممكن تكون متسجلة في Cloudflare باسم DB أو D1_DB
// الدالة دي بتتأكد إننا بنمسك الاسم الصح مهما كان
function getDb(env) {
    return env.DB || env.D1_DB;
}

// بتبعت إشعار Push للطلاب المشتركين. لو معانا "grade"، بتستهدف بس الطلاب
// المتعلّمين بتاج المرحلة دي (مش كل الطلاب)؛ لو مفيش، بتبعت للكل كحل احتياطي.
// لو الإرسال فشل لأي سبب (مفاتيح مش مظبوطة، مشكلة نت...) بترجع بس من غير ما توقف
// حفظ المحتوى نفسه - نشر المحتوى أهم بكتير من نجاح الإشعار.
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
        // استهداف الطلاب اللي عندهم تاج grade بنفس القيمة دي بالظبط
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
        let query = "SELECT * FROM lessons ORDER BY created_at DESC";
        let params = [];

        // فلترة على حسب اختيارات الأدمن
        if (grade !== 'ALL' && category !== 'ALL') {
            query = "SELECT * FROM lessons WHERE grade = ? AND category = ? ORDER BY created_at DESC";
            params = [grade, category];
        } else if (grade !== 'ALL') {
            query = "SELECT * FROM lessons WHERE grade = ? ORDER BY created_at DESC";
            params = [grade];
        } else if (category !== 'ALL') {
            query = "SELECT * FROM lessons WHERE category = ? ORDER BY created_at DESC";
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
            const { studentId, contentId, contentType } = await request.json();
            if (!studentId || !contentId) {
                return Response.json({ error: 'بيانات ناقصة' }, { status: 400 });
            }
            await db.prepare(
                "INSERT INTO content_views (student_id, content_id, content_type) VALUES (?, ?, ?)"
            ).bind(studentId, contentId, contentType || 'unknown').run();
            return Response.json({ success: true });
        }

        // === إضافة محتوى جديد (السلوك الأصلي، من غير أي action محدد) ===
        const lesson = await request.json();

        // إدخال الدرس الجديد في الداتا بيز
        await db.prepare(
            "INSERT INTO lessons (id, title, grade, category, url, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
        ).bind(
            lesson.id, lesson.title, lesson.grade, lesson.category, lesson.url, lesson.notes || '', lesson.createdAt || new Date().toISOString()
        ).run();

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

    try {
        // حذف الدرس بناءً على الـ ID
        if (id) {
            await db.prepare("DELETE FROM lessons WHERE id = ?").bind(id).run();
            return Response.json({ success: true });
        }
        return Response.json({ error: 'ID is required' }, { status: 400 });
    } catch (err) {

        return Response.json({ error: err.message }, { status: 500 });
    }
}
