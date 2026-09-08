export async function onRequestPost(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const action = url.searchParams.get('action');

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

      // البحث عن الطالب في الداتا بيز (استخدمنا D1_DB هنا)
      const stmt = env.D1_DB.prepare("SELECT * FROM students WHERE student_id = ? AND password = ?").bind(studentId.trim(), password);
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
    if (action === 'signup') {
      const data = await request.json();
      // توليد كود طالب عشوائي
      const studentId = `MM-${Math.floor(100000 + Math.random() * 900000)}`;

      // إدخال البيانات في الداتا بيز (استخدمنا D1_DB هنا برضه)
      const stmt = env.D1_DB.prepare(
        "INSERT INTO students (student_id, first_name, last_name, phone, parent_phone, grade, password, role) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
      ).bind(
        studentId, data.firstName, data.lastName, data.phone, data.parentPhone, data.grade, data.password, 'student'
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
          role: 'student'
        }
      });
    }

    return Response.json({ error: 'Action not found' }, { status: 404 });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
