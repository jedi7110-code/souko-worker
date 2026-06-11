// 開発用静的サーバー: Cache-Control: no-cache を付けて配信する。
// ブラウザのヒューリスティックキャッシュで古い ES モジュールが残る問題
// (python3 -m http.server はキャッシュ制御ヘッダを送らない)への対策。
// 使い方: node tools/serve.mjs [port]  (既定 8612)

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.argv[2] || 8612);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

http
  .createServer((req, res) => {
    const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let file = path.normalize(path.join(root, urlPath));
    if (!file.startsWith(root)) {
      res.writeHead(403);
      return res.end('forbidden');
    }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) {
      file = path.join(file, 'index.html');
    }
    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(404);
        return res.end('not found');
      }
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
        'Cache-Control': 'no-cache', // 毎回再検証 → 編集が確実に反映される
      });
      res.end(data);
    });
  })
  .listen(port, '127.0.0.1', () => console.log(`souko dev server: http://127.0.0.1:${port}`));
