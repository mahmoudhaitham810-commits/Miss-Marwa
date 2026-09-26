import { verifyAdminRequest } from './admin-auth.js';

export async function onRequest(context) {
    const { request, env } = context;
    const url = new URL(request.url);
    const action = url.searchParams.get('action');

    // ── حماية: لازم يكون أدمن ──
    const isAdmin = await verifyAdminRequest(request, env);
    if (!isAdmin) {
        return new Response(JSON.stringify({ error: 'غير مصرح — يرجى تسجيل الدخول كمسؤول' }), {
            status: 401, headers: { 'Content-Type': 'application/json' }
        });
    }

    // الداتا بيز ممكن تكون متسجلة في Cloudflare باسم DB أو D1_DB
    // السطر ده بيتأكد إننا بنمسك الاسم الصح مهما كان
    const db = env.DB || env.D1_DB;

    try {
        if (request.method === 'GET' && action === 'list') {
            const { results } = await db.prepare(
                `SELECT student_id as studentId, first_name as firstName, last_name as lastName, 
                gender, branch, phone, parent_phone as parentPhone, grade, created_at as createdAt 
         FROM students ORDER BY id DESC`
            ).all();

            return new Response(JSON.stringify(results), {
                headers: { 'Content-Type': 'application/json' }
            });
        }

        return new Response(JSON.stringify({ error: 'Invalid action' }), { status: 400 });
    } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500 });
    }
}
