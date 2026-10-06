const express = require('express');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env'), override: true });

const app = express();
const PORT = process.env.PORT || 3000;

// Cloud Run sits behind a Google front end; trust it so req.ip is the real client IP.
app.set('trust proxy', true);
app.disable('x-powered-by');

// Baseline security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=()');
  if (req.secure) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
});

// Serve only the public front-end files — never server source, package files, or dotfiles.
const PUBLIC_FILES = ['index.html', 'sw.js', 'manifest.webmanifest'];
const PUBLIC_DIRS = ['css', 'js', 'assets'];
const staticOpts = { dotfiles: 'ignore', index: false };

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
for (const file of PUBLIC_FILES) {
  app.get(`/${file}`, (req, res) => res.sendFile(path.join(__dirname, file)));
}
for (const dir of PUBLIC_DIRS) {
  app.use(`/${dir}`, express.static(path.join(__dirname, dir), staticOpts));
}

app.get('/healthz', (req, res) => res.type('text').send('ok'));

// Parse JSON bodies
app.use(express.json({ limit: '64kb' }));

// Simple in-memory per-IP rate limiter. Per-instance only (Cloud Run may run several
// instances), so it's a speed bump against abuse of the Claude proxy, not a hard quota.
function rateLimit({ windowMs, max }) {
  const hits = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [ip, entry] of hits) if (entry.reset <= now) hits.delete(ip);
  }, windowMs).unref();

  return (req, res, next) => {
    const now = Date.now();
    let entry = hits.get(req.ip);
    if (!entry || entry.reset <= now) {
      entry = { count: 0, reset: now + windowMs };
      hits.set(req.ip, entry);
    }
    entry.count++;
    if (entry.count > max) {
      res.setHeader('Retry-After', Math.ceil((entry.reset - now) / 1000));
      return res.status(429).json({ error: 'Too many requests' });
    }
    next();
  };
}

// Reject cross-site browser calls to the API (other sites embedding our key-backed proxy).
function sameOriginOnly(req, res, next) {
  const origin = req.get('origin');
  if (origin) {
    try {
      if (new URL(origin).host !== req.get('host')) {
        return res.status(403).json({ error: 'Cross-origin requests not allowed' });
      }
    } catch {
      return res.status(403).json({ error: 'Bad origin' });
    }
  }
  next();
}

const CHAT_MAX_MESSAGES = 20;
const CHAT_MAX_MESSAGE_CHARS = 4000;
const CHAT_MAX_SYSTEM_CHARS = 20000;

function validateChat(body) {
  const { messages, system } = body || {};
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > CHAT_MAX_MESSAGES) {
    return 'messages must be a non-empty array of at most ' + CHAT_MAX_MESSAGES;
  }
  for (const m of messages) {
    if (!m || (m.role !== 'user' && m.role !== 'assistant')) return 'invalid message role';
    if (typeof m.content !== 'string' || m.content.length > CHAT_MAX_MESSAGE_CHARS) {
      return 'message content must be a string of at most ' + CHAT_MAX_MESSAGE_CHARS + ' chars';
    }
  }
  if (system !== undefined && (typeof system !== 'string' || system.length > CHAT_MAX_SYSTEM_CHARS)) {
    return 'system must be a string of at most ' + CHAT_MAX_SYSTEM_CHARS + ' chars';
  }
  return null;
}

// POST /api/chat — Proxy to Anthropic Messages API with streaming
app.post('/api/chat', sameOriginOnly, rateLimit({ windowMs: 60_000, max: 10 }), async (req, res) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'API key not configured' });
  }

  const invalid = validateChat(req.body);
  if (invalid) {
    return res.status(400).json({ error: invalid });
  }
  // Only forward the fields we expect — never arbitrary client-supplied properties.
  const messages = req.body.messages.map(({ role, content }) => ({ role, content }));
  const system = req.body.system;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        system: system || '',
        messages,
        stream: true,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('Anthropic API error:', response.status, errText);
      // Don't leak upstream error details to the browser.
      return res.status(502).json({ error: 'Claude API request failed' });
    }

    // Stream SSE back to the client
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      res.write(chunk);
    }

    res.end();
  } catch (err) {
    console.error('Proxy error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to reach Claude API' });
    } else {
      res.end();
    }
  }
});

// GET /api/enso/* — Proxy ENSO API calls to avoid CORS issues.
// Only the endpoints the front end uses are forwarded.
const ENSO_ALLOWED_PATHS = new Set(['/oni/latest', '/oni/data']);
const ENSO_ALLOWED_PARAMS = new Set(['start_year', 'end_year']);

app.get('/api/enso/*', rateLimit({ windowMs: 60_000, max: 30 }), async (req, res) => {
  // Map /api/enso/oni/latest → https://noaa-enso-scraper-api.onrender.com/oni/latest
  const ensoPath = req.path.replace('/api/enso', '');
  if (!ENSO_ALLOWED_PATHS.has(ensoPath)) {
    return res.status(404).json({ error: 'Not found' });
  }
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(req.query)) {
    if (ENSO_ALLOWED_PARAMS.has(key) && /^\d{4}$/.test(String(value))) params.set(key, value);
  }
  const queryString = params.toString();
  const url = `https://noaa-enso-scraper-api.onrender.com${ensoPath}${queryString ? '?' + queryString : ''}`;

  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!response.ok) {
      const errText = await response.text();
      console.error('[ENSO proxy] API error:', response.status, errText);
      return res.status(502).json({ error: 'ENSO API request failed' });
    }
    const data = await response.json();
    res.json(data);
  } catch (err) {
    console.error('[ENSO proxy] Error:', err.message);
    res.status(502).json({ error: 'Failed to reach ENSO API' });
  }
});

app.listen(PORT, () => {
  console.log(`WiczCast server running on http://localhost:${PORT}`);
});
