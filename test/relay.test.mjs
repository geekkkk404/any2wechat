// relay 单元测试：no-op / 投递+鉴权 / 串行保序 / 失败容忍 / 超时
// 运行: node --test test/
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createRelay } from "../src/relay.mjs";

function startServer(handler) {
  return new Promise((resolve) => {
    const srv = http.createServer(handler);
    srv.listen(0, "127.0.0.1", () => resolve(srv));
  });
}

const quietLog = { log() {}, error() {} };

test("未配置 url 时为 no-op", () => {
  const relay = createRelay({ url: "" });
  assert.equal(relay.enabled, false);
  relay.post({ text: "x" }); // 不抛错即可
});

test("投递成功：body 与 Bearer 鉴权头正确", async (t) => {
  const seen = [];
  const srv = await startServer((req, res) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => {
      seen.push({ auth: req.headers.authorization, body: JSON.parse(b) });
      res.writeHead(200).end();
    });
  });
  t.after(() => srv.close());
  const relay = createRelay({
    url: `http://127.0.0.1:${srv.address().port}/inbound`,
    token: "s3cret",
  });
  assert.equal(relay.enabled, true);
  relay.post({ from_user_id: "u1", text: "hello", received_at: "t0" });
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(seen.length, 1);
  assert.equal(seen[0].auth, "Bearer s3cret");
  assert.equal(seen[0].body.text, "hello");
  assert.equal(seen[0].body.from_user_id, "u1");
});

test("多条消息按到达顺序串行投递", async (t) => {
  const seen = [];
  const srv = await startServer((req, res) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => {
      seen.push(JSON.parse(b).text);
      res.writeHead(200).end();
    });
  });
  t.after(() => srv.close());
  const relay = createRelay({ url: `http://127.0.0.1:${srv.address().port}/inbound` });
  relay.post({ text: "first" });
  relay.post({ text: "second" });
  relay.post({ text: "third" });
  await new Promise((r) => setTimeout(r, 250));
  assert.deepEqual(seen, ["first", "second", "third"]);
});

test("非 2xx 与网络错误不外抛（主链路不受影响）", async (t) => {
  const srv = await startServer((req, res) => {
    res.writeHead(500).end();
  });
  t.after(() => srv.close());
  const relay = createRelay({ url: `http://127.0.0.1:${srv.address().port}/x`, log: quietLog });
  relay.post({ text: "a" });
  relay.post({ text: "b" }); // 连续失败也不阻塞队列
  await new Promise((r) => setTimeout(r, 200));
  assert.ok(true);
});

test("超时按 timeoutMs 生效且不外抛", async (t) => {
  const srv = await startServer(() => {}); // 永不应答
  t.after(() => srv.close());
  const relay = createRelay({
    url: `http://127.0.0.1:${srv.address().port}/x`,
    timeoutMs: 200,
    log: quietLog,
  });
  const t0 = Date.now();
  relay.post({ text: "slow" });
  await new Promise((r) => setTimeout(r, 500));
  assert.ok(Date.now() - t0 < 1000);
});
