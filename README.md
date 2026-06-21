# User Story Analyzer — Backend

Secure Express.js backend that proxies Anthropic Claude API calls for the [User Story Analyzer](https://github.com/mrunalmoghe84/user-story-analyzer) frontend.

## Architecture

```
Browser (GitHub Pages)
  └── POST /api/gaps          ─┐
  └── POST /api/prototype      ├── Express (Render) ──► Anthropic Claude API
  └── POST /api/documentation ─┘
```

All requests require an `x-app-secret` header. The Anthropic API key never leaves the server.

---

## Local Development

### 1. Install dependencies
```bash
npm install
```

### 2. Set up environment variables
```bash
cp .env.example .env
# Edit .env and fill in your values
```

### 3. Start the server
```bash
npm run dev      # with auto-reload (nodemon)
npm start        # production mode
```

Server runs at `http://localhost:3000`

### 4. Test the health check
```bash
curl http://localhost:3000/health
```

---

## API Reference

All routes require the header:
```
x-app-secret: YOUR_APP_SECRET
```

### `POST /api/gaps`
Identifies gaps, risks, acceptance criteria, and personas.

**Body:**
```json
{ "businessContext": "...", "userStory": "..." }
```

**Response:**
```json
{
  "gaps": [{ "severity": "high|medium|low", "title": "...", "detail": "..." }],
  "acceptance_criteria": ["..."],
  "personas": [{ "name": "...", "concern": "..." }]
}
```

---

### `POST /api/prototype`
Generates an HTML UI prototype snippet.

**Body:**
```json
{ "businessContext": "...", "userStory": "..." }
```

**Response:**
```json
{ "html": "<div>...</div>" }
```

---

### `POST /api/documentation`
Produces structured feature documentation.

**Body:**
```json
{ "businessContext": "...", "userStory": "..." }
```

**Response:**
```json
{
  "feature_name": "...",
  "overview": "...",
  "problem_statement": "...",
  "scope": { "in_scope": [], "out_of_scope": [] },
  "functional_requirements": [],
  "non_functional_requirements": [],
  "dependencies": [],
  "open_questions": []
}
```

---

## Deploy to Render

1. Push this folder to a **new GitHub repo** (e.g. `user-story-analyzer-backend`)
2. Go to [render.com](https://render.com) → **New → Web Service**
3. Connect your GitHub repo
4. Set:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
5. Add these **Environment Variables** in Render dashboard:

| Key | Value |
|-----|-------|
| `ANTHROPIC_API_KEY` | `sk-ant-...` |
| `APP_SECRET` | your random secret string |
| `ALLOWED_ORIGIN` | `https://mrunalmoghe84.github.io` |

6. Click **Deploy** — Render gives you a URL like `https://user-story-analyzer-backend.onrender.com`
7. Update the frontend `app.js` with this URL and your `APP_SECRET`

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | ✅ | Your Anthropic API key |
| `APP_SECRET` | ✅ | Secret string sent by frontend in `x-app-secret` header |
| `ALLOWED_ORIGIN` | ✅ | Frontend URL for CORS (use `*` for local dev) |
| `PORT` | Auto | Set automatically by Render |
