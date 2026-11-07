// qrart.test.mjs — P-62 终端二维码（底色空格方块法）单测：
// ① ANSI 流解析回填 = 源模块矩阵逐位相等（含 quiet zone 全亮环）
// ② 模块恒 2 空格宽（与字体解耦的方块几何）
// ③ 宽度门控：窄终端返回 null（调用方回退半块），足够宽/未知宽度出完整码
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { bgSquareArt } from "../src/qrart.mjs";

const require = createRequire(import.meta.url);
const QRCode = require("qrcode");

const LINK = "https://liteapp.weixin.qq.com/q/7GiQu1?qrcode=a5dcf70531e69cf6b343029873f4f44f&bot_type=3";
const { modules } = QRCode.create(LINK, { errorCorrectionLevel: "L" });
const QUIET = 3;

function parseAnsi(art) {
  // 返回 lines[r][c] = "d" | "l"（每空格一格）；只认 40/47/0 三码与空格（渲染器输出恰为该子集）
  let fg = null;
  const lines = [];
  let line = [];
  let i = 0;
  while (i < art.length) {
    if (art[i] === "\x1b") {
      const m = /^\x1b\[(\d+)m/.exec(art.slice(i));
      assert.ok(m, "出现渲染器约定之外的转义序列");
      const code = m[1];
      if (code === "40") fg = "d";
      else if (code === "47") fg = "l";
      else if (code === "0") fg = null;
      else assert.fail(`未知 SGR 码 ${code}`);
      i += m[0].length;
      continue;
    }
    if (art[i] === "\n") { lines.push(line); line = []; }
    else if (art[i] === " ") { line.push(fg); }
    else assert.fail(`未知字符 ${JSON.stringify(art[i])}`);
    i += 1;
  }
  lines.push(line);
  return lines;
}

test("解析回填 = 源矩阵逐位相等（含 quiet 环全亮）", () => {
  const art = bgSquareArt(modules, { cols: 200 });
  assert.ok(art, "宽终端应出码");
  const lines = parseAnsi(art);
  const size = modules.size;
  assert.equal(lines.length, size + QUIET * 2 + 4, "行数 = 模块 + quiet×2 + 上下隔离带×2");
  for (const l of lines) assert.equal(l.length, (size + QUIET * 2) * 2, "每行格数恒定");
  for (let r = 0; r < lines.length; r++) {
    for (let c = 0; c < lines[r].length; c++) {
      const mr = r - 2 - QUIET, mc = Math.floor(c / 2) - QUIET;
      const expected =
        mr < 0 || mr >= size || mc < 0 || mc >= size ? "l" : modules.data[mr * size + mc] ? "d" : "l";
      assert.equal(lines[r][c], expected, `r=${r} c=${c}`);
    }
  }
});

test("模块恒 2 空格宽（同模块两格同色）", () => {
  const lines = parseAnsi(bgSquareArt(modules, { cols: 200 }));
  const size = modules.size;
  for (let r = 2 + QUIET; r < 2 + QUIET + size; r++) {
    for (let c = 0; c < lines[r].length; c += 2) {
      assert.equal(lines[r][c], lines[r][c + 1], `模块内两格必须同色 r=${r} c=${c}`);
    }
  }
});

test("宽度门控：80 列返回 null；200 列与未知宽度出码", () => {
  assert.equal(bgSquareArt(modules, { cols: 80 }), null, "窄终端应回退（返回 null）");
  assert.ok(bgSquareArt(modules, { cols: 200 }));
  assert.ok(bgSquareArt(modules, { cols: null }), "非 TTY（列宽未知）默认出码");
});
