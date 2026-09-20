/**
 * Online Quiz System — Backend Server
 * Pure Node.js (no external packages needed) — just run: node server.js
 *
 * Data is stored in data/db.json (a lightweight JSON "database").
 * In a production deployment this would be swapped for MySQL / MongoDB,
 * as noted in the project synopsis — the REST API layer would not need to change.
 */

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const url = require("url");

const PORT = process.env.PORT || 3000;
const DB_PATH = path.join(__dirname, "data", "db.json");
const PUBLIC_DIR = path.join(__dirname, "public");
const SALT = "quiz-system-salt"; // demo only — use bcrypt + env secret in production

// ---------- tiny "database" helpers ----------
function readDB() {
  return JSON.parse(fs.readFileSync(DB_PATH, "utf-8"));
}
function writeDB(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}
function hashPassword(pw) {
  return crypto.createHash("sha256").update(pw + SALT).digest("hex");
}
function newId(prefix) {
  return prefix + "_" + crypto.randomBytes(6).toString("hex");
}

// in-memory session store: token -> userId  (resets on server restart, fine for a demo)
const sessions = {};

// ---------- request helpers ----------
function sendJSON(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
    "Access-Control-Allow-Origin": "*",
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      if (chunks.length === 0) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf-8")));
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

function getAuthUser(req, db) {
  const header = req.headers["authorization"] || "";
  const token = header.replace("Bearer ", "").trim();
  const userId = sessions[token];
  if (!userId) return null;
  return db.users.find((u) => u.id === userId) || null;
}

function publicUser(u) {
  return { id: u.id, name: u.name, email: u.email, role: u.role };
}

// strips correct-answer info from a quiz for the student "taking" view
function studentSafeQuiz(quiz) {
  return {
    id: quiz.id,
    title: quiz.title,
    category: quiz.category,
    duration: quiz.duration,
    createdBy: quiz.createdBy,
    questionCount: quiz.questions.length,
    totalMarks: quiz.questions.reduce((s, q) => s + q.marks, 0),
    questions: quiz.questions.map((q) => ({
      id: q.id,
      text: q.text,
      marks: q.marks,
      options: q.options.map((o) => ({ id: o.id, text: o.text })),
    })),
  };
}

// ---------- API route handlers ----------
const routes = [];
function route(method, pattern, handler) {
  // pattern like /api/quizzes/:id -> regex with named group
  const paramNames = [];
  const regexStr =
    "^" +
    pattern.replace(/:[a-zA-Z]+/g, (m) => {
      paramNames.push(m.slice(1));
      return "([^/]+)";
    }) +
    "$";
  routes.push({ method, regex: new RegExp(regexStr), paramNames, handler });
}

async function handleApi(req, res, pathname) {
  for (const r of routes) {
    if (r.method !== req.method) continue;
    const m = pathname.match(r.regex);
    if (!m) continue;
    const params = {};
    r.paramNames.forEach((name, i) => (params[name] = decodeURIComponent(m[i + 1])));
    try {
      await r.handler(req, res, params);
    } catch (err) {
      console.error(err);
      sendJSON(res, 500, { error: "Server error", detail: String(err.message || err) });
    }
    return true;
  }
  return false;
}

// ---- AUTH ----
route("POST", "/api/register", async (req, res) => {
  const body = await readBody(req);
  const { name, email, password, role } = body;
  if (!name || !email || !password || !role) {
    return sendJSON(res, 400, { error: "name, email, password, role are required" });
  }
  if (!["admin", "instructor", "student"].includes(role)) {
    return sendJSON(res, 400, { error: "role must be admin, instructor or student" });
  }
  const db = readDB();
  if (db.users.find((u) => u.email.toLowerCase() === email.toLowerCase())) {
    return sendJSON(res, 409, { error: "An account with this email already exists" });
  }
  const user = { id: newId("u"), name, email, passwordHash: hashPassword(password), role };
  db.users.push(user);
  writeDB(db);
  const token = crypto.randomBytes(24).toString("hex");
  sessions[token] = user.id;
  sendJSON(res, 201, { token, user: publicUser(user) });
});

route("POST", "/api/login", async (req, res) => {
  const body = await readBody(req);
  const { email, password } = body;
  const db = readDB();
  const user = db.users.find((u) => u.email.toLowerCase() === (email || "").toLowerCase());
  if (!user || user.passwordHash !== hashPassword(password || "")) {
    return sendJSON(res, 401, { error: "Invalid email or password" });
  }
  const token = crypto.randomBytes(24).toString("hex");
  sessions[token] = user.id;
  sendJSON(res, 200, { token, user: publicUser(user) });
});

route("POST", "/api/logout", async (req, res) => {
  const header = req.headers["authorization"] || "";
  const token = header.replace("Bearer ", "").trim();
  delete sessions[token];
  sendJSON(res, 200, { ok: true });
});

route("GET", "/api/me", async (req, res) => {
  const db = readDB();
  const user = getAuthUser(req, db);
  if (!user) return sendJSON(res, 401, { error: "Not authenticated" });
  sendJSON(res, 200, { user: publicUser(user) });
});

// ---- USERS (admin) ----
route("GET", "/api/users", async (req, res) => {
  const db = readDB();
  const user = getAuthUser(req, db);
  if (!user || user.role !== "admin") return sendJSON(res, 403, { error: "Admin only" });
  sendJSON(res, 200, { users: db.users.map(publicUser) });
});

route("DELETE", "/api/users/:id", async (req, res, { id }) => {
  const db = readDB();
  const user = getAuthUser(req, db);
  if (!user || user.role !== "admin") return sendJSON(res, 403, { error: "Admin only" });
  if (id === user.id) return sendJSON(res, 400, { error: "Cannot delete your own account" });
  db.users = db.users.filter((u) => u.id !== id);
  writeDB(db);
  sendJSON(res, 200, { ok: true });
});

// ---- QUIZZES ----
route("GET", "/api/quizzes", async (req, res) => {
  const db = readDB();
  const user = getAuthUser(req, db);
  if (!user) return sendJSON(res, 401, { error: "Not authenticated" });

  let quizzes = db.quizzes;
  if (user.role === "instructor") quizzes = quizzes.filter((q) => q.createdBy === user.id);

  const list = quizzes.map((q) => ({
    id: q.id,
    title: q.title,
    category: q.category,
    duration: q.duration,
    createdBy: q.createdBy,
    questionCount: q.questions.length,
    totalMarks: q.questions.reduce((s, x) => s + x.marks, 0),
  }));
  sendJSON(res, 200, { quizzes: list });
});

route("POST", "/api/quizzes", async (req, res) => {
  const db = readDB();
  const user = getAuthUser(req, db);
  if (!user || !["instructor", "admin"].includes(user.role))
    return sendJSON(res, 403, { error: "Only instructors/admin can create quizzes" });
  const body = await readBody(req);
  const { title, category, duration } = body;
  if (!title || !duration) return sendJSON(res, 400, { error: "title and duration are required" });
  const quiz = {
    id: newId("q"),
    title,
    category: category || "General",
    duration: Number(duration),
    createdBy: user.id,
    questions: [],
  };
  db.quizzes.push(quiz);
  writeDB(db);
  sendJSON(res, 201, { quiz });
});

route("DELETE", "/api/quizzes/:id", async (req, res, { id }) => {
  const db = readDB();
  const user = getAuthUser(req, db);
  const quiz = db.quizzes.find((q) => q.id === id);
  if (!quiz) return sendJSON(res, 404, { error: "Quiz not found" });
  if (!user || (user.role !== "admin" && quiz.createdBy !== user.id))
    return sendJSON(res, 403, { error: "Not allowed" });
  db.quizzes = db.quizzes.filter((q) => q.id !== id);
  db.results = db.results.filter((r) => r.quizId !== id);
  writeDB(db);
  sendJSON(res, 200, { ok: true });
});

// full quiz detail — hides correct answers for students
route("GET", "/api/quizzes/:id", async (req, res, { id }) => {
  const db = readDB();
  const user = getAuthUser(req, db);
  if (!user) return sendJSON(res, 401, { error: "Not authenticated" });
  const quiz = db.quizzes.find((q) => q.id === id);
  if (!quiz) return sendJSON(res, 404, { error: "Quiz not found" });

  if (user.role === "student") {
    return sendJSON(res, 200, { quiz: studentSafeQuiz(quiz) });
  }
  sendJSON(res, 200, { quiz });
});

// add a question to a quiz (instructor who owns it, or admin)
route("POST", "/api/quizzes/:id/questions", async (req, res, { id }) => {
  const db = readDB();
  const user = getAuthUser(req, db);
  const quiz = db.quizzes.find((q) => q.id === id);
  if (!quiz) return sendJSON(res, 404, { error: "Quiz not found" });
  if (!user || (user.role !== "admin" && quiz.createdBy !== user.id))
    return sendJSON(res, 403, { error: "Not allowed" });

  const body = await readBody(req);
  const { text, options, correctOptionId, marks } = body;
  if (!text || !Array.isArray(options) || options.length < 2 || !correctOptionId) {
    return sendJSON(res, 400, { error: "text, at least 2 options, and correctOptionId are required" });
  }
  const optionIds = ["a", "b", "c", "d", "e", "f"];
  const question = {
    id: newId("qq"),
    text,
    options: options.map((text, i) => ({ id: optionIds[i], text })),
    correctOptionId,
    marks: Number(marks) || 1,
  };
  quiz.questions.push(question);
  writeDB(db);
  sendJSON(res, 201, { question });
});

route("DELETE", "/api/quizzes/:id/questions/:qid", async (req, res, { id, qid }) => {
  const db = readDB();
  const user = getAuthUser(req, db);
  const quiz = db.quizzes.find((q) => q.id === id);
  if (!quiz) return sendJSON(res, 404, { error: "Quiz not found" });
  if (!user || (user.role !== "admin" && quiz.createdBy !== user.id))
    return sendJSON(res, 403, { error: "Not allowed" });
  quiz.questions = quiz.questions.filter((q) => q.id !== qid);
  writeDB(db);
  sendJSON(res, 200, { ok: true });
});

// ---- ATTEMPT / AUTO-EVALUATION ----
route("POST", "/api/quizzes/:id/attempt", async (req, res, { id }) => {
  const db = readDB();
  const user = getAuthUser(req, db);
  if (!user || user.role !== "student") return sendJSON(res, 403, { error: "Only students can attempt quizzes" });
  const quiz = db.quizzes.find((q) => q.id === id);
  if (!quiz) return sendJSON(res, 404, { error: "Quiz not found" });

  const body = await readBody(req);
  const answers = Array.isArray(body.answers) ? body.answers : [];

  let score = 0;
  const totalMarks = quiz.questions.reduce((s, q) => s + q.marks, 0);
  const gradedAnswers = quiz.questions.map((q) => {
    const given = answers.find((a) => a.questionId === q.id);
    const selectedOptionId = given ? given.selectedOptionId : null;
    const isCorrect = selectedOptionId === q.correctOptionId;
    if (isCorrect) score += q.marks;
    return {
      questionId: q.id,
      questionText: q.text,
      selectedOptionId,
      correctOptionId: q.correctOptionId,
      isCorrect,
      marks: q.marks,
    };
  });

  const result = {
    id: newId("r"),
    userId: user.id,
    userName: user.name,
    quizId: quiz.id,
    quizTitle: quiz.title,
    score,
    totalMarks,
    correctCount: gradedAnswers.filter((a) => a.isCorrect).length,
    totalQuestions: quiz.questions.length,
    dateAttempted: new Date().toISOString(),
    answers: gradedAnswers,
  };
  db.results.push(result);
  writeDB(db);
  sendJSON(res, 201, { result });
});

// ---- RESULTS / REPORTS ----
route("GET", "/api/results", async (req, res) => {
  const db = readDB();
  const user = getAuthUser(req, db);
  if (!user) return sendJSON(res, 401, { error: "Not authenticated" });

  let results = db.results;
  if (user.role === "student") {
    results = results.filter((r) => r.userId === user.id);
  } else if (user.role === "instructor") {
    const myQuizIds = db.quizzes.filter((q) => q.createdBy === user.id).map((q) => q.id);
    results = results.filter((r) => myQuizIds.includes(r.quizId));
  }
  // admin sees everything
  results = [...results].sort((a, b) => new Date(b.dateAttempted) - new Date(a.dateAttempted));
  sendJSON(res, 200, { results });
});

route("GET", "/api/results/:id", async (req, res, { id }) => {
  const db = readDB();
  const user = getAuthUser(req, db);
  if (!user) return sendJSON(res, 401, { error: "Not authenticated" });
  const result = db.results.find((r) => r.id === id);
  if (!result) return sendJSON(res, 404, { error: "Result not found" });
  if (user.role === "student" && result.userId !== user.id)
    return sendJSON(res, 403, { error: "Not allowed" });
  sendJSON(res, 200, { result });
});

// ---------- static file server ----------
const MIME = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
  ".json": "application/json",
  ".svg": "image/svg+xml",
};

function serveStatic(req, res, pathname) {
  let filePath = pathname === "/" ? "/index.html" : pathname;
  filePath = path.join(PUBLIC_DIR, filePath);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      return res.end("Not found");
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    res.end(data);
  });
}

// ---------- server ----------
const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    });
    return res.end();
  }

  if (pathname.startsWith("/api/")) {
    const handled = await handleApi(req, res, pathname);
    if (!handled) sendJSON(res, 404, { error: "No such API route" });
    return;
  }

  serveStatic(req, res, pathname);
});

server.listen(PORT, () => {
  console.log(`\nOnline Quiz System running at http://localhost:${PORT}`);
  console.log(`Demo logins (password: "password123" for all):`);
  console.log(`  Admin      -> admin@quiz.com`);
  console.log(`  Instructor -> instructor@quiz.com`);
  console.log(`  Student    -> student@quiz.com\n`);
});
