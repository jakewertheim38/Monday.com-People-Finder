// Only used if you deploy with "server" hosting (see the workflow).
// Serves the built Administration View from ./public on monday code. No dependencies.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.map': 'application/json',
};

async function send(res, file, status = 200) {
  const body = await readFile(file);
  const html = file.endsWith('.html');
  res.writeHead(status, {
    'Content-Type': types[path.extname(file).toLowerCase()] || 'application/octet-stream',
    // Hashed assets can be cached; index.html must not be, so new deploys show up straight away.
    'Cache-Control': html ? 'no-cache' : 'public, max-age=31536000, immutable',
  });
  res.end(body);
}

http.createServer(async (req, res) => {
  try {
    const { pathname } = new URL(req.url, 'http://localhost');
    if (pathname === '/health') return void res.writeHead(200).end('ok');
    const file = path.join(root, path.normalize(decodeURIComponent(pathname)).replace(/^([/\\])+/, ''));
    if (file !== root && !file.startsWith(root + path.sep)) return void res.writeHead(403).end();
    try { await send(res, file.endsWith(path.sep) || file === root ? path.join(file, 'index.html') : file); }
    catch { await send(res, path.join(root, 'index.html')); } // unknown path → the app itself
  } catch (error) {
    console.error(error);
    if (!res.headersSent) res.writeHead(500);
    res.end('Server error');
  }
}).listen(Number(process.env.PORT) || 8080, '0.0.0.0', () => console.log('Administration View server ready'));
