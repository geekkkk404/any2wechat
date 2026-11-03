// server.mjs — webhook 服务：POST /webhook {title?, content?|text} → 分批 → 微信；GET /health
// 完整契约见 docs/webhook-api.md。批 1800 字符（保守值）、批间隔 1.2s、串行发送（防风控）
import http from "node:http";
import { sendMessage } from "./ilink.mjs";
import { hasSession, loadCredentials, loadSession } from "./store.mjs";

const BATCH_CHARS = 1800; // 微信文本批大小（保守值，实测后调）
const BATCH_GAP_MS = 1200; // 批间隔，防风控
const MAX_BODY_BYTES = 2_000_000; // 请求体上限

// 按换行边界切分长文本
function splitBatches(text, max = BATCH_CHARS) {
  if (text.length <= max) return [text];
  const out = [];
  let rest = text;
  while (rest.length > max) {
    let cut = rest.lastIndexOf("\n", max);
    if (cut < max * 0.5) cut = max; // 无合适换行则硬切
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\n+/, "");
  }
  if (rest) out.push(rest);
  return out;
}

/**
 * 启动 webhook 服务，监听就绪后 resolve(server)。
 * @param {object} opts
 * @param {number}  opts.port   默认 BRIDGE_PORT 环境变量，再缺省 8788
 * @param {string}  opts.host   默认 BRIDGE_HOST 环境变量，再缺省 127.0.0.1（容器内部署须设 0.0.0.0）
 * @param {string}  opts.token  默认 BRIDGE_TOKEN 环境变量；设置后请求须携带（Authorization: Bearer 或 ?token=）
 * @param {object}  opts.state  与 listen 共享的状态对象（透出到 /health）
 * @param {object}  opts.log    日志对象（默认 console）
 */
export function startServer({
  port = Number(process.env.BRIDGE_PORT || 8788),
  host = process.env.BRIDGE_HOST || "127.0.0.1",
  token = process.env.BRIDGE_TOKEN || "",
  state = {},
  log = console,
} = {}) {
  const creds = loadCredentials();
  let sending = Promise.resolve(); // 串行化发送，避免批间乱序
  const stats = { received: 0, batches: 0, failed: 0, lastAt: null };

  const server = http.createServer((req, res) => {
    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          ok: true,
          hasSession: hasSession(),
          listening: state.listening ?? null,
          pausedUntil: state.pausedUntil ?? null,
          stats,
        }),
      );
      return;
    }
    if (req.method === "POST" && (req.url === "/webhook" || req.url.startsWith("/webhook?"))) {
      if (token) {
        const given = (req.headers.authorization || "").replace(/^Bearer\s+/i, "") ||
          new URL(req.url, "http://x").searchParams.get("token") || "";
        if (given !== token) {
          res.writeHead(401).end(JSON.stringify({ ok: false, error: "token mismatch" }));
          return;
        }
      }
      let body = "";
      req.on("data", (c) => {
        body += c;
        if (body.length > MAX_BODY_BYTES) req.destroy(); // 上限保护
      });
      req.on("end", () => {
        let title = "", content = "";
        try {
          const j = JSON.parse(body);
          title = String(j.title ?? "");
          content = String(j.content ?? j.text ?? "");
        } catch {
          // 兼容纯文本 body
          content = body;
        }
        const full = title ? `${title}\n\n${content}` : content;
        if (!full.trim()) {
          res.writeHead(400).end(JSON.stringify({ ok: false, error: "empty body" }));
          return;
        }
        let session;
        try {
          session = loadSession();
        } catch (err) {
          res.writeHead(409).end(JSON.stringify({ ok: false, error: err.message }));
          return;
        }
        const batches = splitBatches(full);
        const seqTag = batches.length > 1;
        stats.received++;
        log.log(`\n[${new Date().toISOString()}] 收到推送 ${full.length} 字符 → ${batches.length} 批`);

        sending = sending.then(async () => {
          for (let i = 0; i < batches.length; i++) {
            const text = seqTag ? `【${i + 1}/${batches.length}】\n${batches[i]}` : batches[i];
            try {
              // 每批都读最新会话（上游可能分钟级连推，令牌可能已被 listen 刷新）
              const s = loadSession();
              await sendMessage(creds, s.to_user_id, text, s.context_token);
              stats.batches++;
              stats.lastAt = new Date().toISOString();
              log.log(`  批 ${i + 1}/${batches.length} ✅ (${text.length} 字符)`);
            } catch (err) {
              stats.failed++;
              log.error(`  批 ${i + 1}/${batches.length} ❌ ${err.message}`);
              break;
            }
            if (i < batches.length - 1) await new Promise((r) => setTimeout(r, BATCH_GAP_MS));
          }
        });
        res.writeHead(202).end(JSON.stringify({ ok: true, batches: batches.length }));
        return;
      });
      return;
    }
    res.writeHead(404).end();
  });

  return new Promise((resolve) => {
    server.listen(port, host, () => {
      log.log("=== any2wechat webhook 服务 ===");
      log.log(`监听: http://${host}:${port}/webhook （契约: docs/webhook-api.md）`);
      log.log(`会话: ${hasSession() ? "已绑定 ✅" : "未绑定 —— 在微信里给 bot 发一条消息（如：绑定）"}`);
      log.log(
        `接入示例: curl -X POST http://127.0.0.1:${port}/webhook -H "Content-Type: application/json" -d '{"title":"标题","content":"内容"}'`,
      );
      resolve(server);
    });
  });
}
