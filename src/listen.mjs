// listen.mjs — 长轮询任务：抓取绑定关系（from_user_id + context_token）+ 在线保活
// 协议关键（vendor inbound.ts "must be echoed verbatim"）：context_token 由每条下行消息下发、
// 发送必须原样回传 → 本循环是产品形态的硬前提（缺失 = 发送 ret=-2 prepare failed）
import { getUpdates, sendMessage } from "./ilink.mjs";
import { hasSession, loadCredentials, saveSession } from "./store.mjs";

const POLL_RETRY_MS = 5000;
const PAUSE_MS = 60 * 60_000; // -14 暂停时长（服务端语义约 1 小时）
const HEARTBEAT_ROUNDS = 60; // 每 N 轮打一条心跳日志

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 启动长轮询循环（后台运行，本函数立即返回）。
 * @param {object} opts
 * @param {object}  opts.state    与 server 共享的状态对象（listening/bound/pausedUntil/lastError）
 * @param {object}  opts.log      日志对象（默认 console）
 * @param {function} opts.isStopped 停机探测（返回 true 则循环退出）
 * @param {function} opts.onBound  仅"未绑定 → 已绑定"跃迁时回调（首次绑定回执）
 */
export function startListen({ state = {}, log = console, isStopped = () => false, onBound = null } = {}) {
  const creds = loadCredentials();
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
            if (m.from_user_id && m.context_token) {
              latest = { from: m.from_user_id, token: m.context_token };
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
