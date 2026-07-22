#!/usr/bin/env node
/**
 * scan-mojibake.js — 源码乱码（mojibake）扫描工具
 *
 * 用途：检测 GBK/UTF-8 编码混淆产生的乱码字符，防止乱码进入用户可见文案。
 * 触发场景：frontend/package.json 的 `check:mojibake` 脚本调用（node ../scripts/scan-mojibake.js）。
 *
 * 用法：
 *   node scripts/scan-mojibake.js            # 报告模式：打印发现项，exit 0
 *   node scripts/scan-mojibake.js --strict   # 门禁模式：发现即 exit 1（用于 CI）
 *
 * 检测策略（启发式，兼顾召回与低误报）：
 *   1. Unicode 替换字符 \uFFFD（�）——几乎一定是编码错误
 *   2. 已知乱码字符集（GBK<->UTF-8 误转常见产物）——单行出现 >=2 个即判定
 */

const fs = require('fs');
const path = require('path');

// 扫描根目录（相对仓库根）
const SCAN_DIRS = ['frontend/src', 'backend/src'];
const EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.vue', '.json']);
const SKIP_DIRS = new Set(['node_modules', 'dist', '.vite', 'auto-imports.d.ts', 'components.d.ts']);

// 已知乱码字符集：GBK/UTF-8 误转时高频出现的"疑似汉字"碎片
const MOJIBAKE_CHARS = new Set(
  ('锟斤拷烫屯脨鹿鹇鐢ㄦ埛鍔熻兘绯荤粺璁剧疆鑹插彲瑙侊級鏈夎鎹㈠瓨鍒犻櫎缂栬緫閰嶇疆娣诲姞淇濆瓨鍒犻櫎鎿嶄綔鎴愬姛澶辫触寮傚父璇锋眰鍝嶅簲鏁版嵁鍒楄〃').split('')
);

// 连续乱码字符达到多少个即判定为乱码行（连续而非总数，避免对正常中文误报）
const RUN_THRESHOLD = 2;

// 含此标记的行跳过检测（用于合法引用 U+FFFD 的检测代码行）
const IGNORE_MARKER = 'mojibake-ignore';

const strict = process.argv.includes('--strict');
const repoRoot = path.resolve(__dirname, '..');

/** @type {{file:string,line:number,text:string,reason:string}[]} */
const findings = [];

function walk(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full);
    } else if (EXTENSIONS.has(path.extname(entry.name))) {
      scanFile(full);
    }
  }
}

function scanFile(file) {
  let content;
  try {
    content = fs.readFileSync(file, 'utf8');
  } catch {
    return;
  }
  const lines = content.split(/\r?\n/);
  lines.forEach((line, idx) => {
    if (line.includes(IGNORE_MARKER)) return;
    // 1. 替换字符
    if (line.includes('\uFFFD')) {
      findings.push({ file, line: idx + 1, text: line.trim().slice(0, 120), reason: 'U+FFFD 替换字符' });
      return;
    }
    // 2. 连续乱码字符行（run 长度 >= RUN_THRESHOLD）
    let run = 0;
    let maxRun = 0;
    for (const ch of line) {
      if (MOJIBAKE_CHARS.has(ch)) {
        run++;
        if (run > maxRun) maxRun = run;
      } else {
        run = 0;
      }
    }
    if (maxRun >= RUN_THRESHOLD) {
      findings.push({ file, line: idx + 1, text: line.trim().slice(0, 120), reason: `连续乱码字符 x${maxRun}` });
    }
  });
}

for (const d of SCAN_DIRS) {
  walk(path.join(repoRoot, d));
}

if (findings.length === 0) {
  console.log('[scan-mojibake] ✅ 未发现乱码');
  process.exit(0);
}

console.log(`[scan-mojibake] ⚠️ 发现 ${findings.length} 处疑似乱码：`);
for (const f of findings) {
  const rel = path.relative(repoRoot, f.file);
  console.log(`  ${rel}:${f.line}  [${f.reason}]  ${f.text}`);
}

if (strict) {
  console.error('[scan-mojibake] ❌ strict 模式：存在乱码，检查未通过');
  process.exit(1);
} else {
  console.log('[scan-mojibake] 报告模式：不阻断（如需门禁请加 --strict）');
  process.exit(0);
}
