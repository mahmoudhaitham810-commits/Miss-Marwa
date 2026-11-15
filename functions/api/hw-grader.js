// =====================================================================
// Homework grading pipeline (shared by the student API, the staff API and
// the background queue).
//
//   Step A — Vision read: Workers AI reads ONE page per unit of work and
//            returns the student's answers per "section.question" label.
//   Step B — Scoring: code marks MCQ / True-False / Short answers against the
//            approved key (normalised + typo-tolerant); essays (and short
//            answers code can't match) → Workers AI says which KEY IDEAS are
//            present, code adds the points. Same answer → same mark, always.
//
// Each call to gradeStep() does one unit (read a page / check concepts / finish)
// so the student sees real progress, and any unit can be resumed later
// (daily free allowance used up → "queued", picked up after the reset).
// =====================================================================
import { runAI, parseJsonLoose, readPrompt, conceptPrompt, weaknessPrompt, AiQuotaError, AiUnavailableError, quotaHitToday, aiReady } from './ai-engine.js';
import { mediaInfo, mediaResponse } from './media-store.js';

export const RELEASE_KEY = 'hw_release_mode';            // 'confirm' (staff confirm first) | 'instant'
export async function releaseMode(db) {
    try { const r = await db.prepare(`SELECT value FROM app_kv WHERE "key" = ?`).bind(RELEASE_KEY).first(); return r && r.value === 'instant' ? 'instant' : 'confirm'; }
    catch (e) { return 'confirm'; }
}

// ---------------- normalising answers ----------------
const AR_DIAC = /[ؐ-ًؚ-ٰٟۖ-ۭـ]/g;
export function norm(s) {
    return String(s ?? '').toLowerCase()
        .replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 0x06F0))
        .replace(AR_DIAC, '').replace(/[إأآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي')
        .replace(/[^\p{L}\p{N}%°Ω+\-×÷=/.]+/gu, ' ').replace(/\s+/g, ' ').trim().replace(/^(the|a|an) /, '').replace(/[.]+$/, '');
}
function lev(a, b) {
    if (a === b) return 0; if (!a.length) return b.length; if (!b.length) return a.length;
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
        const cur = [i];
        for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        prev = cur;
    }
    return prev[b.length];
}
export function close(a, b) {
    const x = norm(a), y = norm(b);
    if (!x || !y) return false;
    if (x === y) return true;
    const longer = Math.max(x.length, y.length);
    if (longer >= 5 && lev(x, y) / longer <= 0.2) return true;          // small spelling mistakes
    return false;
}
const LETTER = /^\(?([a-f])\)?[.)]?$/i;
function letterOf(s) {
    const t = norm(s).replace(/\s/g, '');
    const m = t.match(LETTER); if (m) return m[1].toLowerCase();
    const ar = { 'ا': 'a', 'ب': 'b', 'ج': 'c', 'د': 'd', 'ه': 'e', 'و': 'f' };   // أ ب ج د
    return ar[t] || null;
}
function tfOf(s) {
    const t = norm(s);
    if (/^(true|t|right|correct|yes|✓|✔|صح|صحيح|ص)$/.test(t) || /[✓✔]/.test(String(s))) return 'true';
    if (/^(false|f|wrong|no|x|×|✗|✘|خطا|خطأ|غلط|خ)$/.test(t) || /[✗✘×]/.test(String(s))) return 'false';
    return null;
}

/**
 * Deterministic marking of one answer. q = key question (with extra fields), a = {answer, correction, legible} | undefined
 * Returns { verdict: correct|partial|wrong|blank|unreadable, points, needsAI }
 */
export function scoreOne(q, a) {
    const full = Number(q.points) || 0;
    if (!a || (!String(a.answer ?? '').trim() && !String(a.correction ?? '').trim())) return a && a.legible === false ? { verdict: 'unreadable', points: 0 } : { verdict: 'blank', points: 0 };
    if (a.legible === false) return { verdict: 'unreadable', points: 0 };
    const ans = String(a.answer ?? '');
    if (q.type === 'mcq') {
        const l = letterOf(ans);
        if (l) return l === String(q.answer || '').toLowerCase() ? { verdict: 'correct', points: full } : { verdict: 'wrong', points: 0 };
        // student wrote the option's words instead of the letter
        if (q.answerText && close(ans, q.answerText)) return { verdict: 'correct', points: full };
        if (Array.isArray(q.options) && q.options.length) {
            const idx = q.options.findIndex(o => close(ans, o));
            if (idx >= 0) return String.fromCharCode(97 + idx) === String(q.answer || '').toLowerCase() ? { verdict: 'correct', points: full } : { verdict: 'wrong', points: 0 };
        }
        return { verdict: 'wrong', points: 0, needsAI: !!q.answerText };
    }
    if (q.type === 'tf') {
        const v = tfOf(ans);
        if (!v) return { verdict: 'unreadable', points: 0 };
        if (v !== q.answer) return { verdict: 'wrong', points: 0 };
        if (q.answer === 'false' && q.correction) {   // ✗ earns half, the right correction the other half
            const corr = String(a.correction || '').trim();
            if (corr && (close(corr, q.correction) || norm(corr).includes(norm(q.correction)))) return { verdict: 'correct', points: full };
            return { verdict: 'partial', points: Math.round(full / 2 * 100) / 100, needsAI: !!corr };
        }
        return { verdict: 'correct', points: full };
    }
    if (q.type === 'short') {
        const accepted = [q.answer, ...(q.alternatives || [])].filter(Boolean);
        if (accepted.some(x => close(ans, x))) return { verdict: 'correct', points: full };
        if (accepted.some(x => norm(x).length >= 3 && norm(ans).split(' ').length <= norm(x).split(' ').length + 3 && norm(ans).includes(norm(x)))) return { verdict: 'correct', points: full };
        return { verdict: 'wrong', points: 0, needsAI: true };   // maybe a valid synonym — let the concept check decide
    }
    // essay
    return { verdict: 'pending', points: 0, needsAI: true };
}

/**
 * A choose answer as read from the photo → one letter we can trust, or a reason for staff to look.
 * The reader gives the circled letter(s) AND the printed words inside the circle; when the two
 * disagree the words win (letters are what vision models guess, the words are what they see).
 */
export function reconcileMcq(q, a) {
    if (!a || q.type !== 'mcq') return a;
    const letters = (Array.isArray(a.circled) ? a.circled : a.circled ? [a.circled] : []).map(x => letterOf(String(x))).filter(Boolean);
    const uniq = [...new Set(letters)];
    const text = String(a.circled_text || a.circledText || '').trim();
    const opts = Array.isArray(q.options) ? q.options : [];
    let byText = '';
    if (text && opts.length) {
        const idx = opts.findIndex(o => close(text, o) || (norm(o).length >= 2 && norm(text) === norm(o)));
        if (idx >= 0) byText = 'abcdef'[idx];
    }
    if (uniq.length > 1) return { ...a, answer: uniq.join('+'), legible: true, multi: true, check: 'Two or more choices circled' };
    const letter = uniq[0] || letterOf(String(a.answer || '')) || '';
    if (byText && letter && byText !== letter) return { ...a, answer: byText, legible: true, check: `Letter (${letter}) and circled words (${byText}) disagree — used the words` };
    if (byText) return { ...a, answer: byText, legible: a.legible !== false };
    if (letter) return { ...a, answer: letter };
    return { ...a, answer: text || String(a.answer || '') };
}

// ---------------- loading ----------------
export function keyOut(q) {
    let extra = {}; try { extra = JSON.parse(q.extra || '{}'); } catch (e) { }
    return { id: q.id, label: q.label, type: q.type, prompt: q.prompt || '', points: q.points, answer: q.answer || '', ...extra };
}
export async function loadKey(db, assignmentId) {
    const { results } = await db.prepare('SELECT * FROM hw_questions WHERE assignment_id = ? ORDER BY ord, id').bind(assignmentId).all();
    return (results || []).map(keyOut);
}
async function pagesOf(db, subId) {
    const { results } = await db.prepare('SELECT * FROM hw_pages WHERE submission_id = ? ORDER BY page_no').bind(subId).all();
    return results || [];
}
async function pageDataUrl(env, db, mediaId) {
    const info = await mediaInfo(db, mediaId);
    if (!info) return null;
    const res = await mediaResponse(env, db, info, { cache: 'no-store' });
    if (!res) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    let s = ''; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
    return `data:${info.mime};base64,${btoa(s)}`;
}

// lock one submission for one unit of work (so the student's browser and the background job never do the same AI call twice)
async function lock(db, subId, seconds = 120) {
    const r = await db.prepare(`UPDATE hw_submissions SET lock_until = datetime('now', ?) WHERE id = ? AND (lock_until IS NULL OR lock_until < datetime('now'))`).bind(`+${seconds} seconds`, subId).run();
    return !!(r.meta && r.meta.changes);
}
const unlock = (db, subId) => db.prepare('UPDATE hw_submissions SET lock_until = NULL WHERE id = ?').bind(subId).run();

/**
 * Do the next unit of grading for a submission.
 * Returns { stage, page, pages, status, done, queued, busy }.
 */
export async function gradeStep(env, db, subId) {
    const sub = await db.prepare('SELECT * FROM hw_submissions WHERE id = ?').bind(subId).first();
    if (!sub) return { error: 'not found' };
    if (!['grading', 'queued'].includes(sub.status)) return { done: true, status: sub.status };
    const pages = await pagesOf(db, subId);
    const total = pages.length;
    if (!aiReady(env)) { await setQueued(db, subId, 'Workers AI is not connected'); return { queued: true, reason: 'ai-off', pages: total }; }
    if (await quotaHitToday(db)) { await setQueued(db, subId, 'Daily free AI allowance used up'); return { queued: true, reason: 'quota', pages: total }; }
    if (!(await lock(db, subId))) return { busy: true, stage: 'working', pages: total };
    try {
        if (sub.status === 'queued') await db.prepare(`UPDATE hw_submissions SET status = 'grading', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(subId).run();
        const key = await loadKey(db, sub.assignment_id);
        // ---- Step A: next unread page ----
        const next = pages.find(p => p.status !== 'read');
        if (next) {
            const img = await pageDataUrl(env, db, next.media_id);
            let read = { answers: [], page_readable: false, notes: 'page image missing' };
            if (img) {
                const out = await runAI(env, db, { image: img, prompt: readPrompt({ key, pageNo: next.page_no, pages: total }), maxTokens: 2048 });
                const j = parseJsonLoose(out.text);
                read = j && Array.isArray(j.answers) ? j : { answers: [], page_readable: false, notes: 'could not understand the reply', raw: String(out.text).slice(0, 2000) };
            }
            await db.prepare(`UPDATE hw_pages SET status = 'read', read_json = ? WHERE id = ?`).bind(JSON.stringify(read), next.id).run();
            const done = pages.filter(p => p.status === 'read').length + 1;
            return { stage: 'reading', page: done, pages: total };
        }
        // ---- Step B: score ----
        const reads = pages.map(p => { try { return JSON.parse(p.read_json || '{}'); } catch (e) { return {}; } });
        const byLabel = {};
        for (const r of reads) for (const a of (r.answers || [])) {
            const lab = String(a.label || '').trim(); if (!lab) continue;
            const prev = byLabel[lab];
            const better = !prev || (prev.legible === false && a.legible !== false) || (!String(prev.answer || '').trim() && String(a.answer || '').trim());
            if (better) byLabel[lab] = a;
        }
        for (const q of key) if (byLabel[q.label]) byLabel[q.label] = reconcileMcq(q, byLabel[q.label]);
        const results = key.map(q => {
            const a = byLabel[q.label];
            if (a && a.multi) return { q, a, verdict: 'wrong', points: 0, check: a.check };     // two circles never earn the mark
            return { q, a, ...scoreOne(q, a), check: a && a.check };
        });
        const aiItems = results.filter(r => r.needsAI && r.a && String(r.a.answer || r.a.correction || '').trim());
        let feedback = {};
        if (aiItems.length) {
            const items = aiItems.map(r => ({
                label: r.q.label, question: r.q.prompt,
                model: r.q.type === 'essay' ? r.q.modelAnswer : r.q.type === 'tf' ? `False. Correct statement uses "${r.q.correction}"` : r.q.type === 'mcq' ? r.q.answerText : [r.q.answer, ...(r.q.alternatives || [])].join(' / '),
                ideas: r.q.type === 'essay' && (r.q.ideas || []).length ? r.q.ideas.map(i => i.text) : [r.q.type === 'tf' ? `the correction means "${r.q.correction}"` : `same meaning as "${r.q.type === 'mcq' ? r.q.answerText : r.q.answer}"`],
                student: r.q.type === 'tf' ? r.a.correction : r.a.answer
            }));
            for (let i = 0; i < items.length; i += 8) {
                const part = items.slice(i, i + 8);
                const out = await runAI(env, db, { prompt: conceptPrompt(part), maxTokens: 1500 });
                const j = parseJsonLoose(out.text);
                for (const x of (j && j.results) || []) feedback[String(x.label)] = x;
            }
        }
        let score = 0, review = false;
        const answerStmts = [];
        for (const r of results) {
            let { verdict, points } = r;
            let evidence = null, fb = null;
            const f = feedback[r.q.label];
            if (r.needsAI && f) {
                const found = new Set((f.ideas_found || []).map(Number).filter(n => n >= 1));
                evidence = f.evidence || null; fb = f.feedback || null;
                if (r.q.type === 'essay') {
                    const ideas = r.q.ideas || [];
                    points = Math.round(ideas.reduce((t, it, i) => t + (found.has(i + 1) ? Number(it.points) || 0 : 0), 0) * 100) / 100;
                    verdict = points >= r.q.points - 0.001 ? 'correct' : points > 0 ? 'partial' : 'wrong';
                } else if (found.size) {
                    if (r.q.type === 'tf') { points = r.q.points; verdict = 'correct'; }
                    else { points = r.q.points; verdict = 'correct'; }
                }
            } else if (verdict === 'pending') { verdict = r.a ? 'wrong' : 'blank'; }
            if (verdict === 'unreadable' || r.check) review = true;
            if (r.a && r.a.multi && !fb) fb = 'You circled more than one choice — circle only one.';
            score += points;
            answerStmts.push(db.prepare(`INSERT INTO hw_answers (submission_id, question_id, transcript, verdict, points, ai_points, evidence, confidence, feedback)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(submission_id, question_id) DO UPDATE SET transcript = excluded.transcript, verdict = excluded.verdict,
                points = excluded.points, ai_points = excluded.ai_points, evidence = excluded.evidence, confidence = excluded.confidence, feedback = excluded.feedback, override_points = NULL`)
                .bind(subId, r.q.id, r.a ? JSON.stringify({ answer: r.a.answer ?? '', correction: r.a.correction ?? '', ...(r.a.circled_text ? { circledText: String(r.a.circled_text).slice(0, 200) } : {}), ...(r.check ? { check: r.check } : {}) }) : null, verdict, points, points, evidence, r.a && r.a.legible === false ? 0 : 1, fb));
        }
        score = Math.round(score * 100) / 100;
        const unreadablePages = reads.filter(r => r.page_readable === false).length;
        const seen = results.filter(r => r.a).length;
        const unreadable = unreadablePages > 0 || (key.length >= 4 && seen < key.length * 0.4) ? 1 : 0;
        if (unreadable) review = true;
        const mode = await releaseMode(db);
        const status = review ? 'needs_review' : mode === 'instant' ? 'graded' : 'pending';
        answerStmts.push(db.prepare(`UPDATE hw_submissions SET status = ?, auto_score = ?, final_score = ?, unreadable = ?, graded_at = CURRENT_TIMESTAMP,
            released_at = ${status === 'graded' ? 'CURRENT_TIMESTAMP' : 'NULL'}, ai_error = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(status, score, score, unreadable, subId));
        await db.batch(answerStmts);
        return { done: true, stage: 'done', status, pages: total, released: status === 'graded' };
    } catch (e) {
        if (e instanceof AiQuotaError) { await setQueued(db, subId, e.message); return { queued: true, reason: 'quota', pages: total }; }
        if (e instanceof AiUnavailableError) { await setQueued(db, subId, e.message); return { queued: true, reason: 'ai-off', pages: total }; }
        await db.prepare(`UPDATE hw_submissions SET ai_error = ?, tries = COALESCE(tries, 0) + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(String(e.message || e).slice(0, 500), subId).run();
        const t = await db.prepare('SELECT tries FROM hw_submissions WHERE id = ?').bind(subId).first();
        if (t && t.tries >= 4) {   // keep failing → a person looks at it (nothing is lost; pages are kept)
            await db.prepare(`UPDATE hw_submissions SET status = 'needs_review', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(subId).run();
            return { done: true, status: 'needs_review', error: e.message };
        }
        return { error: e.message, retry: true, pages: total };
    } finally {
        await unlock(db, subId).catch(() => { });
    }
}
async function setQueued(db, subId, why) {
    await db.prepare(`UPDATE hw_submissions SET status = 'queued', ai_error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status IN ('grading', 'queued')`).bind(why, subId).run();
}

/** Background: continue queued / stalled submissions (called lazily from page loads). */
export async function processQueue(env, db, maxUnits = 3, origin = '') {
    if (!aiReady(env) || await quotaHitToday(db)) return { units: 0 };
    const { results } = await db.prepare(`SELECT id FROM hw_submissions WHERE (status = 'queued' OR (status = 'grading' AND updated_at < datetime('now', '-3 minutes')))
        AND (lock_until IS NULL OR lock_until < datetime('now')) ORDER BY submitted_at LIMIT 3`).all();
    let units = 0;
    for (const s of results || []) {
        while (units < maxUnits) {
            const r = await gradeStep(env, db, s.id);
            units++;
            if (r.done && r.released) {     // marked in the background → tell the student
                const x = await db.prepare('SELECT s.student_id, s.assignment_id, a.title FROM hw_submissions s JOIN hw_assignments a ON a.id = s.assignment_id WHERE s.id = ?').bind(s.id).first();
                if (x) await pushToStudent(env, origin, x.student_id, 'نتيجة الواجب جاهزة ✅', `${x.title} — افتح التطبيق وشوف درجتك`, '/homework.html?id=' + x.assignment_id);
            }
            if (r.done || r.queued || r.busy || r.error) break;
        }
        if (units >= maxUnits) break;
    }
    return { units };
}

// ---------------- results for screens ----------------
export async function resultOf(db, subId, { forStudent = false } = {}) {
    const sub = await db.prepare(`SELECT s.*, a.title, a.unit, a.lesson, a.grade, a.total_score, a.deadline FROM hw_submissions s JOIN hw_assignments a ON a.id = s.assignment_id WHERE s.id = ?`).bind(subId).first();
    if (!sub) return null;
    const key = await loadKey(db, sub.assignment_id);
    const { results } = await db.prepare('SELECT * FROM hw_answers WHERE submission_id = ?').bind(subId).all();
    const byQ = {}; (results || []).forEach(a => { byQ[a.question_id] = a; });
    const released = !!sub.released_at;
    const showScore = !forStudent || released;
    const items = key.map(q => {
        const a = byQ[q.id];
        let t = {}; try { t = a && a.transcript ? JSON.parse(a.transcript) : {}; } catch (e) { }
        const pts = a ? (a.override_points != null ? a.override_points : a.points) : 0;
        const verdict = a ? (a.override_points != null ? (a.override_points >= q.points - 0.001 ? 'correct' : a.override_points > 0 ? 'partial' : 'wrong') : a.verdict) : 'blank';
        return {
            questionId: q.id, label: q.label, type: q.type, question: q.prompt, points: q.points,
            ...(showScore ? {
                verdict, earned: pts, aiPoints: a ? a.ai_points : null, overridden: !!(a && a.override_points != null),
                yourAnswer: t.answer ?? '', yourCorrection: t.correction ?? '', evidence: a ? a.evidence : null, feedback: a ? a.feedback : null,
                modelAnswer: modelAnswerText(q), explanation: q.explanation || '', confidence: a ? a.confidence : null,
                ...(forStudent ? {} : { check: t.check || null, circledText: t.circledText || null })
            } : {})
        };
    });
    return {
        id: sub.id, assignmentId: sub.assignment_id, studentId: sub.student_id, status: sub.status, released,
        title: sub.title, unit: sub.unit, lesson: sub.lesson, grade: sub.grade, total: sub.total_score,
        score: showScore ? sub.final_score : null, autoScore: forStudent ? undefined : sub.auto_score,
        late: !!sub.late, pages: sub.pages, unreadable: !!sub.unreadable, reuploads: sub.reuploads, receipt: sub.receipt_code,
        submittedAt: sub.submitted_at, gradedAt: sub.graded_at, releasedAt: sub.released_at, deadline: sub.deadline, error: forStudent ? undefined : sub.ai_error,
        items
    };
}
export function modelAnswerText(q) {
    if (q.type === 'mcq') return `(${String(q.answer || '').toLowerCase()})${q.answerText ? ' ' + q.answerText : (Array.isArray(q.options) && q.options.length ? ' ' + (q.options[String(q.answer || 'a').toLowerCase().charCodeAt(0) - 97] || '') : '')}`.trim();
    if (q.type === 'tf') return q.answer === 'true' ? '✓ True' : `✗ False${q.correction ? ' — ' + q.correction : ''}`;
    if (q.type === 'short') return q.answer || '';
    return q.modelAnswer || (q.ideas || []).map(i => i.text).join(' — ');
}

// ---------------- WhatsApp weakness report ----------------
const LRM = '‎', RLM = '‏';
const iso = (v) => { const t = String(v ?? '').trim(); return /[؀-ۿ]/.test(t) ? t : `${LRM}${t}${LRM}`; };
const rtl = (lines) => lines.map(l => (l ? RLM + l : l)).join('\n');
const pctTxt = (p) => `${LRM}${Math.round(p)}%${LRM}`;
function levelAr(p) { return p >= 85 ? 'ممتاز' : p >= 70 ? 'جيد' : p >= 50 ? 'متوسط' : 'يحتاج متابعة'; }

/** Builds (and caches) the WhatsApp summary. Uses Workers AI for the "focus" diagnosis; falls back to a plain list if AI is unavailable. */
export async function weaknessReport(env, db, subId, { refresh = false } = {}) {
    const r = await resultOf(db, subId);
    if (!r) return null;
    const st = await db.prepare('SELECT student_id, first_name, last_name, gender, phone, parent_phone FROM students WHERE student_id = ?').bind(r.studentId).first() || {};
    const sub = await db.prepare('SELECT report FROM hw_submissions WHERE id = ?').bind(subId).first();
    const missed = r.items.filter(i => i.verdict !== 'correct');
    let diag = null;
    try { diag = sub && sub.report && !refresh ? JSON.parse(sub.report) : null; } catch (e) { diag = null; }
    if (!diag && missed.length && aiReady(env) && !(await quotaHitToday(db))) {
        try {
            const out = await runAI(env, db, { prompt: weaknessPrompt({ title: r.title, missed: missed.slice(0, 15).map(m => ({ label: m.label, question: m.question, right: m.modelAnswer, student: m.yourAnswer })) }), maxTokens: 600, temperature: 0.2 });
            const j = parseJsonLoose(out.text);
            if (j && Array.isArray(j.focus)) diag = { focus: j.focus.map(x => String(x).slice(0, 160)).slice(0, 3), summary: String(j.summary || '').slice(0, 200), at: new Date().toISOString() };
        } catch (e) { diag = null; }
        if (diag) await db.prepare('UPDATE hw_submissions SET report = ? WHERE id = ?').bind(JSON.stringify(diag), subId).run();
    }
    const f = String(st.gender || '').toLowerCase() === 'female';
    const name = `${st.first_name || ''} ${st.last_name || ''}`.trim();
    const p = r.total ? (Number(r.score) || 0) / r.total * 100 : 0;
    const lines = [
        'السلام عليكم — تيم مس مروة 👋',
        `ولي أمر ${f ? 'الطالبة' : 'الطالب'}: ${iso(name)}`,
        `تقرير واجب: ${iso(r.title)}`,
        '',
        `📝 الدرجة: ${iso(`${r.score}/${r.total}`)} (${pctTxt(p)} — ${levelAr(p)})`,
        `${r.late ? '⏰ تم التسليم بعد الموعد' : '✅ تم التسليم في الموعد'}`
    ];
    if (missed.length) {
        lines.push('', '❌ أسئلة محتاجة مراجعة:');
        missed.slice(0, 6).forEach(m => {
            lines.push(`• ${iso(m.label)}: الإجابة الصحيحة ${iso(m.modelAnswer)}`);
            if (m.explanation) lines.push(`   ${iso(m.explanation.slice(0, 140))}`);
        });
        if (missed.length > 6) lines.push(`• و${iso(String(missed.length - 6))} أسئلة أخرى`);
    } else lines.push('', `🌟 كل الإجابات صحيحة — برافو ${iso(st.first_name || '')}!`);
    if (diag && diag.focus && diag.focus.length) {
        lines.push('', '🎯 نقاط محتاجة تركيز:');
        diag.focus.forEach(x => lines.push(`• ${iso(x)}`));
    }
    lines.push('', 'برجاء المتابعة.');
    return { text: rtl(lines), focus: diag ? diag.focus : [], summary: diag ? diag.summary : '', student: { id: st.student_id, name, phone: st.phone, parentPhone: st.parent_phone, gender: st.gender } };
}

// Not a page — shared module.
export async function onRequest() { return new Response('Not found', { status: 404 }); }

// ---------------- housekeeping + notifications ----------------
// Homework page photos are deleted 60 days after upload (scores, transcripts and marks stay). Once a day, lazily.
export const HW_MEDIA_KEEP_DAYS = 60;
export async function purgeHomeworkMedia(env, db) {
    const { deleteMedia } = await import('./media-store.js');
    await db.prepare(`INSERT OR IGNORE INTO app_kv ("key", value) VALUES ('hw_media_purge', '2000-01-01 00:00:00')`).run();
    const claim = await db.prepare(`UPDATE app_kv SET value = datetime('now'), updated_at = CURRENT_TIMESTAMP WHERE "key" = 'hw_media_purge' AND value <= datetime('now', '-1 day')`).run();
    if (!claim.meta || !claim.meta.changes) return null;
    const { results } = await db.prepare(`SELECT id FROM media_objects WHERE kind = 'hw' AND created_at < datetime('now', ?) LIMIT 2000`).bind(`-${HW_MEDIA_KEEP_DAYS} days`).all();
    const ids = (results || []).map(r => r.id);
    for (let i = 0; i < ids.length; i += 90) {
        const part = ids.slice(i, i + 90);
        await db.prepare(`UPDATE hw_pages SET media_id = NULL WHERE media_id IN (${part.map(() => '?').join(',')})`).bind(...part).run();
    }
    return deleteMedia(env, db, ids);
}
// push to one student (OneSignal tag "sid", set by the student portal)
export async function pushToStudent(env, origin, studentId, title, message, path = '/homework.html') {
    const appId = env.ONESIGNAL_APP_ID, apiKey = env.ONESIGNAL_REST_API_KEY;
    if (!appId || !apiKey || !studentId) return;
    try {
        await fetch('https://api.onesignal.com/notifications', {
            method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8', 'Authorization': `Key ${apiKey}` },
            body: JSON.stringify({ app_id: appId, target_channel: 'push', headings: { en: title, ar: title }, contents: { en: message, ar: message },
                filters: [{ field: 'tag', key: 'sid', relation: '=', value: String(studentId) }], web_url: `${origin}${path}` })
        });
    } catch (e) { /* notifications are best-effort */ }
}
