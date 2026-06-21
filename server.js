require('dotenv').config();

const express = require('express');
const cors    = require('cors');
const fetch   = require('node-fetch');

const app  = express();
const PORT = process.env.PORT || 3000;

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(express.json());
app.use(cors({
  origin: process.env.ALLOWED_ORIGIN || '*',   // set to your GitHub Pages URL in production
  methods: ['GET', 'POST'],
}));

// ─── Auth middleware ──────────────────────────────────────────────────────────
function requireSecret(req, res, next) {
  const clientSecret = req.headers['x-app-secret'];
  if (!clientSecret || clientSecret !== process.env.APP_SECRET) {
    return res.status(401).json({ error: 'Unauthorized — invalid or missing secret.' });
  }
  next();
}

// ─── Health check ─────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ─── Shared Claude caller ─────────────────────────────────────────────────────
async function callClaude(prompt) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 55000); // 55 second timeout

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1500,
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err?.error?.message || `Anthropic API error ${response.status}`);
    }

    const data = await response.json();
    return data.content.filter(b => b.type === 'text').map(b => b.text).join('');
  } finally {
    clearTimeout(timeout);
  }
}

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err?.error?.message || `Anthropic API error ${response.status}`);
  }

  const data = await response.json();
  return data.content.filter(b => b.type === 'text').map(b => b.text).join('');
}

// ─── Routes ───────────────────────────────────────────────────────────────────

// Gap Analysis
app.post('/api/gaps', requireSecret, async (req, res) => {
  const { businessContext, userStory } = req.body;
  if (!businessContext || !userStory) {
    return res.status(400).json({ error: 'businessContext and userStory are required.' });
  }

  try {
    const prompt = `You are a senior product analyst. Analyze this user story for gaps, risks, and missing details.

Business Context: ${businessContext}

User Story: ${userStory}

Respond ONLY with valid JSON — no markdown fences, no preamble:
{
  "gaps": [
    {"severity": "high|medium|low", "title": "short title", "detail": "explanation under 2 sentences"}
  ],
  "acceptance_criteria": ["criterion 1", "criterion 2"],
  "personas": [
    {"name": "Persona Name", "concern": "what they need that the story doesn't address"}
  ]
}

Cover 4–7 gaps across: missing error handling, edge cases, security/auth, performance, accessibility, business rules, and unclear scope.`;

    const result = await callClaude(prompt);
    const parsed = JSON.parse(result.replace(/```json|```/g, '').trim());
    res.json(parsed);
  } catch (err) {
    console.error('[/api/gaps]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Prototype
app.post('/api/prototype', requireSecret, async (req, res) => {
  const { businessContext, userStory } = req.body;
  if (!businessContext || !userStory) {
    return res.status(400).json({ error: 'businessContext and userStory are required.' });
  }

  try {
    const prompt = `You are a UX designer. Generate a clean semantic HTML snippet for a realistic UI prototype based on this user story.

Business Context: ${businessContext}
User Story: ${userStory}

Rules:
- Self-contained HTML snippet (no <html>/<head>/<body> tags)
- Inline styles only, no external CSS
- Represent the PRIMARY screen the user interacts with
- Include realistic form fields, labels, buttons, and placeholder data
- Single focused screen/form, card-based white layout
- Approx 40–60 lines of HTML`;

    const result = await callClaude(prompt);
    res.json({ html: result });
  } catch (err) {
    console.error('[/api/prototype]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Documentation
app.post('/api/documentation', requireSecret, async (req, res) => {
  const { businessContext, userStory } = req.body;
  if (!businessContext || !userStory) {
    return res.status(400).json({ error: 'businessContext and userStory are required.' });
  }

  try {
    const prompt = `You are a technical writer. Create structured documentation for this user story.

Business Context: ${businessContext}
User Story: ${userStory}

Respond ONLY with valid JSON — no markdown fences, no preamble:
{
  "feature_name": "...",
  "overview": "2–3 sentence summary",
  "problem_statement": "what problem this solves",
  "scope": {
    "in_scope": ["item1", "item2"],
    "out_of_scope": ["item1", "item2"]
  },
  "functional_requirements": ["req1", "req2", "req3", "req4", "req5"],
  "non_functional_requirements": ["perf", "security", "accessibility"],
  "dependencies": ["dep1", "dep2"],
  "open_questions": ["question1", "question2", "question3"]
}`;

    const result = await callClaude(prompt);
    const parsed = JSON.parse(result.replace(/```json|```/g, '').trim());
    res.json(parsed);
  } catch (err) {
    console.error('[/api/documentation]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`   Health check: http://localhost:${PORT}/health`);
});
