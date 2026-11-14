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
    answers TEXT,
    started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    submitted_at DATETIME,
    UNIQUE(exam_id, student_id)
);

-- ===== Staff portal (created automatically by functions/api/admin-auth.js on first use) =====
-- staff: Miss Marwa (role 'teacher') + assistants (role 'assistant'). Passwords are PBKDF2 hashes.
CREATE TABLE IF NOT EXISTS staff (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    display_name TEXT NOT NULL,
    role TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    token_version INTEGER NOT NULL DEFAULT 1,
    last_login_at TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
-- audit_log: every change made from the staff portal (who, what, when, and a copy of anything deleted)
CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    staff_id INTEGER,
    staff_name TEXT,
    role TEXT,
    action TEXT NOT NULL,
    target TEXT,
    details TEXT,
    ip TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(created_at);
-- auth_throttle: temporary lock after too many wrong passwords
CREATE TABLE IF NOT EXISTS auth_throttle (
    key TEXT PRIMARY KEY,
    fails INTEGER NOT NULL DEFAULT 0,
    first_fail_at INTEGER NOT NULL DEFAULT 0,
    locked_until INTEGER NOT NULL DEFAULT 0
);

-- ===== Phase 2 (added automatically by ensureAppSchema in functions/api/admin-auth.js) =====
-- Only new nullable columns / new tables; existing data is never rewritten.
-- ALTER TABLE offline_exams ADD COLUMN branch TEXT;        -- 'center' | 'private' | NULL = before the split
-- ALTER TABLE offline_exams ADD COLUMN group_id TEXT;      -- future: private sub-groups (Saturday group…)
-- ALTER TABLE offline_exams ADD COLUMN exam_date TEXT;     -- YYYY-MM-DD
-- ALTER TABLE offline_grades ADD COLUMN absent INTEGER NOT NULL DEFAULT 0;
-- ALTER TABLE students ADD COLUMN group_id TEXT;           -- future: private sub-groups
-- ALTER TABLE exams ADD COLUMN shuffle INTEGER NOT NULL DEFAULT 1;
-- ALTER TABLE exam_submissions ADD COLUMN shuffle_seed TEXT;
CREATE TABLE IF NOT EXISTS student_groups (
    id TEXT PRIMARY KEY, grade TEXT NOT NULL, branch TEXT NOT NULL, name TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1, created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS duplicate_dismissals (
    pair_key TEXT PRIMARY KEY, staff_id INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_students_grade_phone ON students(grade, phone);
