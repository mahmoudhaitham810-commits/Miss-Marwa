-- ملاحظة: عمود gender كان موجود بالفعل في الداتا بيز الحية (Cloudflare D1)
-- وده اللي بيخليه يتسجل صح، لكنه كان ناقص من الملف ده، فتمت إضافته هنا
-- عشان لو حد احتاج يعمل الداتا بيز من الصفر تاني، تطلع مطابقة لما هو شغال فعلياً.
--
-- عمود branch (خاص / سنتر) هو الجديد وميكونش موجود في الداتا بيز الحية لسه.
-- لازم تدخلي على Cloudflare D1 Console وتشغلي الأمر ده مرة واحدة بس:
--   ALTER TABLE students ADD COLUMN branch TEXT;
--
CREATE TABLE IF NOT EXISTS students (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id TEXT UNIQUE NOT NULL,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    gender TEXT,
    branch TEXT,
    phone TEXT NOT NULL,
    parent_phone TEXT NOT NULL,
    grade TEXT NOT NULL,
    password TEXT NOT NULL,
    role TEXT DEFAULT 'student',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS lessons (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    grade TEXT NOT NULL,
    category TEXT NOT NULL,
    url TEXT NOT NULL,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- جدول الامتحانات: كل صف = امتحان واحد، وفيه كل أسئلته مخزنة في عمود questions
-- كنص JSON (عشان منحتاجش نعمل جداول تانية للأسئلة والاختيارات، أبسط وأسرع).
CREATE TABLE IF NOT EXISTS exams (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    grade TEXT NOT NULL,
    questions TEXT NOT NULL,
    duration_days INTEGER NOT NULL DEFAULT 3,
    expires_at DATETIME NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- جدول محاولات الطلاب: صف واحد لكل طالب/امتحان.
-- status = 'started' لحظة ما الطالب يفتح الامتحان، وبيتحول لـ 'submitted' لما يسلم.
-- الـ UNIQUE في الآخر ده هو اللي بيمنع الطالب يدخل الامتحان مرتين نهائياً،
-- حتى لو حصل أي خطأ في كود الموقع نفسه، الداتا بيز مش هتسمح بصف مكرر.
CREATE TABLE IF NOT EXISTS exam_submissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    exam_id TEXT NOT NULL,
    student_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'started',
    score REAL,
    started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    submitted_at DATETIME,
    UNIQUE(exam_id, student_id)
);
