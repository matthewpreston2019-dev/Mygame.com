// Minimal HTTP plumbing: routing, JSON bodies, access token and static files. No framework.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from '../config.js';
import { log } from '../core/log.js';

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon' };
const MAX_BODY = 64 * 1024;

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** routes: [[method, '/api/tasks/:id', handler]] — handler(req, { params, body, query }) returns JSON-able data. */
export function createServer(routes) {
  const compiled = routes.map(([method, pattern, handler]) => {
    const keys = [];
    const re = new RegExp(`^${pattern.replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)'))}$`);
    return { method, re, keys, handler };
  });

  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (url.pathname === '/health') return send(res, 200, { ok: true }); // for the host's health checks; reveals nothing
      if (!url.pathname.startsWith('/api/')) return serveStatic(url.pathname, res);
      if (!authorised(req, url)) throw new HttpError(401, 'Access token required');

      for (const r of compiled) {
        const m = r.method === req.method && url.pathname.match(r.re);
        if (!m) continue;
        const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
        const body = ['POST', 'PUT'].includes(req.method) ? await readJson(req) : {};
        const data = await r.handler(req, { params, body, query: url.searchParams, res });
        if (data !== undefined) send(res, 200, data);
        return;
      }
      throw new HttpError(404, 'Not found');
    } catch (err) {
      const status = err.status || 500;
      if (status >= 500) log.error('http.error', { path: url.pathname, error: err.message });
      if (!res.headersSent) send(res, status, { error: status >= 500 ? 'Server error' : err.message });
    }
  });
}

function authorised(req, url) {
  if (!config.token) return true; // only allowed on loopback — enforced at start-up
  const given = (req.headers.authorization || '').replace(/^Bearer /, '') || url.searchParams.get('token') || '';
  const a = crypto.createHash('sha256').update(given).digest();
  const b = crypto.createHash('sha256').update(config.token).digest();
  return crypto.timingSafeEqual(a, b);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new HttpError(413, 'Request too large'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
      } catch {
        reject(new HttpError(400, 'Invalid JSON'));
      }
    });
  });
}

export function send(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

// Three.js is served from node_modules so the interface needs no external CDN.
const VENDOR = { '/vendor/three/': path.join(config.root, 'node_modules', 'three') };

function serveStatic(pathname, res) {
  const decoded = decodeURIComponent(pathname);
  const prefix = Object.keys(VENDOR).find((p) => decoded.startsWith(p));
  const base = prefix ? VENDOR[prefix] : config.publicDir;
  const rel = prefix ? decoded.slice(prefix.length) : decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '');
  let file = path.join(base, rel);
  if (!file.startsWith(base + path.sep)) throw new HttpError(403, 'Forbidden');
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    if (prefix) throw new HttpError(404, 'Not found');
    file = path.join(config.publicDir, 'index.html');
  }
  res.writeHead(200, {
    'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
    'Cache-Control': 'no-cache',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  });
  fs.createReadStream(file).pipe(res);
}
