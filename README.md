# Online Quiz System

A working B.Tech CSE project — full web app matching the project synopsis
(role-based login, quiz creation, auto-evaluation, instant results, reports).

## Tech Stack

- **Front-End:** HTML, CSS, JavaScript (no framework, no build step)
- **Back-End:** Node.js (built-in `http` module — no external packages required)
- **Database:** Lightweight JSON file (`data/db.json`) — easy to swap for MySQL/MongoDB later, since only the two `readDB()`/`writeDB()` functions in `server.js` would need to change
- **Auth:** Token-based sessions, SHA-256 password hashing (`crypto` module)

## How to Run (Kaise Chalayein)

1. Make sure **Node.js** is installed (v14 or above — `node -v` to check).
2. Terminal/Command Prompt kholo aur project folder mein jao:
   ```
   cd online-quiz-system
   ```
3. Server start karo:
   ```
   node server.js
   ```
4. Browser mein kholo:
   ```
   http://localhost:3000
   ```

No `npm install` needed — the entire backend uses only Node's built-in modules.

## Demo Logins

| Role       | Email                | Password      |
|------------|-----------------------|----------------|
| Admin      | admin@quiz.com        | password123    |
| Instructor | instructor@quiz.com   | password123    |
| Student    | student@quiz.com      | password123    |

Ya "Register" tab se naya account bhi bana sakte ho (koi bhi role choose karke).

## Modules Implemented (Matches the Synopsis)

1. **Authentication Module** — register/login, SHA-256 hashed passwords, token sessions
2. **Admin Module** — view/manage all users, view all quizzes and results
3. **Instructor Module** — create quizzes, add/remove MCQ questions, mark correct answers, set marks
4. **Student Module** — browse available quizzes, attempt with a live countdown timer
5. **Quiz Engine Module** — timer-based attempts, auto-submit when time runs out
6. **Result & Report Module** — instant auto-evaluated score, per-question correct/incorrect breakdown, result history filtered by role

## Project Structure

```
online-quiz-system/
├── server.js          # Backend: REST API + static file server
├── data/
│   ├── db.json         # Live data (users, quizzes, results)
│   └── db.seed.json    # Original seed data — copy back to db.json to reset
├── public/
│   ├── index.html      # App shell
│   ├── style.css        # Styling (navy/amber theme, matches the PPT)
│   └── app.js           # All frontend logic (SPA, vanilla JS)
└── README.md
```

## Resetting Demo Data

Agar data ko wapas original state mein laana ho:
```
cp data/db.seed.json data/db.json
```

## Notes for Submission / Viva

- This is a genuine client-server app: `public/` is the client, `server.js` exposes a REST API (`/api/...`), and `data/db.json` is the persistence layer — matching the architecture described in the synopsis (front-end / back-end / database).
- Auto-evaluation happens server-side in `POST /api/quizzes/:id/attempt` — the correct answers are never sent to the browser until after submission, so the grading can't be cheated from the client.
- Role-based access control is enforced on every API route (see the `role` checks in `server.js`), not just hidden in the UI.
- To move to MySQL/MongoDB for a production version, only `readDB()`/`writeDB()` in `server.js` need to change — the rest of the API and the whole frontend stay the same.
