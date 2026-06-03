/**
 * Markdown 渲染 Composable
 * 基于 markdown-it + DOMPurify，提供安全的 Markdown 到 HTML 转换
 */
import MarkdownIt from 'markdown-it'
import DOMPurify from 'dompurify'

const md = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: true,
  breaks: true,
})

/**
 * 安全地将 Markdown 文本转换为 HTML
 */
export function useMarkdown() {
  const renderMarkdown = (text: string | null | undefined): string => {
    if (!text) return ''
    const html = md.render(text)
    return DOMPurify.sanitize(html)
  }

  const renderInlineMarkdown = (text: string | null | undefined): string => {
    if (!text) return ''
    const html = md.renderInline(text)
    return DOMPurify.sanitize(html)
  }

  return { renderMarkdown, renderInlineMarkdown }
}
