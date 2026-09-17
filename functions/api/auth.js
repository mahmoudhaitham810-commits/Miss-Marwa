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
                return Response.json({
                    success: true,
                    student: {
                        id: user.student_id,
                        firstName: user.first_name,
                        lastName: user.last_name,
                        grade: user.grade,
                        role: user.role
                    }
                });
            } else {
                return Response.json({ error: 'كود الطالب أو كلمة المرور غير صحيحة' }, { status: 401 });
            }
        }

        // 2. حالة إنشاء حساب جديد (Signup)
        // 2. حالة إنشاء حساب جديد (Signup)
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

        // 3. حالة التحقق من وجود الحساب (Session Validation) اللي لسه ضايفينها
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

        return Response.json({ error: 'Action not found' }, { status: 404 });
    } catch (err) {
        return Response.json({ error: err.message }, { status: 500 });
    }
}
