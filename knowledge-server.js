'use strict';

const http = require('node:http');
const knowledge = require('./src/knowledge/service');

const originalCreateServer = http.createServer.bind(http);

function send(res, status, body) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff'
  });
  res.end(JSON.stringify(body));
}

function readJson(req, max = 5_000_000) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.setEncoding('utf8');
    req.on('data', chunk => {
      data += chunk;
      if (data.length > max) reject(new Error('Knowledge import is too large'));
    });
    req.on('end', () => {
      try { resolve(JSON.parse(data || '{}')); }
      catch { reject(new Error('Invalid JSON body')); }
    });
    req.on('error', reject);
  });
}

async function handleKnowledge(req, res) {
  const url = new URL(req.url, 'http://localhost');
  if (!url.pathname.startsWith('/api/knowledge')) return false;
  try {
    if (req.method === 'GET' && url.pathname === '/api/knowledge/stats') {
      send(res, 200, await knowledge.stats()); return true;
    }
    if (req.method === 'GET' && url.pathname === '/api/knowledge/search') {
      send(res, 200, await knowledge.search(url.searchParams.get('q') || '', Number(url.searchParams.get('limit') || 30))); return true;
    }
    if (req.method === 'GET' && url.pathname.startsWith('/api/knowledge/atoms/')) {
      const id = decodeURIComponent(url.pathname.slice('/api/knowledge/atoms/'.length));
      const result = await knowledge.get(id); send(res, result.atom ? 200 : 404, result); return true;
    }
    if (req.method === 'POST' && url.pathname === '/api/knowledge/import') {
      const body = await readJson(req); const result = await knowledge.importAtoms(body);
      send(res, 200, result); return true;
    }
    if (req.method === 'POST' && /\/api\/knowledge\/atoms\/[^/]+\/status$/.test(url.pathname)) {
      const id = decodeURIComponent(url.pathname.split('/').slice(-2)[0]);
      const body = await readJson(req); send(res, 200, await knowledge.setStatus(id, body.status)); return true;
    }
    if (req.method === 'POST' && /\/api\/knowledge\/atoms\/[^/]+\/usage$/.test(url.pathname)) {
      const id = decodeURIComponent(url.pathname.split('/').slice(-2)[0]);
      const body = await readJson(req); send(res, 200, await knowledge.recordUsage(id, Boolean(body.success))); return true;
    }
    send(res, 404, { error: 'Knowledge endpoint not found' }); return true;
  } catch (error) {
    console.error('Knowledge API:', error);
    send(res, 500, { error: error.message || 'Knowledge database failed' }); return true;
  }
}

function injectKnowledgeStudio(req, res) {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  if (req.method !== 'GET' || (pathname !== '/' && pathname !== '/index.html')) return;
  const originalEnd = res.end.bind(res);
  res.end = function endWithKnowledge(body, encoding, callback) {
    let output = body;
    if (typeof body === 'string') output = body.replace('</body>', '<script src="/knowledge-studio.js"></script></body>');
    else if (Buffer.isBuffer(body)) output = Buffer.from(body.toString('utf8').replace('</body>', '<script src="/knowledge-studio.js"></script></body>'));
    return originalEnd(output, encoding, callback);
  };
}

http.createServer = function patchedCreateServer(handler) {
  return originalCreateServer(async (req, res) => {
    if (await handleKnowledge(req, res)) return;
    injectKnowledgeStudio(req, res);
    return handler(req, res);
  });
};

knowledge.init().then(result => console.log(`AtomOS knowledge database ready: ${result.database}`)).catch(error => console.error('Knowledge database unavailable:', error));
require('./server');
