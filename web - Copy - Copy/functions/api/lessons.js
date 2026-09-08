export async function onRequestGet({ request, env }) {
    try {
        const url = new URL(request.url);
        const grade = url.searchParams.get('grade');
        const category = url.searchParams.get('category');

        let query = `SELECT id, title, grade, category, url, notes, strftime('%d/%m/%Y', created_at) as createdAt FROM lessons WHERE 1=1`;
        const params = [];

        if (grade && grade !== 'ALL') {
            query += ` AND lower(grade) = ?`;
            params.push(grade.toLowerCase());
        }
        if (category && category !== 'ALL') {
            query += ` AND lower(category) = ?`;
            params.push(category.toLowerCase());
        }

        query += ` ORDER BY created_at DESC`;

        const stmt = env.DB.prepare(query);
        const { results } = await (params.length > 0 ? stmt.bind(...params) : stmt).all();
        return Response.json(results || []);
    } catch (err) {
        return Response.json({ error: err.message }, { status: 500 });
    }
}

export async function onRequestPost({ request, env }) {
    try {
        const body = await request.json();
        const id = 'ITEM-' + Date.now();
        await env.DB.prepare(
            `INSERT INTO lessons (id, title, grade, category, url, notes) VALUES (?, ?, ?, ?, ?, ?)`
        ).bind(
            id,
            body.title.trim(),
            body.grade.toLowerCase(),
            body.category.toLowerCase(),
            body.url.trim(),
            (body.notes || '').trim()
        ).run();

        return Response.json({ success: true, id });
    } catch (err) {
        return Response.json({ error: err.message }, { status: 500 });
    }
}

export async function onRequestDelete({ request, env }) {
    try {
        const url = new URL(request.url);
        const id = url.searchParams.get('id');
        await env.DB.prepare(`DELETE FROM lessons WHERE id = ?`).bind(id).run();
        return Response.json({ success: true });
    } catch (err) {
        return Response.json({ error: err.message }, { status: 500 });
    }
}