/*
 * 店舗管理アプリ 同期サーバー（Cloudflare Workers 版）
 * ------------------------------------------------------------------
 * 店内にPCを置きたくない場合や、店の外からも見たい場合はこちらを使います。
 * Cloudflare の無料枠で動きます（1日10万リクエストまで。14台なら十分です）。
 *
 * 【手順】
 *  1. https://dash.cloudflare.com/ でアカウントを作る（無料）
 *  2. 左メニュー「Workers & Pages」→「Create」→「Start with Hello World!」
 *  3. 出てきたコードを全部消して、このファイルの中身を貼り付けて Deploy
 *  4. 「Settings」→「Bindings」→「Add」→「KV Namespace」を選ぶ
 *       Variable name : STORE
 *       KV namespace  : 新しく作る（名前は store-manager など何でもよい）
 *  5. デプロイ後に表示されるURL（例 https://xxxx.workers.dev ）の末尾に
 *     /sync を付けたものを、アプリの「設定 → 連携とデータ → 外部同期URL」に
 *     全タブレットで入力する
 *       例）https://xxxx.workers.dev/sync
 *
 * 【注意】
 *  このURLを知っている人は誰でもデータを読み書きできます。
 *  下の SECRET を推測されにくい文字列に変えると、URLに ?key=その文字列 を
 *  付けた場合だけ通すようになります。
 *    例）https://xxxx.workers.dev/sync?key=あなたの合言葉
 */

const SECRET = "";   // 空なら誰でもアクセス可。例: "kai-club-2026-8f3a"

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
  });
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

    const url = new URL(request.url);

    if (SECRET && url.searchParams.get("key") !== SECRET) {
      return json({ error: "unauthorized" }, 401);
    }

    if (url.pathname !== "/sync") {
      return json({ error: "not found. use /sync" }, 404);
    }

    if (!env.STORE) {
      return json({ error: "KV namespace 'STORE' が設定されていません" }, 500);
    }

    /* --- 最新の状態を返す --- */
    if (request.method === "GET") {
      const raw = await env.STORE.get("state");
      if (!raw) return json({ rev: 0, data: null });
      return new Response(raw, {
        headers: { ...CORS, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
      });
    }

    /* --- 受け取った状態を保存する --- */
    if (request.method === "POST") {
      let m;
      try { m = await request.json(); } catch (e) { return json({ error: "bad json" }, 400); }
      if (!m || !m.data) return json({ error: "no data" }, 400);

      // サーバー側で通し番号を振る（どの端末が最後に書いたか判定するため）
      const prevRaw = await env.STORE.get("state");
      let prevRev = 0;
      if (prevRaw) {
        try { prevRev = JSON.parse(prevRaw).rev || 0; } catch (e) {}
      }
      const rev = prevRev + 1;

      const record = { from: m.from || "unknown", rev, at: Date.now(), data: m.data };
      await env.STORE.put("state", JSON.stringify(record));

      return json({ ok: true, rev });
    }

    return json({ error: "method not allowed" }, 405);
  }
};
