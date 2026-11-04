// listen.mjs — 长轮询任务：抓取绑定关系（from_user_id + context_token）+ 在线保活
// 协议关键（vendor inbound.ts "must be echoed verbatim"）：context_token 由每条下行消息下发、
// 发送必须原样回传 → 本循环是产品形态的硬前提（缺失 = 发送 ret=-2 prepare failed）
// P-35 守卫：绑定与转发只认扫码者本人（credentials.user_id），他人的消息一律忽略——
// 绑定语义是 last-message-wins，入站转发开放后被抢绑定的后果从"收错推送"升级为"配置可被改"
import { getUpdates, sendMessage } from "./ilink.mjs";
import { hasSession, loadCredentials, saveSession } from "./store.mjs";

const POLL_RETRY_MS = 5000;
const PAUSE_MS = 60 * 60_000; // -14 暂停时长（服务端语义约 1 小时）
const HEARTBEAT_ROUNDS = 60; // 每 N 轮打一条心跳日志

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 提取下行消息的文本（item_list[{type:1,text_item:{text}}]；其它类型忽略）
function extractText(m) {
  const parts = [];
  for (const item of m.item_list ?? []) {
    const t = item?.text_item?.text;
    if (typeof t === "string") parts.push(t);
  }
  return parts.join("\n");
}

/**
 * 启动长轮询循环（后台运行，本函数立即返回）。
 * @param {object} opts
 * @param {object}  opts.state    与 server 共享的状态对象（listening/bound/pausedUntil/lastError）
 * @param {object}  opts.log      日志对象（默认 console）
 * @param {function} opts.isStopped 停机探测（返回 true 则循环退出）
 * @param {function} opts.onBound  仅"未绑定 → 已绑定"跃迁时回调（首次绑定回执）
 * @param {function} opts.onMessage 扫码者本人的每条消息回调（含首条绑定消息）：
 *                            ({from_user_id, text, received_at})；未配置则不回调
 */
export function startListen({
  state = {},
  log = console,
  isStopped = () => false,
  onBound = null,
  onMessage = null,
} = {}) {
  const creds = loadCredentials();
  const owner = creds.user_id || "";
  if (!owner) log.error("[listen] ⚠️ 凭证缺 user_id，无法启用扫码者守卫（P-35），绑定回退为认任意发送者");
  let buf = "";
  let bound = hasSession();
  state.listening = true;
  state.bound = bound;

  (async () => {
    for (let i = 1; ; i++) {
      if (isStopped()) {
        state.listening = false;
        return;
      }
      try {
        const resp = await getUpdates(creds, buf);
        state.lastPollAt = new Date().toISOString();
        if (resp.ret && resp.ret !== 0) {
          state.lastError = `ret=${resp.ret}`;
          log.error(`[listen] ret=${resp.ret} errcode=${resp.errcode ?? ""} errmsg=${resp.errmsg ?? ""}`);
          if (resp.ret === -14 || resp.errcode === -14) {
            // 服务端要求会话暂停：进程不清退（server 还要靠最后的令牌尽力发送），到点自动恢复轮询
            log.error("[listen] -14: 服务端要求会话暂停约 1 小时，60 分钟后自动恢复");
            state.pausedUntil = new Date(Date.now() + PAUSE_MS).toISOString();
            await sleep(PAUSE_MS);
            state.pausedUntil = null;
            continue;
          }
          await sleep(POLL_RETRY_MS);
          continue;
        }
        const msgs = resp.msgs ?? [];
        if (Array.isArray(msgs) && msgs.length) {
          let latest = null;
          for (const m of msgs) {
            if (!m.from_user_id || !m.context_token) continue;
            if (owner && m.from_user_id !== owner) continue; // P-35 守卫
            latest = { from: m.from_user_id, token: m.context_token };
            if (onMessage) {
              try {
                onMessage({
                  from_user_id: m.from_user_id,
                  text: extractText(m),
                  received_at: new Date().toISOString(),
                });
              } catch (err) {
                log.error(`[listen] onMessage 回调异常（忽略）: ${err.message}`);
              }
            }
          }
          if (latest) {
            const session = {
              to_user_id: latest.from,
              context_token: latest.token,
              bound_at: new Date().toISOString(),
            };
            saveSession(session);
            const isNew = !bound;
            bound = true;
            state.bound = true;
            log.log(`[listen] ✅ 会话已绑定 → to_user_id=${session.to_user_id}`);
            if (isNew && onBound) {
              try {
                await onBound(session);
              } catch (err) {
                log.error(`[listen] 绑定回执失败: ${err.message}`);
              }
            }
          }
        } else if (i % HEARTBEAT_ROUNDS === 0) {
          log.log(`[listen] ${i} 轮心跳正常`);
        }
        if (resp.get_updates_buf) buf = resp.get_updates_buf;
      } catch (err) {
        state.lastError = err.message;
        log.error(`[listen] 异常: ${err.message}，${POLL_RETRY_MS / 1000} 秒后重试`);
        await sleep(POLL_RETRY_MS);
      }
    }
  })();

  return state;
}
