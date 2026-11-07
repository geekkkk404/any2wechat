// images 字段（P-61）单元测试：pngFromB64 校验 / webhook images 契约解析与回执
// 运行: node --test test/
import test from "node:test";
import assert from "node:assert/strict";
import { pngFromB64, aesEcbPaddedSize } from "../src/ilink.mjs";
import { startServer } from "../src/server.mjs";

const quietLog = { log() {}, error() {} };

// 最小合法 PNG：8 字节魔数 + IHDR 长度头（pngFromB64 只做魔数/大小门禁，不解析 chunk）
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const pngB64 = (extra = 8) => Buffer.concat([PNG_SIG, Buffer.alloc(extra)]).toString("base64");

test("pngFromB64：合法 PNG 魔数通过并还原字节", () => {
  const buf = pngFromB64(pngB64(16));
  assert.equal(buf.length, 24);
  assert.equal(buf.toString("latin1", 1, 4), "PNG");
});

test("pngFromB64：垃圾数据 / 空 base64 / 魔数缺失一律拒绝", () => {
  assert.throws(() => pngFromB64(Buffer.from("hello world").toString("base64")), /PNG/);
  assert.throws(() => pngFromB64(Buffer.alloc(64).toString("base64")), /PNG/);
  assert.throws(() => pngFromB64(""), /PNG/);
  // 首字节不对（0x88 而非 0x89）
  const bad = Buffer.from([0x88, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.throws(() => pngFromB64(bad.toString("base64")), /PNG/);
});

test("pngFromB64：超过 5MB 拒绝", () => {
  const big = Buffer.concat([PNG_SIG, Buffer.alloc(6 * 1024 * 1024)]);
  assert.throws(() => pngFromB64(big.toString("base64")), /5MB/);
});

test("aesEcbPaddedSize：PKCS7 对齐 16 字节（回归守卫）", () => {
  assert.equal(aesEcbPaddedSize(16), 32); // +1 padding 进位
  assert.equal(aesEcbPaddedSize(31), 32);
  assert.equal(aesEcbPaddedSize(32), 48);
});

test("webhook images 契约：解析计数入回执，无 session 时 202 受理", async (t) => {
  process.env.BRIDGE_DATA_DIR = process.env.BRIDGE_DATA_DIR || "./data";
  const srv = await startServer({ port: 0, host: "127.0.0.1", state: {}, log: quietLog });
  t.after(() => srv.close());
  const port = srv.address().port;
  const resp = await fetch(`http://127.0.0.1:${port}/webhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: "海报卡", images: [pngB64(), "  ", pngB64(4), 123] }),
  });
  const j = await resp.json();
  assert.equal(resp.status, 202);
  assert.equal(j.ok, true);
  assert.equal(j.batches, 1);
  assert.equal(j.images, 2); // 空串/非字符串被过滤；数组截取 MAX_IMAGES
});

test("webhook images 契约：纯图片无文本也受理；全空仍 400", async (t) => {
  process.env.BRIDGE_DATA_DIR = process.env.BRIDGE_DATA_DIR || "./data";
  const srv = await startServer({ port: 0, host: "127.0.0.1", state: {}, log: quietLog });
  t.after(() => srv.close());
  const port = srv.address().port;
  const url = `http://127.0.0.1:${port}/webhook`;
  const onlyImg = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ images: [pngB64()] }),
  });
  assert.equal(onlyImg.status, 202);
  assert.equal((await onlyImg.json()).images, 1);
  const empty = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ images: ["", null] }),
  });
  assert.equal(empty.status, 400);
});
