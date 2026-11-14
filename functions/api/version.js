// GET /api/version — shows which build of the Functions is running and which settings it receives.
// Setting NAMES only (never values), so it is safe to open in a browser while troubleshooting.
export async function onRequestGet({ env }) {
    const names = Object.keys(env || {}).sort();
    return Response.json({
        functionsBuild: 'phase2-diag-3',
        settingNames: names.filter(k => typeof env[k] === 'string'),
        bindings: names.filter(k => typeof env[k] !== 'string'),
        hasAdminTokenSecret: typeof env.ADMIN_TOKEN_SECRET === 'string',
        adminTokenSecretLength: typeof env.ADMIN_TOKEN_SECRET === 'string' ? env.ADMIN_TOKEN_SECRET.trim().length : 0,
        hasAdminPassword: typeof env.ADMIN_PASSWORD === 'string'
    }, { headers: { 'Cache-Control': 'no-store' } });
}
