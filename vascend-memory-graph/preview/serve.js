// Server statico minimale per la preview del grafo (solo 127.0.0.1).
// Root = cartella dell'estensione (parent di preview/), per servire
// graph-preview.html, media/main.js e media/style.css con i MIME corretti.
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.argv[2] || 7842);
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.json': 'application/json; charset=utf-8',
};

http
  .createServer((req, res) => {
    let p = decodeURIComponent((req.url || '/').split('?')[0]);
    if (p === '/') {
      p = '/preview/graph-preview.html';
    }
    const fp = path.normalize(path.join(ROOT, p));
    if (!fp.startsWith(ROOT)) {
      res.writeHead(403);
      return res.end('forbidden');
    }
    fs.readFile(fp, (e, buf) => {
      if (e) {
        res.writeHead(404);
        return res.end('not found');
      }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(fp).toLowerCase()] || 'application/octet-stream' });
      res.end(buf);
    });
  })
  .listen(PORT, '127.0.0.1', () => console.log(`serve on http://127.0.0.1:${PORT}`));
