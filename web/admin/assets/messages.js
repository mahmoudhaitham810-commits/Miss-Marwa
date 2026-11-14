/* =========================================================
   Parent WhatsApp messages — the 7 approved templates.
   One place for every message the staff portal sends, so the
   wording, greeting, sign-off and boy/girl forms stay consistent.
   window.ParentMessages
   ========================================================= */
(function () {
    'use strict';

    const GRADE_AR = { prep1: 'الصف الأول الإعدادي', prep2: 'الصف الثاني الإعدادي', prep3: 'الصف الثالث الإعدادي', sec1: 'الصف الأول الثانوي' };
    const BRANCH_AR = { center: 'سنتر', private: 'خاص' };
    const SIGN = 'مع تحيات مس مروة — Science Academy 💐';

    // Boy / girl wording, from the student's gender
    function g(student) {
        const f = String(student && student.gender || '').toLowerCase() === 'female';
        return {
            f,
            student: f ? 'الطالبة' : 'الطالب',
            took: f ? 'حلّت' : 'حلّ',
            didntTake: f ? 'لم تحل' : 'لم يحل',
            opened: f ? 'فتحت' : 'فتح',
            was: f ? 'كانت' : 'كان',
            absent: f ? 'غائبة' : 'غائب',
            solves: f ? 'تحل' : 'يحل',
            herself: f ? 'بنفسها' : 'بنفسه',
            level: f ? 'مستواها' : 'مستواه',
            help: f ? 'ونساعدها' : 'ونساعده',
            became: f ? 'بقت' : 'بقى',
            first: f ? 'الأولى' : 'الأول',
            proud: f ? 'بيها' : 'بيه'
        };
    }
    const fullName = (s) => `${s.firstName || ''} ${s.lastName || ''}`.trim();
    const pct = (v) => (v === null || v === undefined ? '—' : `${Math.round(v)}%`);
    function levelAr(p) {
        if (p === null || p === undefined) return '';
        return p >= 85 ? 'ممتاز' : p >= 70 ? 'جيد' : p >= 50 ? 'متوسط' : 'يحتاج متابعة';
    }
    function dateAr(d) {
        if (!d) return '';
        const x = new Date(/^\d{4}-\d{2}-\d{2}$/.test(d) ? d + 'T12:00:00Z' : d);
        if (isNaN(x)) return String(d);
        return x.toLocaleDateString('ar-EG', { day: 'numeric', month: 'long', timeZone: 'Africa/Cairo' });
    }
    const greeting = (s) => `السلام عليكم ولي أمر ${g(s).student} ${fullName(s)}`;

    // 1. Online results report (taken ✅, missed ❌ — missed counts as 0)
    function onlineReport(report) {
        const s = report.student, w = g(s);
        const lines = [
            `${greeting(s)} 🌟`,
            `تقرير الامتحانات الأونلاين — ${GRADE_AR[s.grade] || s.grade || ''}${s.branch ? ' · ' + (BRANCH_AR[s.branch] || '') : ''}`,
            ''
        ];
        report.exams.forEach(e => {
            lines.push(e.status === 'taken' ? `✅ ${e.title}: ${e.score}/${e.total}` : `❌ ${e.title}: ${w.didntTake}`);
        });
        lines.push('');
        if (report.possible > 0) lines.push(`📊 الإجمالي: ${report.earned}/${report.possible} (${pct(report.percent)}) — ${levelAr(report.percent)}`);
        lines.push(`📝 ${w.took} ${report.taken} من ${report.taken + report.missed} امتحانات`);
        lines.push('', SIGN);
        return lines.join('\n');
    }

    // 2. Missed online exam (only after it closed)
    function missedOnline({ student, examTitle, closedAt }) {
        const w = g(student);
        return [
            `${greeting(student)}،`,
            `نحيطكم علماً أن ${student.firstName} ${w.didntTake} امتحان "${examTitle}" الأونلاين، والذي انتهى يوم ${dateAr(closedAt)}.`,
            'برجاء المتابعة، ولو فيه عذر يسعدنا نعرفه على هذا الرقم.',
            '',
            SIGN
        ].join('\n');
    }

    // 3. Opened but didn't submit (only once the exam or its timer is over)
    function notSubmitted({ student, examTitle, reopened }) {
        const w = g(student);
        const lines = [
            `${greeting(student)}،`,
            `${student.firstName} ${w.opened} امتحان "${examTitle}" ولم يتم تسليم الإجابات، وده بيحصل غالباً لما ${w.student} يخرج من صفحة الامتحان.`
        ];
        if (reopened) lines.push('تم إعادة فتح الامتحان مرة واحدة — برجاء التأكيد على عدم الخروج من الصفحة حتى التسليم.');
        lines.push('', SIGN);
        return lines.join('\n');
    }

    // 4. Latest center mark (or absence)
    function latestCenter({ student, examName, date, score, total, absent, groupAvg }) {
        const w = g(student);
        if (absent) {
            return [`السلام عليكم 🌟`, `${student.firstName} ${w.was} ${w.absent} عن امتحان "${examName}"${date ? ' يوم ' + dateAr(date) : ''}.`, 'برجاء المتابعة.', '', SIGN].join('\n');
        }
        const p = total > 0 ? (score / total) * 100 : null;
        const lines = [
            'السلام عليكم 🌟',
            `درجة ${fullName(student)} في امتحان "${examName}"${date ? ' (' + dateAr(date) + ')' : ''}: ${score}/${total} — ${pct(p)} (${levelAr(p)})`
        ];
        if (groupAvg !== null && groupAvg !== undefined) lines.push(`متوسط المجموعة: ${pct(groupAvg)}`);
        lines.push('', SIGN);
        return lines.join('\n');
    }

    // 5. Full center report (absences counted as 0)
    function fullCenter({ student, rows }) {
        const w = g(student);
        const lines = [`${greeting(student)} 🌟`, `تقرير امتحانات ${student.branch === 'private' ? 'الخاص' : 'السنتر'} — ${GRADE_AR[student.grade] || ''}`, ''];
        let earned = 0, possible = 0, taken = 0, missed = 0;
        rows.forEach(r => {
            if (r.status === 'not-entered') return;
            if (r.status === 'absent') { lines.push(`❌ ${r.name}: ${w.absent}`); missed++; possible += r.total; }
            else { lines.push(`✅ ${r.name}: ${r.score}/${r.total}`); taken++; earned += r.score; possible += r.total; }
        });
        const p = possible > 0 ? (earned / possible) * 100 : null;
        lines.push('');
        if (possible > 0) lines.push(`📊 الإجمالي: ${earned}/${possible} (${pct(p)}) — ${levelAr(p)}`);
        lines.push(`📝 حضر ${taken} من ${taken + missed} امتحانات`);
        lines.push('', SIGN);
        return lines.join('\n');
    }

    // 6. Online vs center gap (only with 3+ exams of each kind)
    function gap({ student, onlinePct, centerPct }) {
        const w = g(student);
        return [
            `${greeting(student)}،`,
            `لاحظنا إن مستوى ${student.firstName} في الامتحانات الأونلاين (${pct(onlinePct)}) أعلى بفارق كبير من امتحانات السنتر (${pct(centerPct)}).`,
            `نتمنى نتعاون مع حضرتك إن ${student.firstName} ${w.solves} الامتحانات الأونلاين ${w.herself} من غير مساعدة، عشان نعرف ${w.level} الحقيقي ${w.help}.`,
            '',
            SIGN
        ].join('\n');
    }

    // 7. Congratulations (from the analytics movers cards)
    function congrats({ student, rank, before, groupLabel, grade, examName }) {
        const w = g(student);
        const place = rank === 1 ? w.first : `رقم ${rank}`;
        return [
            'ألف مبروك 🎉',
            `${student.firstName} ${w.became} ${place} على ${groupLabel || 'المجموعة'} في ${GRADE_AR[grade] || ''}${examName ? ` بعد امتحان "${examName}"` : ''}${before ? ` (كان الترتيب #${before})` : ''}.`,
            `فخورين ${w.proud} جداً — مس مروة 💐`
        ].join('\n');
    }

    // 8 — DRAFT (waiting for approval): the private report link, sent once per parent
    function parentLink({ student, url }) {
        const w = g(student);
        return [
            `السلام عليكم ولي أمر ${w.student} ${fullName(student)} 🌷`,
            `ده رابط خاص بمتابعة ${student.firstName} على Science Academy:`,
            url,
            `من الرابط ده هتلاقوا كل درجات امتحانات السنتر والامتحانات الأونلاين أول بأول، وبيتحدث لوحده مع كل درجة جديدة.`,
            `⚠️ الرابط خاص بيكم بس — يا ريت ما يتبعتش لحد تاني.`,
            SIGN
        ].join('\n');
    }

    // WhatsApp link for an Egyptian number (01xxxxxxxxx → 201xxxxxxxxx)
    function waLink(phone, text) {
        let n = String(phone || '').replace(/[٠-٩]/g, d => d.charCodeAt(0) - 0x0660).replace(/\D/g, '');
        if (n.startsWith('0020')) n = n.slice(4);
        if (n.startsWith('20') && n.length === 12) n = n.slice(2);
        if (n.startsWith('0')) n = n.slice(1);
        if (!n) return null;
        return `https://wa.me/20${n}?text=${encodeURIComponent(text)}`;
    }

    window.ParentMessages = { onlineReport, missedOnline, notSubmitted, latestCenter, fullCenter, gap, congrats, parentLink, waLink, levelAr, GRADE_AR, BRANCH_AR };
})();
