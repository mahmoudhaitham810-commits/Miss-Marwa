let tablesCreated = false;

async function ensureTables(db) {
  if (tablesCreated) return;
  const queries = [
    `CREATE TABLE IF NOT EXISTS assistant_conversations (id INTEGER PRIMARY KEY AUTOINCREMENT, student_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS assistant_conversation_summaries (id INTEGER PRIMARY KEY AUTOINCREMENT, student_id TEXT NOT NULL, summary TEXT NOT NULL, covers_up_to_message_id INTEGER, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS student_learning_profile (student_id TEXT PRIMARY KEY, known_weak_topics TEXT, preferred_study_times TEXT, conversational_notes TEXT, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)`
  ];
  for (const q of queries) {
    await db.prepare(q).run();
  }
  tablesCreated = true;
}

const SYSTEM_PROMPT = `You are "مساعد مس مروة الذكي" — an AI tutor and platform assistant for Science Academy, an educational platform serving Prep1, Prep2, Prep3, and Secondary 1 students in Egypt.

=== IDENTITY ===
Your name is "مساعد مس مروة الذكي". You were built by Miss Marwa to help her students learn, stay organized, and enjoy the subject — and to give parents clear, professional updates on their child's progress.

=== AUDIENCE DETECTION (do this first, every conversation) ===
Determine whether you are speaking with a STUDENT or a PARENT.
- Default assumption: whoever is logged into the student's account is the student, unless they say otherwise ("أنا والدها", "I'm his father", "ابني...").
- If a parent identifies themselves, switch immediately and completely to PARENT MODE for the rest of that conversation.

=== STUDENT MODE: TONE ===
- Speak in warm, funny, colloquial Egyptian Arabic — like a supportive study buddy, not a formal teacher.
- Use the student's first name naturally and, once rapport is established, light friendly nicknames are fine.
- It is completely fine to joke around, make science puns, and be playful in general conversation.
- Blend Arabic and English naturally: read an English exam question as-is, explain the underlying concept in Egyptian Arabic, and keep scientific terms in English.

=== STUDENT MODE: TEACHING STATE ===
The moment you are explaining a scientific concept, walking through a wrong answer, or correcting a misunderstanding, your tone must shift: become precise, structured, and academically serious. Jokes pause during actual teaching moments.

=== PARENT MODE: TONE ===
- Fully formal, respectful Modern Standard Arabic.
- No jokes, no nicknames.
- Give constructive, specific, evidence-based feedback grounded in real data via tools.

=== THE MOST IMPORTANT RULE: NEVER GUESS PLATFORM DATA ===
You must never state a deadline, a grade, a rank, or content status from memory. Every such fact MUST come from an actual tool call. If a tool call fails, say so honestly. Guessing platform data undermines all trust.

=== DATA BOUNDARIES (security-critical) ===
You may only ever discuss the platform data of the student currently authenticated in this session. Never attempt to look up another student's data.

=== EMOTIONAL SAFETY NET ===
If a student expresses distress (bullying, family conflict, depression), do not counsel them. Respond with warmth, take it seriously, and gently encourage them to talk to Miss Marwa or a parent.`;

const functionDeclarations = [
  {
    name: "get_student_profile",
    description: "Returns student name, grade, branch, streak, badges.",
    parameters: { type: "OBJECT", properties: {} }
  },
  {
    name: "get_exam_deadlines",
    description: "Returns open online exams for the student's grade with expiry dates.",
    parameters: { type: "OBJECT", properties: {} }
  },
  {
    name: "get_new_content",
    description: "Returns recently added videos/summaries for the student's grade.",
    parameters: { type: "OBJECT", properties: {} }
  },
  {
    name: "get_my_grades_and_rank",
    description: "Returns student's online + offline results, plus rank.",
    parameters: { type: "OBJECT", properties: {} }
  },
  {
    name: "get_wrong_answers",
    description: "Returns which questions the student got wrong for a specific exam.",
    parameters: {
      type: "OBJECT",
      properties: {
        exam_title: { type: "STRING", description: "The exact title of the exam" }
      },
      required: ["exam_title"]
    }
  },
  {
    name: "get_pdf_content",
    description: "Returns the URL and notes for a specific lesson/summary.",
    parameters: {
      type: "OBJECT",
      properties: {
        lesson_title: { type: "STRING", description: "The title of the lesson/summary" }
      },
      required: ["lesson_title"]
    }
  },
  {
    name: "get_parent_child_summary",
    description: "Returns comprehensive summary for parent mode: student profile + all grades + attendance streak + recent activity.",
    parameters: { type: "OBJECT", properties: {} }
  }
];

// ─── Tool Execution ───
async function executeTool(call, studentCheck, db) {
  const name = call.name;
  const args = call.args || {};
  const studentId = studentCheck.student_id;
  const grade = studentCheck.grade;

  try {
    switch (name) {
      case "get_student_profile": {
        return {
          first_name: studentCheck.first_name,
          last_name: studentCheck.last_name,
          grade: studentCheck.grade,
          branch: studentCheck.branch || '',
          current_streak: studentCheck.current_streak || 0,
          longest_streak: studentCheck.longest_streak || 0
        };
      }
      case "get_exam_deadlines": {
        const exams = await db.prepare("SELECT id, title, expires_at FROM exams WHERE grade = ? AND expires_at > datetime('now') ORDER BY expires_at ASC").bind(grade).all();
        const submissions = await db.prepare("SELECT exam_id FROM exam_submissions WHERE student_id = ?").bind(studentId).all();
        const subMap = new Set((submissions.results || []).map(s => s.exam_id));
        const openExams = (exams.results || []).filter(e => !subMap.has(e.id));
        return { openExams };
      }
      case "get_new_content": {
        const lessons = await db.prepare("SELECT id, title, category, url, created_at FROM lessons WHERE grade = ? ORDER BY created_at DESC LIMIT 10").bind(grade).all();
        return { newContent: lessons.results || [] };
      }
      case "get_my_grades_and_rank": {
        const online = await db.prepare("SELECT sub.score, e.title, e.questions FROM exam_submissions sub JOIN exams e ON e.id = sub.exam_id WHERE sub.student_id = ? AND sub.status = 'submitted'").bind(studentId).all();
        const offline = await db.prepare("SELECT og.score, oe.exam_name, oe.total_marks FROM offline_grades og JOIN offline_exams oe ON oe.id = og.exam_id WHERE og.student_id = ?").bind(studentId).all();

        // Rank calculation
        let rank = "N/A";
        try {
          const allOnlineScores = await db.prepare(`SELECT sub.student_id, AVG(CAST(sub.score AS REAL) / json_array_length(e.questions)) as avg_score 
                                                    FROM exam_submissions sub 
                                                    JOIN exams e ON e.id = sub.exam_id 
                                                    JOIN students s ON s.student_id = sub.student_id 
                                                    WHERE s.grade = ? AND sub.status = 'submitted' 
                                                    GROUP BY sub.student_id`).bind(grade).all();

          if (allOnlineScores.results && allOnlineScores.results.length > 0) {
            const myAvg = allOnlineScores.results.find(s => s.student_id === studentId)?.avg_score;
            if (myAvg !== undefined && myAvg !== null) {
              const higher = allOnlineScores.results.filter(s => s.avg_score > myAvg).length;
              rank = `${higher + 1} من ${allOnlineScores.results.length}`;
            }
          }
        } catch (rankErr) {
          // json_array_length may not exist in all D1 versions; degrade gracefully
          rank = "غير متاح";
        }

        return { onlineGrades: online.results || [], offlineGrades: offline.results || [], rank };
      }
      case "get_wrong_answers": {
        const exam = await db.prepare("SELECT id, questions FROM exams WHERE grade = ? AND title LIKE ?").bind(grade, `%${args.exam_title}%`).first();
        if (!exam) return { error: "لم يتم العثور على الامتحان" };

        const sub = await db.prepare("SELECT answers FROM exam_submissions WHERE student_id = ? AND exam_id = ? AND status = 'submitted'").bind(studentId, exam.id).first();
        if (!sub) return { error: "لم يتم العثور على إجابات لهذا الامتحان" };

        const questions = JSON.parse(exam.questions || "[]");
        const answers = JSON.parse(sub.answers || "[]");
        const wrongAnswers = [];

        questions.forEach((q, index) => {
          const studentAns = Array.isArray(answers) ? answers[index] : undefined;
          if (studentAns === undefined || studentAns === null || studentAns !== q.correctIndex) {
            wrongAnswers.push({
              questionNumber: index + 1,
              questionText: q.question || q.text || '',
              options: q.options,
              correctAnswer: q.options ? q.options[q.correctIndex] : '',
              studentAnswer: (studentAns !== undefined && studentAns !== null && q.options && q.options[studentAns]) ? q.options[studentAns] : 'لم يُجَب'
            });
          }
        });
        return { wrongAnswers, totalQuestions: questions.length, totalWrong: wrongAnswers.length };
      }
      case "get_pdf_content": {
        const lesson = await db.prepare("SELECT url, notes FROM lessons WHERE grade = ? AND title LIKE ?").bind(grade, `%${args.lesson_title}%`).first();
        if (!lesson) return { error: "لم يتم العثور على الملخص" };
        return { url: lesson.url, notes: lesson.notes || '' };
      }
      case "get_parent_child_summary": {
        const profile = {
          first_name: studentCheck.first_name,
          last_name: studentCheck.last_name,
          grade: studentCheck.grade,
          current_streak: studentCheck.current_streak || 0
        };
        const online = await db.prepare("SELECT sub.score, e.title FROM exam_submissions sub JOIN exams e ON e.id = sub.exam_id WHERE sub.student_id = ?").bind(studentId).all();
        const offline = await db.prepare("SELECT og.score, oe.exam_name, oe.total_marks FROM offline_grades og JOIN offline_exams oe ON oe.id = og.exam_id WHERE og.student_id = ?").bind(studentId).all();
        let recentActivity = { results: [] };
        try {
          recentActivity = await db.prepare("SELECT content_type, created_at FROM content_views WHERE student_id = ? ORDER BY created_at DESC LIMIT 5").bind(studentId).all();
        } catch (e) { /* content_views table may not exist yet */ }

        return { profile, onlineGrades: online.results || [], offlineGrades: offline.results || [], recentActivity: recentActivity.results || [] };
      }
      default:
        return { error: `الأداة ${name} غير موجودة` };
    }
  } catch (err) {
    return { error: `خطأ في تنفيذ الأداة: ${err.message}` };
  }
}

// ─── Gemini API Call with Timeout, Retries, and Graceful Degradation ───
const GEMINI_TIMEOUT_MS = 7000;
const GEMINI_MAX_RETRIES = 2;
const GEMINI_FALLBACK_MSG = "المساعد الذكي يواجه ضغطاً كبيراً حالياً، يرجى المحاولة بعد قليل. 🙏";

async function callGemini(env, payload) {
  if (!env.GEMINI_API_KEY) {
    throw new Error("Gemini API failed - Status: ConfigError | Details: GEMINI_API_KEY is not defined in environment variables.");
  }

  const url = `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash-latest:generateContent?key=${env.GEMINI_API_KEY}`;
  let lastError = null;

  for (let attempt = 0; attempt <= GEMINI_MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      // Retryable status codes (503 Service Unavailable, 429 Rate Limit)
      if (res.status === 503 || res.status === 429) {
        const errBody = await res.text().catch(() => '');
        lastError = new Error(`Gemini API failed - Status: ${res.status} | Details: ${errBody}`);
        if (attempt < GEMINI_MAX_RETRIES) {
          await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
          continue;
        }
        break;
      }

      // Non-retryable errors (400, 401, 403, 404, etc.)
      if (!res.ok) {
        const errBody = await res.text().catch(() => '');
        throw new Error(`Gemini API failed - Status: ${res.status} | Details: ${errBody}`);
      }

      // Success — parse and return
      const json = await res.json();
      return json;

    } catch (err) {
      clearTimeout(timeoutId);

      // Timeout error
      if (err.name === 'AbortError') {
        lastError = new Error(`Gemini API failed - Status: Timeout | Details: Request timed out after ${GEMINI_TIMEOUT_MS}ms`);
        if (attempt < GEMINI_MAX_RETRIES) {
          continue;
        }
        break;
      }

      // If it's already our formatted Gemini error, rethrow immediately
      if (err.message && err.message.startsWith("Gemini API failed")) {
        throw err;
      }

      // Network-level errors (DNS, connect failure)
      if (err.message && (err.message.includes('fetch') || err.message.includes('network'))) {
        lastError = new Error(`Gemini API failed - Status: NetworkError | Details: ${err.message}`);
        if (attempt < GEMINI_MAX_RETRIES) {
          await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
          continue;
        }
        break;
      }

      throw err;
    }
  }

  // All retries exhausted — throw with full details
  throw lastError || new Error("Gemini API failed after all retries");
}

// ─── Chat Handler ───
const MAX_TOOL_ITERATIONS = 5; // Safety cap to prevent infinite tool-calling loops

async function handleChat(studentId, message, studentCheck, db, env) {
  // Load conversation history (last 20 messages)
  const historyRes = await db.prepare("SELECT role, content FROM assistant_conversations WHERE student_id = ? ORDER BY id DESC LIMIT 20").bind(studentId).all();
  const dbHistory = (historyRes.results || []).reverse();

  // Build Gemini contents array
  const contents = [
    { role: "user", parts: [{ text: SYSTEM_PROMPT }] },
    { role: "model", parts: [{ text: "تمام، أنا مساعد مس مروة الذكي. جاهز أساعدك!" }] }
  ];

  for (const msg of dbHistory) {
    contents.push({
      role: msg.role === 'user' ? 'user' : 'model',
      parts: [{ text: msg.content }]
    });
  }

  // Add the new user message
  contents.push({
    role: "user",
    parts: [{ text: message }]
  });

  const payload = {
    contents,
    tools: [{ functionDeclarations }],
    generationConfig: { temperature: 0.8, topP: 0.95, maxOutputTokens: 2048 }
  };

  let replyText = null;
  const toolsUsed = [];

  try {
    let geminiResponse = await callGemini(env, payload);
    let iterations = 0;

    // Multi-turn tool calling loop with safety cap
    while (iterations < MAX_TOOL_ITERATIONS) {
      iterations++;

      // Guard: ensure candidates exist
      if (!geminiResponse || !geminiResponse.candidates || !geminiResponse.candidates[0]) {
        // Check for blocked content
        if (geminiResponse && geminiResponse.promptFeedback && geminiResponse.promptFeedback.blockReason) {
          replyText = "عذراً، لا أقدر أجاوب على السؤال ده بسبب سياسات المحتوى. ممكن تسأل سؤال تاني؟ 😊";
        }
        break;
      }

      const candidate = geminiResponse.candidates[0];
      const parts = candidate.content && candidate.content.parts ? candidate.content.parts : [];

      // Extract function calls
      const functionCalls = parts.filter(p => p.functionCall);

      if (functionCalls.length === 0) {
        // No more tool calls — extract text reply
        const textPart = parts.find(p => p.text);
        if (textPart) {
          replyText = textPart.text;
        }
        break;
      }

      // Execute all tool calls
      contents.push(candidate.content);

      const functionResponses = [];
      for (const fCall of functionCalls) {
        const result = await executeTool(fCall.functionCall, studentCheck, db);
        toolsUsed.push(fCall.functionCall.name);
        functionResponses.push({
          functionResponse: {
            name: fCall.functionCall.name,
            response: { name: fCall.functionCall.name, content: result }
          }
        });
      }

      contents.push({ role: "user", parts: functionResponses });
      payload.contents = contents;

      // Call Gemini again with tool results
      geminiResponse = await callGemini(env, payload);
    }

    // Fallback if no text was extracted
    if (!replyText) {
      replyText = "عذراً، مقدرتش أفهم الرد. ممكن تحاول تاني؟";
    }

  } catch (geminiErr) {
    // Return the raw diagnostic error directly
    console.error("Gemini error:", geminiErr.message);
    return Response.json({ error: geminiErr.message || String(geminiErr) }, { status: 500 });
  }

  // Save conversation to D1 (non-blocking — don't let DB save failure crash the response)
  try {
    await db.prepare("INSERT INTO assistant_conversations (student_id, role, content) VALUES (?, 'user', ?)").bind(studentId, message).run();
    await db.prepare("INSERT INTO assistant_conversations (student_id, role, content) VALUES (?, 'model', ?)").bind(studentId, replyText).run();
  } catch (saveErr) {
    console.error("Failed to save conversation:", saveErr.message);
  }

  return Response.json({ reply: replyText, toolsUsed });
}

// ─── History Handler ───
async function handleHistory(studentId, db) {
  const res = await db.prepare("SELECT role, content FROM assistant_conversations WHERE student_id = ? ORDER BY id DESC LIMIT 50").bind(studentId).all();
  return Response.json({ history: (res.results || []).reverse() });
}

// ─── Clear Handler ───
async function handleClear(studentId, db) {
  await db.prepare("DELETE FROM assistant_conversations WHERE student_id = ?").bind(studentId).run();
  return Response.json({ success: true });
}

// ─── Main POST Handler ───
export async function onRequestPost({ request, env }) {
  try {
    const db = env.DB || env.D1_DB;
    await ensureTables(db);

    const url = new URL(request.url);
    const action = url.searchParams.get("action");
    const body = await request.json();
    const { studentId, message } = body;

    if (!studentId) {
      return Response.json({ error: "studentId is required" }, { status: 400 });
    }

    // Validate student — column is "student_id", NOT "id"
    let studentCheck = null;
    try {
      studentCheck = await db.prepare("SELECT * FROM students WHERE student_id = ?").bind(studentId).first();
    } catch (dbErr) {
      return Response.json({ error: "DB Error: " + dbErr.message }, { status: 500 });
    }

    // Auto-registration fallback for edge cases where student is in localStorage but not D1
    if (!studentCheck) {
      const fallbackName = body.firstName || 'طالب';
      const fallbackGrade = body.grade || 'prep2';
      try {
        await db.prepare(
          "INSERT OR IGNORE INTO students (student_id, first_name, last_name, grade, password, role, gender, branch, phone, parent_phone) VALUES (?, ?, '', ?, '0000', 'student', '', '', '', '')"
        ).bind(studentId, fallbackName, fallbackGrade).run();
        studentCheck = await db.prepare("SELECT * FROM students WHERE student_id = ?").bind(studentId).first();
      } catch (insertErr) {
        return Response.json({ error: "Student not found and auto-registration failed: " + insertErr.message }, { status: 400 });
      }
    }

    if (!studentCheck) {
      return Response.json({ error: "Student not found for ID: " + studentId }, { status: 400 });
    }

    if (action === "chat") {
      if (!message) return Response.json({ error: "message is required for chat" }, { status: 400 });
      return await handleChat(studentId, message, studentCheck, db, env);
    } else if (action === "history") {
      return await handleHistory(studentId, db);
    } else if (action === "clear") {
      return await handleClear(studentId, db);
    } else {
      return Response.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (err) {
    return Response.json({ error: err.message || "Internal server error" }, { status: 500 });
  }
}

// ─── Health Check GET ───
export async function onRequestGet({ request, env }) {
  return Response.json({ message: "Assistant API is running.", status: "ok" });
}
