/* =========================================================
   Voice grading — say a student's name and a mark ("أحمد محمد خمسين").
   Name matching + Arabic number words, moved unchanged from the classic portal.
   window.VoiceGrading
   ========================================================= */
(function () {
    'use strict';
    function normalizeArabic(text) {
        return (text || '')
            // شيل التشكيل بالكامل (فتحة ضمة كسرة شدة سكون تنوين)
            .replace(/[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06DC\u06DF-\u06E4\u06E7\u06E8\u06EA-\u06ED]/g, '')
            // توحيد الألف بكل أشكاله
            .replace(/[أإآٱءٲٳ]/g, 'ا')
            // التاء المربوطة = هاء
            .replace(/ة/g, 'ه')
            // الألف المقصورة = ياء
            .replace(/ى/g, 'ي')
            // الهمزة على واو = واو
            .replace(/ؤ/g, 'و')
            // الهمزة على ياء = ياء
            .replace(/ئ/g, 'ي')
            // شيل أي حروف مش عربية ومش أرقام ومش مسافات (علامات ترقيم زيادة)
            .replace(/[^\u0621-\u064A\u0660-\u06690-9a-zA-Z\s]/g, '')
            // مسافات متعددة → مسافة واحدة
            .replace(/\s+/g, ' ')
            .trim();
    }

    // نسخة أعمق للمقارنة — بتشيل حتى "ال" التعريف
    // تحويل الحروف الإنجليزية إلى ما يقابلها بالعربية (عشان لو اسم متسجل بالانجليزي والمايك جابه عربي)
    function englishToArabicPhonetic(text) {
        if (!/[a-zA-Z]/.test(text || '')) return text;

        let t = text.toLowerCase();

        // الحروف المركبة أولاً
        const digraphs = {
            'sh': 'ش', 'ch': 'تش', 'th': 'ث', 
            'kh': 'خ', 'gh': 'غ', 'ph': 'ف',
            'ou': 'و', 'oo': 'و', 'ee': 'ي'
        };
        for (let [eng, ar] of Object.entries(digraphs)) {
            t = t.split(eng).join(ar);
        }

        // الحروف الفردية
        const letters = {
            'a': 'ا', 'b': 'ب', 'c': 'ك', 'd': 'د', 'e': 'ي', 
            'f': 'ف', 'g': 'ج', 'h': 'ه', 'i': 'ي', 'j': 'ج', 
            'k': 'ك', 'l': 'ل', 'm': 'م', 'n': 'ن', 'o': 'و', 
            'p': 'ب', 'q': 'ق', 'r': 'ر', 's': 'س', 't': 'ت', 
            'u': 'و', 'v': 'ف', 'w': 'و', 'x': 'كس', 'y': 'ي', 'z': 'ز'
        };

        return t.split('').map(char => letters[char] || char).join('');
    }

    // نسخة أعمق للمقارنة — بتشيل حتى "ال" التعريف
    function deepNormalize(text) {
        // تحويل أي انجليزي لعربي الأول
        let n = englishToArabicPhonetic(text);
        n = normalizeArabic(n).toLowerCase();
        // شيل "ال" التعريف من أول كل كلمة
        n = n.replace(/\bال/g, '');
        // شيل المسافات الزيادة اللي ممكن تكون ظهرت
        n = n.replace(/\s+/g, ' ').trim();
        return n;
    }

    // ──────────────────────────────────────────────
    // قاموس شامل: كل الأرقام العربية بالكلام (فصحى + عامية مصرية)
    // ──────────────────────────────────────────────
    const arabicNumberWords = {
        // 0-10 (كل الأشكال الممكنة)
        'صفر': 0, 'سيرو': 0, 'زيرو': 0,
        'واحد': 1, 'واحده': 1, 'واحدة': 1,
        'اتنين': 2, 'اثنين': 2, 'اثنان': 2, 'اتنان': 2,
        'تلاته': 3, 'تلاتة': 3, 'ثلاثه': 3, 'ثلاثة': 3, 'ثلاث': 3, 'تلات': 3,
        'اربعه': 4, 'اربعة': 4, 'أربعه': 4, 'أربعة': 4, 'اربع': 4, 'أربع': 4,
        'خمسه': 5, 'خمسة': 5, 'خمس': 5,
        'سته': 6, 'ستة': 6, 'ست': 6,
        'سبعه': 7, 'سبعة': 7, 'سبع': 7,
        'تمنيه': 8, 'تمانيه': 8, 'تمانية': 8, 'ثمانيه': 8, 'ثمانية': 8, 'ثماني': 8, 'تماني': 8, 'ثمانى': 8,
        'تسعه': 9, 'تسعة': 9, 'تسع': 9,
        'عشره': 10, 'عشرة': 10, 'عشر': 10,

        // 11-19 (عامية + فصحى)
        'حداشر': 11, 'احداشر': 11, 'حدعشر': 11, 'احد عشر': 11, 'احدى عشر': 11, 'احدى عشره': 11, 'حداعشر': 11,
        'اطناشر': 12, 'اتناشر': 12, 'اثنى عشر': 12, 'اثني عشر': 12, 'اتناعشر': 12, 'اطناعشر': 12, 'اثنا عشر': 12,
        'تلاتاشر': 13, 'ثلاثتاشر': 13, 'تلتاشر': 13, 'ثلاثه عشر': 13, 'ثلاثة عشر': 13, 'تلاتاعشر': 13,
        'اربعتاشر': 14, 'أربعتاشر': 14, 'اربعه عشر': 14, 'أربعة عشر': 14, 'اربعة عشر': 14, 'اربعطاشر': 14, 'اربعتاعشر': 14,
        'خمستاشر': 15, 'خمسطاشر': 15, 'خمسه عشر': 15, 'خمسة عشر': 15, 'خمستاعشر': 15,
        'ستاشر': 16, 'سطاشر': 16, 'سته عشر': 16, 'ستة عشر': 16, 'ستاعشر': 16,
        'سبعتاشر': 17, 'سبعطاشر': 17, 'سبعه عشر': 17, 'سبعة عشر': 17, 'سبعتاعشر': 17,
        'تمنتاشر': 18, 'تمنطاشر': 18, 'ثمانيه عشر': 18, 'ثمانية عشر': 18, 'ثمانتاشر': 18, 'تمنتاعشر': 18,
        'تسعتاشر': 19, 'تسعطاشر': 19, 'تسعه عشر': 19, 'تسعة عشر': 19, 'تسعتاعشر': 19,

        // العشرات (20-90)
        'عشرين': 20, 'تلاتين': 30, 'ثلاثين': 30,
        'اربعين': 40, 'أربعين': 40,
        'خمسين': 50, 'ستين': 60, 'سبعين': 70,
        'تمانين': 80, 'ثمانين': 80, 'تمنين': 80,
        'تسعين': 90,

        // 100 وما فوق
        'ميه': 100, 'مية': 100, 'مئة': 100, 'مئه': 100, 'ميت': 100
    };

    // ──────────────────────────────────────────────
    // تحويل نص عربي (كلام أو رقم) لعدد
    // بيفهم: "50" / "خمسين" / "خمسه وعشرين" / "٥٠"
    // ──────────────────────────────────────────────
    function parseArabicNumber(text) {
        let cleaned = normalizeArabic(text).trim();

        // حوّل الأرقام العربية/الهندية (٠١٢٣) لأرقام لاتينية
        cleaned = cleaned.replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));

        // لو رقم عادي (1, 50, 100, 7.5 etc.)
        if (/^\d+(\.\d+)?$/.test(cleaned)) {
            return parseFloat(cleaned);
        }

        // لو كلمة عربية واحدة مطابقة بالظبط
        if (arabicNumberWords[cleaned] !== undefined) {
            return arabicNumberWords[cleaned];
        }

        // لو عدد مركب فيه "و" — مثلاً "خمسه وعشرين" → 5 + 20 = 25
        // أو "ثلاثة و ستين" → 3 + 60 = 63
        const wawParts = cleaned.split(/\s*و\s*/);
        if (wawParts.length === 2) {
            const a = arabicNumberWords[wawParts[0].trim()];
            const b = arabicNumberWords[wawParts[1].trim()];
            if (a !== undefined && b !== undefined) {
                return a + b;
            }
        }
        // جرب 3 أجزاء — "ميه و خمسه و عشرين"
        if (wawParts.length === 3) {
            const a = arabicNumberWords[wawParts[0].trim()];
            const b = arabicNumberWords[wawParts[1].trim()];
            const c = arabicNumberWords[wawParts[2].trim()];
            if (a !== undefined && b !== undefined && c !== undefined) {
                return a + b + c;
            }
        }

        return null;
    }

    // ──────────────────────────────────────────────
    // Levenshtein Distance — المسافة بين نصّين (عدد التعديلات المطلوبة)
    // ──────────────────────────────────────────────
    function levenshtein(a, b) {
        const m = a.length, n = b.length;
        if (m === 0) return n;
        if (n === 0) return m;

        // بنستخدم صف واحد بس عشان الذاكرة
        let prev = Array.from({ length: n + 1 }, (_, i) => i);
        let curr = new Array(n + 1);

        for (let i = 1; i <= m; i++) {
            curr[0] = i;
            for (let j = 1; j <= n; j++) {
                const cost = a[i - 1] === b[j - 1] ? 0 : 1;
                curr[j] = Math.min(
                    prev[j] + 1,       // حذف
                    curr[j - 1] + 1,   // إضافة
                    prev[j - 1] + cost  // استبدال
                );
            }
            [prev, curr] = [curr, prev];
        }
        return prev[n];
    }

    // ──────────────────────────────────────────────
    // مقارنة أسماء ذكية — بتاخد في الاعتبار:
    // 1. التشابه الحرفي (Levenshtein) على الاسم كامل
    // 2. تطابق الكلمات منفصلة (اسم أول + اسم عائلة)
    // 3. تطابق جزئي (substring)
    // بترجع نسبة 0 إلى 1
    // ──────────────────────────────────────────────
    function arabicNameSimilarity(spoken, stored) {
        const a = deepNormalize(spoken);
        const b = deepNormalize(stored);

        if (!a || !b) return 0;

        // تطابق كامل بعد التنظيف
        if (a === b) return 1.0;

        // ── الطريقة 1: Levenshtein على الاسم الكامل ──
        const maxLen = Math.max(a.length, b.length);
        const dist = levenshtein(a, b);
        const charSimilarity = maxLen > 0 ? 1 - (dist / maxLen) : 0;

        // ── الطريقة 2: مقارنة كلمة كلمة ──
        const spokenWords = a.split(' ').filter(w => w.length > 0);
        const storedWords = b.split(' ').filter(w => w.length > 0);

        let wordMatchScore = 0;
        if (spokenWords.length > 0 && storedWords.length > 0) {
            let matchedWeight = 0;
            let completelyUnmatched = 0;

            spokenWords.forEach(sw => {
                let bestWordSim = 0;
                storedWords.forEach(stw => {
                    // تطابق كامل
                    if (sw === stw) {
                        bestWordSim = Math.max(bestWordSim, 1.0);
                    }
                    // تطابق جزئي (كلمة داخل كلمة)
                    else if (stw.includes(sw) || sw.includes(stw)) {
                        const overlap = Math.min(sw.length, stw.length) / Math.max(sw.length, stw.length);
                        bestWordSim = Math.max(bestWordSim, 0.7 + (overlap * 0.2));
                    }
                    // Levenshtein على مستوى الكلمة
                    else {
                        const wLen = Math.max(sw.length, stw.length);
                        const wDist = levenshtein(sw, stw);
                        const wSim = 1 - (wDist / wLen);
                        // نقبل لو حرف أو اتنين غلط بس
                        if (wDist <= 2 && wSim > 0.5) {
                            bestWordSim = Math.max(bestWordSim, wSim * 0.85);
                        }
                    }
                });

                matchedWeight += bestWordSim;

                // لو الكلمة المنطوقة دي ملهاش أي تقارب مع أي جزء من الاسم المخزن
                if (bestWordSim < 0.3) {
                    completelyUnmatched++;
                }
            });

            wordMatchScore = matchedWeight / spokenWords.length;

            // عقاب صارم لو في كلمات اتقالت ملهاش أي علاقة بالاسم
            // ده عشان نمنع "فريده السكري" تتطابق مع "فريده وائل"
            if (completelyUnmatched > 0) {
                wordMatchScore = wordMatchScore * Math.pow(0.6, completelyUnmatched);
            }
        }

        // ── الطريقة 3: واحد يحتوي التاني (substring) ──
        let substringBonus = 0;
        // بنعطي بونص بس لو مفيش كلمات مختلفة تماماً (عشان نتجنب نفس المشكلة)
        if ((b.includes(a) || a.includes(b)) && wordMatchScore >= 0.5) {
            substringBonus = 0.85;
        }

        // الدرجة النهائية = أعلى واحدة من التلاتة
        return Math.max(charSimilarity, wordMatchScore, substringBonus);
    }


    // Split a transcript into a mark and the name part, then find the closest student
    function parse(transcript, students) {
        const cleaned = String(transcript || '').trim();
        let score = null, namepart = '';
        const allDigits = [...cleaned.matchAll(/(\d+(\.\d+)?)/g)];
        if (allDigits.length > 0) {
            const last = allDigits[allDigits.length - 1];
            score = parseFloat(last[1]);
            const idx = cleaned.lastIndexOf(last[0]);
            namepart = cleaned.substring(0, idx).trim() || cleaned.substring(idx + last[0].length).trim();
        }
        if (score === null) {
            const words = cleaned.split(/\s+/);
            for (let n = 5; n >= 1 && score === null; n--) {
                if (words.length < n + 1) continue;
                const v = parseArabicNumber(words.slice(-n).join(' '));
                if (v !== null) { score = v; namepart = words.slice(0, -n).join(' ').trim(); }
            }
            for (let n = 5; n >= 1 && score === null; n--) {
                if (words.length < n + 1) continue;
                const v = parseArabicNumber(words.slice(0, n).join(' '));
                if (v !== null) { score = v; namepart = words.slice(n).join(' ').trim(); }
            }
        }
        if (score === null) return { error: 'no-score', heard: cleaned };
        if (!namepart) return { error: 'no-name', heard: cleaned, score };
        let best = null, bestSim = 0;
        students.forEach(s => {
            const sim = Math.max(arabicNameSimilarity(namepart, `${s.firstName} ${s.lastName}`), arabicNameSimilarity(namepart, s.firstName) * 0.95);
            if (sim > bestSim) { bestSim = sim; best = s; }
        });
        if (!best || bestSim < 0.4) return { error: 'no-match', heard: cleaned, score, namepart };
        return { student: best, score, similarity: bestSim, heard: cleaned };
    }

    // Listen once; calls back with the final transcript (or an error code)
    function listen({ onInterim, onFinal, onError }) {
        const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SR) { onError && onError('unsupported'); return null; }
        const r = new SR();
        r.lang = 'ar-EG'; r.continuous = false; r.interimResults = true; r.maxAlternatives = 5;
        r.onresult = (event) => {
            let fin = '', interim = '';
            for (let i = event.resultIndex; i < event.results.length; i++) {
                if (event.results[i].isFinal) fin += event.results[i][0].transcript; else interim += event.results[i][0].transcript;
            }
            if (interim && onInterim) onInterim(interim);
            if (fin && onFinal) onFinal(fin);
        };
        r.onerror = (e) => onError && onError(e.error);
        r.start();
        return r;
    }

    window.VoiceGrading = { parse, listen, supported: !!(window.SpeechRecognition || window.webkitSpeechRecognition) };
})();
