// send-test.mjs — 手工发送测试：读凭证 + 会话 → 发一条消息到已绑定的微信
import { sendMessage, notifyStart } from "../src/ilink.mjs";
import { loadCredentials, loadSession } from "../src/store.mjs";

const creds = loadCredentials();

// 已绑定会话优先——发送必须回传最新 context_token
let to, contextToken;
try {
  const session = loadSession();
  to = session.to_user_id;
  contextToken = session.context_token;
  console.log(`使用已绑定会话: to=${to} token=${contextToken.slice(0, 20)}...`);
} catch {
  to = process.argv[3] || creds.user_id;
  console.log("⚠️ 会话未绑定，将不带 context_token 尝试（预期 prepare failed，先启动监听并在微信里发一条消息）");
}

const text = process.argv[2] ?? "any2wechat 心跳测试 ✅";
console.log(`内容: ${text.slice(0, 60)}${text.length > 60 ? "..." : ""}\n`);

console.log("先上线通知 (notifystart)...");
try {
  const ns = await notifyStart(creds);
  console.log(`notifystart: ${JSON.stringify(ns)}`);
} catch (err) {
  console.error(`notifystart 失败（继续尝试发送）: ${err.message}`);
}
try {
  const resp = await sendMessage(creds, to, text, contextToken);
  console.log("✅ 服务端接受:", JSON.stringify(resp));
  console.log("→ 请查看微信是否收到");
} catch (err) {
  console.error("❌ 发送失败:", err.message);
  process.exit(1);
}
