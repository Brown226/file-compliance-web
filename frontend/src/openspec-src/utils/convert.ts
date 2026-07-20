// 将纯文本按基本规则转为 HTML，便于 v-html 渲染
export const convertTextToHtml = (text: string) => {
  // 先做基本转义，避免意外标签注入
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

  // 按行处理标题和换行
  const lines = escaped.split('\n').map(line => {
    if (line.startsWith('### ')) return `<h3>${line.slice(4)}</h3>`
    if (line.startsWith('## ')) return `<h2>${line.slice(3)}</h2>`
    if (line.startsWith('# ')) return `<h1>${line.slice(2)}</h1>`
    return line
  })

  // 合并为带换行的 HTML（行内用 <br/>）
  let html = lines.join('<br/>')

  // 加粗：**text**
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')

  return html
}


export const parse2Json = (jsonStr: string) => {
  if (Array.isArray(jsonStr)) return jsonStr
  if (typeof jsonStr === 'string') {
    try {
      const parsed = JSON.parse(jsonStr)
      return Array.isArray(parsed) ? parsed : []
    } catch (e) {
      console.warn('json string 解析失败:', e)
      return []
    }
  }
  return []
}

// 解析 Markdown 内容中的二级标题（## 标题）
export const parseSecondaryHeadings = (content: string, chapterId: string): Array<{ id: string, title: string }> => {
  if (!content) return []
  
  const lines = content.split('\n')
  const secondaryHeadings: Array<{ id: string, title: string }> = []
  let subIndex = 1 // 二级目录序号从1开始自增
  
  lines.forEach((line) => {
    // 匹配 "## " 开头的二级标题
    const match = line.match(/^##\s+(.+)$/)
    if (match) {
      const title = match[1]?.trim() || ''
      if (title) {
        // 生成格式为 "章节ID.序号" 的ID，如 "1.1", "1.2", "1.3"
        secondaryHeadings.push({
          id: `${chapterId}.${subIndex}`,
          title: title
        })
        subIndex++ // 序号自增
      }
    }
  })
  
  return secondaryHeadings
}