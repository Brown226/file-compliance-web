const fs = require('fs')
const path = require('path')

const root = fs.existsSync(path.join(process.cwd(), 'src'))
  ? path.join(process.cwd(), 'src')
  : path.join(process.cwd(), 'frontend', 'src')
const exts = new Set(['.vue', '.ts'])
const suspicious = [
  '鏍稿', '宸ヤ綔鍙?', '鎻愮ず璇嶆ā鏉?', '閮ㄩ棬涓庡憳宸?', '绯荤粺鎬婚', '鐭ラ亾浜?', '蹇嵎閿?', '悳绱?'
]
const badTagPattern = /[^<]\/((?:h[1-6])|span|div|p|template|el-[a-z-]+)>/g

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else if (exts.has(path.extname(entry.name))) out.push(full)
  }
  return out
}

const files = walk(root)
let count = 0
for (const file of files) {
  const text = fs.readFileSync(file, 'utf8')
  const lines = text.split(/\r?\n/)
  lines.forEach((line, idx) => {
    if (suspicious.some(k => line.includes(k)) || badTagPattern.test(line)) {
      console.log(`${path.relative(process.cwd(), file)}:${idx + 1}:${line}`)
      count++
    }
    badTagPattern.lastIndex = 0
  })
}
if (count === 0) console.log('OK: no suspicious mojibake/tag issues found')
