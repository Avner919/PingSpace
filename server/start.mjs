import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { createApi } from './api.mjs';
import { createRuntimeStore } from './runtime-store.mjs';
const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 5173);
const root = resolve('dist');
const api = createApi({ store: await createRuntimeStore() });
const types = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.png':'image/png', '.jpg':'image/jpeg', '.svg':'image/svg+xml', '.woff2':'font/woff2', '.json':'application/json' };
const server = createServer(async (req, res) => {
  if (req.url?.startsWith('/api/')) return void api.handle(req, res);
  if (!['GET','HEAD'].includes(req.method)) { res.writeHead(405); return res.end(); }
  try {
    const pathname = decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    let file = resolve(root, '.' + pathname);
    if (file !== root && !file.startsWith(root + sep)) { res.writeHead(403); return res.end(); }
    try { if ((await stat(file)).isDirectory()) file = resolve(file,'index.html'); }
    catch { if (!extname(pathname)) file = resolve(root,'index.html'); }
    const data = await readFile(file);
    res.writeHead(200, {'Content-Type':types[extname(file)] || 'application/octet-stream','X-Content-Type-Options':'nosniff','Cache-Control':'no-cache'});
    res.end(req.method === 'HEAD' ? undefined : data);
  } catch { res.writeHead(404);res.end('Страница не найдена. Выполните npm run build.'); }
});
server.on('close',()=>api.close());
server.on('error',error=>{console.error(error.message);process.exitCode=1;api.close();});
server.listen(port,host,()=>console.log(`PingSpace: http://${host}:${port}/`));
for (const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>server.close());
