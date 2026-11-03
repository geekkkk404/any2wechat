// main.mjs — any2wechat 守护进程入口：单进程双任务
//   ① listen 长轮询（抓绑定令牌 + 在线保活）  ② webhook server（读会话发送）
// 环境变量：BRIDGE_PORT（默认 8788）、BRIDGE_HOST（默认 127.0.0.1）、BRIDGE_TOKEN（可选鉴权）、
//           BRIDGE_DATA_DIR（默认 <仓库>/data）——详见 docs/webhook-api.md
import { notifyStart, sendMessage } from "./ilink.mjs";
import { loadCredentials } from "./store.mjs";
import { startListen } from "./listen.mjs";
import { startServer } from "./server.mjs";

const log = console;

let creds;
try {
  creds = loadCredentials();
} catch (err) {
  log.error(`❌ ${err.message}`);
  process.exit(1);
}

const state = {};

log.log("=== any2wechat 守护进程 ===");

// 上线通知（官方 channel 启动时调用；失败不阻塞启动）
try {
  const ns = await notifyStart(creds);
  log.log(`notifystart: ${JSON.stringify(ns)}`);
} catch (err) {
  log.error(`notifystart 失败（忽略，继续启动）: ${err.message}`);
}

// 任务①：长轮询。首次绑定（未绑定 → 已绑定跃迁）时自动回发确认
startListen({
  state,
  log,
  onBound: async (session) => {
    try {
      await sendMessage(
        creds,
        session.to_user_id,
        "✅ 绑定成功！此后的推送将直达这里。—— any2wechat",
        session.context_token,
      );
      log.log("[main] 绑定回执已发送");
    } catch (err) {
      log.error(`[main] 绑定回执发送失败: ${err.message}`);
    }
  },
});

// 任务②：webhook 服务
const server = await startServer({ state, log });

const shutdown = (sig) => {
  log.log(`\n收到 ${sig}，正在退出...`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref(); // 兜底：1.5s 内强制退出
};
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
