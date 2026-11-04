// ilink.mjs — 微信 iLink bot 协议核心（实现参考 Tencent/openclaw-weixin src/api/api.ts 语义，MIT）
// 协议细节见 docs/protocol-notes.md 与 vendor 文档 docs/protocol_zh_CN.md
import crypto from "node:crypto";

export const FIXED_BASE_URL = "https://ilinkai.weixin.qq.com";
// 官方插件 2.4.8 的版本编码值（0x00MMNNPP → 十进制），服务端已验证接受
export const CHANNEL_VERSION = "2.4.8";
export const CLIENT_VERSION = "132104";
export const BOT_AGENT = "any2wechat/0.2.0";

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
