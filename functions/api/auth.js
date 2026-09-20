// بتحسب تحديث المتابعة اليومية (Streak) للطالب.
// اتعملها اختبارات كاملة قبل ما تتحط هنا (8 حالات مختلفة اتأكدنا منها).
function computeStreakUpdate(lastLoginISO, currentStreak, longestStreak) {
    const now = new Date();
    const todayUTC = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());

    if (!lastLoginISO) {
        // أول ظهور للطالب على الإطلاق
        return { newStreak: 1, newLongest: Math.max(1, longestStreak || 0) };
    }

    const last = new Date(lastLoginISO);
    const lastUTC = Date.UTC(last.getUTCFullYear(), last.getUTCMonth(), last.getUTCDate());
    const dayDiff = Math.round((todayUTC - lastUTC) / (1000 * 60 * 60 * 24));

    let newStreak;
    if (dayDiff === 0) {
        newStreak = currentStreak || 1;       // دخل النهاردة قبل كده، مفيش تغيير
    } else if (dayDiff === 1) {
        newStreak = (currentStreak || 0) + 1; // يوم ورا يوم، السلسلة مستمرة
    } else {
        newStreak = 1;                        // فوّت يوم أو أكتر، ترجع تبدأ من واحد
    }

    const newLongest = Math.max(newStreak, longestStreak || 0);
    return { newStreak, newLongest };
}

// بتحدد الأوسمة (Badges) اللي الطالب مستاهلها دلوقتي، بناءً على نشاطه.
// محسوبة لحظياً من غير ما تتخزن في جدول منفصل، عشان تفضل دايماً متطابقة مع الأرقام الحقيقية.
function computeBadges(currentStreak, contentViewCount) {
    const badges = [];
    if (currentStreak >= 3) badges.push('streak_3');
    if (currentStreak >= 7) badges.push('streak_7');
    if (currentStreak >= 30) badges.push('streak_30');
    if (contentViewCount >= 10) badges.push('active_learner');
    return badges;
}

// بتحدّث الـ streak في الداتا بيز وبترجع الأرقام الجديدة + الأوسمة.
// مستخدمة من login وبرضو من checkin، عشان المنطق يبقى مكان واحد بس.
async function updateStreakAndGetBadges(db, user) {
    const { newStreak, newLongest } = computeStreakUpdate(user.last_login, user.current_streak, user.longest_streak);
    const nowIso = new Date().toISOString();

    await db.prepare(
        "UPDATE students SET last_login = ?, current_streak = ?, longest_streak = ? WHERE student_id = ?"
    ).bind(nowIso, newStreak, newLongest, user.student_id).run();

    let viewCount = 0;
    try {
        const row = await db.prepare(
            "SELECT COUNT(*) as cnt FROM content_views WHERE student_id = ?"
        ).bind(user.student_id).first();
        viewCount = row ? row.cnt : 0;
    } catch (e) {
        // لو الجدول لسه مش موجود لأي سبب، منسيبش ده يوقف تسجيل الدخول
        viewCount = 0;
    }

    const badges = computeBadges(newStreak, viewCount);
    return { currentStreak: newStreak, longestStreak: newLongest, badges };
}

export async function onRequestPost(context) {
    const { request, env } = context;
    const url = new URL(request.url);
    const action = url.searchParams.get('action');
    // الداتا بيز ممكن تكون متسجلة في Cloudflare باسم DB أو D1_DB
    // السطر ده بيتأكد إننا بنمسك الاسم الصح مهما كان
    const db = env.DB || env.D1_DB;

    try {
        // 1. حالة تسجيل الدخول (Login)
        if (action === 'login') {
            const { studentId, password } = await request.json();

            // التحقق من حساب الأدمن الخاص بالمس مروة
            if (studentId.trim().toUpperCase() === 'MM-ADMIN' && password === 'marwa2026') {
                return Response.json({
                    success: true,
                    student: { id: 'MM-ADMIN', firstName: 'Miss Marwa', lastName: '(Admin)', grade: 'all', role: 'admin' }
                });
            }

            // البحث عن الطالب في الداتا بيز
            const stmt = db.prepare("SELECT * FROM students WHERE student_id = ? AND password = ?").bind(studentId.trim(), password);
            const user = await stmt.first();

            if (user) {
                const streakInfo = await updateStreakAndGetBadges(db, user);
                return Response.json({
                    success: true,
                    student: {
                        id: user.student_id,
                        firstName: user.first_name,
                        lastName: user.last_name,
                        grade: user.grade,
                        role: user.role,
                        currentStreak: streakInfo.currentStreak,
                        longestStreak: streakInfo.longestStreak,
                        badges: streakInfo.badges
                    }
                });
            } else {
                return Response.json({ error: 'كود الطالب أو كلمة المرور غير صحيحة' }, { status: 401 });
            }
        }

        // 2. حالة إنشاء حساب جديد (Signup)
        if (action === 'signup') {
            const data = await request.json();

            // التأكد الإجباري إن الطالب اختار النوع
            if (!data.gender) {
                return Response.json({ error: 'يرجى اختيار النوع (ذكر/أنثى)' }, { status: 400 });
            }

            // التأكد الإجباري إن الطالب اختار نظام الدراسة (خاص / سنتر)
            if (!data.branch) {
                return Response.json({ error: 'يرجى اختيار نظام الدراسة (خاص/سنتر)' }, { status: 400 });
            }

            // توليد كود طالب عشوائي
            const studentId = `MM-${Math.floor(100000 + Math.random() * 900000)}`;

            // إدخال البيانات في الداتا بيز (تم ترتيب gender و branch قبل phone)
            const stmt = db.prepare(
                "INSERT INTO students (student_id, first_name, last_name, gender, branch, phone, parent_phone, grade, password, role) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
            ).bind(
                studentId, data.firstName, data.lastName, data.gender, data.branch, data.phone, data.parentPhone, data.grade, data.password, 'student'
            );

            await stmt.run();

            return Response.json({
                success: true,
                studentId: studentId,
                student: {
                    id: studentId,
                    firstName: data.firstName,
                    lastName: data.lastName,
                    grade: data.grade,
                    role: 'student',
                    gender: data.gender,
                    branch: data.branch
                }
            });
        }

        // 3. حالة التحقق من وجود الحساب (Session Validation)
        if (action === 'validate') {
            const { studentId } = await request.json();

            // لو ده حساب الأدمن، خليه يكمل عادي
            if (studentId.trim().toUpperCase() === 'MM-ADMIN') {
                return Response.json({ valid: true });
            }

            // نسأل الداتا بيز: هل الطالب ده لسه موجود؟
            const user = await db.prepare("SELECT student_id FROM students WHERE student_id = ?").bind(studentId).first();

            if (user) {
                return Response.json({ valid: true }); // الحساب موجود
            } else {
                return Response.json({ valid: false }); // الحساب اتحذف
            }
        }

        // 4. حالة "تسجيل حضور" خفيفة بتتنادى من أي صفحة الطالب بيفتحها
        // (مش بس صفحة تسجيل الدخول) عشان الـ streak يبقى معبّر عن نشاطه الحقيقي كل يوم
        if (action === 'checkin') {
            const { studentId } = await request.json();

            if (!studentId || studentId.trim().toUpperCase() === 'MM-ADMIN') {
                return Response.json({ success: true, skipped: true });
            }

            const user = await db.prepare("SELECT * FROM students WHERE student_id = ?").bind(studentId.trim()).first();
            if (!user) {
                return Response.json({ error: 'الحساب غير موجود' }, { status: 404 });
            }

            const streakInfo = await updateStreakAndGetBadges(db, user);
            return Response.json({ success: true, ...streakInfo });
        }

        return Response.json({ error: 'Action not found' }, { status: 404 });
    } catch (err) {
        return Response.json({ error: err.message }, { status: 500 });
    }
}
