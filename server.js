const express = require('express');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env'), override: true });

const app = express();
const PORT = process.env.PORT || 3000;

// Serve static files from current directory
app.use(express.static(path.join(__dirname)));

// Parse JSON bodies
app.use(express.json());

// POST /api/chat — Proxy to Anthropic Messages API with streaming
app.post('/api/chat', async (req, res) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'API key not configured' });
  }

  const { messages, system } = req.body;

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'messages array required' });
  }

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
      return res.status(response.status).json({ error: errText });
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

// GET /api/enso/* — Proxy ENSO API calls to avoid CORS issues
app.get('/api/enso/*', async (req, res) => {
  // Map /api/enso/oni/latest → https://noaa-enso-scraper-api.onrender.com/oni/latest
  const ensoPath = req.path.replace('/api/enso', '');
  const queryString = new URLSearchParams(req.query).toString();
  const url = `https://noaa-enso-scraper-api.onrender.com${ensoPath}${queryString ? '?' + queryString : ''}`;

  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!response.ok) {
      const errText = await response.text();
      console.error('[ENSO proxy] API error:', response.status, errText);
      return res.status(response.status).json({ error: errText });
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
