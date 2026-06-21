require('dotenv').config();

const express = require('express');
const cors    = require('cors');
const https   = require('https');

const app  = express();
const PORT = process.env.PORT || 3000;

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(express.json());
app.use(cors({
  origin: process.env.ALLOWED_ORIGIN || '*',
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

// ─── Generic HTTPS request helper ────────────────────────────────────────────
function httpsRequest(options, body = null) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(60000, () => { req.destroy(); reject(new Error('Request timed out')); });
    if (body) req.write(body);
    req.end();
  });
}

// ─── Shared Claude caller ─────────────────────────────────────────────────────
function callClaude(prompt) {
  const body = JSON.stringify({
    model: 'claude-sonnet-4-6',
    max_tokens: 1500,
    messages: [{ role: 'user', content: prompt }],
  });

  return httpsRequest({
    hostname: 'api.anthropic.com',
    path: '/v1/messages',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
  }, body).then(({ body: parsed }) => {
    if (parsed.error) throw new Error(parsed.error.message);
    return (parsed.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
  });
}

// ─── GitHub helpers ───────────────────────────────────────────────────────────
function githubRequest(path, method = 'GET', body = null) {
  const repo    = process.env.GITHUB_REPO;
  const token   = process.env.GITHUB_TOKEN;
  const payload = body ? JSON.stringify(body) : null;

  return httpsRequest({
    hostname: 'api.github.com',
    path: `/repos/${repo}/${path}`,
    method,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json',
      'User-Agent': 'user-story-analyzer',
      'Content-Type': 'application/json',
      ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
    },
  }, payload);
}

// ─── GitHub: Fetch issue ──────────────────────────────────────────────────────
app.post('/api/github/fetch-issue', requireSecret, async (req, res) => {
  const { issueNumber } = req.body;
  if (!issueNumber) return res.status(400).json({ error: 'issueNumber is required.' });

  try {
    const { status, body } = await githubRequest(`issues/${issueNumber}`);
    if (status !== 200) return res.status(status).json({ error: body.message || 'GitHub error' });

    res.json({
      number:    body.number,
      title:     body.title,
      body:      body.body || '',
      url:       body.html_url,
      state:     body.state,
      labels:    (body.labels || []).map(l => l.name),
      createdAt: body.created_at,
    });
  } catch (err) {
    console.error('[/api/github/fetch-issue]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── GitHub: Push results as comment ─────────────────────────────────────────
app.post('/api/github/push-results', requireSecret, async (req, res) => {
  const { issueNumber, gaps, acceptanceCriteria, personas, documentation } = req.body;
  if (!issueNumber) return res.status(400).json({ error: 'issueNumber is required.' });

  try {
    // Build a rich markdown comment
    const severityEmoji = { high: '🔴', medium: '🟡', low: '🔵' };

    const gapsSection = (gaps || []).map(g =>
      `${severityEmoji[g.severity] || '⚪'} **${g.severity.toUpperCase()} — ${g.title}**\n${g.detail}`
    ).join('\n\n');

    const criteriaSection = (acceptanceCriteria || []).map(c => `- [ ] ${c}`).join('\n');

    const personasSection = (personas || []).map(p =>
      `- **${p.name}**: ${p.concern}`
    ).join('\n');

    const docSection = documentation ? `
### 📄 Feature Overview
**${documentation.feature_name || 'Feature'}**

${documentation.overview || ''}

**Problem Statement:** ${documentation.problem_statement || ''}

**In Scope:** ${(documentation.scope?.in_scope || []).join(', ')}

**Out of Scope:** ${(documentation.scope?.out_of_scope || []).join(', ')}

**Open Questions:**
${(documentation.open_questions || []).map((q, i) => `${i + 1}. ${q}`).join('\n')}
` : '';

    const comment = `## 🤖 AI Analysis — User Story Analyzer

---

### 🔍 Gap Analysis
${gapsSection || '_No gaps identified._'}

---

### ✅ Suggested Acceptance Criteria
${criteriaSection || '_No criteria suggested._'}

---

### 👥 Additional Personas to Consider
${personasSection || '_No additional personas identified._'}

---
${docSection}

---
_Generated by [User Story Analyzer](https://mrunalmoghe84.github.io/user-story-analyzer)_`;

    const { status, body } = await githubRequest(`issues/${issueNumber}/comments`, 'POST', { body: comment });

    if (status !== 201) return res.status(status).json({ error: body.message || 'Failed to post comment' });

    res.json({ success: true, commentUrl: body.html_url });
  } catch (err) {
    console.error('[/api/github/push-results]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── GitHub: List open issues ─────────────────────────────────────────────────
app.get('/api/github/issues', requireSecret, async (req, res) => {
  try {
    const { status, body } = await githubRequest('issues?state=open&per_page=20');
    if (status !== 200) return res.status(status).json({ error: body.message || 'GitHub error' });

    res.json(body.map(i => ({
      number: i.number,
      title:  i.title,
      state:  i.state,
      url:    i.html_url,
    })));
  } catch (err) {
    console.error('[/api/github/issues]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Existing analysis routes ─────────────────────────────────────────────────

app.post('/api/gaps', requireSecret, async (req, res) => {
  const { businessContext, userStory } = req.body;
  if (!businessContext || !userStory)
    return res.status(400).json({ error: 'businessContext and userStory are required.' });

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

app.post('/api/prototype', requireSecret, async (req, res) => {
  const { businessContext, userStory } = req.body;
  if (!businessContext || !userStory)
    return res.status(400).json({ error: 'businessContext and userStory are required.' });

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

app.post('/api/documentation', requireSecret, async (req, res) => {
  const { businessContext, userStory } = req.body;
  if (!businessContext || !userStory)
    return res.status(400).json({ error: 'businessContext and userStory are required.' });

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
