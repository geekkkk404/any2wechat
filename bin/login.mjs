// login.mjs — 登录 CLI：终端出二维码/授权链接 → 轮询状态机 → 凭证落盘 data/credentials.json
// 状态机语义参考 Tencent/openclaw-weixin src/auth/login-qr.ts（MIT）
// 零硬依赖：装了 qrcode（P-62：runtime 依赖本就必有——发图链用）就渲染终端二维码（微信扫一扫
// 对屏幕直接授权，省「复制链接→传手机」三步）；裸跑未 npm install 则直接给链接兜底
import fs from "node:fs";
import { FIXED_BASE_URL, getBotQrcode, pollQrStatus } from "../src/ilink.mjs";
import { QR_LINK_FILE, ensureDataDir, saveCredentials } from "../src/store.mjs";

const MAX_QR_REFRESH = 5;
const TOTAL_TIMEOUT_MS = 8 * 60_000;
// 支持 --code 1234：服务端要求配对码时由外部传入（后台运行场景）
const codeArgIdx = process.argv.indexOf("--code");
const PRESET_CODE = codeArgIdx > -1 ? process.argv[codeArgIdx + 1] : undefined;

let QRCodeLib = null;
try {
  QRCodeLib = (await import("qrcode")).default;
} catch {
  /* 未安装则跳过终端二维码渲染 */
}

const inputLine = (prompt) =>
  new Promise((resolve) => {
    process.stdout.write(prompt);
    let input = "";
    const onData = (chunk) => {
      input += chunk.toString();
      if (input.includes("\n")) {
        process.stdin.removeListener("data", onData);
        process.stdin.pause();
        resolve(input.trim());
      }
    };
    process.stdin.resume();
    process.stdin.setEncoding("utf-8");
    process.stdin.on("data", onData);
  });

async function main() {
  ensureDataDir();
  let baseUrl = FIXED_BASE_URL;
  let qrRefresh = 0;
  let verifyCode = PRESET_CODE;
  let scannedPrinted = false;
  const deadline = Date.now() + TOTAL_TIMEOUT_MS;

  console.log("=== any2wechat — 登录 ===");
  let qr = await getBotQrcode(baseUrl);
  await renderQr(qr);

  while (Date.now() < deadline) {
    let status;
    try {
      status = await pollQrStatus(baseUrl, qr.qrcode, verifyCode);
    } catch (err) {
      console.error(`轮询异常: ${err.message}，2 秒后重试`);
      await sleep(2000);
      continue;
    }

    switch (status.status) {
      case "wait":
        process.stdout.write(".");
        break;
      case "scaned":
        if (!scannedPrinted) {
          console.log("\n已扫码，正在验证（手机上如有数字配对码请留意）...");
          scannedPrinted = true;
        }
        break;
      case "need_verifycode":
        if (PRESET_CODE && verifyCode !== PRESET_CODE) {
          // 后台模式：用启动时预设的配对码重试
          console.log(`\n需要配对码，使用预设: ${PRESET_CODE}`);
          verifyCode = PRESET_CODE;
          continue;
        }
        verifyCode = await inputLine(
          verifyCode ? "❌ 数字不匹配，请重新输入：" : "输入手机微信显示的数字，以继续连接：",
        );
        continue;
      case "verify_code_blocked":
        console.log("\n⛔ 多次输入错误，刷新二维码重来");
        verifyCode = undefined;
        qr = await refresh(qr, ++qrRefresh);
        scannedPrinted = false;
        break;
      case "expired":
        qr = await refresh(qr, ++qrRefresh);
        if (!qr) return die("二维码多次失效，已停止");
        scannedPrinted = false;
        break;
      case "scaned_but_redirect":
        if (status.redirect_host) {
          baseUrl = `https://${status.redirect_host}`;
          console.log(`\n(IDC 重定向) 轮询主机切换: ${status.redirect_host}`);
        }
        break;
      case "binded_redirect":
        return die("此 bot 已绑定过，无需重复连接");
      case "confirmed": {
        if (!status.ilink_bot_id) return die("登录失败：服务端未返回 ilink_bot_id");
        saveCredentials({
          bot_token: status.bot_token,
          bot_id: status.ilink_bot_id,
          user_id: status.ilink_user_id, // 扫码者 = 推送目标
          base_url: status.baseurl || baseUrl,
          saved_at: new Date().toISOString(),
        });
        console.log(`\n\n✅ 登录成功，凭证已保存: ${process.env.BRIDGE_DATA_DIR || "<仓库>/data"}`);
        console.log(`   bot_id=${status.ilink_bot_id}`);
        console.log(`   user_id=${status.ilink_user_id}  (推送目标)`);
        console.log(`   base_url=${status.baseurl || baseUrl}`);
        console.log(`\n下一步: node src/main.mjs 启动守护进程，然后微信里给 bot 发一句"绑定"`);
        return;
      }
      default:
        console.log(`\n未知状态: ${status.status}（原始: ${JSON.stringify(status).slice(0, 200)}）`);
    }
    await sleep(1000);
  }
  die("登录超时");
}

async function renderQr(qr) {
  const link = qr.qrcode_img_content || qr.qrcode;
  fs.writeFileSync(QR_LINK_FILE, link, "utf-8"); // 持久化当前有效链接，供后台/远程模式传递
  let rendered = false;
  if (QRCodeLib) {
    try {
      const art = await QRCodeLib.toString(link, { type: "terminal", small: true });
      console.log("\n手机微信「扫一扫」扫下方二维码即可确认（或把链接发到手机，微信内打开）:\n");
      console.log(art);
      rendered = true;
    } catch {
      /* 渲染失败回退纯链接 */
    }
  }
  if (!rendered) {
    console.log("\n手机微信内打开此链接即可确认（把链接发到手机，如文件传输助手）:\n");
  }
  console.log(`${link}\n`);
}

async function refresh(oldQr, count) {
  if (count > MAX_QR_REFRESH) return null;
  console.log(`\n⏳ 二维码已过期，刷新中（第 ${count} 次）...`);
  const qr = await getBotQrcode(FIXED_BASE_URL);
  await renderQr(qr);
  return qr;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function die(msg) {
  console.error(`\n❌ ${msg}`);
  process.exit(1);
}

main().catch((e) => die(e.stack || e.message));
