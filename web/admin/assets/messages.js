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
    // Every parent message starts with this line (no sign-off at the end)
    const OPEN = 'السلام عليكم — تيم مس مروة 👋';
    // Right-to-left safety: English names / scores inside Arabic lines are fenced with left-to-right
    // marks so WhatsApp never re-orders them, and each line starts with a right-to-left mark so
    // lines that begin with an emoji or an English word still read right-to-left.
    // (Left-to-right marks on both sides — supported by every WhatsApp version, unlike newer isolate characters.)
    const LRM = '\u200E', RLM = '\u200F';
    const iso = (v) => { const t = String(v ?? '').trim(); return /[\u0600-\u06FF]/.test(t) ? t : `${LRM}${t}${LRM}`; }; // Arabic text needs no fence
    const rtl = (lines) => lines.map(l => (l ? RLM + l : l)).join('\n');

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
    const pct = (v) => (v === null || v === undefined ? '—' : `\u200E${Math.round(v)}%\u200E`); // stays "68%" inside Arabic lines
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
    const head = (s) => [OPEN, `ولي أمر ${g(s).student}: ${iso(fullName(s))}`];
    const scoreLine = (score, total, p) => `${iso(`${score}/${total}`)} (${pct(p)}${p === null || p === undefined ? '' : ' — ' + levelAr(p)})`;

    // 1. Online results report (taken ✅, missed ❌ — missed counts as 0)
    function onlineReport(report) {
        const s = report.student, w = g(s);
        const lines = [...head(s), `الصف: ${GRADE_AR[s.grade] || s.grade || ''}${s.branch ? ' — ' + (BRANCH_AR[s.branch] || '') : ''}`, '', 'تقرير الامتحانات الأونلاين:'];
        report.exams.forEach(e => {
            lines.push(e.status === 'taken' ? `✅ ${iso(e.title)}: ${iso(`${e.score}/${e.total}`)}` : `❌ ${iso(e.title)}: ${w.didntTake}`);
        });
        lines.push('');
        if (report.possible > 0) lines.push(`الإجمالي: ${scoreLine(report.earned, report.possible, report.percent)}`);
        lines.push(`${w.took} ${report.taken} من ${report.taken + report.missed} امتحانات`);
        return rtl(lines);
    }

    // 2. Missed online exam (only after it closed)
    function missedOnline({ student, examTitle, closedAt }) {
        const w = g(student);
        return rtl([
            ...head(student),
            `امتحان أونلاين: ${iso(examTitle)}`,
            ...(closedAt ? [`انتهى يوم: ${dateAr(closedAt)}`] : []),
            `${iso(student.firstName)} ${w.didntTake} الامتحان.`,
            'برجاء المتابعة.'
        ]);
    }

    // 3. Opened but didn't submit (only once the exam or its timer is over)
    function notSubmitted({ student, examTitle, reopened }) {
        const w = g(student);
        const lines = [
            ...head(student),
            `امتحان أونلاين: ${iso(examTitle)}`,
            `${iso(student.firstName)} ${w.opened} الامتحان ولم يتم تسليم الإجابات، وده بيحصل غالباً لما ${w.student} يخرج من صفحة الامتحان.`
        ];
        if (reopened) lines.push('تم إعادة فتح الامتحان مرة واحدة — برجاء التأكيد على عدم الخروج من الصفحة حتى التسليم.');
        lines.push('برجاء المتابعة.');
        return rtl(lines);
    }

    // 4. Latest offline mark (or absence) — offline exams are taken at the center or at home, so the
    //    message shows only the exam name and score/total (no date, no %, no rating, no group average).
    //    `date` and `groupAvg` are still accepted (callers pass them) but ignored.
    function latestCenter({ student, examName, score, total, absent }) {
        const w = g(student);
        const lines = [...head(student), `الامتحان الأوفلاين: ${iso(examName)}`];
        if (absent) {
            lines.push(`${iso(student.firstName)} ${w.was} ${w.absent} عن الامتحان.`, 'برجاء المتابعة.');
            return rtl(lines);
        }
        lines.push(`الدرجة: ${iso(`${score}/${total}`)}`);
        return rtl(lines);
    }

    // 5. Full offline report (absences counted as 0) — marks as score/total only, no %, no rating
    function fullCenter({ student, rows }) {
        const w = g(student);
        const lines = [...head(student), `تقرير الامتحانات الأوفلاين — ${GRADE_AR[student.grade] || ''}`, ''];
        let earned = 0, possible = 0, taken = 0, missed = 0;
        rows.forEach(r => {
            if (r.status === 'not-entered') return;
            if (r.status === 'absent') { lines.push(`❌ ${iso(r.name)}: ${w.absent}`); missed++; possible += r.total; }
            else { lines.push(`✅ ${iso(r.name)}: ${iso(`${r.score}/${r.total}`)}`); taken++; earned += r.score; possible += r.total; }
        });
        lines.push('');
        if (possible > 0) lines.push(`الإجمالي: ${iso(`${earned}/${possible}`)}`);
        lines.push(`حضر ${taken} من ${taken + missed} امتحانات`);
        return rtl(lines);
    }

    // 6. Online vs center gap (only with 3+ exams of each kind)
    function gap({ student, onlinePct, centerPct }) {
        const w = g(student);
        return rtl([
            ...head(student),
            `الامتحانات الأونلاين: ${pct(onlinePct)}`,
            `الامتحانات الأوفلاين: ${pct(centerPct)}`,
            `لاحظنا إن مستوى ${iso(student.firstName)} في الأونلاين أعلى بفارق كبير من الأوفلاين.`,
            `نتمنى نتعاون مع حضرتك إن ${iso(student.firstName)} ${w.solves} الامتحانات الأونلاين ${w.herself} من غير مساعدة، عشان نعرف ${w.level} الحقيقي ${w.help}.`
        ]);
    }

    // 7. Congratulations (from the analytics movers cards)
    function congrats({ student, rank, before, groupLabel, grade, examName }) {
        const w = g(student);
        const place = rank === 1 ? w.first : `رقم ${rank}`;
        return rtl([
            ...head(student),
            'ألف مبروك 🎉',
            `${iso(student.firstName)} ${w.became} ${place} على ${groupLabel || 'المجموعة'} في ${GRADE_AR[grade] || ''}.`,
            ...(examName ? [`بعد امتحان: ${iso(examName)}`] : []),
            ...(before ? [`الترتيب قبلها: ${before}`] : []),
            `فخورين ${w.proud} جداً 💐`
        ]);
    }

    // 8 — on hold (not sent yet): the private report link, sent once per parent
    function parentLink({ student, url }) {
        return rtl([
            ...head(student),
            `ده رابط خاص بمتابعة ${iso(student.firstName)} على Science Academy:`,
            iso(url),
            'من الرابط ده هتلاقوا كل درجات امتحانات السنتر والامتحانات الأونلاين أول بأول، وبيتحدث لوحده مع كل درجة جديدة.',
            '⚠️ الرابط خاص بيكم بس — يا ريت ما يتبعتش لحد تاني.'
        ]);
    }

    // 9. Weekly homework follow-up (25 Nov 2026): R = not submitted · I = incomplete · L = late (A / E → no message)
    //    misses = how many times in the last 4 homework weeks (this one included) — mentioned from the 2nd time
    function homeworkWeek({ student, title, date, code, misses }) {
        const f = g(student).f, name = iso(student.firstName);
        const what = { R: `${name} ${f ? 'لم تسلّم' : 'لم يسلّم'} الواجب.`, I: `${name} ${f ? 'سلّمت' : 'سلّم'} الواجب ناقص.`, L: `${name} ${f ? 'سلّمت' : 'سلّم'} الواجب متأخر.` }[code];
        if (!what) return '';
        return rtl([
            ...head(student),
            `واجب: ${iso(title)}${date ? ` (${dateAr(date)})` : ''}`,
            what,
            ...(misses >= 2 ? [`ودي المرة رقم ${misses} في آخر 4 واجبات.`] : []),
            'برجاء المتابعة.'
        ]);
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

    window.ParentMessages = { onlineReport, missedOnline, notSubmitted, latestCenter, fullCenter, gap, congrats, parentLink, homeworkWeek, waLink, levelAr, GRADE_AR, BRANCH_AR };
})();
