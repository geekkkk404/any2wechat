// store.mjs — 凭证/会话持久化。数据目录：BRIDGE_DATA_DIR 环境变量优先，缺省 <仓库>/data
// data/ 是唯一有状态目录（内容 = 微信账号钥匙），.gitignore 已拦截，Docker volume 挂载点
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const REPO_ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");

export const DATA_DIR = process.env.BRIDGE_DATA_DIR
  ? path.resolve(process.env.BRIDGE_DATA_DIR)
  : path.join(REPO_ROOT, "data");

export const CREDENTIALS_FILE = path.join(DATA_DIR, "credentials.json");
export const SESSION_FILE = path.join(DATA_DIR, "session.json");
export const QR_LINK_FILE = path.join(DATA_DIR, "qr-link.txt");

export function ensureDataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readJson(file, what) {
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch (err) {
    throw new Error(`${what}文件损坏（${file}）: ${err.message}`);
  }
}

export function loadCredentials() {
  const creds = readJson(CREDENTIALS_FILE, "凭证");
  if (!creds?.bot_token) {
    throw new Error(`未找到登录凭证（${CREDENTIALS_FILE}）。先运行: node bin/login.mjs`);
  }
  return creds;
}

export function saveCredentials(creds) {
  ensureDataDir();
  fs.writeFileSync(CREDENTIALS_FILE, JSON.stringify(creds, null, 2), { mode: 0o600 });
}

export function loadSession() {
  const s = readJson(SESSION_FILE, "会话");
  if (!s?.to_user_id || !s?.context_token) {
    throw new Error(
      `会话未绑定或文件不完整（${SESSION_FILE}）。启动后请在微信里给 bot 发一条消息（如：绑定）`,
    );
  }
  return s;
}

export function saveSession(session) {
  ensureDataDir();
  fs.writeFileSync(SESSION_FILE, JSON.stringify(session, null, 2), { mode: 0o600 });
}

export function hasSession() {
  return fs.existsSync(SESSION_FILE);
}
