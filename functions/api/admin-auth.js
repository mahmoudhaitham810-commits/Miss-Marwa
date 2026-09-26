// ============================================================
// Admin Authentication API
// ============================================================
// POST /api/admin-auth?action=login   → validates password, sets HttpOnly cookie
// POST /api/admin-auth?action=logout  → clears the cookie
// GET  /api/admin-auth?action=check   → verifies the cookie is valid (used by admin.html on load)
// ============================================================

function getDb(env) {
    return env.DB || env.D1_DB;
}

// HMAC-SHA256 signing using the Web Crypto API (available in Cloudflare Workers)
async function hmacSign(message, secret) {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
        'raw', encoder.encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false, ['sign']
    );
    const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
    return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function hmacVerify(message, signature, secret) {
    const expected = await hmacSign(message, secret);
    return expected === signature;
}

// Create a signed token: base64(payload).signature
async function createToken(payload, secret) {
    const json = JSON.stringify(payload);
    const b64 = btoa(unescape(encodeURIComponent(json)));
    const sig = await hmacSign(b64, secret);
    return `${b64}.${sig}`;
}

// Verify and decode a signed token
async function verifyToken(token, secret) {
    if (!token || !token.includes('.')) return null;
    const [b64, sig] = token.split('.');
    const valid = await hmacVerify(b64, sig, secret);
    if (!valid) return null;
    try {
        const json = decodeURIComponent(escape(atob(b64)));
        const payload = JSON.parse(json);
        // Check expiration
        if (payload.exp && Date.now() > payload.exp) return null;
        return payload;
    } catch {
        return null;
    }
}

// The admin password. In production you should store a hash in env vars,
// but this matches the existing pattern used throughout the codebase.
// The secret used for HMAC signing of the session token.
function getAdminPassword(env) {
    return env.ADMIN_PASSWORD || 'marwa2026';
}
function getTokenSecret(env) {
    return env.ADMIN_TOKEN_SECRET || 'science-academy-secret-key-2026';
}

const COOKIE_NAME = 'admin_session';
const SESSION_HOURS = 12;

export async function onRequest(context) {
    const { request, env } = context;
    const url = new URL(request.url);
    const action = url.searchParams.get('action');

    const corsHeaders = {
        'Content-Type': 'application/json',
    };

    try {
        // ── LOGIN ──
        if (request.method === 'POST' && action === 'login') {
            const { password } = await request.json();
            const correctPassword = getAdminPassword(env);

            if (!password || password !== correctPassword) {
                return new Response(JSON.stringify({ error: 'الرمز السري غير صحيح' }), {
                    status: 401, headers: corsHeaders
                });
            }

            const secret = getTokenSecret(env);
            const token = await createToken({
                role: 'admin',
                iat: Date.now(),
                exp: Date.now() + (SESSION_HOURS * 60 * 60 * 1000)
            }, secret);

            // Set HttpOnly cookie — secure on HTTPS (Cloudflare Pages), SameSite=Strict
            const cookieHeader = `${COOKIE_NAME}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${SESSION_HOURS * 3600}`;

            return new Response(JSON.stringify({ success: true }), {
                status: 200,
                headers: { ...corsHeaders, 'Set-Cookie': cookieHeader }
            });
        }

        // ── LOGOUT ──
        if (request.method === 'POST' && action === 'logout') {
            const cookieHeader = `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`;
            return new Response(JSON.stringify({ success: true }), {
                status: 200,
                headers: { ...corsHeaders, 'Set-Cookie': cookieHeader }
            });
        }

        // ── CHECK AUTH ──
        if (request.method === 'GET' && action === 'check') {
            const cookie = parseCookies(request.headers.get('Cookie') || '');
            const token = cookie[COOKIE_NAME];

            if (!token) {
                return new Response(JSON.stringify({ authenticated: false }), {
                    status: 200, headers: corsHeaders
                });
            }

            const secret = getTokenSecret(env);
            const payload = await verifyToken(token, secret);

            if (!payload || payload.role !== 'admin') {
                // Clear invalid cookie
                const cookieHeader = `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`;
                return new Response(JSON.stringify({ authenticated: false }), {
                    status: 200, headers: { ...corsHeaders, 'Set-Cookie': cookieHeader }
                });
            }

            return new Response(JSON.stringify({ authenticated: true }), {
                status: 200, headers: corsHeaders
            });
        }

        return new Response(JSON.stringify({ error: 'Invalid action' }), {
            status: 400, headers: corsHeaders
        });

    } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
            status: 500, headers: corsHeaders
        });
    }
}

// Helper: parse cookie header string into an object
function parseCookies(cookieStr) {
    const cookies = {};
    if (!cookieStr) return cookies;
    cookieStr.split(';').forEach(pair => {
        const [key, ...rest] = pair.trim().split('=');
        if (key) cookies[key.trim()] = rest.join('=').trim();
    });
    return cookies;
}

// ── EXPORTED: verifyAdminRequest ──
// Other API files import this to protect admin-only endpoints
export async function verifyAdminRequest(request, env) {
    const cookie = parseCookies(request.headers.get('Cookie') || '');
    const token = cookie[COOKIE_NAME];
    if (!token) return false;

    const secret = getTokenSecret(env);
    const payload = await verifyToken(token, secret);
    return payload && payload.role === 'admin';
}
