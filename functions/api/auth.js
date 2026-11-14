import { ensureAppSchema, ensureStaffSchema, normalizeEgyptPhone, studentCookieFor, CLEAR_STUDENT_COOKIE, verifyStudentRequest, requireStudent, legacyStudentsAllowed, throttleState, recordFail } from './admin-auth.js';

// Student sign-in: 10 wrong passwords for one code (or 30 from one network) → 15 minutes pause
const STUDENT_CODE_LOCK = { fails: 10, windowMs: 15 * 60 * 1000, lockMs: 15 * 60 * 1000 };
const STUDENT_IP_LOCK = { fails: 30, windowMs: 15 * 60 * 1000, lockMs: 15 * 60 * 1000 };
const clientIp = (request) => request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || '';

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
    const db = [env.DB, env.D1_DB].find(d => d && typeof d.prepare === "function");

    try {
        // 1. حالة تسجيل الدخول (Login)
        if (action === 'login') {
            const body = await request.json();
            // الكود بيتحول لحروف كبيرة، عشان الطالب اللي يكتب mm-123456 يدخل عادي
            const studentId = String(body.studentId || '').trim().toUpperCase();
            const password = String(body.password || '');
            if (!studentId || !password) {
                return Response.json({ error: 'يرجى إدخال الكود وكلمة المرور' }, { status: 400 });
            }

            // حساب الأدمن القديم (MM-ADMIN) اتشال من صفحة دخول الطلاب نهائياً.
            // مس مروة والمساعد بيدخلوا من بوابة المعلمين المنفصلة (/admin/) بحساباتهم.
            if (studentId === 'MM-ADMIN') {
                return Response.json({ error: 'كود الطالب أو كلمة المرور غير صحيحة' }, { status: 401 });
            }

            // البحث عن الطالب في الداتا بيز
            await ensureStaffSchema(db);
            await ensureAppSchema(db);
            const codeKey = 'student:' + studentId, ipKey = 'student-ip:' + clientIp(request);
            const [cSt, iSt] = await Promise.all([throttleState(db, codeKey), throttleState(db, ipKey)]);
            const lockedUntil = Math.max(cSt.locked_until, iSt.locked_until);
            if (lockedUntil > Date.now()) {
                const mins = Math.max(1, Math.ceil((lockedUntil - Date.now()) / 60000));
                return Response.json({ error: `محاولات غلط كتير — جرّب تاني بعد ${mins} دقيقة`, code: 'LOCKED' }, { status: 429 });
            }

            const stmt = db.prepare("SELECT * FROM students WHERE student_id = ? AND password = ?").bind(studentId, password);
            const user = await stmt.first();

            if (user) {
                const streakInfo = await updateStreakAndGetBadges(db, user);
                await db.prepare('DELETE FROM auth_throttle WHERE key = ?').bind(codeKey).run();
                const cookie = await studentCookieFor(env, user.student_id, user.session_version || 1);
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
                }, cookie ? { headers: { 'Set-Cookie': cookie } } : undefined);
            } else {
                await recordFail(db, codeKey, STUDENT_CODE_LOCK);
                await recordFail(db, ipKey, STUDENT_IP_LOCK);
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

            // ── تأكيد البيانات على السيرفر (مش كفاية الفرونت إند) ──
            // الاسم بيظهر في لوحة الأدمن، فلو حد كتب كود HTML/JavaScript مكان اسمه كان ممكن
            // يتنفذ جوه لوحة التحكم ويمسح بيانات. فبنسمح بحروف عربي/إنجليزي ومسافات بس.
            const firstName = String(data.firstName || '').trim();
            const lastName = String(data.lastName || '').trim();
            // الأرقام بتتوحد لصيغة واحدة (01xxxxxxxxx) مهما اتكتبت: أرقام عربي، +20، مسافات...
            const phone = normalizeEgyptPhone(data.phone);
            const parentPhone = normalizeEgyptPhone(data.parentPhone);
            const grade = String(data.grade || '').trim().toLowerCase();
            const password = String(data.password || '');
            const NAME_RE = /^[؀-ۿa-zA-Z\s'\-.]{2,40}$/;
            const PHONE_RE = /^01[0125][0-9]{8}$/;

            if (!NAME_RE.test(firstName) || !NAME_RE.test(lastName) || /[<>]/.test(firstName + lastName)) {
                return Response.json({ error: 'الاسم لازم يكون حروف بس (عربي أو إنجليزي) من 2 لـ 40 حرف' }, { status: 400 });
            }
            if (!PHONE_RE.test(phone) || !PHONE_RE.test(parentPhone)) {
                return Response.json({ error: 'يرجى إدخال أرقام هواتف مصرية صحيحة (11 رقم تبدأ بـ 01)' }, { status: 400 });
            }
            if (!['prep1', 'prep2', 'prep3', 'sec1'].includes(grade)) {
                return Response.json({ error: 'يرجى اختيار المرحلة الدراسية' }, { status: 400 });
            }
            if (!['male', 'female'].includes(data.gender) || !['private', 'center'].includes(data.branch)) {
                return Response.json({ error: 'بيانات النوع أو نظام الدراسة غير صحيحة' }, { status: 400 });
            }
            if (password.length < 4 || password.length > 64) {
                return Response.json({ error: 'كلمة المرور لازم تكون 4 حروف/أرقام على الأقل' }, { status: 400 });
            }
            if (phone === parentPhone) {
                return Response.json({ error: 'رقم ولي الأمر لازم يكون مختلف عن رقم الطالب', code: 'SAME_PHONE' }, { status: 400 });
            }

            // ── منع الحسابات المكررة: رقم الطالب نفسه + نفس المرحلة = نفس الطالب ──
            // (رقم ولي الأمر ممكن يتكرر عادي — إخوات أو توأم). بنقارن بعد توحيد صيغة الأرقام،
            // عشان 01012345678 و +201012345678 و ٠١٠١٢٣٤٥٦٧٨ يتعرفوا إنهم نفس الرقم.
            await ensureAppSchema(db);
            const { results: sameGrade } = await db.prepare(
                "SELECT phone FROM students WHERE grade = ?"
            ).bind(grade).all();
            if ((sameGrade || []).some(r => normalizeEgyptPhone(r.phone) === phone)) {
                return Response.json({
                    error: 'فيه حساب متسجل بالفعل برقم الموبايل ده في نفس المرحلة. لو نسيت الكود أو كلمة السر، كلّمنا على واتساب.',
                    code: 'PHONE_EXISTS'
                }, { status: 409 });
            }

            // توليد كود طالب عشوائي — ولو الكود طلع متكرر (نادر بس بيحصل مع زيادة الطلاب)
            // بنجرب كود تاني بدل ما الطالب يشوف رسالة خطأ غريبة
            let studentId = null;
            for (let attempt = 0; attempt < 5 && !studentId; attempt++) {
                const candidate = `MM-${Math.floor(100000 + Math.random() * 900000)}`;
                try {
                    await db.prepare(
                        "INSERT INTO students (student_id, first_name, last_name, gender, branch, phone, parent_phone, grade, password, role) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
                    ).bind(
                        candidate, firstName, lastName, data.gender, data.branch, phone, parentPhone, grade, password, 'student'
                    ).run();
                    studentId = candidate;
                } catch (insertErr) {
                    if (!String(insertErr.message || '').includes('UNIQUE')) throw insertErr;
                }
            }
            if (!studentId) {
                return Response.json({ error: 'حصلت مشكلة أثناء إنشاء الكود، جرّب تاني' }, { status: 500 });
            }

            const cookie = await studentCookieFor(env, studentId, 1);
            return Response.json({
                success: true,
                studentId: studentId,
                student: {
                    id: studentId,
                    firstName,
                    lastName,
                    grade,
                    role: 'student',
                    gender: data.gender,
                    branch: data.branch
                }
            }, cookie ? { headers: { 'Set-Cookie': cookie } } : undefined);
        }

        // 3. Is this browser still signed in? (the server-verified cookie decides — not the code in the request)
        if (action === 'validate') {
            const body = await request.json().catch(() => ({}));
            if (body.studentId && String(body.studentId).trim().toUpperCase() === 'MM-ADMIN') return Response.json({ valid: false });
            const st = await verifyStudentRequest(request, env, db);
            if (st) return Response.json({ valid: true, student: { id: st.id, grade: st.grade, firstName: st.firstName, lastName: st.lastName } });
            // Old sign-in (before sessions): only accepted while STUDENT_LEGACY_SESSIONS=allow
            if (legacyStudentsAllowed(env) && body.studentId) {
                const user = await db.prepare("SELECT student_id FROM students WHERE student_id = ?").bind(String(body.studentId).trim()).first();
                return Response.json({ valid: !!user, legacy: true });
            }
            return Response.json({ valid: false, code: 'STUDENT_SESSION_REQUIRED' });
        }

        // 4. Daily check-in for the streak — for the signed-in student only
        if (action === 'checkin') {
            const body = await request.json().catch(() => ({}));
            if (body.studentId && String(body.studentId).trim().toUpperCase() === 'MM-ADMIN') return Response.json({ success: true, skipped: true });
            const who = await requireStudent(request, env, db, body.studentId);
            if (who.error) return who.error;
            const user = await db.prepare("SELECT * FROM students WHERE student_id = ?").bind(who.id).first();
            if (!user) return Response.json({ error: 'الحساب غير موجود' }, { status: 404 });
            const streakInfo = await updateStreakAndGetBadges(db, user);
            return Response.json({ success: true, ...streakInfo });
        }

        // 5. Sign out (clears the session cookie)
        if (action === 'logout') {
            return Response.json({ success: true }, { headers: { 'Set-Cookie': CLEAR_STUDENT_COOKIE } });
        }

        return Response.json({ error: 'Action not found' }, { status: 404 });
    } catch (err) {
        return Response.json({ error: 'حصل خطأ في السيرفر' }, { status: 500 });
    }
}
