// ============================================================
// Admin / staff authentication, roles and audit log
// ============================================================
// Two kinds of staff accounts share one portal (/admin/):
//   teacher   = Miss Marwa — full access
//   assistant = staff — daily operations, no deletions / settings / Co-Pilot
//
// GET  /api/admin-auth?action=status          → { configured, needsSetup }
// POST /api/admin-auth?action=setup           → first-time: create Miss Marwa's account (needs ADMIN_PASSWORD)
// POST /api/admin-auth?action=login           → { username, password } → HttpOnly cookie
// POST /api/admin-auth?action=logout
// GET  /api/admin-auth?action=me  (alias: check) → { authenticated, staff, permissions }
// POST /api/admin-auth?action=change-password → own password
// GET  /api/admin-auth?action=staff-list      → teacher only
// POST /api/admin-auth?action=staff-create    → teacher only (creates assistants)
// POST /api/admin-auth?action=staff-update    → teacher only (rename, enable/disable, reset password)
// GET  /api/admin-auth?action=audit-log       → teacher only
//
// Other API files import { verifyAdminRequest, requireStaff, audit, auditStmt } from here.
// Every permission is checked on the SERVER — hiding a button is never the security.
// ============================================================

import { mediaSchemaSteps, registerLegacy } from './media-store.js';

function getDb(env) {
    return [env.DB, env.D1_DB].find(d => d && typeof d.prepare === "function");
}

// ---------- Permissions (the single source of truth) ----------
const BOTH = ['teacher', 'assistant'];
const TEACHER = ['teacher'];
export const PERMISSIONS = {
    'students.view': BOTH,
    'students.reset-password': BOTH,
    'students.edit': BOTH,       // branch assignment, 'not a duplicate'
    'students.delete': TEACHER,
    'students.export': TEACHER,
    'lessons.view': BOTH,
    'lessons.create': BOTH,
    'lessons.delete': TEACHER,
    'exams.view': BOTH,
    'exams.create': BOTH,
    'exams.edit': BOTH,          // only before the exam has submissions (enforced where edits happen)
    'exams.delete': TEACHER,
    'exams.reset-attempt': BOTH, // always written to the audit log
    'offline.view': BOTH,
    'offline.create-exam': BOTH,
    'offline.edit-exam': TEACHER,   // assistants enter marks/absences only
    'offline.save-grades': BOTH,
    'offline.delete-exam': TEACHER,
    'analytics.view': BOTH,
    'reports.send': BOTH,
    'inbox.reply': BOTH,
    'copilot.use': TEACHER,
    'staff.manage': TEACHER,
    'audit.view': TEACHER,
    'settings.manage': TEACHER
};
export function can(staff, permission) {
    if (!staff) return false;
    const allowed = PERMISSIONS[permission];
    return !!allowed && allowed.includes(staff.role);
}
export function permissionsFor(role) {
    return Object.keys(PERMISSIONS).filter(p => PERMISSIONS[p].includes(role));
}

// ---------- Config ----------
const COOKIE_NAME = 'admin_session';
const BUILD = 'auth-diag-2';
const SESSION_HOURS = { teacher: 24 * 30, assistant: 12 };
const PBKDF2_ITERATIONS = 100000; // the maximum Cloudflare Workers allows
const USER_LOCK = { fails: 5, windowMs: 15 * 60 * 1000, lockMs: 15 * 60 * 1000 };
const IP_LOCK = { fails: 20, windowMs: 15 * 60 * 1000, lockMs: 15 * 60 * 1000 };

// The signing secret MUST come from a Cloudflare secret. The old code fell back to a
// string that is visible on GitHub — anyone could have forged an admin cookie with it.
function getTokenSecret(env) {
    return secretState(env) === 'ok' ? String(env.ADMIN_TOKEN_SECRET).trim() : null;
}
// Why the secret isn't usable (never reveals the value itself)
function secretState(env) {
    const s = env && env.ADMIN_TOKEN_SECRET;
    if (s === undefined || s === null) return 'missing';
    if (typeof s !== 'string') return 'not-text';
    if (s.trim().length < 16) return 'too-short';
    return 'ok';
}
// Only used once, to prove it's Miss Marwa during first-time setup.
function setupState(env) {
    const p = env && env.ADMIN_PASSWORD;
    if (p === undefined || p === null) return 'missing';
    if (typeof p !== 'string') return 'not-text';
    if (p.trim() === 'marwa2026') return 'default';
    if (p.trim().length < 6) return 'too-short';
    return 'ok';
}
function getSetupPassword(env) {
    return setupState(env) === 'ok' ? String(env.ADMIN_PASSWORD).trim() : null;
}
// Names (never values) of settings that look like a misspelt ADMIN_TOKEN_SECRET / ADMIN_PASSWORD
function nearMissNames(env) {
    try {
        return Object.keys(env || {}).filter(k => /admin|token|secret/i.test(k) && k !== 'ADMIN_TOKEN_SECRET' && k !== 'ADMIN_PASSWORD').slice(0, 5);
    } catch (e) { return []; }
}

// ---------- Schema (created automatically, never touches existing tables) ----------
let schemaReady = false;
export async function ensureStaffSchema(db) {
    if (schemaReady) return;
    if (!db || typeof db.prepare !== 'function') throw new Error('No D1 database binding named DB (or D1_DB) in this deployment');
    // One statement at a time: if one step fails we still know exactly which one and why
    const steps = [
        `CREATE TABLE IF NOT EXISTS staff (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL, display_name TEXT NOT NULL, role TEXT NOT NULL, password_hash TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, token_version INTEGER NOT NULL DEFAULT 1, last_login_at TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP)`,
        `CREATE TABLE IF NOT EXISTS audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, staff_id INTEGER, staff_name TEXT, role TEXT, action TEXT NOT NULL, target TEXT, details TEXT, ip TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP)`,
        `CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(created_at)`,
        `CREATE TABLE IF NOT EXISTS auth_throttle ("key" TEXT PRIMARY KEY, fails INTEGER NOT NULL DEFAULT 0, first_fail_at INTEGER NOT NULL DEFAULT 0, locked_until INTEGER NOT NULL DEFAULT 0)`
    ];
    const errors = [];
    for (const q of steps) {
        try { await db.prepare(q).run(); }
        catch (e) { errors.push(`${q.slice(0, 48)}… → ${e && e.message ? e.message : e}`); }
    }
    if (errors.length) throw new Error('Database setup failed: ' + errors.join(' | '));
    schemaReady = true;
}

// ---------- App schema upgrades (Phase 2) ----------
// Only ADDS nullable columns / new tables — never rewrites or drops existing data.
// Safe to run on every cold start: each step is skipped when already done.
let appSchemaReady = false;
export async function ensureAppSchema(db) {
    if (appSchemaReady) return;
    const cols = async (table) => {
        try { const { results } = await db.prepare(`PRAGMA table_info(${table})`).all(); return (results || []).map(r => r.name); }
        catch (e) { return null; }
    };
    const steps = [];
    const oe = await cols('offline_exams');
    if (oe && oe.length) {
        if (!oe.includes('branch')) steps.push('ALTER TABLE offline_exams ADD COLUMN branch TEXT');        // 'center' | 'private' | NULL (= before the split)
        if (!oe.includes('group_id')) steps.push('ALTER TABLE offline_exams ADD COLUMN group_id TEXT');    // future: private sub-groups
        if (!oe.includes('exam_date')) steps.push('ALTER TABLE offline_exams ADD COLUMN exam_date TEXT');  // YYYY-MM-DD
    }
    const og = await cols('offline_grades');
    if (og && og.length && !og.includes('absent')) steps.push('ALTER TABLE offline_grades ADD COLUMN absent INTEGER NOT NULL DEFAULT 0');
    const st = await cols('students');
    if (st && st.length && !st.includes('group_id')) steps.push('ALTER TABLE students ADD COLUMN group_id TEXT');
    if (st && st.length && !st.includes('session_version')) steps.push('ALTER TABLE students ADD COLUMN session_version INTEGER NOT NULL DEFAULT 1');
    const ex = await cols('exams');
    if (ex && ex.length && !ex.includes('shuffle')) steps.push('ALTER TABLE exams ADD COLUMN shuffle INTEGER NOT NULL DEFAULT 1');
    const es = await cols('exam_submissions');
    if (es && es.length && !es.includes('shuffle_seed')) steps.push('ALTER TABLE exam_submissions ADD COLUMN shuffle_seed TEXT');
    // Exam-integrity record. No default on purpose: NULL = an attempt from before this was recorded.
    if (es && es.length && !es.includes('leave_count')) steps.push('ALTER TABLE exam_submissions ADD COLUMN leave_count INTEGER');     // times the student left the exam page
    if (es && es.length && !es.includes('auto_submitted')) steps.push('ALTER TABLE exam_submissions ADD COLUMN auto_submitted TEXT');  // NULL/'' = by the student · 'left-page' · 'time-up'
    steps.push(`CREATE TABLE IF NOT EXISTS student_groups (
        id TEXT PRIMARY KEY, grade TEXT NOT NULL, branch TEXT NOT NULL, name TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 1, created_at TEXT DEFAULT CURRENT_TIMESTAMP)`);
    steps.push(`CREATE TABLE IF NOT EXISTS duplicate_dismissals (
        pair_key TEXT PRIMARY KEY, staff_id INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP)`);
    steps.push('CREATE INDEX IF NOT EXISTS idx_students_grade_phone ON students(grade, phone)');
    // Ask Miss Marwa: one row per question (a small chat thread), its messages, and the photos / voice notes
    steps.push(`CREATE TABLE IF NOT EXISTS ask_questions (
        id INTEGER PRIMARY KEY AUTOINCREMENT, student_id TEXT NOT NULL, grade TEXT NOT NULL, unit INTEGER NOT NULL, lesson INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'waiting', waiting_since TEXT DEFAULT CURRENT_TIMESTAMP,
        student_unread INTEGER NOT NULL DEFAULT 0, staff_unread INTEGER NOT NULL DEFAULT 1,
        bank_text TEXT, bank_hidden INTEGER NOT NULL DEFAULT 0, resolved_by TEXT, exported_at TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP)`);
    steps.push('CREATE INDEX IF NOT EXISTS idx_ask_q_grade ON ask_questions(grade, status, waiting_since)');
    steps.push('CREATE INDEX IF NOT EXISTS idx_ask_q_student ON ask_questions(student_id, updated_at)');
    steps.push(`CREATE TABLE IF NOT EXISTS ask_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT, question_id INTEGER NOT NULL, sender TEXT NOT NULL, staff_name TEXT,
        text TEXT, media_id INTEGER, media_kind TEXT, media_seconds REAL, audio_id INTEGER, audio_seconds REAL, created_at TEXT DEFAULT CURRENT_TIMESTAMP)`);
    steps.push('CREATE INDEX IF NOT EXISTS idx_ask_m_q ON ask_messages(question_id, id)');
    {   // a message can carry a photo AND a voice note (add-only)
        let am = [];
        try { const r = await db.prepare('PRAGMA table_info(ask_messages)').all(); am = (r.results || []).map(c => c.name); } catch (e) { }
        if (am.length && !am.includes('audio_id')) steps.push('ALTER TABLE ask_messages ADD COLUMN audio_id INTEGER');
        if (am.length && !am.includes('audio_seconds')) steps.push('ALTER TABLE ask_messages ADD COLUMN audio_seconds REAL');
    }
    {   // questions cleared from the bank after a PDF export (add-only)
        let aq = [];
        try { const r = await db.prepare('PRAGMA table_info(ask_questions)').all(); aq = (r.results || []).map(c => c.name); } catch (e) { }
        if (aq.length && !aq.includes('exported_at')) steps.push('ALTER TABLE ask_questions ADD COLUMN exported_at TEXT');
    }
    // Small key/value store for housekeeping (e.g. when the 30-day media clean-up last ran)
    steps.push(`CREATE TABLE IF NOT EXISTS app_kv ("key" TEXT PRIMARY KEY, value TEXT, updated_at TEXT DEFAULT CURRENT_TIMESTAMP)`);
    steps.push(`CREATE TABLE IF NOT EXISTS ask_media (
        id INTEGER PRIMARY KEY AUTOINCREMENT, student_id TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL,
        data TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP)`);
    // Unified file registry (R2 primary, D1 fallback) — see media-store.js
    steps.push(...mediaSchemaSteps());
    // Devices each student is signed in on (max 2 — staff can reset them)
    steps.push(`CREATE TABLE IF NOT EXISTS student_devices (
        id INTEGER PRIMARY KEY AUTOINCREMENT, student_id TEXT NOT NULL, device_id TEXT NOT NULL, label TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP, last_seen_at TEXT DEFAULT CURRENT_TIMESTAMP, UNIQUE(student_id, device_id))`);
    // WhatsApp messages staff opened for a parent (so nobody sends the same message twice)
    steps.push(`CREATE TABLE IF NOT EXISTS message_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT, student_id TEXT NOT NULL, kind TEXT NOT NULL, text_hash TEXT NOT NULL,
        staff_id INTEGER, staff_name TEXT, sent_at TEXT DEFAULT CURRENT_TIMESTAMP)`);
    steps.push('CREATE INDEX IF NOT EXISTS idx_message_log_student ON message_log(student_id, sent_at)');
    // One private, always-up-to-date report link per student for the parent (sent once on WhatsApp)
    steps.push(`CREATE TABLE IF NOT EXISTS parent_links (
        student_id TEXT PRIMARY KEY, token TEXT NOT NULL UNIQUE, created_by TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        views INTEGER NOT NULL DEFAULT 0, last_view_at TEXT)`);
    for (const q of steps) {
        try { await db.prepare(q).run(); } catch (e) { /* another request may have added it at the same moment */ }
    }
    await registerLegacy(db);     // old Questions files keep their ids
    appSchemaReady = true;
}

// ---------- Shared helpers ----------
// Any Egyptian mobile written any way → 01XXXXXXXXX (Arabic/Persian digits, spaces, +20, 0020, 20…)
export function normalizeEgyptPhone(value) {
    let s = String(value ?? '')
        .replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x0660))
        .replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 0x06F0))
        .replace(/\D/g, '');
    if (s.startsWith('0020')) s = s.slice(4);
    else if (s.startsWith('20') && s.length === 12) s = s.slice(2);
    if (s.length === 10 && s.startsWith('1')) s = '0' + s;
    return s;
}
// A rough "sound" of a name that matches Arabic and English spellings of the same name
// (أحمد / Ahmed → "md", محمد / Mohamed → "mmd", يوسف / Youssef → "sf"). One signal only, never proof.
const AR_LATIN = { 'ا': 'a', 'أ': 'a', 'إ': 'a', 'آ': 'a', 'ء': '', 'ؤ': 'w', 'ئ': 'y', 'ب': 'b', 'ت': 't', 'ة': 'a', 'ث': 's', 'ج': 'g', 'ح': 'h', 'خ': 'k', 'د': 'd', 'ذ': 'z', 'ر': 'r', 'ز': 'z', 'س': 's', 'ش': 's', 'ص': 's', 'ض': 'd', 'ط': 't', 'ظ': 'z', 'ع': '', 'غ': 'g', 'ف': 'f', 'ق': 'k', 'ك': 'k', 'ل': 'l', 'م': 'm', 'ن': 'n', 'ه': 'h', 'و': 'w', 'ى': 'y', 'ي': 'y' };
export function nameKey(name) {
    let s = String(name || '').trim().split(/\s+/)[0] || '';
    s = s.toLowerCase().replace(/[ً-ٰٟ]/g, '').split('').map(c => AR_LATIN[c] ?? c).join('');
    s = s.replace(/sh/g, 's').replace(/kh/g, 'k').replace(/ph/g, 'f').replace(/q/g, 'k').replace(/c/g, 'k').replace(/j/g, 'g').replace(/[^a-z]/g, '');
    s = s.replace(/^(el|al)(?=..)/, '').replace(/[aeiouwyh]/g, '').replace(/(.)\1+/g, '$1');
    return s;
}

// ---------- Crypto helpers ----------
const enc = new TextEncoder();
const toB64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const fromB64 = (s) => Uint8Array.from(atob(s), c => c.charCodeAt(0));

function safeEqual(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
}

async function hmacSign(message, secret) {
    const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
    return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function pbkdf2(password, salt, iterations) {
    const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
    return toB64(bits);
}
export async function hashPassword(password) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const hash = await pbkdf2(password, salt, PBKDF2_ITERATIONS);
    return `pbkdf2$${PBKDF2_ITERATIONS}$${toB64(salt)}$${hash}`;
}
async function verifyPassword(password, stored) {
    try {
        const [scheme, iter, saltB64, hash] = String(stored).split('$');
        if (scheme !== 'pbkdf2') return false;
        const check = await pbkdf2(password, fromB64(saltB64), Number(iter));
        return safeEqual(check, hash);
    } catch (e) {
        return false;
    }
}

async function createToken(payload, secret) {
    const b64 = btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
    return `${b64}.${await hmacSign(b64, secret)}`;
}
async function readToken(token, secret) {
    if (!token || !token.includes('.')) return null;
    const [b64, sig] = token.split('.');
    if (!safeEqual(await hmacSign(b64, secret), sig)) return null;
    try {
        const payload = JSON.parse(decodeURIComponent(escape(atob(b64))));
        if (!payload.exp || Date.now() > payload.exp) return null;
        return payload;
    } catch {
        return null;
    }
}

function parseCookies(cookieStr) {
    const cookies = {};
    (cookieStr || '').split(';').forEach(pair => {
        const [key, ...rest] = pair.trim().split('=');
        if (key) cookies[key.trim()] = rest.join('=').trim();
    });
    return cookies;
}
function sessionCookie(token, maxAgeSec) {
    return `${COOKIE_NAME}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${maxAgeSec}`;
}
const CLEAR_COOKIE = `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`;

export function clientIp(request) {
    return request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || '';
}
const publicStaff = (s) => ({ id: s.id, username: s.username, name: s.display_name, role: s.role });

// ---------- Student sessions (server-verified) ----------
// Sign-in / sign-up set an HttpOnly cookie signed on the server. Student APIs read WHO is asking
// from that cookie — never from a student code sent by the browser — so nobody can open, submit
// or read another student's exams by typing their code.
// Resetting a student's password (or deleting the account) signs them out everywhere.
// STUDENT_LEGACY_SESSIONS=allow (Cloudflare setting) temporarily accepts old sign-ins without the cookie.
const STUDENT_COOKIE = 'student_session';
const STUDENT_DAYS = 60;
function studentSecret(env) {
    const s = getTokenSecret(env);
    return s ? s + '|student-session' : null;
}
export async function studentCookieFor(env, studentId, version, deviceId) {
    const secret = studentSecret(env);
    if (!secret) return null;
    const token = await createToken({ sid: studentId, v: version || 1, d: deviceId || undefined, iat: Date.now(), exp: Date.now() + STUDENT_DAYS * 864e5 }, secret);
    return `${STUDENT_COOKIE}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${STUDENT_DAYS * 86400}`;
}
export const CLEAR_STUDENT_COOKIE = `${STUDENT_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
export function studentSessionsEnabled(env) { return !!studentSecret(env); }
export function legacyStudentsAllowed(env) {
    return !studentSecret(env) || String(env.STUDENT_LEGACY_SESSIONS || '').toLowerCase() === 'allow';
}
// ---------- Max 2 devices per student ----------
// Each browser keeps a random device id in its own long-lived HttpOnly cookie. Signing in registers
// that device for the student; a 3rd device is refused until staff press "Reset devices".
// Signing out does NOT free the slot (otherwise an account could be passed around).
export const MAX_STUDENT_DEVICES = 2;
// Optional Cloudflare setting STUDENT_MAX_DEVICES (e.g. 3) changes the limit without a code change
export const maxDevices = (env) => { const n = parseInt(env && env.STUDENT_MAX_DEVICES, 10); return n >= 1 && n <= 20 ? n : MAX_STUDENT_DEVICES; };
const DEVICE_COOKIE = 'sa_device';
const DEVICE_RE = /^[A-Za-z0-9_-]{22,64}$/;
export function deviceIdFrom(request) {
    const v = parseCookies(request.headers.get('Cookie'))[DEVICE_COOKIE];
    return v && DEVICE_RE.test(v) ? v : null;
}
export function newDeviceId() {
    const b = crypto.getRandomValues(new Uint8Array(18));
    return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export const deviceCookie = (id) => `${DEVICE_COOKIE}=${id}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${2 * 365 * 86400}`;
export function deviceLabel(request) {
    const ua = request.headers.get('User-Agent') || '';
    const os = /iPad/.test(ua) ? 'iPad' : /iPhone/.test(ua) ? 'iPhone' : /Android/.test(ua) ? (/Mobile/.test(ua) ? 'Android phone' : 'Android tablet')
        : /Windows/.test(ua) ? 'Windows PC' : /Macintosh/.test(ua) ? 'Mac' : /CrOS/.test(ua) ? 'Chromebook' : /Linux/.test(ua) ? 'Linux PC' : 'Device';
    const br = /SamsungBrowser/.test(ua) ? 'Samsung Internet' : /Edg\//.test(ua) ? 'Edge' : /OPR\/|Opera/.test(ua) ? 'Opera' : /Firefox|FxiOS/.test(ua) ? 'Firefox'
        : /CriOS|Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : '';
    return br ? `${os} · ${br}` : os;
}
export const DEVICE_LIMIT_MESSAGE = 'لقد وصلت للحد الأقصى للأجهزة المسموح بها (جهازين فقط). تواصل مع التيم لإعادة الضبط';
// → { ok: true } or { ok: false } when this would be a 3rd device
export async function claimDevice(db, request, studentId, deviceId, env) {
    const MAX = maxDevices(env);
    await ensureAppSchema(db);
    const known = await db.prepare('SELECT id FROM student_devices WHERE student_id = ? AND device_id = ?').bind(studentId, deviceId).first();
    if (known) {
        await db.prepare('UPDATE student_devices SET last_seen_at = CURRENT_TIMESTAMP, label = ? WHERE id = ?').bind(deviceLabel(request), known.id).run();
        return { ok: true };
    }
    const n = await db.prepare('SELECT COUNT(*) as c FROM student_devices WHERE student_id = ?').bind(studentId).first();
    if ((n && n.c) >= MAX) return { ok: false };
    await db.prepare('INSERT OR IGNORE INTO student_devices (student_id, device_id, label) VALUES (?, ?, ?)').bind(studentId, deviceId, deviceLabel(request)).run();
    // two sign-ins at the same moment can't sneak in a 3rd device
    const after = await db.prepare('SELECT COUNT(*) as c FROM student_devices WHERE student_id = ?').bind(studentId).first();
    if (after && after.c > MAX) {
        await db.prepare('DELETE FROM student_devices WHERE student_id = ? AND device_id = ?').bind(studentId, deviceId).run();
        return { ok: false };
    }
    return { ok: true };
}

// Why a student request was refused (so the sign-in page can explain a device limit)
export const STUDENT_REFUSAL = new WeakMap();
// → { id, grade, firstName, lastName, gender, branch } or null
export async function verifyStudentRequest(request, env, db) {
    const secret = studentSecret(env);
    if (!secret) return null;
    const token = parseCookies(request.headers.get('Cookie'))[STUDENT_COOKIE];
    const payload = await readToken(token, secret);
    if (!payload || !payload.sid) return null;
    await ensureAppSchema(db);
    const row = await db.prepare(
        'SELECT student_id, grade, first_name, last_name, gender, branch, session_version FROM students WHERE student_id = ?'
    ).bind(payload.sid).first();
    if (!row || (row.session_version || 1) !== payload.v) return null;
    if (payload.d) {
        // This device must still be one of the student's devices ("Reset devices" signs it out)
        const dev = await db.prepare('SELECT 1 as ok FROM student_devices WHERE student_id = ? AND device_id = ?').bind(row.student_id, payload.d).first();
        if (!dev) return null;
    } else {
        // Signed in before the device limit existed: the next page load registers this device
        // (auth?action=validate). If the student already has 2 devices, this one is a 3rd → refused.
        const n = await db.prepare('SELECT COUNT(*) as c FROM student_devices WHERE student_id = ?').bind(row.student_id).first();
        if (n && n.c >= maxDevices(env)) { STUDENT_REFUSAL.set(request, 'DEVICE_LIMIT'); return null; }
    }
    return { needsDevice: !payload.d, deviceId: payload.d || null, version: row.session_version || 1, id: row.student_id, grade: String(row.grade || '').toLowerCase(), firstName: row.first_name, lastName: row.last_name, gender: row.gender, branch: row.branch };
}
// Use in student APIs:
//   const who = await requireStudent(request, env, db, claimedId);
//   if (who.error) return who.error;     who.id is the verified student code
export async function requireStudent(request, env, db, claimedId) {
    const st = await verifyStudentRequest(request, env, db);
    if (st) return st;
    if (legacyStudentsAllowed(env) && claimedId) {
        const row = await db.prepare('SELECT student_id, grade, first_name, last_name, gender, branch FROM students WHERE student_id = ?').bind(String(claimedId).trim()).first();
        if (row) return { id: row.student_id, grade: String(row.grade || '').toLowerCase(), firstName: row.first_name, lastName: row.last_name, gender: row.gender, branch: row.branch, legacy: true };
    }
    return { error: Response.json({ error: 'Please sign in again.', code: 'STUDENT_SESSION_REQUIRED' }, { status: 401 }) };
}

// ---------- Exported: who is calling? ----------
// Returns the staff member (truthy) or null. The role is read fresh from the database,
// so disabling an account or changing its password signs it out everywhere immediately.
export async function verifyAdminRequest(request, env) {
    const secret = getTokenSecret(env);
    if (!secret) return null;
    const token = parseCookies(request.headers.get('Cookie'))[COOKIE_NAME];
    const payload = await readToken(token, secret);
    if (!payload || !payload.sid) return null;
    const db = getDb(env);
    await ensureStaffSchema(db);
    const s = await db.prepare(
        'SELECT id, username, display_name, role, active, token_version FROM staff WHERE id = ?'
    ).bind(payload.sid).first();
    if (!s || !s.active || s.token_version !== payload.v) return null;
    return publicStaff(s);
}

// Use in API files:
//   const auth = await requireStaff(request, env, 'students.delete');
//   if (auth.error) return auth.error;
//   ... auth.staff
export async function requireStaff(request, env, permission) {
    const staff = await verifyAdminRequest(request, env);
    if (!staff) {
        return { error: Response.json({ error: 'غير مصرح — يرجى تسجيل الدخول', code: 'UNAUTHENTICATED' }, { status: 401 }) };
    }
    if (permission && !can(staff, permission)) {
        return { error: Response.json({ error: 'الصلاحية دي لمس مروة بس', code: 'FORBIDDEN' }, { status: 403 }), staff };
    }
    return { staff };
}

// Audit log. auditStmt() returns a statement to put inside the SAME db.batch as the change,
// so a destructive change and its log entry are saved together or not at all.
export function auditStmt(db, request, staff, action, target, details) {
    let d = details === undefined ? null : JSON.stringify(details);
    if (d && d.length > 200000) d = d.slice(0, 200000) + '…';
    return db.prepare(
        'INSERT INTO audit_log (staff_id, staff_name, role, action, target, details, ip) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).bind(staff ? staff.id : null, staff ? staff.name : null, staff ? staff.role : null, action, target == null ? null : String(target), d, clientIp(request));
}
export async function audit(db, request, staff, action, target, details) {
    try {
        await ensureStaffSchema(db);
        await auditStmt(db, request, staff, action, target, details).run();
    } catch (e) { /* logging must never break the action itself */ }
}

// ---------- Brute-force protection ----------
export async function throttleState(db, key) {
    const row = await db.prepare('SELECT fails, first_fail_at, locked_until FROM auth_throttle WHERE key = ?').bind(key).first();
    return row || { fails: 0, first_fail_at: 0, locked_until: 0 };
}
export async function recordFail(db, key, rule) {
    const now = Date.now();
    const st = await throttleState(db, key);
    const inWindow = now - st.first_fail_at < rule.windowMs;
    const fails = inWindow ? st.fails + 1 : 1;
    const first = inWindow ? st.first_fail_at : now;
    const locked = fails >= rule.fails ? now + rule.lockMs : 0;
    await db.prepare(
        `INSERT INTO auth_throttle (key, fails, first_fail_at, locked_until) VALUES (?, ?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET fails = excluded.fails, first_fail_at = excluded.first_fail_at, locked_until = excluded.locked_until`
    ).bind(key, locked ? 0 : fails, locked ? 0 : first, locked).run();
}
function minutesLeft(until) {
    return Math.max(1, Math.ceil((until - Date.now()) / 60000));
}

const USERNAME_RE = /^[a-z0-9._-]{3,32}$/;
const NAME_RE = /^[^<>]{2,40}$/;
function checkNewPassword(p) {
    if (typeof p !== 'string' || p.length < 8 || p.length > 128) return 'كلمة السر لازم تكون 8 حروف على الأقل';
    return null;
}

// ---------- Router ----------
export async function onRequest(context) {
    const { request, env } = context;
    const url = new URL(request.url);
    const action = url.searchParams.get('action');
    const method = request.method;
    const db = getDb(env);
    const secret = getTokenSecret(env);

    const json = (body, status = 200, headers = {}) => Response.json(body, { status, headers });
    const notConfigured = () => json({
        error: 'لوحة التحكم مش متجهزة على السيرفر لسه: لازم يتضاف ADMIN_TOKEN_SECRET في إعدادات Cloudflare.',
        code: 'NOT_CONFIGURED'
    }, 503);

    async function startSession(staffRow) {
        const hours = SESSION_HOURS[staffRow.role] || 12;
        const token = await createToken({ sid: staffRow.id, v: staffRow.token_version, iat: Date.now(), exp: Date.now() + hours * 3600 * 1000 }, secret);
        return sessionCookie(token, hours * 3600);
    }

    try {
        await ensureStaffSchema(db);

        // ── STATUS: what should the login page show? ──
        if (method === 'GET' && action === 'status') {
            const teacher = await db.prepare("SELECT id FROM staff WHERE role = 'teacher' LIMIT 1").first();
            const body = { configured: !!secret, needsSetup: !teacher, setupReady: !!getSetupPassword(env) };
            // Diagnostics only while something is wrong (states and setting NAMES — never values)
            if (!secret || (!teacher && !body.setupReady)) {
                body.secretState = secretState(env);
                body.setupState = setupState(env);
                body.similarNames = nearMissNames(env);
                // Which settings actually reached this deployment — NAMES only, never values
                body.settingNames = Object.keys(env || {}).filter(k => typeof env[k] === 'string').sort();
                body.build = BUILD;
            }
            return json(body);
        }

        // ── FIRST-TIME SETUP: create Miss Marwa's own account ──
        if (method === 'POST' && action === 'setup') {
            if (!secret) return notConfigured();
            const setupPassword = getSetupPassword(env);
            if (!setupPassword) {
                return json({ error: 'لازم ADMIN_PASSWORD يكون متضاف في إعدادات Cloudflare (ومختلف عن القديم) قبل الإعداد.', code: 'SETUP_NOT_READY' }, 503);
            }
            const existing = await db.prepare("SELECT id FROM staff WHERE role = 'teacher' LIMIT 1").first();
            if (existing) return json({ error: 'الحساب الرئيسي اتعمل بالفعل — سجّلي دخول عادي.' }, 409);

            const ipKey = 'ip:' + clientIp(request);
            const ipSt = await throttleState(db, ipKey);
            if (ipSt.locked_until > Date.now()) return json({ error: `محاولات كتير — جرّبي بعد ${minutesLeft(ipSt.locked_until)} دقيقة` }, 429);

            const body = await request.json().catch(() => ({}));
            if (!safeEqual(String(body.setupPassword || ''), setupPassword)) {
                await recordFail(db, ipKey, IP_LOCK);
                return json({ error: 'الرمز السري الحالي غير صحيح' }, 401);
            }
            const username = String(body.username || '').trim().toLowerCase();
            const displayName = String(body.displayName || '').trim();
            if (!USERNAME_RE.test(username)) return json({ error: 'اسم المستخدم: 3–32 حرف إنجليزي صغير أو أرقام (مسموح . _ -)' }, 400);
            if (!NAME_RE.test(displayName)) return json({ error: 'الاسم الظاهر غير صالح' }, 400);
            const pwErr = checkNewPassword(body.password);
            if (pwErr) return json({ error: pwErr }, 400);
            if (body.password === setupPassword) return json({ error: 'اختاري كلمة سر جديدة مختلفة عن الرمز القديم' }, 400);

            const hash = await hashPassword(body.password);
            const r = await db.prepare(
                "INSERT INTO staff (username, display_name, role, password_hash, last_login_at) VALUES (?, ?, 'teacher', ?, CURRENT_TIMESTAMP)"
            ).bind(username, displayName, hash).run();
            const row = await db.prepare('SELECT * FROM staff WHERE id = ?').bind(r.meta.last_row_id).first();
            await audit(db, request, publicStaff(row), 'staff.setup', username, null);
            return json({ success: true, staff: publicStaff(row), permissions: permissionsFor('teacher') }, 200, { 'Set-Cookie': await startSession(row) });
        }

        // ── LOGIN ──
        if (method === 'POST' && action === 'login') {
            if (!secret) return notConfigured();
            const body = await request.json().catch(() => ({}));
            const username = String(body.username || '').trim().toLowerCase();
            const password = String(body.password || '');
            if (!username || !password) return json({ error: 'اكتبي اسم المستخدم وكلمة السر' }, 400);

            const userKey = 'u:' + username;
            const ipKey = 'ip:' + clientIp(request);
            const [uSt, ipSt] = await Promise.all([throttleState(db, userKey), throttleState(db, ipKey)]);
            const lockedUntil = Math.max(uSt.locked_until, ipSt.locked_until);
            if (lockedUntil > Date.now()) {
                return json({ error: `محاولات غلط كتير — الحساب مقفول مؤقتاً، جرّبي بعد ${minutesLeft(lockedUntil)} دقيقة`, code: 'LOCKED' }, 429);
            }

            const row = await db.prepare('SELECT * FROM staff WHERE username = ?').bind(username).first();
            // Always run the hash so a wrong username takes as long as a wrong password
            const ok = await verifyPassword(password, row ? row.password_hash : 'pbkdf2$1000$AAAAAAAAAAAAAAAAAAAAAA==$x');
            if (!row || !ok || !row.active) {
                await recordFail(db, userKey, USER_LOCK);
                await recordFail(db, ipKey, IP_LOCK);
                if (row) await audit(db, request, publicStaff(row), 'auth.login-failed', username, row.active ? null : { reason: 'disabled' });
                return json({ error: 'اسم المستخدم أو كلمة السر غير صحيحة' }, 401);
            }

            await db.batch([
                db.prepare('DELETE FROM auth_throttle WHERE key = ?').bind(userKey),
                db.prepare('UPDATE staff SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?').bind(row.id),
                auditStmt(db, request, publicStaff(row), 'auth.login', username, null)
            ]);
            return json({ success: true, staff: publicStaff(row), permissions: permissionsFor(row.role) }, 200, { 'Set-Cookie': await startSession(row) });
        }

        // ── LOGOUT ──
        if (method === 'POST' && action === 'logout') {
            return json({ success: true }, 200, { 'Set-Cookie': CLEAR_COOKIE });
        }

        // ── WHO AM I ──
        if (method === 'GET' && (action === 'me' || action === 'check')) {
            if (!secret) return json({ authenticated: false, configured: false });
            const staff = await verifyAdminRequest(request, env);
            if (!staff) {
                const hadCookie = !!parseCookies(request.headers.get('Cookie'))[COOKIE_NAME];
                return json({ authenticated: false }, 200, hadCookie ? { 'Set-Cookie': CLEAR_COOKIE } : {});
            }
            return json({ authenticated: true, staff, permissions: permissionsFor(staff.role) });
        }

        // Everything below needs a signed-in staff member
        if (!secret) return notConfigured();
        const me = await verifyAdminRequest(request, env);
        if (!me) return json({ error: 'غير مصرح — يرجى تسجيل الدخول', code: 'UNAUTHENTICATED' }, 401);

        // ── CHANGE OWN PASSWORD ──
        if (method === 'POST' && action === 'change-password') {
            const body = await request.json().catch(() => ({}));
            const row = await db.prepare('SELECT * FROM staff WHERE id = ?').bind(me.id).first();
            if (!(await verifyPassword(String(body.currentPassword || ''), row.password_hash))) {
                return json({ error: 'كلمة السر الحالية غير صحيحة' }, 400);
            }
            const pwErr = checkNewPassword(body.newPassword);
            if (pwErr) return json({ error: pwErr }, 400);
            const hash = await hashPassword(body.newPassword);
            await db.batch([
                db.prepare('UPDATE staff SET password_hash = ?, token_version = token_version + 1 WHERE id = ?').bind(hash, me.id),
                auditStmt(db, request, me, 'staff.change-own-password', me.username, null)
            ]);
            const fresh = await db.prepare('SELECT * FROM staff WHERE id = ?').bind(me.id).first();
            return json({ success: true }, 200, { 'Set-Cookie': await startSession(fresh) });
        }

        // ── STAFF MANAGEMENT (teacher only) ──
        if (action === 'staff-list' || action === 'staff-create' || action === 'staff-update') {
            if (!can(me, 'staff.manage')) return json({ error: 'الصلاحية دي لمس مروة بس', code: 'FORBIDDEN' }, 403);

            if (method === 'GET' && action === 'staff-list') {
                const { results } = await db.prepare(
                    'SELECT id, username, display_name as name, role, active, last_login_at as lastLoginAt, created_at as createdAt FROM staff ORDER BY role DESC, id ASC'
                ).all();
                return json({ staff: results.map(r => ({ ...r, active: !!r.active })) });
            }

            if (method === 'POST' && action === 'staff-create') {
                const body = await request.json().catch(() => ({}));
                const username = String(body.username || '').trim().toLowerCase();
                const displayName = String(body.displayName || '').trim();
                if (!USERNAME_RE.test(username)) return json({ error: 'اسم المستخدم: 3–32 حرف إنجليزي صغير أو أرقام (مسموح . _ -)' }, 400);
                if (!NAME_RE.test(displayName)) return json({ error: 'الاسم الظاهر غير صالح' }, 400);
                const pwErr = checkNewPassword(body.password);
                if (pwErr) return json({ error: pwErr }, 400);
                const taken = await db.prepare('SELECT id FROM staff WHERE username = ?').bind(username).first();
                if (taken) return json({ error: 'اسم المستخدم ده مستخدم قبل كده' }, 409);
                const hash = await hashPassword(body.password);
                await db.batch([
                    db.prepare("INSERT INTO staff (username, display_name, role, password_hash) VALUES (?, ?, 'assistant', ?)").bind(username, displayName, hash),
                    auditStmt(db, request, me, 'staff.create', username, { displayName, role: 'assistant' })
                ]);
                return json({ success: true });
            }

            if (method === 'POST' && action === 'staff-update') {
                const body = await request.json().catch(() => ({}));
                const target = await db.prepare('SELECT * FROM staff WHERE id = ?').bind(Number(body.id)).first();
                if (!target) return json({ error: 'الحساب غير موجود' }, 404);
                if (target.role === 'teacher' && target.id !== me.id) return json({ error: 'مينفعش تعديل حساب المعلم' }, 403);

                const sets = [], vals = [], changes = {};
                if (body.displayName !== undefined) {
                    const n = String(body.displayName).trim();
                    if (!NAME_RE.test(n)) return json({ error: 'الاسم الظاهر غير صالح' }, 400);
                    sets.push('display_name = ?'); vals.push(n); changes.displayName = n;
                }
                let signOut = false;
                if (body.active !== undefined) {
                    if (target.id === me.id) return json({ error: 'مينفعش توقفي حسابك أنتِ' }, 400);
                    sets.push('active = ?'); vals.push(body.active ? 1 : 0); changes.active = !!body.active;
                    if (!body.active) signOut = true;
                }
                if (body.password !== undefined) {
                    if (target.id === me.id) return json({ error: 'غيّري كلمة سرك من "كلمة السر بتاعتي"' }, 400);
                    const pwErr = checkNewPassword(body.password);
                    if (pwErr) return json({ error: pwErr }, 400);
                    sets.push('password_hash = ?'); vals.push(await hashPassword(body.password)); changes.password = 'reset';
                    signOut = true;
                }
                if (!sets.length) return json({ error: 'مفيش تعديل' }, 400);
                if (signOut) sets.push('token_version = token_version + 1');
                await db.batch([
                    db.prepare(`UPDATE staff SET ${sets.join(', ')} WHERE id = ?`).bind(...vals, target.id),
                    auditStmt(db, request, me, 'staff.update', target.username, changes)
                ]);
                return json({ success: true });
            }
        }

        // ── AUDIT LOG (teacher only) ──
        if (method === 'GET' && action === 'audit-log') {
            if (!can(me, 'audit.view')) return json({ error: 'الصلاحية دي لمس مروة بس', code: 'FORBIDDEN' }, 403);
            const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit')) || 50));
            const before = Number(url.searchParams.get('before')) || 0;
            const staffId = Number(url.searchParams.get('staffId')) || 0;
            const where = [], vals = [];
            if (before) { where.push('id < ?'); vals.push(before); }
            if (staffId) { where.push('staff_id = ?'); vals.push(staffId); }
            const { results } = await db.prepare(
                `SELECT id, staff_id as staffId, staff_name as staffName, role, action, target, details, created_at as createdAt
                 FROM audit_log ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT ?`
            ).bind(...vals, limit).all();
            return json({
                entries: results.map(r => { let d = null; try { d = r.details ? JSON.parse(r.details) : null; } catch (e) { d = r.details; } return { ...r, details: d }; }),
                hasMore: results.length === limit
            });
        }

        return json({ error: 'Invalid action' }, 400);
    } catch (err) {
        // The detail helps fix setup problems; it is a database/runtime message, never a secret
        return json({ error: 'حصل خطأ في السيرفر', code: 'SERVER_ERROR', detail: String(err && err.message ? err.message : err).slice(0, 400) }, 500);
    }
}
