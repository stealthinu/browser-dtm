import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve, extname, sep } from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
export function createDemoServer() {
  return createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      if (pathname === '/favicon.ico') { response.writeHead(204); response.end(); return; }
      const path = pathname === '/' || pathname === '/demo/vocaloid/' ? '/demo/vocaloid/index.html' : pathname;
      const file = resolve(root, '.' + path);
      const allowed = ['/demo/vocaloid/', '/effects/vocaloid/', '/node_modules/lamejs/'].some(prefix => path.startsWith(prefix));
      const inAllowedDirectory = ['demo/vocaloid', 'effects/vocaloid', 'node_modules/lamejs'].some(prefix => file.startsWith(resolve(root, prefix) + sep));
      if (!allowed || !inAllowedDirectory) { response.writeHead(404); response.end(); return; }
      const bytes = await readFile(file);
      response.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
      response.end(bytes);
    } catch { if (!response.headersSent) response.writeHead(404); response.end(); }
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.VOCALOID_PORT ?? 5447);
  if (!Number.isInteger(port) || port < 5400 || port > 5499) throw new Error('VOCALOID_PORT must be 5400..5499');
  const server = createDemoServer();
  server.listen(port, '127.0.0.1', () => console.log(`http://127.0.0.1:${port}/demo/vocaloid/`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close());
}
