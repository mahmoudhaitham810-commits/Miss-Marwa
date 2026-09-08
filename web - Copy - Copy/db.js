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
            throw new Error(data.error || 'Wrong ID/Password');
        } catch (err) {
            // Local fallback
            const cleanId = (studentId || '').trim().toUpperCase();
            const cleanPass = (password || '').trim();
            const localStudents = JSON.parse(localStorage.getItem('mm_students_db') || '[]');

            // Default admin account
            if (cleanId === 'MM-ADMIN' && cleanPass === 'marwa2026') {
                return {
                    success: true,
                    student: { id: 'MM-ADMIN', firstName: 'Miss Marwa', lastName: '(Admin)', grade: 'all', role: 'admin', gender: 'female' }
                };
            }

            const acc = localStudents.find(x => (x.studentId || x.student_id || '').trim().toUpperCase() === cleanId);
            if (acc && acc.password === cleanPass) {
                return {
                    success: true,
                    student: {
                        id: acc.studentId || acc.student_id,
                        firstName: acc.firstName || acc.first_name,
                        lastName: acc.lastName || acc.last_name,
                        grade: acc.grade,
                        role: acc.role || (acc.grade === 'all' ? 'admin' : 'student'),
                        gender: acc.gender
                    }
                };
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

            // Cache locally
            const local = JSON.parse(localStorage.getItem('mm_students_db') || '[]');
            local.push({
                studentId: data.studentId,
                ...payload,
                role: 'student',
                createdAt: new Date().toLocaleDateString('ar-EG')
            });
            localStorage.setItem('mm_students_db', JSON.stringify(local));

            return data;
        } catch (err) {
            // If offline or API unavailable, create locally
            const studentId = `MM-${Math.floor(100000 + Math.random() * 900000)}`;
            const newStudent = {
                studentId,
                firstName: payload.firstName.trim(),
                lastName: payload.lastName.trim(),
                gender: payload.gender,
                phone: payload.phone.trim(),
                parentPhone: payload.parentPhone.trim(),
                grade: payload.grade,
                password: payload.password.trim(),
                role: 'student',
                createdAt: new Date().toLocaleDateString('ar-EG')
            };
            const local = JSON.parse(localStorage.getItem('mm_students_db') || '[]');
            local.push(newStudent);
            localStorage.setItem('mm_students_db', JSON.stringify(local));
            return {
                success: true,
                studentId,
                student: {
                    id: studentId,
                    firstName: newStudent.firstName,
                    lastName: newStudent.lastName,
                    grade: newStudent.grade,
                    role: 'student',
                    gender: newStudent.gender
                }
            };
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

            if (res.ok) {
                const data = await res.json();
                if (Array.isArray(data)) {
                    localStorage.setItem('mm_students_db', JSON.stringify(data));
                    return data;
                }
            }
        } catch (e) {
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

        try {
            const res = await fetch('/api/students?action=reset-password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ studentId, password })
            });
            if (res.ok) return await res.json();
        } catch (e) {
            console.warn('API resetPassword failed:', e);
        }
        return { success: true };
    },

    async deleteStudent(studentId) {
        let local = JSON.parse(localStorage.getItem('mm_students_db') || '[]');
        local = local.filter(s => (s.studentId || s.student_id) !== studentId);
        localStorage.setItem('mm_students_db', JSON.stringify(local));

        try {
            const res = await fetch('/api/students?action=delete', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ studentId })
            });
            if (res.ok) return await res.json();
        } catch (e) {
            console.warn('API deleteStudent failed:', e);
        }
        return { success: true };
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

        const allLessons = JSON.parse(localStorage.getItem('mm_lessons_db') || '[]');
        allLessons.unshift(localLesson);
        localStorage.setItem('mm_lessons_db', JSON.stringify(allLessons));

        try {
            const res = await fetch('/api/lessons', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(localLesson)
            });
            const data = await res.json();
            if (!res.ok) {
                throw new Error(data.error || 'Server error saving lesson');
            }
            return data;
        } catch (err) {
            if (err.message && err.message.includes('Server error')) {
                throw err;
            }
            return { success: true, id: localLesson.id, localOnly: true };
        }
    },

    async deleteLesson(id) {
        let allLessons = JSON.parse(localStorage.getItem('mm_lessons_db') || '[]');
        allLessons = allLessons.filter(l => l.id !== id);
        localStorage.setItem('mm_lessons_db', JSON.stringify(allLessons));

        try {
            const res = await fetch(`/api/lessons?id=${encodeURIComponent(id)}`, {
                method: 'DELETE'
            });
            if (res.ok) return await res.json();
        } catch (e) {
            console.warn('API deleteLesson failed:', e);
        }
        return { success: true };
    }
};
