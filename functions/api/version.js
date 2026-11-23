import { ensureStaffSchema } from './admin-auth.js';

// GET /api/version — which build of the Functions is running, which settings it receives,
// and whether the database is reachable. Setting NAMES only (never values).
export async function onRequestGet({ env }) {
    const names = Object.keys(env || {}).sort();
    const db = [env.DB, env.D1_DB].find(d => d && typeof d.prepare === "function");
    let database = 'NO D1 DATABASE BINDING — a plain text variable named DB is not a database. Add a D1 binding named DB for this environment.';
    let tables = [];
    if (db) {
        try {
            const { results } = await db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all();
            tables = (results || []).map(r => r.name);
            await ensureStaffSchema(db);
            database = 'ok';
        } catch (e) {
            database = String(e && e.message ? e.message : e).slice(0, 500);
        }
    }
    return Response.json({
        functionsBuild: 'phase2-diag-5',
        settingNames: names.filter(k => typeof env[k] === 'string'),
        bindings: names.filter(k => typeof env[k] !== 'string'),
        dbIsTextVariable: typeof env.DB === 'string',
        hasAdminTokenSecret: typeof env.ADMIN_TOKEN_SECRET === 'string',
        // public page: whether the secret is long enough — never its length (audit 23 Nov 2026)
        adminTokenSecretLongEnough: typeof env.ADMIN_TOKEN_SECRET === 'string' && env.ADMIN_TOKEN_SECRET.trim().length >= 16,
        hasAdminPassword: typeof env.ADMIN_PASSWORD === 'string',
        database,
        tableCount: tables.length        // the table names stay private (anyone can open this URL)
    }, { headers: { 'Cache-Control': 'no-store' } });
}
