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

function getDb(env) {
    return env.DB || env.D1_DB;
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
    'offline.edit-exam': BOTH,
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
const SESSION_HOURS = { teacher: 24 * 30, assistant: 12 };
const PBKDF2_ITERATIONS = 100000; // the maximum Cloudflare Workers allows
const USER_LOCK = { fails: 5, windowMs: 15 * 60 * 1000, lockMs: 15 * 60 * 1000 };
const IP_LOCK = { fails: 20, windowMs: 15 * 60 * 1000, lockMs: 15 * 60 * 1000 };

// The signing secret MUST come from a Cloudflare secret. The old code fell back to a
// string that is visible on GitHub — anyone could have forged an admin cookie with it.
function getTokenSecret(env) {
    const s = env.ADMIN_TOKEN_SECRET;
    return (typeof s === 'string' && s.length >= 16) ? s : null;
}
// Only used once, to prove it's Miss Marwa during first-time setup.
function getSetupPassword(env) {
    const p = env.ADMIN_PASSWORD;
    return (typeof p === 'string' && p.length >= 6 && p !== 'marwa2026') ? p : null;
}

// ---------- Schema (created automatically, never touches existing tables) ----------
let schemaReady = false;
export async function ensureStaffSchema(db) {
    if (schemaReady) return;
    await db.batch([
        db.prepare(`CREATE TABLE IF NOT EXISTS staff (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            display_name TEXT NOT NULL,
            role TEXT NOT NULL,
            password_hash TEXT NOT NULL,
            active INTEGER NOT NULL DEFAULT 1,
            token_version INTEGER NOT NULL DEFAULT 1,
            last_login_at TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )`),
        db.prepare(`CREATE TABLE IF NOT EXISTS audit_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            staff_id INTEGER,
            staff_name TEXT,
            role TEXT,
            action TEXT NOT NULL,
            target TEXT,
            details TEXT,
            ip TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )`),
        db.prepare(`CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(created_at)`),
        db.prepare(`CREATE TABLE IF NOT EXISTS auth_throttle (
            key TEXT PRIMARY KEY,
            fails INTEGER NOT NULL DEFAULT 0,
            first_fail_at INTEGER NOT NULL DEFAULT 0,
            locked_until INTEGER NOT NULL DEFAULT 0
        )`)
    ]);
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
    const ex = await cols('exams');
    if (ex && ex.length && !ex.includes('shuffle')) steps.push('ALTER TABLE exams ADD COLUMN shuffle INTEGER NOT NULL DEFAULT 1');
    const es = await cols('exam_submissions');
    if (es && es.length && !es.includes('shuffle_seed')) steps.push('ALTER TABLE exam_submissions ADD COLUMN shuffle_seed TEXT');
    steps.push(`CREATE TABLE IF NOT EXISTS student_groups (
        id TEXT PRIMARY KEY, grade TEXT NOT NULL, branch TEXT NOT NULL, name TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 1, created_at TEXT DEFAULT CURRENT_TIMESTAMP)`);
    steps.push(`CREATE TABLE IF NOT EXISTS duplicate_dismissals (
        pair_key TEXT PRIMARY KEY, staff_id INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP)`);
    steps.push('CREATE INDEX IF NOT EXISTS idx_students_grade_phone ON students(grade, phone)');
    for (const q of steps) {
        try { await db.prepare(q).run(); } catch (e) { /* another request may have added it at the same moment */ }
    }
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

function clientIp(request) {
    return request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || '';
}
const publicStaff = (s) => ({ id: s.id, username: s.username, name: s.display_name, role: s.role });

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
async function throttleState(db, key) {
    const row = await db.prepare('SELECT fails, first_fail_at, locked_until FROM auth_throttle WHERE key = ?').bind(key).first();
    return row || { fails: 0, first_fail_at: 0, locked_until: 0 };
}
async function recordFail(db, key, rule) {
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
            return json({ configured: !!secret, needsSetup: !teacher, setupReady: !!getSetupPassword(env) });
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
        return json({ error: 'حصل خطأ في السيرفر' }, 500);
    }
}
