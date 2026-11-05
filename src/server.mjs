// server.mjs — webhook 服务：POST /webhook {title?, content?|text, qr_content?} → 分批 → 微信；GET /health
// 完整契约见 docs/webhook-api.md。批字符数默认 1800（保守值，实测后调），BRIDGE_BATCH_CHARS 可调；
// 批间隔 1.2s、串行发送（防风控）。qr_content（P-53）：非空则发完文本后追加一张二维码图片消息。
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { sendMessage, sendQrContent } from "./ilink.mjs";
import { DATA_DIR, hasSession, loadCredentials, loadSession } from "./store.mjs";

const BATCH_CHARS = Math.max(500, Math.min(4500, Number(process.env.BRIDGE_BATCH_CHARS || 1800)));
const BATCH_GAP_MS = 1200; // 批间隔，防风控
const MAX_BODY_BYTES = 2_000_000; // 请求体上限

// 推送尾注（通用能力，N-08）：BRIDGE_FOOTER_TEXT 可选；BRIDGE_FOOTER_ONCE_PER_DAY=1 时
// 每日仅首推带（本地日期判定）。状态存 data/footer-state.json，发送成功才记账——失败不吞明天的名额。
const FOOTER = (process.env.BRIDGE_FOOTER_TEXT || "").trim();
const FOOTER_ONCE_PER_DAY = String(process.env.BRIDGE_FOOTER_ONCE_PER_DAY || "") === "1";
const FOOTER_SEP = "\n\n──────────────\n";
const FOOTER_STATE_FILE = path.join(DATA_DIR, "footer-state.json");

function localDate() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

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
        let title = "", content = "", qrContent = "";
        try {
          const j = JSON.parse(body);
          title = String(j.title ?? "");
          content = String(j.content ?? j.text ?? "");
          qrContent = String(j.qr_content ?? "").trim();
        } catch {
          // 兼容纯文本 body
          content = body;
        }
        const full = title ? `${title}\n\n${content}` : content;
        if (!full.trim() && !qrContent) {
          res.writeHead(400).end(JSON.stringify({ ok: false, error: "empty body" }));
          return;
        }
        // 推送尾注
        let footerPending = false;
        let fullOut = full;
        if (FOOTER && full.trim()) {
          if (!FOOTER_ONCE_PER_DAY) {
            fullOut = full + FOOTER_SEP + FOOTER;
          } else {
            const today = localDate();
            let lastDate = "";
            try {
              lastDate = JSON.parse(fs.readFileSync(FOOTER_STATE_FILE, "utf-8")).lastDate || "";
            } catch {
              lastDate = ""; // 无状态文件 = 今日未发
            }
            if (lastDate !== today) {
              footerPending = true;
              fullOut = full + FOOTER_SEP + FOOTER;
            }
          }
        }
        let session;
        try {
          session = loadSession();
        } catch (err) {
          res.writeHead(409).end(JSON.stringify({ ok: false, error: err.message }));
          return;
        }
        const batches = fullOut.trim() ? splitBatches(fullOut) : [];
        const seqTag = batches.length > 1;
        stats.received++;
        log.log(`\n[${new Date().toISOString()}] 收到推送 ${fullOut.length} 字符 → ${batches.length} 批${qrContent ? ` + QR(${qrContent.length}字符)` : ""}`);

        sending = sending.then(async () => {
          for (let i = 0; i < batches.length; i++) {
            const text = seqTag ? `【${i + 1}/${batches.length}】\n${batches[i]}` : batches[i];
            try {
              // 每批都读最新会话（上游可能分钟级连推，令牌可能已被 listen 刷新）
              const s = loadSession();
              await sendMessage(creds, s.to_user_id, text, s.context_token);
              stats.batches++;
              stats.lastAt = new Date().toISOString();
              if (footerPending && i === 0) {
                footerPending = false; // 首批发送成功才记账，失败不吞明天的名额
                try {
                  fs.writeFileSync(FOOTER_STATE_FILE, JSON.stringify({ lastDate: localDate() }));
                } catch { /* 状态写失败 = 明天可能重复带一次，无害 */ }
              }
              log.log(`  批 ${i + 1}/${batches.length} ✅ (${text.length} 字符)`);
            } catch (err) {
              stats.failed++;
              log.error(`  批 ${i + 1}/${batches.length} ❌ ${err.message}`);
              return; // 文本断链时不再补发 QR（顺序语境已乱）
            }
            if (i < batches.length - 1) await new Promise((r) => setTimeout(r, BATCH_GAP_MS));
          }
          if (qrContent) {
            await new Promise((r) => setTimeout(r, BATCH_GAP_MS));
            try {
              const s = loadSession();
              await sendQrContent(creds, s.to_user_id, s.context_token, qrContent, log);
              stats.batches++;
              stats.lastAt = new Date().toISOString();
            } catch (err) {
              stats.failed++;
              log.error(`  QR 图片 ❌ ${err.message}`);
            }
          }
        });
        res.writeHead(202).end(JSON.stringify({ ok: true, batches: batches.length, qr: Boolean(qrContent) }));
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
