const DB = {
    async login(studentId, password) {
        try {
            const res = await fetch('/api/auth?action=login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ studentId, password })
            });
            if (res.ok) {
                return await res.json();
            }
            const data = await res.json().catch(() => ({}));
            throw new Error(data.error || 'كود الطالب أو كلمة المرور غير صحيحة');
        } catch (err) {
            // كان هنا "دخول احتياطي" من نسخة محفوظة في المتصفح، وكان بيسمح للطالب يدخل
            // بالباسورد القديم حتى بعد ما الأدمن تغيره (والباسورد كان متخزن في المتصفح كنص عادي).
            // دلوقتي الدخول من السيرفر بس.
            if (err instanceof TypeError) {
                throw new Error('تعذر الاتصال بالخادم، تأكد من الإنترنت وحاول تاني');
            }
            throw err;
        }
    },

    async signup(payload) {
        try {
            const res = await fetch('/api/auth?action=signup', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'فشل إنشاء الحساب');

            // (مبقيناش نحفظ بيانات الطالب وكلمة السر في المتصفح — ملهاش لازمة وكانت خطر)
            return data;
        } catch (err) {
            // مهم جداً: لو التسجيل فشل فعلاً (مثلاً مشكلة في السيرفر أو الداتا بيز)،
            // من غير ما نعمل حساب وهمي محفوظ بس في متصفح الطالب (ده كان بيسبب
            // اختفاء حسابات طلاب حقيقيين من لوحة الأدمن من غير ما حد يلاحظ).
            // دلوقتي هيظهر رسالة خطأ واضحة للطالب بدل ما نتظاهر إن التسجيل نجح.
            console.error('Signup failed:', err);
            throw err;
        }
    },

    async getStudents() {
        try {
            // كسر الكاش بإضافة وقت الطلب عشان المتصفح يسحب داتا فريش
            const timestamp = new Date().getTime();
            let res = await fetch(`/api/admin?action=list&t=${timestamp}`);

            if (!res.ok) {
                res = await fetch(`/api/students?t=${timestamp}`);
            }

            if (res.status === 401) {
                // جلسة الأدمن خلصت: نقول كده صراحة بدل ما نعرض "مفيش طلاب"
                throw new Error('SESSION_EXPIRED');
            }

            if (res.ok) {
                const data = await res.json();
                if (Array.isArray(data)) {
                    // من غير باسوردات الطلاب، حتى لو جت من السيرفر
                    const safe = data.map(({ password, ...rest }) => rest);
                    localStorage.setItem('mm_students_db', JSON.stringify(safe));
                    return safe;
                }
            }
        } catch (e) {
            if (e.message === 'SESSION_EXPIRED') throw e;
            console.warn('API getStudents failed, using local storage cache:', e);
        }
        return JSON.parse(localStorage.getItem('mm_students_db') || '[]');
    },

    async resetPassword(studentId, password) {
        const local = JSON.parse(localStorage.getItem('mm_students_db') || '[]');
        const idx = local.findIndex(s => (s.studentId || s.student_id) === studentId);
        if (idx !== -1) {
            local[idx].password = password;
            localStorage.setItem('mm_students_db', JSON.stringify(local));
        }

        // قبل كده لو السيرفر رفض (جلسة منتهية مثلاً) كانت الدالة بترجع "نجح" برضو،
        // والأدمن تفتكر الباسورد اتغير وهو متغيرش. دلوقتي أي فشل بيظهر كرسالة خطأ.
        const res = await fetch('/api/students?action=reset-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ studentId, password })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'فشل تغيير كلمة المرور');
        return data;
    },

    async deleteStudent(studentId) {
        const res = await fetch('/api/students?action=delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ studentId })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'فشل حذف الطالب');

        let local = JSON.parse(localStorage.getItem('mm_students_db') || '[]');
        local = local.filter(s => (s.studentId || s.student_id) !== studentId);
        localStorage.setItem('mm_students_db', JSON.stringify(local));
        return data;
    },

    async getLessons(grade = 'ALL', category = 'ALL') {
        let serverLessons = null;
        try {
            const timestamp = new Date().getTime();
            const res = await fetch(`/api/lessons?grade=${encodeURIComponent(grade)}&category=${encodeURIComponent(category)}&t=${timestamp}`);
            if (res.ok) {
                const data = await res.json();
                if (Array.isArray(data)) {
                    serverLessons = data;
                    if (grade === 'ALL' && category === 'ALL') {
                        localStorage.setItem('mm_lessons_db', JSON.stringify(serverLessons));
                    }
                }
            }
        } catch (e) {
            console.warn('API getLessons failed, falling back to localStorage cache:', e);
        }

        if (serverLessons !== null) {
            return serverLessons;
        }

        const allLocal = JSON.parse(localStorage.getItem('mm_lessons_db') || '[]');
        return allLocal.filter(l => {
            const matchGrade = (grade === 'ALL' || (l.grade || '').trim().toLowerCase() === grade.trim().toLowerCase());
            let matchCat = (category === 'ALL');
            if (!matchCat) {
                const catLower = category.toLowerCase();
                const itemCat = (l.category || l.type || '').toLowerCase();
                if (catLower.includes('video')) matchCat = itemCat.includes('video');
                else if (catLower.includes('summar') || catLower.includes('pdf')) matchCat = itemCat.includes('summar') || itemCat.includes('pdf');
                else if (catLower.includes('exam') || catLower.includes('quiz')) matchCat = itemCat.includes('exam') || itemCat.includes('quiz');
                else matchCat = itemCat === catLower;
            }
            return matchGrade && matchCat;
        });
    },

    async addLesson(lesson) {
        const localLesson = {
            id: 'ITEM-' + Date.now(),
            createdAt: new Date().toLocaleDateString('ar-EG'),
            title: (lesson.title || '').trim(),
            grade: (lesson.grade || '').trim().toLowerCase(),
            category: (lesson.category || '').trim().toLowerCase(),
            url: (lesson.url || '').trim(),
            notes: (lesson.notes || '').trim()
        };

        // قبل كده لو السيرفر رفض الحفظ (مثلاً جلسة الأدمن خلصت) كان المحتوى بيتحفظ في متصفح
        // الأدمن بس، ويظهر لها إنه "اتنشر" والطلاب عمرهم ما يشوفوه. دلوقتي أي فشل بيظهر.
        let res;
        try {
            res = await fetch('/api/lessons', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(localLesson)
            });
        } catch (netErr) {
            throw new Error('تعذر الاتصال بالخادم، المحتوى ماتنشرش');
        }
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'فشل حفظ المحتوى على الخادم');

        const allLessons = JSON.parse(localStorage.getItem('mm_lessons_db') || '[]');
        allLessons.unshift(localLesson);
        localStorage.setItem('mm_lessons_db', JSON.stringify(allLessons));
        return data;
    },

    async deleteLesson(id) {
        const res = await fetch(`/api/lessons?id=${encodeURIComponent(id)}`, {
            method: 'DELETE'
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'فشل حذف المحتوى');

        let allLessons = JSON.parse(localStorage.getItem('mm_lessons_db') || '[]');
        allLessons = allLessons.filter(l => l.id !== id);
        localStorage.setItem('mm_lessons_db', JSON.stringify(allLessons));
        return data;
    }
};
