// synth-engine のローカル確認用サーバー（127.0.0.1 のみ。第三者ライブラリ不使用）。
// 使い方: node tools/serve.mjs [port]   既定 8963。プロジェクト直下を配信し、/ は試聴ページへ。
// Range に対応しているのは、<audio> が総再生時間を表示しシークできるようにするため。
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.argv[2] || 8963);
const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json", ".wasm": "application/wasm", ".wav": "audio/wav",
  ".txt": "text/plain; charset=utf-8", ".md": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png",
};

http.createServer((req, res) => {
  let rel = decodeURIComponent(req.url.split("?")[0]);

  // ブラウザ自己診断（shells/web/selftest.html）の結果を受け取って追記する。
  // Safari は Claude のブラウザツールから操作できないため、ページ側から結果を送ってもらう。
  // 127.0.0.1 のみで待ち受けており、書き込み先は下の1ファイルに固定。
  if (req.method === "POST" && rel === "/report") {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 64 * 1024) { req.destroy(); }
    });
    req.on("end", () => {
      const line = JSON.stringify({ at: new Date().toISOString(), ua: req.headers["user-agent"] || "", body: body.slice(0, 64 * 1024) }) + "\n";
      fs.mkdirSync(path.join(ROOT, "build"), { recursive: true });
      fs.appendFileSync(path.join(ROOT, "build", "browser-reports.jsonl"), line);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end('{"ok":true}');
    });
    return;
  }

  // `/` はブラウザ版デモへ。試聴ページ（design/listen/）は手元だけの判断用で公開物には含まれない。
  if (rel === "/") { res.writeHead(302, { Location: "/shells/web/demo.html" }); res.end(); return; }
  const target = path.normalize(path.join(ROOT, rel));
  if (!target.startsWith(ROOT)) { res.writeHead(403); res.end("403"); return; }
  fs.stat(target, (err, stat) => {
    if (err || !stat.isFile()) { res.writeHead(404); res.end("404"); return; }
    const type = TYPES[path.extname(target)] || "application/octet-stream";
    const range = req.headers.range;
    if (range) {
      const m = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (m) {
        const start = m[1] === "" ? stat.size - Number(m[2]) : Number(m[1]);
        const end = m[2] === "" || m[1] === "" ? stat.size - 1 : Number(m[2]);
        if (start >= 0 && end < stat.size && start <= end) {
          res.writeHead(206, {
            "Content-Type": type, "Content-Length": end - start + 1,
            "Content-Range": `bytes ${start}-${end}/${stat.size}`,
            "Accept-Ranges": "bytes", "Cache-Control": "no-store",
          });
          fs.createReadStream(target, { start, end }).pipe(res);
          return;
        }
      }
      res.writeHead(416, { "Content-Range": `bytes */${stat.size}` }); res.end(); return;
    }
    res.writeHead(200, {
      "Content-Type": type, "Content-Length": stat.size,
      "Accept-Ranges": "bytes", "Cache-Control": "no-store",
    });
    fs.createReadStream(target).pipe(res);
  });
}).listen(PORT, "127.0.0.1", () => {
  console.log(`synth-engine on http://127.0.0.1:${PORT} (localhost only, root=${ROOT})`);
});
