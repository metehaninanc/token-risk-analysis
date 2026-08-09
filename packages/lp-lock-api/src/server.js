// HTTP API: POST /lp-lock (token|pair), GET /health, GET /. Node's built-in http.
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { findLpLocks, loadEnv } from './index.js';

loadEnv();
const PORT = Number(process.env.PORT) || 3001;
const MAX_BODY = 64 * 1024;

const DOCS = {
  name: 'lp-lock-api',
  description: 'Finds whether a token\'s Uniswap V2 LP is locked (OnlyMoons / PinkLock / UNCX) or burned.',
  sources: ['OnlyMoons', 'PinkLock', 'UNCX', 'Burn (fallback)'],
  endpoints: {
    'POST /lp-lock': 'body { "token": "0x..", "pair": "0x.." } (at least one) → standard lock result',
    'GET /health': 'liveness',
  },
};

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('Request body too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function statusFor(err) {
  if (err.status) return err.status;
  const msg = err.message || '';
  if (/Invalid (token|pair) address|Provide a token/.test(msg)) return 400;
  if (/No RPC URL/.test(msg)) return 500;
  return 502; // RPC / explorer failures
}

export function createApp() {
  return createServer(async (req, res) => {
    try {
      const url = (req.url || '/').split('?')[0];
      if (req.method === 'GET' && url === '/health') return sendJson(res, 200, { ok: true, sources: DOCS.sources });
      if (req.method === 'GET' && url === '/') return sendJson(res, 200, DOCS);
      if (req.method === 'POST' && url === '/lp-lock') {
        const raw = await readBody(req);
        let body;
        try {
          body = raw ? JSON.parse(raw) : {};
        } catch {
          return sendJson(res, 400, { error: 'Body must be valid JSON.' });
        }
        const result = await findLpLocks({ token: body.token, pair: body.pair });
        return sendJson(res, 200, result);
      }
      return sendJson(res, 404, { error: `No route for ${req.method} ${url}` });
    } catch (err) {
      return sendJson(res, statusFor(err), { error: err.message || 'Internal error' });
    }
  });
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  createApp().listen(PORT, () => {
    console.log(`lp-lock-api on http://localhost:${PORT}`);
    console.log('  POST /lp-lock   GET /health   GET /');
  });
}
