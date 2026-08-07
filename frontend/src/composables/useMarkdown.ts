/**
 * Markdown 渲染 Composable
 * 基于 markdown-it + DOMPurify + highlight.js，提供安全的 Markdown 到 HTML 转换
 * 代码块渲染为 pi-web 风格结构（header + 复制按钮 + 高亮代码）
 */
import MarkdownIt from 'markdown-it'
import DOMPurify from 'dompurify'
import hljs from 'highlight.js/lib/common'

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// 自定义 fence 渲染：输出 pi-web 风格代码块结构
function renderCodeBlock(code: string, lang: string): string {
  const language = (lang || '').trim().toLowerCase()
  const displayLang = language && language !== 'plaintext' ? language : 'text'

  let highlighted: string
  try {
    if (language && language !== 'plaintext' && hljs.getLanguage(language)) {
      highlighted = hljs.highlight(code, { language }).value
    } else {
      highlighted = hljs.highlightAuto(code).value
    }
  } catch {
    highlighted = escapeHtml(code)
  }

  const encodedCode = encodeURIComponent(code)
  return `<div class="markdown-code-block">
<div class="markdown-code-header"><span class="markdown-code-lang">${escapeHtml(displayLang)}</span><div class="markdown-code-actions"><button class="markdown-code-action" data-code="${encodedCode}" onclick="window.__copyCodeBlock(this)">复制</button></div></div>
<pre><code class="hljs language-${escapeHtml(language || 'text')}">${highlighted}</code></pre>
</div>`
}

// 注册全局复制函数（模块顶层只注册一次）
;(window as any).__copyCodeBlock = function (btn: HTMLButtonElement) {
  const encoded = btn.getAttribute('data-code') || ''
  const code = decodeURIComponent(encoded)
  const done = () => {
    btn.textContent = '已复制'
    btn.classList.add('is-active')
    setTimeout(() => {
      btn.textContent = '复制'
      btn.classList.remove('is-active')
    }, 1400)
  }
  navigator.clipboard
    .writeText(code)
    .then(done)
    .catch(() => {
      const ta = document.createElement('textarea')
      ta.value = code
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
      done()
    })
}

const md = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: true,
  breaks: true,
})

// 覆盖 fence 渲染规则：输出 pi-web 风格代码块
md.renderer.rules.fence = function (tokens: any, idx: any) {
  const token = tokens[idx]
  const info = token.info ? token.info.trim() : ''
  const code = token.content
  return renderCodeBlock(code, info)
}

// inline code 用 .markdown-inline-code class
md.renderer.rules.code_inline = function (tokens: any, idx: any) {
  return `<code class="markdown-inline-code">${md.utils.escapeHtml(tokens[idx].content)}</code>`
}

/**
 * 安全修复：原实现 ADD_ATTR 全局放行 onclick——markdown 源文本里的
 * `<img onclick="...">` 等恶意属性会原样通过 DOMPurify（XSS 注入面）。
 * 复制按钮的 inline handler 是 markdown-it 渲染器生成的固定值
 * `window.__copyCodeBlock(this)`，用 DOMPurify hook 精确放行：
 * 仅 .markdown-code-action 按钮且 onclick 值完全匹配时才保留，其余一律移除。
 * hook 是全局注册且幂等（模块顶层只执行一次）。
 */
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.hasAttribute('onclick')) {
    const isCopyButton =
      node.tagName === 'BUTTON' &&
      String(node.getAttribute('class') || '').includes('markdown-code-action') &&
      node.getAttribute('onclick') === 'window.__copyCodeBlock(this)'
    if (!isCopyButton) node.removeAttribute('onclick')
  }
})

/**
 * 安全地将 Markdown 文本转换为 HTML
 */
export function useMarkdown() {
  const renderMarkdown = (text: string | null | undefined): string => {
    if (!text) return ''
    const html = md.render(text)
    return DOMPurify.sanitize(html, { ADD_ATTR: ['data-code'] })
  }

  const renderInlineMarkdown = (text: string | null | undefined): string => {
    if (!text) return ''
    const html = md.renderInline(text)
    return DOMPurify.sanitize(html)
  }

  return { renderMarkdown, renderInlineMarkdown }
}
