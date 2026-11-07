// qrart.mjs — P-62 终端二维码渲染：底色空格方块法（字体无关）。
// 半块字符（▀▄█）会被 CJK 全角字体终端拉成 2 格宽 → 模块横向熔连不可扫（2026-11-07 站主实测实锤，
// cv2 栅格仿真四指标全败复现）；空格恒窄字符 + ANSI 底色填充与字体无关 → 模块天然方正。
// cv2 仿真实证：模块=2 空格宽×1 行高在 6x12/8x16/10x20/8x18 四种像素密度全部解码成功。
// 宽度门控：主形态需 (size+6)×2 ≈ 86 列；终端不够宽（cols 传入且不足）返回 null，调用方回退半块紧凑形态。

const BLK = "\x1b[40m"; // 黑底 = 暗模块
const WHT = "\x1b[47m"; // 白底 = 亮模块（含 quiet zone）
const RST = "\x1b[0m";

export function bgSquareArt(modules, { quiet = 3, cols = null } = {}) {
  const size = modules.size;
  const width = (size + quiet * 2) * 2;
  if (cols !== null && cols < width) return null;
  const fullLight = WHT + " ".repeat(width) + RST; // 上下整行白底：码区与终端黑底的隔离带
  const lines = [fullLight, fullLight];
  for (let r = -quiet; r < size + quiet; r++) {
    let line = "";
    let cur = null; // "d" | "l"
    let run = 0;
    const flush = () => {
      if (!run) return;
      line += (cur === "d" ? BLK : WHT) + " ".repeat(run) + RST;
      run = 0;
    };
    for (let c = -quiet; c < size + quiet; c++) {
      const dark = r >= 0 && r < size && c >= 0 && c < size && !!modules.data[r * size + c];
      const k = dark ? "d" : "l";
      if (k !== cur) {
        flush();
        cur = k;
      }
      run += 2; // 每模块恒 2 空格：宽高比与终端字体解耦
    }
    flush();
    lines.push(line);
  }
  lines.push(fullLight, fullLight);
  return lines.join("\n");
}
