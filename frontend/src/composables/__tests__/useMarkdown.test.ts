/**
 * useMarkdown 单元测试（Markdown 渲染安全）
 *
 * 覆盖：
 * - 基础渲染：标题/加粗/列表/链接
 * - XSS 防护：<script> / onerror 事件 / javascript: 链接被清洗
 * - 代码块 fence 渲染（markdown-code-block 结构 + 复制按钮 + 高亮）
 * - inline code 渲染 markdown-inline-code
 * - 空文本 → ''
 * - renderInlineMarkdown
 */
import { describe, it, expect } from 'vitest'
import { useMarkdown } from '../useMarkdown'

const { renderMarkdown, renderInlineMarkdown } = useMarkdown()

describe('基础渲染', () => {
  it('标题与加粗', () => {
    const html = renderMarkdown('# 标题\n\n**加粗**')
    expect(html).toContain('<h1>标题</h1>')
    expect(html).toContain('<strong>加粗</strong>')
  })

  it('列表渲染', () => {
    const html = renderMarkdown('- 第一项\n- 第二项')
    expect(html).toContain('<li>第一项</li>')
    expect(html).toContain('<li>第二项</li>')
  })

  it('空文本 → 空字符串', () => {
    expect(renderMarkdown('')).toBe('')
    expect(renderMarkdown(null)).toBe('')
    expect(renderMarkdown(undefined)).toBe('')
  })
})

describe('XSS 防护', () => {
  it('<script> 标签被清洗（不出现可执行 script 标签）', () => {
    const html = renderMarkdown('<script>alert(1)</script>')
    // 标签被转义为文本（&lt;script&gt;），不出现可执行的 <script> 标签
    expect(html).not.toContain('<script>')
    expect(html).not.toMatch(/<\/?script>/i)
  })

  it('img onerror 事件被清洗', () => {
    const html = renderMarkdown('![x](https://evil.com/a.png "onerror=alert(1)")')
    // 不出现作为属性名的 onerror 事件处理（title 文本里的字符串无害）
    expect(html).not.toMatch(/\sonerror\s*=/i)
  })

  it('javascript: 链接被清洗（不出现 javascript: href）', () => {
    const html = renderMarkdown('[点击](javascript:alert(1))')
    expect(html).not.toMatch(/href\s*=\s*["']javascript:/i)
  })
})

describe('代码块', () => {
  it('fence 渲染为 markdown-code-block 结构（含复制按钮与高亮 class）', () => {
    const html = renderMarkdown('```js\nconst a = 1;\n```')
    expect(html).toContain('markdown-code-block')
    expect(html).toContain('复制')
    expect(html).toContain('language-js')
    expect(html).toContain('hljs')
  })

  it('inline code 渲染 markdown-inline-code', () => {
    const html = renderMarkdown('这是 `code` 片段')
    expect(html).toContain('markdown-inline-code')
  })

  it('代码块中 XSS 内容被转义', () => {
    const html = renderMarkdown('```\n<script>alert(1)</script>\n```')
    // 高亮后的代码不包含可执行脚本（highlightAuto 会转义，或 DOMPurify 清洗）
    expect(html).not.toContain('<script>alert(1)</script>')
  })
})

describe('renderInlineMarkdown', () => {
  it('行内渲染加粗', () => {
    expect(renderInlineMarkdown('**粗**')).toContain('<strong>粗</strong>')
  })
})
