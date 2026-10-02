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

// ═══════════════════════════════════════════════════════════════════════════
// Problem 1: Configurable model + distinct error classes
// ═══════════════════════════════════════════════════════════════════════════
const GEMINI_TIMEOUT_MS = 7000;

async function callGemini(env, payload) {
  if (!env.GEMINI_API_KEY) {
    throw new Error("[ConfigError] GEMINI_API_KEY is not set in environment variables.");
  }

  // Model name from env var — change in Cloudflare dashboard, no redeploy needed
  const model = env.GEMINI_MODEL || 'gemini-2.0-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.GEMINI_API_KEY}`;

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

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');

      // ── 404: Model deprecated / not found — distinct from rate limits ──
      if (res.status === 404) {
        const lower = errBody.toLowerCase();
        if (lower.includes('not_found') || lower.includes('no longer available') || lower.includes('is not found')) {
          throw new Error(`[ModelNotFound] The model "${model}" is no longer available. Update the GEMINI_MODEL environment variable in Cloudflare. Raw: ${errBody.slice(0, 300)}`);
        }
        throw new Error(`[Gemini404] Status 404 | Details: ${errBody.slice(0, 300)}`);
      }

      // ── 429: Rate limit — inspect body to classify short vs long term ──
      if (res.status === 429) {
        const isDaily = classifyRateLimit(errBody);
        if (isDaily) {
          throw new Error(`[DailyQuotaExhausted] ${errBody.slice(0, 300)}`);
        } else {
          throw new Error(`[RateLimitShortTerm] ${errBody.slice(0, 300)}`);
        }
      }

      // ── All other non-OK statuses ──
      throw new Error(`[GeminiHTTP${res.status}] Status: ${res.status} | Details: ${errBody.slice(0, 300)}`);
    }

    return await res.json();

  } catch (err) {
    clearTimeout(timeoutId);

    if (err.name === 'AbortError') {
      throw new Error(`[GeminiTimeout] Request timed out after ${GEMINI_TIMEOUT_MS}ms`);
    }

    // Re-throw our own classified errors as-is
    if (err.message && err.message.startsWith("[")) {
      throw err;
    }

    throw new Error(`[NetworkError] ${err.message}`);
  }
}

// ── 429 classifier: inspects the error body to distinguish short-term from daily quota ──
function classifyRateLimit(errBody) {
  const lower = (errBody || '').toLowerCase();
  // Gemini typically includes "per day" or "RATE_LIMIT_EXCEEDED" with quota metric details.
  // "per minute" / "per_minute" / "rpm" signals short-term.
  // "per day" / "per_day" / "rpd" / "daily" signals long-term.
  // If the body contains "per day" or "daily" or "rpd" or "DAILY", it's the daily cap.
  if (lower.includes('per day') || lower.includes('per_day') || lower.includes('daily') || lower.includes('rpd')) {
    return true; // daily quota
  }
  // If it's clearly per-minute, it's short-term
  if (lower.includes('per minute') || lower.includes('per_minute') || lower.includes('rpm')) {
    return false;
  }
  // Ambiguous — treat as potentially daily to avoid pointless retries
  return true;
}

// ═══════════════════════════════════════════════════════════════════════════
// Problem 3: Scripted intent router (runs before Gemini, saves quota)
// ═══════════════════════════════════════════════════════════════════════════

// ── Intent patterns: each pattern list is checked against normalized message ──
// Order matters: AI_REQUIRED_PATTERNS are checked first to exclude ambiguous cases.
const AI_REQUIRED_PATTERNS = [
  /حلل/,       // "حلل نتيجتي" — needs reasoning
  /تحليل/,     // "تحليل غلطاتي"
  /لخص/,       // "لخصلي الملخص" — PDF summarization
  /تلخيص/,     // "تلخيص"
  /اشرح/,      // "اشرحلي" — teaching
  /فسر/,       // "فسرلي"
  /ليه\s+غلط/, // "ليه غلط" — reasoning about wrong answers
  /ايه\s+غلطي/,// "ايه غلطي" — detailed analysis
  /غلطات/,     // "غلطاتي في" — wrong answer analysis
  /wrong/i,    // "what did I get wrong"
  /explain/i,  // "explain"
  /why/i,      // "why did I..."
  /practice/i, // "practice questions"
  /اسئل/,      // "generate questions"
  /اسئلة/,     // "أسئلة تدريب"
  /تدريب/,     // "تدريب"
  /summarize/i,// "summarize"
  /analyze/i   // "analyze"
];

const INTENT_GRADES = {
  keywords: [
    /درجت/,       // درجتي، درجاتي
    /نتيجت/,      // نتيجتي
    /كام\s*(جبت|درجة|درجت)/,
    /جبت\s*كام/,
    /أداء/,       // أدائي
    /ادائي/,
    /my\s*(grade|score|result|mark)/i,
    /grade/i,
    /score/i,
    /علامت/,      // علاماتي
    /الدرجات/,
    /نتائج/,
    /عرض\s*درجات/
  ],
  tool: "get_my_grades_and_rank"
};

const INTENT_DEADLINES = {
  keywords: [
    /امتحان\s*امت/,    // امتحان امتى
    /الامتحان.*امت/,
    /فاضل\s*كام/,
    /موعد/,             // مواعيد
    /مواعيد/,
    /deadline/i,
    /متى.*امتحان/,
    /امتحان.*متى/,
    /يقفل/,             // "متى يقفل الامتحان"
    /due\s*date/i,
    /when.*exam/i,
    /امتى.*الامتحان/,
    /الامتحانات\s*القادم/,
    /قرب\s*امتحان/,
    /exam.*coming/i,
    /upcoming/i,
    /open\s*exam/i
  ],
  tool: "get_exam_deadlines"
};

const INTENT_NEW_CONTENT = {
  keywords: [
    /في\s*جديد/,        // "في جديد"
    /فيديو.*جديد/,
    /ملخص.*جديد/,
    /جديد.*اتضاف/,
    /المحتوى\s*الجديد/,
    /new\s*(video|content|material|lesson)/i,
    /ايه\s*الجديد/,
    /اخر\s*(الفيديوهات|الملخصات|المحتوى|حاجة)/,
    /آخر\s*(الفيديوهات|الملخصات|المحتوى|حاجة)/,
    /latest/i,
    /اتنزل.*جديد/,
    /نزل.*جديد/,
    /محتوى\s*جديد/
  ],
  tool: "get_new_content"
};

const INTENT_RANK = {
  keywords: [
    /ترتيب/,           // "ترتيبي ايه"
    /رقم\s*كام/,
    /rank/i,
    /my\s*rank/i,
    /standing/i,
    /انا\s*رقم/,
    /مركز/              // "مركزي"
  ],
  tool: "get_my_grades_and_rank"
};

const INTENT_PROFILE = {
  keywords: [
    /ستريك/,            // "الستريك"
    /streak/i,
    /كام\s*يوم\s*متتال/,
    /my\s*streak/i,
    /حضور/,
    /المتابع/,
    /المتابعة\s*اليومي/,
    /الملف\s*الشخص/,
    /بياناتي/,
    /my\s*profile/i
  ],
  tool: "get_student_profile"
};

const SCRIPTED_INTENTS = [INTENT_GRADES, INTENT_DEADLINES, INTENT_NEW_CONTENT, INTENT_RANK, INTENT_PROFILE];

/**
 * Attempt to match the user's message to a scripted intent.
 * Returns { tool, confidence } or null if no match / ambiguous.
 * AI_REQUIRED_PATTERNS are checked first — if any match, returns null immediately.
 */
function detectScriptedIntent(message) {
  const normalized = message.trim();

  // 1. Exclusion pass: if message needs AI reasoning, bail out immediately
  for (const pattern of AI_REQUIRED_PATTERNS) {
    if (pattern.test(normalized)) {
      return null;
    }
  }

  // 2. Match against scripted intents — require at least one keyword hit
  for (const intent of SCRIPTED_INTENTS) {
    for (const kw of intent.keywords) {
      if (kw.test(normalized)) {
        return { tool: intent.tool };
      }
    }
  }

  // 3. No confident match — fall through to Gemini
  return null;
}

// ── Scripted response templates (warm Egyptian Arabic, matching the AI persona) ──
function formatScriptedResponse(toolName, data, studentName) {
  const name = studentName || '';

  switch (toolName) {
    case "get_my_grades_and_rank": {
      const onlineGrades = data.onlineGrades || [];
      const offlineGrades = data.offlineGrades || [];
      const rank = data.rank || 'N/A';

      if (onlineGrades.length === 0 && offlineGrades.length === 0) {
        return `لسه مفيش درجات متسجلة ليك يا ${name}. أول ما تحل امتحان هتلاقي درجاتك هنا إن شاء الله! 💪`;
      }

      let reply = `يلا نشوف درجاتك يا ${name}! 📊\n\n`;

      if (onlineGrades.length > 0) {
        reply += '**امتحانات أونلاين:**\n';
        for (const g of onlineGrades) {
          let total = 0;
          try { total = JSON.parse(g.questions || '[]').length; } catch (e) { /* ignore */ }
          reply += `• ${g.title}: ${g.score}/${total} 🎯\n`;
        }
        reply += '\n';
      }

      if (offlineGrades.length > 0) {
        reply += '**امتحانات السنتر:**\n';
        for (const g of offlineGrades) {
          reply += `• ${g.exam_name}: ${g.score}/${g.total_marks}\n`;
        }
        reply += '\n';
      }

      if (rank && rank !== 'N/A' && rank !== 'غير متاح') {
        reply += `ترتيبك بين زملائك: **${rank}** ⭐\n`;
      }

      return reply.trim();
    }

    case "get_exam_deadlines": {
      const openExams = data.openExams || [];
      if (openExams.length === 0) {
        return `مفيش امتحانات مفتوحة دلوقتي يا ${name}. استريح شوية! 😎`;
      }

      let reply = `الامتحانات المفتوحة ليك يا ${name}: 📅\n\n`;
      for (const ex of openExams) {
        const expDate = ex.expires_at ? new Date(ex.expires_at) : null;
        const dateStr = expDate ? expDate.toLocaleDateString('ar-EG', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }) : 'غير محدد';
        reply += `• **${ex.title}** — آخر موعد: ${dateStr}\n`;
      }

      reply += '\nخد بالك من المواعيد ومتسيبش حاجة للآخر! 💪';
      return reply;
    }

    case "get_new_content": {
      const items = data.newContent || [];
      if (items.length === 0) {
        return `مفيش محتوى جديد دلوقتي يا ${name}. هبقى أقولك أول ما ينزل حاجة! 📢`;
      }

      let reply = `أحدث المحتوى ليك يا ${name}: 📚\n\n`;
      for (const item of items.slice(0, 7)) {
        const icon = item.category === 'videos' ? '🎬' : item.category === 'summaries' ? '📝' : '📄';
        reply += `${icon} **${item.title}** (${item.category === 'videos' ? 'فيديو' : item.category === 'summaries' ? 'ملخص' : item.category})\n`;
      }
      if (items.length > 7) {
        reply += `\n... و${items.length - 7} حاجات تانية. ادخل على صفحة المحتوى عشان تشوف كل حاجة!`;
      }
      return reply;
    }

    case "get_student_profile": {
      const streak = data.current_streak || 0;
      const longest = data.longest_streak || 0;
      const grade = data.grade || '';
      const branch = data.branch || '';

      let reply = `بياناتك يا ${name}! 🌟\n\n`;
      reply += `🔥 الستريك الحالي: **${streak} يوم**\n`;
      reply += `🏆 أطول ستريك: **${longest} يوم**\n`;
      if (grade) reply += `📚 المرحلة: **${grade}**\n`;
      if (branch) reply += `🏫 النظام: **${branch === 'private' ? 'خاص' : branch === 'center' ? 'سنتر' : branch}**\n`;

      if (streak > 0) {
        reply += '\nشغال تمام! كمّل كده ومتقطعش 💪';
      } else {
        reply += '\nيلا نبدأ ستريك جديد النهاردة! 🚀';
      }
      return reply;
    }

    default:
      return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Chat Handler (with scripted-intent router before Gemini call)
// ═══════════════════════════════════════════════════════════════════════════
const MAX_TOOL_ITERATIONS = 5;

async function handleChat(studentId, message, studentCheck, db, env) {
  const firstName = studentCheck.first_name || '';
  let replyText = null;
  const toolsUsed = [];

  // ── Problem 3: Scripted intent detection (runs before Gemini) ──
  // Limitation: parent-mode detection currently lives inside the Gemini system prompt,
  // so we have no lightweight signal to detect parents before calling the AI.
  // For now, scripted shortcuts only apply to student-mode conversations.
  // If a parent identifies themselves mid-conversation, subsequent messages would need
  // the AI path anyway for tone adaptation. This is acceptable until a non-AI
  // parent-detection signal is added (e.g., a "parent mode" toggle in the frontend).
  const intentMatch = detectScriptedIntent(message);

  if (intentMatch) {
    try {
      const toolResult = await executeTool(
        { name: intentMatch.tool, args: {} },
        studentCheck,
        db
      );

      // If the tool itself returned an error, fall through to Gemini for a nicer explanation
      if (!toolResult.error) {
        replyText = formatScriptedResponse(intentMatch.tool, toolResult, firstName);
        toolsUsed.push(intentMatch.tool + ':scripted');
      }
    } catch (scriptedErr) {
      // Tool execution failed — fall through to Gemini silently
      console.error("Scripted intent tool error:", scriptedErr.message);
    }
  }

  // ── If scripted path produced a reply, save and return immediately (no Gemini call) ──
  if (replyText) {
    try {
      await db.prepare("INSERT INTO assistant_conversations (student_id, role, content) VALUES (?, 'user', ?)").bind(studentId, message).run();
      await db.prepare("INSERT INTO assistant_conversations (student_id, role, content) VALUES (?, 'model', ?)").bind(studentId, replyText).run();
    } catch (saveErr) {
      console.error("Failed to save scripted conversation:", saveErr.message);
    }
    return Response.json({ reply: replyText, toolsUsed });
  }

  // ═══════════════════════════════════════════════════════════
  // Normal Gemini AI path (unchanged from before, except error handling)
  // ═══════════════════════════════════════════════════════════

  // Load conversation history
  const historyRes = await db.prepare("SELECT role, content FROM assistant_conversations WHERE student_id = ? ORDER BY id DESC LIMIT 20").bind(studentId).all();
  const dbHistory = (historyRes.results || []).reverse();

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

  contents.push({
    role: "user",
    parts: [{ text: message }]
  });

  const payload = {
    contents,
    tools: [{ functionDeclarations }],
    generationConfig: { temperature: 0.8, topP: 0.95, maxOutputTokens: 2048 }
  };

  try {
    let geminiResponse = await callGemini(env, payload);
    let iterations = 0;

    while (iterations < MAX_TOOL_ITERATIONS) {
      iterations++;

      if (!geminiResponse || !geminiResponse.candidates || !geminiResponse.candidates[0]) {
        if (geminiResponse && geminiResponse.promptFeedback && geminiResponse.promptFeedback.blockReason) {
          replyText = "عذراً، لا أقدر أجاوب على السؤال ده بسبب سياسات المحتوى. ممكن تسأل سؤال تاني؟ 😊";
        }
        break;
      }

      const candidate = geminiResponse.candidates[0];
      const parts = candidate.content && candidate.content.parts ? candidate.content.parts : [];
      const functionCalls = parts.filter(p => p.functionCall);

      if (functionCalls.length === 0) {
        const textPart = parts.find(p => p.text);
        if (textPart) {
          replyText = textPart.text;
        }
        break;
      }

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
      geminiResponse = await callGemini(env, payload);
    }

    if (!replyText) {
      replyText = "عذراً، مقدرتش أفهم الرد. ممكن تحاول تاني؟";
    }

  } catch (geminiErr) {
    console.error("Gemini error:", geminiErr.message);

    // ── Problem 2: Classify the error and return an appropriate message ──
    const errMsg = geminiErr.message || '';

    if (errMsg.startsWith('[DailyQuotaExhausted]')) {
      // Daily quota — honest, student-friendly, and mentions scripted features still work
      replyText = "النظام وصل لأقصى استخدام مجاني النهاردة 😔 هيرجع يشتغل تاني قريب إن شاء الله.\n\nفي الوقت ده، لسه تقدر تسألني عن درجاتك أو مواعيد الامتحانات أو المحتوى الجديد وهرد عليك فوراً! 😊";
    } else if (errMsg.startsWith('[RateLimitShortTerm]')) {
      replyText = "في ناس كتير بتسأل دلوقتي 😅 استنى دقيقة واحدة وابعتلي تاني.\n\nأو اسألني عن درجاتك أو مواعيد الامتحانات — دول بيشتغلوا فوراً من غير انتظار! ⚡";
    } else if (errMsg.startsWith('[ModelNotFound]')) {
      replyText = "عندنا مشكلة تقنية في إعدادات المساعد الذكي 🔧 بنشتغل على حلها. جرب تاني بعد شوية!";
    } else if (errMsg.startsWith('[GeminiTimeout]')) {
      replyText = "السيرفر بطيء شوية دلوقتي ⏳ جرب تاني كمان شوية.\n\nأو اسألني عن درجاتك أو الامتحانات — دول بيردوا فوراً! ⚡";
    } else {
      // Unknown / unclassified error — show raw details for debugging
      replyText = "حصل خطأ غير متوقع 😕 التفاصيل: " + errMsg.slice(0, 200);
    }
  }

  // Save to conversation history
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

    // Auto-registration fallback
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
