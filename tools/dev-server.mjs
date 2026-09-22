import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareVendor } from './vendor.mjs';
import { developmentConfig } from './runtime-config.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT || 4173);
await prepareVendor();
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.glb': 'model/gltf-binary',
  '.wasm': 'application/wasm',
};

createServer(async (request, response) => {
  if (!['GET', 'HEAD'].includes(request.method)) {
    response.writeHead(405, { Allow: 'GET, HEAD' }).end();
    return;
  }
  let path;
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (pathname === '/config.js') {
      const config = await developmentConfig(root);
      const body = `window.ASTRA_CONFIG = Object.assign({}, window.ASTRA_CONFIG || {}, {terrain: Object.assign({}, window.ASTRA_CONFIG?.terrain || {}, ${JSON.stringify(config.terrain)})});\n`;
      response.writeHead(200, { 'Content-Type': mime['.js'], 'Cache-Control': 'no-store' });
      response.end(request.method === 'HEAD' ? '' : body);
      return;
    }
    const parts = pathname.split('/').filter(Boolean);
    if (parts.some(part => part.startsWith('.')) || parts.includes('node_modules')) throw new Error('Forbidden');
    path = resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!path.startsWith(root + sep)) throw new Error('Forbidden');
    const info = await stat(path);
    if (!info.isFile()) throw new Error('Not a file');
    response.writeHead(200, {
      'Content-Type': mime[extname(path)] || 'application/octet-stream',
      'Content-Length': info.size,
      'Cache-Control': 'no-cache',
    });
    if (request.method === 'HEAD') response.end();
    else createReadStream(path).pipe(response);
  } catch {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
  }
}).on('error', error => {
  console.error(error.code === 'EADDRINUSE' ? `Port ${port} is already in use. Set PORT to choose another port.` : error.message);
  process.exitCode = 1;
}).listen(port, '127.0.0.1', () => console.log(`Astra is ready at http://127.0.0.1:${port}`));
