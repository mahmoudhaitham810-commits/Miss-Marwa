export async function onRequest(context) {
    const { request, env } = context;
    const url = new URL(request.url);
    const action = url.searchParams.get('action');

    try {
        if (request.method === 'GET' && action === 'list') {
            const { results } = await env.DB.prepare(
                `SELECT student_id as studentId, first_name as firstName, last_name as lastName, 
                phone, parent_phone as parentPhone, grade, created_at as createdAt 
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