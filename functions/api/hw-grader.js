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
import { runAI, parseJsonLoose, readPrompt, conceptPrompt, weaknessPrompt, assistPrompt, chatPrompt, writtenReadPrompt, AiQuotaError, AiUnavailableError, quotaHitToday, aiReady, textModel, visionModel } from './ai-engine.js';
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
        if (q.answer === 'false' && q.requiresCorrection === false) return { verdict: 'correct', points: full };   // no correction asked → ✗ is enough
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
        if (sub.mode === 'web') return await webStep(env, db, sub, key, pages);
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
    await autoSubmitExpired(env, db).catch(() => null);
    let units = 0;
    if (aiReady(env) && !(await quotaHitToday(db))) {
        const { results } = await db.prepare(`SELECT id FROM hw_submissions WHERE (status = 'queued' OR (status = 'grading' AND updated_at < datetime('now', '-3 minutes')))
            AND (lock_until IS NULL OR lock_until < datetime('now')) ORDER BY submitted_at LIMIT 3`).all();
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
        // AI Assistant walkthroughs waiting for the allowance / left mid-way
        const { results: wait } = await db.prepare(`SELECT id FROM hw_submissions WHERE assist_status = 'queued' OR (assist_status = 'working' AND assist_lock < datetime('now')) ORDER BY updated_at LIMIT 2`).all();
        for (const w of wait || []) { if (units >= maxUnits + 2) break; await ensureAssist(env, db, w.id).catch(() => null); units++; }
    }
    // ready but the student never saw it (left the page / generated in the background) → notify once
    const { results: unseen } = await db.prepare(`SELECT s.id, s.student_id, s.assignment_id, a.title FROM hw_submissions s JOIN hw_assignments a ON a.id = s.assignment_id
        WHERE s.assist_status = 'ready' AND s.updated_at < datetime('now', '-90 seconds') LIMIT 5`).all();
    for (const x of unseen || []) {
        const claim = await db.prepare(`UPDATE hw_submissions SET assist_status = 'notified' WHERE id = ? AND assist_status = 'ready'`).bind(x.id).run();
        if (claim.meta && claim.meta.changes) await pushToStudent(env, origin, x.student_id, 'مساعدك الذكي جهّز شرح أخطائك 🤖', `${x.title} — افتح وشوف الشرح`, `/homework.html?id=${x.assignment_id}&tab=assistant`);
    }
    return { units };
}
/** Time window over (or homework closed with a saved draft) → submit what the student saved. */
export async function autoSubmitExpired(env, db) {
    const { results } = await db.prepare(`SELECT s.*, a.id AS a_id FROM hw_submissions s JOIN hw_assignments a ON a.id = s.assignment_id
        WHERE s.status = 'uploading' AND s.mode = 'web' AND ((s.ends_at IS NOT NULL AND s.ends_at < datetime('now', '-2 minutes'))
        OR (s.draft IS NOT NULL AND a.closes_at IS NOT NULL AND a.closes_at < datetime('now'))) LIMIT 5`).all();
    for (const s of results || []) {
        const a = await db.prepare('SELECT * FROM hw_assignments WHERE id = ?').bind(s.assignment_id).first();
        let answers = {}; try { answers = JSON.parse(s.draft || '{}'); } catch (e) { }
        const out = await submitWeb(env, db, s, a, answers, { auto: true });
        if (out.deferred) await markWritten(env, db, s.id).catch(() => null);
    }
    return (results || []).length;
}

// =====================================================================
// Website answering (answer_mode 'web')
//   submit → code marks Choose / ✓✗ / Complete at once (0 AI units);
//   written answers (and Complete answers code can't match) are "deferred":
//   AI checks them in the background, then staff Accept / Edit before the
//   student and parent see them.
// =====================================================================
const RCPT = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export async function newReceipt(db) {
    for (let k = 0; k < 6; k++) {
        const b = crypto.getRandomValues(new Uint8Array(6));
        const c = [...b].map(x => RCPT[x % RCPT.length]).join('');
        if (!(await db.prepare('SELECT 1 FROM hw_submissions WHERE receipt_code = ?').bind(c).first())) return c;
    }
    return null;
}
const clip = (v, n) => String(v ?? '').replace(/\r/g, '').trim().slice(0, n);
export const isWeb = (a) => (a && (a.answer_mode || 'photo')) === 'web';
const nowMs = () => Date.now();
const msOf = (v) => (v ? new Date(String(v).replace(' ', 'T') + (/[zZ]$/.test(String(v)) ? '' : 'Z')).getTime() : NaN);

/** Answers map {label: {answer, correction}} from a student → marks + submission row. Returns the new status. */
export async function submitWeb(env, db, sub, a, answers, { auto = false } = {}) {
    const key = await loadKey(db, a.id);
    const pages = await pagesOf(db, sub.id);
    const photoLabels = new Set(pages.flatMap(p => String(p.labels || '').split(',').map(x => x.trim()).filter(Boolean)));
    const stmts = [];
    let objective = 0, provisional = 0, deferredN = 0;
    for (const q of key) {
        const raw = (answers && answers[q.label]) || {};
        const ans = { answer: clip(raw.answer, q.type === 'essay' ? 3000 : 300), correction: clip(raw.correction, 300), legible: true };
        const photo = photoLabels.has(q.label) && ['essay', 'short'].includes(q.type);
        let r = q.type === 'essay' ? { verdict: 'pending', points: 0, needsAI: true } : scoreOne(q, ans);
        let deferred = 0;
        if (q.type === 'essay' && !ans.answer && !photo) r = { verdict: 'blank', points: 0 };
        else if (r.needsAI || r.verdict === 'pending' || (photo && !ans.answer)) deferred = 1;
        if (deferred) { deferredN++; provisional += r.points || 0; } else objective += r.points || 0;
        stmts.push(db.prepare(`INSERT INTO hw_answers (submission_id, question_id, transcript, verdict, points, ai_points, confidence, deferred, feedback, evidence, override_points)
            VALUES (?, ?, ?, ?, ?, ?, 1, ?, NULL, NULL, NULL) ON CONFLICT(submission_id, question_id) DO UPDATE SET transcript = excluded.transcript, verdict = excluded.verdict,
            points = excluded.points, ai_points = excluded.ai_points, deferred = excluded.deferred, feedback = NULL, evidence = NULL, override_points = NULL`)
            .bind(sub.id, q.id, JSON.stringify({ answer: ans.answer, correction: ans.correction, typed: true, ...(photo ? { photo: true } : {}) }),
                deferred ? 'pending' : r.verdict, r.points || 0, r.points || 0, deferred));
    }
    objective = Math.round(objective * 100) / 100;
    const score = Math.round((objective + provisional) * 100) / 100;
    const late = msOf(a.deadline) < nowMs() ? 1 : 0;
    const code = sub.receipt_code || await newReceipt(db);
    const status = deferredN ? 'grading' : 'graded';
    stmts.push(db.prepare(`UPDATE hw_submissions SET status = ?, mode = 'web', objective_score = ?, auto_score = ?, final_score = ?, late = ?, receipt_code = ?,
        written_status = ?, submitted_at = CURRENT_TIMESTAMP, graded_at = ${deferredN ? 'NULL' : 'CURRENT_TIMESTAMP'}, released_at = ${deferredN ? 'NULL' : 'CURRENT_TIMESTAMP'},
        released_by = ${deferredN ? 'NULL' : "'auto'"}, draft = NULL, pages = ?, ai_error = NULL, tries = 0, assist = NULL, assist_status = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
        .bind(status, objective, score, score, late, code, deferredN ? 'queued' : 'none', pages.length, sub.id));
    await db.batch(stmts);
    return { status, objective, deferred: deferredN, late: !!late, receipt: code, auto };
}

/** Background: mark one website submission's written answers right after submitting (keeps going if the student leaves). */
export async function markWritten(env, db, subId) {
    for (let k = 0; k < 14; k++) {
        const r = await gradeStep(env, db, subId);
        if (r.done || r.queued || r.busy) return r;
        if (r.retry) await new Promise(x => setTimeout(x, 1500));
    }
    return { pending: true };
}

/** One unit of background work for a website submission: read one photo, or check all written answers. */
async function webStep(env, db, sub, key, pages) {
    const total = pages.length;
    const next = pages.find(p => p.status !== 'read');
    if (next) {
        const labels = String(next.labels || '').split(',').map(x => x.trim()).filter(Boolean);
        const qs = key.filter(q => labels.includes(q.label));
        const img = qs.length ? await pageDataUrl(env, db, next.media_id) : null;
        let read = { answers: [], page_readable: false, notes: img ? '' : 'photo missing' };
        if (img) {
            const out = await runAI(env, db, { image: img, model: visionModel(env), prompt: writtenReadPrompt({ questions: qs }), maxTokens: 1500 });
            const j = parseJsonLoose(out.text);
            read = j && Array.isArray(j.answers) ? j : { answers: [], page_readable: false, notes: 'could not understand the reply' };
        }
        await db.prepare(`UPDATE hw_pages SET status = 'read', read_json = ? WHERE id = ?`).bind(JSON.stringify(read), next.id).run();
        return { stage: 'reading', page: pages.filter(p => p.status === 'read').length + 1, pages: total };
    }
    // words read from photos, per label
    const photoText = {}, photoBad = new Set();
    for (const p of pages) {
        let j = {}; try { j = JSON.parse(p.read_json || '{}'); } catch (e) { }
        const labels = String(p.labels || '').split(',').map(x => x.trim()).filter(Boolean);
        if (j.page_readable === false) labels.forEach(l => photoBad.add(l));
        for (const x of j.answers || []) {
            const l = String(x.label || '').trim(); if (!l) continue;
            if (x.legible === false) { photoBad.add(l); continue; }
            const t = clip(x.text ?? x.answer, 3000); if (t) photoText[l] = photoText[l] ? photoText[l] + '\n' + t : t;
        }
    }
    const { results: rows } = await db.prepare('SELECT * FROM hw_answers WHERE submission_id = ? AND deferred = 1').bind(sub.id).all();
    const byQ = Object.fromEntries(key.map(q => [q.id, q]));
    const work = [];
    for (const row of rows || []) {
        const q = byQ[row.question_id]; if (!q) continue;
        let t = {}; try { t = JSON.parse(row.transcript || '{}'); } catch (e) { }
        const fromPhoto = photoText[q.label] || '';
        const student = [t.answer, fromPhoto].filter(Boolean).join('\n').trim();
        const ans = { answer: q.type === 'tf' ? t.answer : student, correction: q.type === 'tf' ? [t.correction, fromPhoto].filter(Boolean).join(' ') : t.correction, legible: true };
        let r = q.type === 'essay' ? (student ? { verdict: 'pending', points: 0, needsAI: true } : { verdict: photoBad.has(q.label) ? 'unreadable' : 'blank', points: 0 }) : scoreOne(q, ans);
        work.push({ row, q, t: { ...t, ...(fromPhoto ? { photoText: fromPhoto } : {}), ...(photoBad.has(q.label) ? { check: 'Photo hard to read — look at it' } : {}) }, ans, r, student });
    }
    const ai = work.filter(w => w.r.needsAI && String(w.q.type === 'tf' ? w.ans.correction : w.student).trim());
    const feedback = {};
    for (let i = 0; i < ai.length; i += 8) {
        const part = ai.slice(i, i + 8).map(w => ({
            label: w.q.label, question: w.q.prompt,
            model: w.q.type === 'essay' ? w.q.modelAnswer : w.q.type === 'tf' ? `False. Correct statement uses "${w.q.correction}"` : [w.q.answer, ...(w.q.alternatives || [])].join(' / '),
            ideas: w.q.type === 'essay' && (w.q.ideas || []).length ? w.q.ideas.map(x => x.text) : [w.q.type === 'tf' ? `the correction means "${w.q.correction}"` : `same meaning as "${w.q.answer}"`],
            student: w.q.type === 'tf' ? w.ans.correction : w.student
        }));
        const out = await runAI(env, db, { prompt: conceptPrompt(part), model: textModel(env), maxTokens: 1500 });
        const j = parseJsonLoose(out.text);
        for (const x of (j && j.results) || []) feedback[String(x.label)] = x;
    }
    const stmts = [];
    let written = 0;
    for (const w of work) {
        let { verdict, points } = w.r, evidence = null, fb = null;
        const f = feedback[w.q.label];
        if (w.r.needsAI && f) {
            const found = new Set((f.ideas_found || []).map(Number).filter(n => n >= 1));
            evidence = f.evidence ? clip(f.evidence, 300) : null; fb = f.feedback ? clip(f.feedback, 400) : null;
            if (w.q.type === 'essay') {
                const ideas = w.q.ideas || [];
                points = Math.round(ideas.reduce((t, it, i) => t + (found.has(i + 1) ? Number(it.points) || 0 : 0), 0) * 100) / 100;
                verdict = points >= w.q.points - 0.001 ? 'correct' : points > 0 ? 'partial' : 'wrong';
            } else if (found.size) { points = w.q.points; verdict = 'correct'; }
        } else if (verdict === 'pending') verdict = 'wrong';
        written += points || 0;
        stmts.push(db.prepare('UPDATE hw_answers SET transcript = ?, verdict = ?, points = ?, ai_points = ?, evidence = ?, feedback = ? WHERE id = ?')
            .bind(JSON.stringify(w.t), verdict, points || 0, points || 0, evidence, fb, w.row.id));
    }
    const objective = Number(sub.objective_score) || 0;
    const score = Math.round((objective + written) * 100) / 100;
    stmts.push(db.prepare(`UPDATE hw_submissions SET status = 'pending', written_status = 'review', auto_score = ?, final_score = ?, graded_at = CURRENT_TIMESTAMP,
        ai_error = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(score, score, sub.id));
    await db.batch(stmts);
    return { done: true, stage: 'done', status: 'pending', pages: total, released: false };
}

// ---------------- AI Assistant ----------------
export const CHAT_LIMIT = 10;
async function studentOf(db, studentId) {
    return await db.prepare('SELECT first_name, last_name, gender FROM students WHERE student_id = ?').bind(studentId).first() || {};
}
function mistakesOf(r, key) {
    const byLabel = Object.fromEntries(key.map(q => [q.label, q]));
    return r.items.filter(i => i.verdict && i.verdict !== 'correct' && !i.pending).map(i => {
        const q = byLabel[i.label] || {};
        return { label: i.label, question: i.question, options: q.type === 'mcq' ? q.options || [] : [], student: [i.yourAnswer, i.yourCorrection].filter(Boolean).join(' — '),
            right: i.modelAnswer, explanation: i.explanation, feedback: i.feedback, verdict: i.verdict };
    });
}
// No AI available → still useful: the key's own explanations, in the same shape
function plainAssist(name, female, mistakes) {
    if (!mistakes.length) return { greeting: `برافو يا ${name || 'بطل'}! 🎉`, items: [], closing: `كل إجاباتك صح — ${female ? 'إنتِ' : 'إنت'} فاهم${female ? 'ة' : ''} الدرس كويس جدًا. كمّل كده 💪`, ai: false };
    return { greeting: `يلا يا ${name || 'بطل'} نراجع الأسئلة دي سوا 👇`, ai: false,
        items: mistakes.map(m => ({ label: m.label, text: `${m.student ? `إجابتك: ${m.student}` : 'السؤال ده كان فاضي'}\nالإجابة الصح: ${m.right}${m.explanation ? `\n💡 ${m.explanation}` : ''}` })),
        closing: 'ولو لسه في حاجة مش واضحة اسألني تحت 👇' };
}
/** Minutes until the assistant can answer (daily reset at 00:00 UTC = 2:00 am Cairo, or the queue ahead). */
export async function assistEta(db) {
    if (await quotaHitToday(db)) {
        const d = new Date(); const reset = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, 0, 5);
        return { minutes: Math.max(5, Math.ceil((reset - d.getTime()) / 60000)), reason: 'limit' };
    }
    const r = await db.prepare(`SELECT COUNT(*) AS n FROM hw_submissions WHERE assist_status IN ('queued', 'working')`).first();
    return { minutes: Math.max(1, Math.ceil(((r ? r.n : 0) + 1) * 25 / 60)), reason: 'busy' };
}
/** Build (or rebuild) the assistant's walkthrough. Returns { status: ready|queued|working, assist }. */
export async function ensureAssist(env, db, subId, { force = false, silent = false } = {}) {
    const sub = await db.prepare('SELECT * FROM hw_submissions WHERE id = ?').bind(subId).first();
    if (!sub || sub.status === 'uploading') return { status: 'none' };
    if (!force && ['ready', 'seen', 'notified'].includes(sub.assist_status) && sub.assist) return { status: 'ready', assist: JSON.parse(sub.assist) };
    const r = await resultOf(db, subId, { forStudent: true });
    const key = await loadKey(db, sub.assignment_id);
    const st = await studentOf(db, sub.student_id);
    const female = String(st.gender || '').toLowerCase() === 'female', name = st.first_name || '';
    const mistakes = mistakesOf(r, key);
    const byLabel = Object.fromEntries(key.map(q => [q.label, q]));
    const save = async (assist, status) => {
        await db.prepare(`UPDATE hw_submissions SET assist = ?, assist_status = ?, assist_lock = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(JSON.stringify(assist), status, subId).run();
        return { status: 'ready', assist };
    };
    if (!mistakes.length) return save(plainAssist(name, female, []), silent ? 'notified' : 'ready');
    if (!aiReady(env) || await quotaHitToday(db)) {
        await db.prepare(`UPDATE hw_submissions SET assist_status = 'queued', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(subId).run();
        return { status: 'queued' };
    }
    const got = await db.prepare(`UPDATE hw_submissions SET assist_status = 'working', assist_lock = datetime('now', '+120 seconds') WHERE id = ? AND (assist_lock IS NULL OR assist_lock < datetime('now'))`).bind(subId).run();
    if (!got.meta || !got.meta.changes) return { status: 'working' };
    try {
        const out = await runAI(env, db, { prompt: assistPrompt({ name, female, title: r.title, items: mistakes.slice(0, 20) }), model: textModel(env), maxTokens: 2200, temperature: 0.4 });
        const j = parseJsonLoose(out.text);
        const items = j && Array.isArray(j.items) ? j.items.map(x => ({ label: clip(x.label, 12), text: clip(x.text, 1200), en: clip(x.explanation_en, 600) })).filter(x => x.text) : [];
        // explanations the key didn't have → saved on the question for every other student (staff see "AI explanation · check")
        const cache = [];
        for (const it of items) {
            const q = byLabel[it.label];
            if (q && !q.explanation && it.en && !/however|re-?evaluat|not sure|misinterpret/i.test(it.en)) cache.push(db.prepare(`UPDATE hw_questions SET extra = json_set(COALESCE(extra, '{}'), '$.explanation', ?, '$.explAi', json('true')) WHERE id = ? AND COALESCE(json_extract(extra, '$.explanation'), '') = ''`).bind(it.en, q.id));
            delete it.en;
        }
        if (cache.length) await db.batch(cache).catch(() => null);
        const assist = items.length ? { greeting: clip(j.greeting, 300), items, closing: clip(j.closing, 300), ai: true } : plainAssist(name, female, mistakes);
        return save(assist, silent ? 'notified' : 'ready');
    } catch (e) {
        if (e instanceof AiQuotaError || e instanceof AiUnavailableError) {
            await db.prepare(`UPDATE hw_submissions SET assist_status = 'queued', assist_lock = NULL WHERE id = ?`).bind(subId).run();
            return { status: 'queued' };
        }
        return save(plainAssist(name, female, mistakes), silent ? 'notified' : 'ready');   // AI hiccup → the key's explanations, never an empty tab
    }
}
/** Follow-up question in the AI Assistant tab. */
export async function assistChat(env, db, subId, question) {
    const sub = await db.prepare('SELECT * FROM hw_submissions WHERE id = ?').bind(subId).first();
    if (!sub || sub.status === 'uploading') return { error: 'Submit your homework first', status: 409 };
    if ((sub.chat_used || 0) >= CHAT_LIMIT) return { error: `You used all ${CHAT_LIMIT} questions for this homework — ask Miss Marwa in "Ask Miss Marwa"`, status: 429, code: 'CHAT_LIMIT' };
    const r = await resultOf(db, subId, { forStudent: true });
    const key = await loadKey(db, sub.assignment_id);
    const st = await studentOf(db, sub.student_id);
    const { results: hist } = await db.prepare('SELECT role, text FROM hw_chat WHERE submission_id = ? ORDER BY id DESC LIMIT 8').bind(subId).all();
    const out = await runAI(env, db, { prompt: chatPrompt({ name: st.first_name || '', female: String(st.gender || '').toLowerCase() === 'female', title: r.title, mistakes: mistakesOf(r, key).slice(0, 20), history: (hist || []).reverse(), question }), model: textModel(env), maxTokens: 600, temperature: 0.4 });
    const reply = clip(String(out.text || '').replace(/^```[a-z]*\n?|```$/g, ''), 2000) || 'مش قادر أرد دلوقتي — جرّب تاني كمان شوية 🙏';
    await db.batch([
        db.prepare(`INSERT INTO hw_chat (submission_id, role, text) VALUES (?, 'user', ?)`).bind(subId, question),
        db.prepare(`INSERT INTO hw_chat (submission_id, role, text) VALUES (?, 'assistant', ?)`).bind(subId, reply),
        db.prepare('UPDATE hw_submissions SET chat_used = COALESCE(chat_used, 0) + 1 WHERE id = ?').bind(subId)
    ]);
    return { reply, left: CHAT_LIMIT - (sub.chat_used || 0) - 1 };
}
export async function chatOf(db, subId) {
    const { results } = await db.prepare('SELECT role, text, created_at FROM hw_chat WHERE submission_id = ? ORDER BY id LIMIT 60').bind(subId).all();
    return (results || []).map(x => ({ role: x.role, text: x.text, at: x.created_at }));
}

// ---------------- results for screens ----------------
export async function resultOf(db, subId, { forStudent = false } = {}) {
    const sub = await db.prepare(`SELECT s.*, a.title, a.unit, a.lesson, a.grade, a.total_score, a.deadline, a.answer_mode, a.allow_photo FROM hw_submissions s JOIN hw_assignments a ON a.id = s.assignment_id WHERE s.id = ?`).bind(subId).first();
    if (!sub) return null;
    const key = await loadKey(db, sub.assignment_id);
    const { results } = await db.prepare('SELECT * FROM hw_answers WHERE submission_id = ?').bind(subId).all();
    const byQ = {}; (results || []).forEach(a => { byQ[a.question_id] = a; });
    const released = !!sub.released_at;
    const web = sub.mode === 'web';
    const submitted = sub.status !== 'uploading';
    const showScore = !forStudent || released;
    let pendingPoints = 0;
    const items = key.map(q => {
        const a = byQ[q.id];
        let t = {}; try { t = a && a.transcript ? JSON.parse(a.transcript) : {}; } catch (e) { }
        const pts = a ? (a.override_points != null ? a.override_points : a.points) : 0;
        const verdict = a ? (a.override_points != null ? (a.override_points >= q.points - 0.001 ? 'correct' : a.override_points > 0 ? 'partial' : 'wrong') : a.verdict) : 'blank';
        const base = { questionId: q.id, label: q.label, type: q.type, question: q.prompt, points: q.points, options: q.type === 'mcq' ? q.options || [] : undefined, deferred: !!(a && a.deferred) };
        // website answers: the marked-by-code part is visible at once; written answers wait for staff
        if (forStudent && !released && web && submitted) {
            if (a && a.deferred) { pendingPoints += Number(q.points) || 0; return { ...base, pending: true, yourAnswer: t.answer ?? '', yourCorrection: t.correction ?? '', photo: !!t.photo }; }
            return { ...base, verdict, earned: pts, yourAnswer: t.answer ?? '', yourCorrection: t.correction ?? '', modelAnswer: modelAnswerText(q), explanation: q.explanation || '', feedback: a ? a.feedback : null };
        }
        return {
            ...base,
            ...(showScore ? {
                verdict, earned: pts, aiPoints: a ? a.ai_points : null, overridden: !!(a && a.override_points != null),
                yourAnswer: t.answer ?? '', yourCorrection: t.correction ?? '', evidence: a ? a.evidence : null, feedback: a ? a.feedback : null,
                modelAnswer: modelAnswerText(q), explanation: q.explanation || '', confidence: a ? a.confidence : null, photoText: t.photoText || null, photo: !!t.photo,
                ...(forStudent ? {} : { check: t.check || null, circledText: t.circledText || null, modelAnswerFull: q.type === 'essay' ? { ideas: q.ideas || [], modelAnswer: q.modelAnswer || '' } : undefined })
            } : {})
        };
    });
    const soFar = forStudent && !released && web && submitted;
    return {
        id: sub.id, assignmentId: sub.assignment_id, studentId: sub.student_id, status: sub.status, released, mode: web ? 'web' : 'photo',
        title: sub.title, unit: sub.unit, lesson: sub.lesson, grade: sub.grade, total: sub.total_score,
        score: showScore ? sub.final_score : soFar ? sub.objective_score : null, scoreSoFar: soFar || undefined, pendingPoints: soFar ? pendingPoints : undefined,
        objectiveScore: web ? sub.objective_score : undefined, writtenStatus: sub.written_status || null,
        autoScore: forStudent ? undefined : sub.auto_score,
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
            const strong = r.items.filter(i => i.verdict === 'correct').slice(0, 12).map(i => ({ label: i.label, question: String(i.question || '').slice(0, 120) }));
            const out = await runAI(env, db, { prompt: weaknessPrompt({ title: r.title, strong, missed: missed.slice(0, 15).map(m => ({ label: m.label, question: m.question, right: m.modelAnswer, student: m.yourAnswer })) }), maxTokens: 700, temperature: 0.2 });
            const j = parseJsonLoose(out.text);
            if (j && Array.isArray(j.focus)) diag = { focus: j.focus.map(x => String(x).slice(0, 160)).slice(0, 3), strengths: (Array.isArray(j.strengths) ? j.strengths : []).map(x => String(x).slice(0, 160)).slice(0, 2), summary: String(j.summary || '').slice(0, 200), at: new Date().toISOString() };
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
    if (diag && diag.strengths && diag.strengths.length) {
        lines.push('', '💪 نقاط القوة:');
        diag.strengths.forEach(x => lines.push(`• ${iso(x)}`));
    }
    if (diag && diag.focus && diag.focus.length) {
        lines.push('', '🎯 نقاط محتاجة تركيز:');
        diag.focus.forEach(x => lines.push(`• ${iso(x)}`));
    }
    if (diag && diag.summary) lines.push('', iso(diag.summary));
    lines.push('', 'برجاء المتابعة.');
    return { text: rtl(lines), strengths: diag ? diag.strengths || [] : [], focus: diag ? diag.focus : [], summary: diag ? diag.summary : '', student: { id: st.student_id, name, phone: st.phone, parentPhone: st.parent_phone, gender: st.gender } };
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
