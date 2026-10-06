const express = require('express');
const path = require('path');

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

// Simple in-memory per-IP rate limiter. Per-instance only (Cloud Run may run several
// instances), so it's a speed bump against abuse of the ENSO proxy, not a hard quota.
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
