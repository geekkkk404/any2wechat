// relay.mjs — 入站转发：把扫码者的消息 POST 给本机回调（BRIDGE_RELAY_URL），
// 供宿主项目实现指令/自动化。设计纪律：桥不解析消息语义（保持通用产品，R5）；
// 转发失败只记日志，绝不影响绑定/保活/发送主链路。
const RELAY_TIMEOUT_MS = 5000;

/**
 * 创建入站转发器（串行保序；未配置 BRIDGE_RELAY_URL 时为 no-op）。
 * @param {object} opts
 * @param {string} opts.url    默认 BRIDGE_RELAY_URL 环境变量；空 = 关闭转发
 * @param {string} opts.token  默认 BRIDGE_RELAY_TOKEN 环境变量；设置后携带 Authorization: Bearer
 * @param {number} opts.timeoutMs  单次投递超时（默认 5000；测试用）
 * @param {object} opts.log    日志对象（默认 console）
 * @returns {{post: (msg: object) => void, enabled: boolean}}
 */
export function createRelay({
  url = process.env.BRIDGE_RELAY_URL || "",
  token = process.env.BRIDGE_RELAY_TOKEN || "",
  timeoutMs = RELAY_TIMEOUT_MS,
  log = console,
} = {}) {
  if (!url) return { post: () => {}, enabled: false };

  let chain = Promise.resolve(); // 串行保序：消息按到达顺序逐条投递
  let ok = 0;
  let failed = 0;

  const post = (msg) => {
    chain = chain
      .then(async () => {
        const res = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify(msg),
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        ok++;
        log.log(`[relay] → 已投递（累计 ✅${ok} / ❌${failed}）`);
      })
      .catch((err) => {
        failed++;
        log.error(`[relay] 投递失败（忽略，不影响主链路）: ${err.message}`);
      });
  };

  return { post, enabled: true };
}
