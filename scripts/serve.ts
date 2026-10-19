// Serves dist/ under the GitHub Pages repository subpath, to test subpath behaviour locally.
// Usage: node scripts/serve.ts [port]
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { ROOT } from './repo-data.ts';

export const BASE = '/RagdollLabs-relocation-decision-tool/';
const port = Number(process.argv[2] ?? process.env.PORT ?? 4173);
const dist = join(ROOT, 'dist');
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname === '/') {
    res.writeHead(302, { location: BASE }).end();
    return;
  }
  if (!url.pathname.startsWith(BASE)) {
    res.writeHead(404).end('Not found (outside the repository subpath, as on GitHub Pages)');
    return;
  }
  let file = normalize(join(dist, url.pathname.slice(BASE.length)));
  if (!file.startsWith(dist)) {
    res.writeHead(403).end();
    return;
  }
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
  if (!existsSync(file)) {
    res.writeHead(404).end('Not found');
    return;
  }
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' }).end(readFileSync(file));
}).listen(port, () => console.log(`Serving dist/ at http://localhost:${port}${BASE}`));
