/*
 * 店舗管理アプリ 同期サーバー
 * ------------------------------------------------------------------
 * 店内のPC（Windows / Mac / Raspberry Pi など）で動かします。
 * 外部サービスの契約もインターネット接続も不要です。
 *
 * 【必要なもの】
 *   Node.js （https://nodejs.org/ から LTS 版をインストール）
 *
 * 【使い方】
 *   1. このファイルと store-manager.html を同じフォルダに置く
 *   2. そのフォルダでコマンドを開いて  node sync-server.js  と実行
 *   3. 画面に出たURL（例 http://192.168.1.20:8787 ）を
 *      各タブレットのブラウザで開く
 *
 * これだけで14台すべてが同じデータを見るようになります。
 * アプリ側の「外部同期URL」は自動で設定されるので、触る必要はありません。
 *
 * データは同じフォルダの store-data.json に保存されます。
 * サーバーを再起動しても内容は残ります。
 */

const http = require("http");
const fs   = require("fs");
const path = require("path");
const os   = require("os");

const PORT      = process.env.PORT || 8787;
const DATA_FILE = path.join(__dirname, "store-data.json");
const HTML_FILE = path.join(__dirname, "store-manager.html");

/* ---------- 保存されている状態を読み込む ---------- */
let current = null;   // { from, rev, at, data }
let rev = 0;

try {
  if (fs.existsSync(DATA_FILE)) {
    current = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    rev = current.rev || 0;
    console.log("保存済みのデータを読み込みました（rev " + rev + "）");
  }
} catch (e) {
  console.warn("保存データの読み込みに失敗しました。空の状態で始めます。", e.message);
}

/* ---------- ディスクへの書き込みはまとめて行う ---------- */
let saveTimer = null;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      // 一度別名で書いてから置き換える（書き込み中に電源が落ちても壊れないように）
      const tmp = DATA_FILE + ".tmp";
      fs.writeFileSync(tmp, JSON.stringify(current));
      fs.renameSync(tmp, DATA_FILE);
    } catch (e) {
      console.error("保存に失敗:", e.message);
    }
  }, 500);
}

/* ---------- 便利関数 ---------- */
function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}
function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(body)
  });
  res.end(body);
}
function readBody(req, limitBytes, cb) {
  let size = 0;
  const chunks = [];
  req.on("data", c => {
    size += c.length;
    if (size > limitBytes) { req.destroy(); return; }
    chunks.push(c);
  });
  req.on("end", () => cb(null, Buffer.concat(chunks).toString("utf8")));
  req.on("error", err => cb(err));
}

/* ---------- サーバー本体 ---------- */
const server = http.createServer((req, res) => {
  cors(res);

  if (req.method === "OPTIONS") { res.writeHead(204); return res.end(); }

  const url = (req.url || "/").split("?")[0];

  /* --- 同期エンドポイント --- */
  if (url === "/sync") {
    if (req.method === "GET") {
      if (!current) return sendJson(res, 200, { rev: 0, data: null });
      return sendJson(res, 200, current);
    }
    if (req.method === "POST") {
      return readBody(req, 20 * 1024 * 1024, (err, raw) => {
        if (err) return sendJson(res, 400, { error: "read failed" });
        let m;
        try { m = JSON.parse(raw); } catch (e) { return sendJson(res, 400, { error: "bad json" }); }
        if (!m || !m.data) return sendJson(res, 400, { error: "no data" });

        rev += 1;
        current = { from: m.from || "unknown", rev: rev, at: Date.now(), data: m.data };
        scheduleSave();
        return sendJson(res, 200, { ok: true, rev: rev });
      });
    }
    res.writeHead(405); return res.end();
  }

  /* --- 状態を初期化したいとき（ブラウザで /reset を開く） --- */
  if (url === "/reset" && req.method === "GET") {
    current = null; rev = 0;
    try { if (fs.existsSync(DATA_FILE)) fs.unlinkSync(DATA_FILE); } catch (e) {}
    return sendJson(res, 200, { ok: true, message: "サーバー上のデータを消しました" });
  }

  /* --- アプリ本体を配信する --- */
  if (url === "/" || url === "/index.html" || url === "/store-manager.html") {
    fs.readFile(HTML_FILE, (err, buf) => {
      if (err) {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        return res.end("store-manager.html がこのフォルダに見つかりません。\n"
                     + "sync-server.js と同じ場所に置いてください。");
      }
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store"
      });
      res.end(buf);
    });
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("not found");
});

/* ---------- 起動 ---------- */
server.listen(PORT, "0.0.0.0", () => {
  const nets = os.networkInterfaces();
  const addrs = [];
  Object.keys(nets).forEach(name => {
    nets[name].forEach(n => {
      if (n.family === "IPv4" && !n.internal) addrs.push(n.address);
    });
  });

  console.log("");
  console.log("==================================================");
  console.log("  店舗管理アプリ 同期サーバーを起動しました");
  console.log("==================================================");
  console.log("");
  console.log("  このPCで開く場合:");
  console.log("    http://localhost:" + PORT);
  console.log("");
  if (addrs.length) {
    console.log("  タブレットで開く場合（同じWi-Fiに繋いでください）:");
    addrs.forEach(a => console.log("    http://" + a + ":" + PORT));
  } else {
    console.log("  ネットワークアドレスが取得できませんでした。");
    console.log("  Wi-Fiに接続してから起動し直してください。");
  }
  console.log("");
  console.log("  データの保存先: " + DATA_FILE);
  console.log("  止めるときは Ctrl + C");
  console.log("");
});

process.on("SIGINT", () => {
  console.log("\n終了します。データを保存しました。");
  try {
    if (current) fs.writeFileSync(DATA_FILE, JSON.stringify(current));
  } catch (e) {}
  process.exit(0);
});
