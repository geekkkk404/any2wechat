// ilink.mjs — 微信 iLink bot 协议核心（实现参考 Tencent/openclaw-weixin src/api/api.ts 语义，MIT）
// 协议细节见 docs/protocol-notes.md 与 vendor 文档 docs/protocol_zh_CN.md
import crypto from "node:crypto";

export const FIXED_BASE_URL = "https://ilinkai.weixin.qq.com";
// 官方插件 2.4.8 的版本编码值（0x00MMNNPP → 十进制），服务端已验证接受
export const CHANNEL_VERSION = "2.4.8";
export const CLIENT_VERSION = "132104";
export const BOT_AGENT = "any2wechat/0.4.0";
// 微信 CDN（图片等媒体上传），vendor config-schema 默认值
export const CDN_BASE_URL = "https://novac2c.cdn.weixin.qq.com/c2c";

export function buildBaseInfo() {
  return { channel_version: CHANNEL_VERSION, bot_agent: BOT_AGENT };
}

function randomWechatUin() {
  const uint32 = crypto.randomBytes(4).readUInt32BE(0);
  return Buffer.from(String(uint32), "utf-8").toString("base64");
}

export function buildHeaders(token) {
  const headers = {
    "Content-Type": "application/json",
    AuthorizationType: "ilink_bot_token",
    "X-WECHAT-UIN": randomWechatUin(),
    "iLink-App-Id": "bot",
    "iLink-App-ClientVersion": CLIENT_VERSION,
  };
  if (token?.trim()) headers.Authorization = `Bearer ${token.trim()}`;
  return headers;
}

async function jsonFetch({ baseUrl, endpoint, body, token, timeoutMs, method = "POST", label }) {
  const url = `${baseUrl.replace(/\/$/, "")}/${endpoint.replace(/^\//, "")}`;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      method,
      headers: buildHeaders(token),
      body: method === "GET" ? undefined : body,
      signal: ac.signal,
    });
    if (!resp.ok) throw new Error(`${label}: HTTP ${resp.status}`);
    return await resp.text();
  } finally {
    clearTimeout(timer);
  }
}

export async function getBotQrcode(baseUrl, botType = "3", localTokenList = []) {
  const raw = await jsonFetch({
    baseUrl,
    endpoint: `ilink/bot/get_bot_qrcode?bot_type=${encodeURIComponent(botType)}`,
    body: JSON.stringify({ local_token_list: localTokenList }),
    timeoutMs: 15_000,
    label: "getBotQrcode",
  });
  return JSON.parse(raw); // { qrcode, qrcode_img_content }
}

export async function pollQrStatus(baseUrl, qrcode, verifyCode, timeoutMs = 35_000) {
  let endpoint = `ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`;
  if (verifyCode) endpoint += `&verify_code=${encodeURIComponent(verifyCode)}`;
  try {
    const raw = await jsonFetch({
      baseUrl,
      endpoint,
      method: "GET",
      timeoutMs,
      label: "pollQrStatus",
    });
    return JSON.parse(raw); // { status, bot_token?, ilink_bot_id?, baseurl?, ilink_user_id?, redirect_host? }
  } catch (err) {
    // 长轮询客户端超时按 wait 处理（与官方一致）
    if (err.name === "AbortError") return { status: "wait" };
    throw err;
  }
}

export async function sendMessage(creds, toUserId, text, contextToken) {
  const clientId = `a2w-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
  const body = {
    msg: {
      from_user_id: "",
      to_user_id: toUserId,
      client_id: clientId,
      message_type: 2, // BOT
      message_state: 2, // FINISH
      item_list: text ? [{ type: 1, text_item: { text } }] : undefined,
      context_token: contextToken || undefined,
    },
    base_info: buildBaseInfo(),
  };
  const raw = await jsonFetch({
    baseUrl: creds.base_url || FIXED_BASE_URL,
    endpoint: "ilink/bot/sendmessage",
    body: JSON.stringify(body),
    token: creds.bot_token,
    timeoutMs: 15_000,
    label: "sendMessage",
  });
  const resp = JSON.parse(raw);
  if (resp.ret && resp.ret !== 0) {
    throw new Error(`sendMessage ret=${resp.ret} errmsg=${resp.errmsg ?? "(none)"}`);
  }
  return resp;
}

export async function getUpdates(creds, updatesBuf = "", timeoutMs = 35_000) {
  const body = JSON.stringify({ get_updates_buf: updatesBuf, base_info: buildBaseInfo() });
  try {
    const raw = await jsonFetch({
      baseUrl: creds.base_url || FIXED_BASE_URL,
      endpoint: "ilink/bot/getupdates",
      body,
      token: creds.bot_token,
      timeoutMs,
      label: "getUpdates",
    });
    return JSON.parse(raw);
  } catch (err) {
    if (err.name === "AbortError") return { ret: 0, msgs: [] };
    throw err;
  }
}

// 上线通知：官方 channel 启动时调用；POC 阶段实测缺失不必然失败，但保留调用（是否硬需求未隔离验证）
export async function notifyStart(creds) {
  const raw = await jsonFetch({
    baseUrl: creds.base_url || FIXED_BASE_URL,
    endpoint: "ilink/bot/msg/notifystart",
    body: JSON.stringify({ base_info: buildBaseInfo() }),
    token: creds.bot_token,
    timeoutMs: 10_000,
    label: "notifyStart",
  });
  return JSON.parse(raw);
}

// ============================== 图片发送（P-53 QR，2026-11-05） ==============================
// 移植自 vendor（Tencent/openclaw-weixin，MIT）：src/cdn/{upload,cdn-upload,aes-ecb}.ts 与
// src/messaging/send.ts sendImageMessageWeixin。管线：getuploadurl 拿上传地址 → 本地 AES-128-ECB
// 加密 → POST 密文到微信 CDN（响应头 x-encrypted-param=下载参数）→ sendmessage image_item。

/** AES-128-ECB PKCS7 加密（node:crypto 原生支持，vendor aes-ecb.ts 同款） */
function encryptAesEcb(buf, key) {
  const cipher = crypto.createCipheriv("aes-128-ecb", key, null);
  return Buffer.concat([cipher.update(buf), cipher.final()]);
}

/** PKCS7 密文大小（vendor aesEcbPaddedSize） */
export function aesEcbPaddedSize(plainLen) {
  return Math.ceil((plainLen + 1) / 16) * 16;
}

async function getUploadUrl(creds, { filekey, toUserId, rawsize, rawfilemd5, filesize, aeskeyHex }) {
  const body = JSON.stringify({
    filekey,
    media_type: 1, // UploadMediaType.IMAGE
    to_user_id: toUserId,
    rawsize,
    rawfilemd5,
    filesize, // 密文大小
    no_need_thumb: true, // 免缩略图（vendor uploadMediaToCdn 同款）
    aeskey: aeskeyHex,
    base_info: buildBaseInfo(),
  });
  const raw = await jsonFetch({
    baseUrl: creds.base_url || FIXED_BASE_URL,
    endpoint: "ilink/bot/getuploadurl",
    body,
    token: creds.bot_token,
    timeoutMs: 15_000,
    label: "getUploadUrl",
  });
  const resp = JSON.parse(raw);
  if (resp.ret && resp.ret !== 0) throw new Error(`getUploadUrl ret=${resp.ret}`);
  const uploadFullUrl = (resp.upload_full_url || "").trim();
  const uploadParam = resp.upload_param || "";
  if (!uploadFullUrl && !uploadParam) throw new Error("getUploadUrl 未返回上传地址");
  return { uploadFullUrl: uploadFullUrl || undefined, uploadParam: uploadParam || undefined };
}

/** 上传密文到微信 CDN，返回下载参数（vendor cdn-upload.ts：重试 3 次，4xx 即断） */
async function uploadToCdn({ buf, uploadFullUrl, uploadParam, filekey, aeskey }) {
  const ciphertext = encryptAesEcb(buf, aeskey);
  const cdnUrl = uploadFullUrl ||
    `${CDN_BASE_URL}/upload?encrypted_query_param=${encodeURIComponent(uploadParam)}&filekey=${encodeURIComponent(filekey)}`;
  let downloadParam;
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 60_000);
    try {
      const resp = await fetch(cdnUrl, {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: new Uint8Array(ciphertext),
        signal: ac.signal,
      });
      if (resp.status >= 400 && resp.status < 500) {
        throw new Error(`CDN client error ${resp.status}: ${resp.headers.get("x-error-message") ?? ""}`);
      }
      if (resp.status !== 200) throw new Error(`CDN server error ${resp.status}`);
      downloadParam = resp.headers.get("x-encrypted-param") || "";
      if (!downloadParam) throw new Error("CDN 响应缺少 x-encrypted-param 头");
      return downloadParam;
    } catch (err) {
      lastErr = err;
      if (err.name === "AbortError") lastErr = new Error("CDN 上传超时(60s)");
      if (String(lastErr.message).includes("client error")) throw lastErr;
      if (attempt < 3) await new Promise((r) => setTimeout(r, 1000 * attempt));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("CDN 上传失败");
}

/** 发一条图片消息（vendor sendImageMessageWeixin：item_list=[image_item] 独立一条） */
export async function sendImageMessage(creds, toUserId, contextToken, image) {
  const clientId = `a2w-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
  const body = {
    msg: {
      from_user_id: "",
      to_user_id: toUserId,
      client_id: clientId,
      message_type: 2, // BOT
      message_state: 2, // FINISH
      item_list: [{
        type: 2, // MessageItemType.IMAGE
        image_item: {
          media: {
            encrypt_query_param: image.downloadParam,
            aes_key: image.aeskeyB64,
            encrypt_type: 1,
          },
          mid_size: image.ciphertextSize,
        },
      }],
      context_token: contextToken || undefined,
    },
    base_info: buildBaseInfo(),
  };
  const raw = await jsonFetch({
    baseUrl: creds.base_url || FIXED_BASE_URL,
    endpoint: "ilink/bot/sendmessage",
    body: JSON.stringify(body),
    token: creds.bot_token,
    timeoutMs: 15_000,
    label: "sendImageMessage",
  });
  const resp = JSON.parse(raw);
  if (resp.ret && resp.ret !== 0) {
    throw new Error(`sendImageMessage ret=${resp.ret} errmsg=${resp.errmsg ?? "(none)"}`);
  }
  return resp;
}

/**
 * 生成二维码 PNG 并作为图片消息发送（server 契约 qr_content 字段的执行端）。
 * qrcode 为唯一 npm 运行时依赖（官方实现；自写 Reed-Solomon 编码器属长期负担，不取）。
 * 返回 { fileSize } 供日志；失败抛错由调用方决定是否软失败。
 */
export async function sendQrContent(creds, toUserId, contextToken, content, log = console) {
  const { default: QRCode } = await import("qrcode");
  const png = await QRCode.toBuffer(content, {
    type: "png",
    width: 480,
    margin: 2,
    errorCorrectionLevel: "M",
  });
  const filekey = crypto.randomBytes(16).toString("hex");
  const aeskey = crypto.randomBytes(16);
  const rawfilemd5 = crypto.createHash("md5").update(png).digest("hex");
  const { uploadFullUrl, uploadParam } = await getUploadUrl(creds, {
    filekey,
    toUserId,
    rawsize: png.length,
    rawfilemd5,
    filesize: aesEcbPaddedSize(png.length),
    aeskeyHex: aeskey.toString("hex"),
  });
  const downloadParam = await uploadToCdn({ buf: png, uploadFullUrl, uploadParam, filekey, aeskey });
  await sendImageMessage(creds, toUserId, contextToken, {
    downloadParam,
    // vendor 语义（send.ts:297 Buffer.from(uploaded.aeskey)）：aeskey 先 hex 字符串化再整体
    // base64——微信端按「base64 → hex 文本 → hex 解码」还原 16 字节密钥；直接 base64(原始字节)
    // 会得到 24 字符短串，客户端解不出密钥 → 图片静默丢弃（服务端仍 ret=0，实测踩中）
    aeskeyB64: Buffer.from(aeskey.toString("hex")).toString("base64"),
    ciphertextSize: aesEcbPaddedSize(png.length),
  });
  log.log(`  QR 图片已发送 (${png.length} 字节 PNG, 内容 ${content.length} 字符)`);
  return { fileSize: png.length };
}
