// relay.mjs — 入站转发：把扫码者的消息 POST 给本机回调（BRIDGE_RELAY_URL），
// 供宿主项目实现指令/自动化。设计纪律：桥不解析消息语义（保持通用产品，R5）；
// 投递失败短暂重试后放弃，绝不影响绑定/保活/发送主链路。
//   P-64 重开（2026-11-08）：安装收尾「桥先起、消费方晚 ~10s」的竞态窗口里，首绑消息
//   的一次投递失败 = 宿主欢迎语永久丢失（消息已消费且原实现不重试，真机实锤）。
//   改为失败重试（默认 8 次 × 2s），覆盖消费方未就绪与瞬时重启两类窗口；
//   重试在串行链内后台进行，listen/保活/发送主链路零阻塞。
const RELAY_TIMEOUT_MS = 5000;
const RELAY_RETRY_TIMES = 8; // 首次失败后的额外尝试次数（0 = 关闭重试）
const RELAY_RETRY_DELAY_MS = 2000;

/**
 * 创建入站转发器（串行保序；未配置 BRIDGE_RELAY_URL 时为 no-op）。
 * @param {object} opts
 * @param {string} opts.url    默认 BRIDGE_RELAY_URL 环境变量；空 = 关闭转发
 * @param {string} opts.token  默认 BRIDGE_RELAY_TOKEN 环境变量；设置后携带 Authorization: Bearer
 * @param {number} opts.timeoutMs  单次投递超时（默认 5000；测试用）
 * @param {number} opts.retryTimes  首次失败后的额外尝试次数（默认 8；0 = 失败即放弃）
 * @param {number} opts.retryDelayMs  重试间隔毫秒（默认 2000；测试可传小值）
 * @param {object} opts.log    日志对象（默认 console）
 * @returns {{post: (msg: object) => void, enabled: boolean}}
 */
export function createRelay({
  url = process.env.BRIDGE_RELAY_URL || "",
  token = process.env.BRIDGE_RELAY_TOKEN || "",
  timeoutMs = RELAY_TIMEOUT_MS,
  retryTimes = RELAY_RETRY_TIMES,
  retryDelayMs = RELAY_RETRY_DELAY_MS,
  log = console,
} = {}) {
  if (!url) return { post: () => {}, enabled: false };

  let chain = Promise.resolve(); // 串行保序：消息按到达顺序逐条投递（含重试，见 P-64）
  let ok = 0;
  let failed = 0;

  const post = (msg) => {
    chain = chain
      .then(async () => {
        const total = retryTimes + 1;
        for (let attempt = 1; attempt <= total; attempt++) {
          try {
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
            log.log(
              attempt === 1
                ? `[relay] → 已投递（累计 ✅${ok} / ❌${failed}）`
                : `[relay] → 已投递（第 ${attempt}/${total} 次尝试成功；累计 ✅${ok} / ❌${failed}）`,
            );
            return;
          } catch (err) {
            if (attempt < total) {
              log.error(
                `[relay] 投递失败（${attempt}/${total} 次，${retryDelayMs}ms 后重试）: ${err.message}`,
              );
              await new Promise((r) => setTimeout(r, retryDelayMs));
            } else {
              failed++;
              log.error(
                `[relay] 投递失败（已重试 ${retryTimes} 次放弃，不影响主链路）: ${err.message}`,
              );
            }
          }
        }
      });
  };

  return { post, enabled: true };
}
