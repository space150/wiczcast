#!/usr/bin/env python3
"""WiczCast proxy server — serves static files + proxies Claude API with streaming."""

import http.server
import json
import os
import urllib.request
import urllib.error
from pathlib import Path

PORT = int(os.environ.get('PORT', 3000))

# Load API key from .env file
env_path = Path(__file__).parent / '.env'
API_KEY = None
if env_path.exists():
    for line in env_path.read_text().splitlines():
        line = line.strip()
        if line.startswith('ANTHROPIC_API_KEY=') and not line.endswith('='):
            API_KEY = line.split('=', 1)[1].strip()

class WiczCastHandler(http.server.SimpleHTTPRequestHandler):
    """Handles static files + /api/chat proxy to Anthropic."""

    def do_POST(self):
        if self.path == '/api/chat':
            self.handle_chat()
        else:
            self.send_error(404, 'Not found')

    def handle_chat(self):
        if not API_KEY or API_KEY == 'your-api-key-here':
            self.send_json_error(500, 'API key not configured. Add your key to .env')
            return

        # Read request body
        content_length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(content_length)

        try:
            data = json.loads(body)
        except json.JSONDecodeError:
            self.send_json_error(400, 'Invalid JSON')
            return

        messages = data.get('messages')
        system = data.get('system', '')

        if not messages or not isinstance(messages, list):
            self.send_json_error(400, 'messages array required')
            return

        # Build Anthropic API request
        api_body = json.dumps({
            'model': 'claude-sonnet-4-20250514',
            'max_tokens': 1024,
            'system': system,
            'messages': messages,
            'stream': True,
        }).encode('utf-8')

        req = urllib.request.Request(
            'https://api.anthropic.com/v1/messages',
            data=api_body,
            headers={
                'Content-Type': 'application/json',
                'x-api-key': API_KEY,
                'anthropic-version': '2023-06-01',
            },
            method='POST',
        )

        try:
            resp = urllib.request.urlopen(req)
        except urllib.error.HTTPError as e:
            err_body = e.read().decode('utf-8', errors='replace')
            print(f'Anthropic API error {e.code}: {err_body}')
            self.send_json_error(e.code, err_body)
            return
        except urllib.error.URLError as e:
            print(f'Network error: {e}')
            self.send_json_error(502, f'Failed to reach Claude API: {e}')
            return

        # Stream SSE response back to client
        self.send_response(200)
        self.send_header('Content-Type', 'text/event-stream')
        self.send_header('Cache-Control', 'no-cache')
        self.send_header('Connection', 'keep-alive')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()

        try:
            while True:
                chunk = resp.read(4096)
                if not chunk:
                    break
                self.wfile.write(chunk)
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            pass
        finally:
            resp.close()

    def send_json_error(self, code, message):
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps({'error': message}).encode('utf-8'))

    def do_OPTIONS(self):
        """Handle CORS preflight."""
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def log_message(self, format, *args):
        """Custom log format."""
        msg = format % args
        if '/api/chat' in msg:
            print(f'[CHAT] {msg}')
        elif not any(ext in msg for ext in ['.css', '.js', '.svg', '.woff', '.ico']):
            print(f'[FILE] {msg}')


if __name__ == '__main__':
    os.chdir(Path(__file__).parent)
    server = http.server.HTTPServer(('', PORT), WiczCastHandler)
    print(f'WiczCast server running on http://localhost:{PORT}')
    print(f'API Key: {"configured ✓" if API_KEY and API_KEY != "your-api-key-here" else "NOT SET — add your key to .env"}')
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\nServer stopped.')
        server.server_close()
