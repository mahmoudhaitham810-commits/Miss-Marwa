export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  
  // بنقرأ الفلاتر اللي جاية من الفرونت إند
  const grade = url.searchParams.get('grade') || 'ALL';
  const category = url.searchParams.get('category') || 'ALL';

  try {
    let query = "SELECT * FROM lessons ORDER BY created_at DESC";
    let params = [];
    
    // فلترة على حسب اختيارات الأدمن
    if (grade !== 'ALL' && category !== 'ALL') {
       query = "SELECT * FROM lessons WHERE grade = ? AND category = ? ORDER BY created_at DESC";
       params = [grade, category];
    } else if (grade !== 'ALL') {
       query = "SELECT * FROM lessons WHERE grade = ? ORDER BY created_at DESC";
       params = [grade];
    } else if (category !== 'ALL') {
       query = "SELECT * FROM lessons WHERE category = ? ORDER BY created_at DESC";
       params = [category];
    }

    const { results } = await env.D1_DB.prepare(query).bind(...params).all();
    return Response.json(results);
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const lesson = await request.json();
    
    // إدخال الدرس الجديد في الداتا بيز
    await env.D1_DB.prepare(
      "INSERT INTO lessons (id, title, grade, category, url, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).bind(
      lesson.id, lesson.title, lesson.grade, lesson.category, lesson.url, lesson.notes || '', lesson.createdAt || new Date().toISOString()
    ).run();

    return Response.json({ success: true, id: lesson.id });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}

export async function onRequestDelete(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const id = url.searchParams.get('id');

  try {
    // حذف الدرس بناءً على الـ ID
    if (id) {
      await env.D1_DB.prepare("DELETE FROM lessons WHERE id = ?").bind(id).run();
      return Response.json({ success: true });
    }
    return Response.json({ error: 'ID is required' }, { status: 400 });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
