import { Request, Response } from 'express'
import { LlmService } from '../services/llm.service'
import { success, error } from '../utils/response'

/**
 * AI 生成正则表达式
 */
export async function generateRegex(req: Request, res: Response): Promise<void> {
  try {
    const { description, testCases, examples } = req.body

    if (!description || typeof description !== 'string') {
      error(res, '请提供正则表达式的自然语言描述', 400)
      return
    }

    // 构建提示词
    let prompt = `请根据以下描述生成一个精确的正则表达式（RegExp）。

描述：${description}`

    // 添加测试用例
    if (testCases && Array.isArray(testCases) && testCases.length > 0) {
      prompt += '\n\n测试用例（应该匹配的）：'
      testCases.forEach((tc: string, i: number) => {
        prompt += `\n  ${i + 1}. "${tc}"`
      })
    }

    // 添加示例
    if (examples && Array.isArray(examples) && examples.length > 0) {
      prompt += '\n\n期望匹配示例：'
      examples.forEach((ex: string) => {
        prompt += `\n  - "${ex}"`
      })
    }

    prompt += '\n\n请只输出正则表达式本身，不要任何解释文字。如果正则需要修饰符（如 i、g），请在正则后面用 // 标注，如：/pattern/gi'

    const systemPrompt = `你是一个正则表达式专家，擅长根据用户需求生成准确的正则表达式。
规则：
1. 只输出正则表达式，不要输出其他解释文字
2. 如果需要修饰符，用 // 格式标注，如 /pattern/gi
3. 正则表达式要精确，避免过度匹配
4. 考虑常见边界情况
5. 如果描述有歧义，选择最合理的解释`

    const result = await LlmService.chat(prompt, {
      systemPrompt,
      maxTokens: 512,
      timeout: 60,
    })

    // 提取正则表达式
    let regex = result.trim()

    // 尝试提取 // 之间的内容
    const match = regex.match(/\/(.+)\/([giuy]*)/)
    if (match) {
      regex = match[1]
    }

    // 移除 markdown 代码块
    regex = regex.replace(/^```(?:\w+)?\n?/, '').replace(/\n?```$/, '').trim()

    success(res, {
      regex,
      rawOutput: result,
    })
  } catch (err: any) {
    console.error('[Regex] 生成正则表达式失败:', err)
    error(res, err.message || '生成正则表达式失败', 500)
  }
}

/**
 * 解释正则表达式
 */
export async function explainRegex(req: Request, res: Response): Promise<void> {
  try {
    const { regex, pattern } = req.body

    const patternStr = regex || pattern
    if (!patternStr || typeof patternStr !== 'string') {
      error(res, '请提供要解释的正则表达式', 400)
      return
    }

    const prompt = `请详细解释以下正则表达式的含义，包括每个部分的语法和作用。

正则表达式：${patternStr}

请用中文详细解释，可以包含：
1. 整体用途
2. 各个部分的含义
3. 匹配的示例
4. 注意事项`

    const systemPrompt = `你是一个正则表达式专家，擅长解释正则表达式的含义和用法。请用清晰易懂的中文解释正则表达式。`

    const result = await LlmService.chat(prompt, {
      systemPrompt,
      maxTokens: 1024,
      timeout: 60,
    })

    // 解析解释结果，提取关键信息
    const explanation = parseRegexExplanation(result, patternStr)

    success(res, {
      pattern: patternStr,
      explanation,
      rawOutput: result,
    })
  } catch (err: any) {
    console.error('[Regex] 解释正则表达式失败:', err)
    error(res, err.message || '解释正则表达式失败', 500)
  }
}

/**
 * 验证正则表达式
 */
export async function validateRegex(req: Request, res: Response): Promise<void> {
  try {
    const { pattern, flags, testStrings } = req.body

    if (!pattern || typeof pattern !== 'string') {
      error(res, '请提供正则表达式', 400)
      return
    }

    // 验证正则是否有效
    let regex: RegExp
    try {
      regex = new RegExp(pattern, flags || '')
    } catch (e: any) {
      error(res, `正则表达式语法错误: ${e.message}`, 400)
      return
    }

    const results: Array<{
      input: string
      matched: boolean
      matchGroups?: string[]
    }> = []

    // 测试字符串
    const testInputs = testStrings && Array.isArray(testStrings) ? testStrings : []

    for (const input of testInputs) {
      try {
        const match = regex.exec(input)
        results.push({
          input,
          matched: match !== null,
          matchGroups: match ? match.slice(1) : undefined,
        })
      } catch (e) {
        results.push({
          input,
          matched: false,
        })
      }
    }

    success(res, {
      valid: true,
      pattern,
      flags: flags || '',
      results,
    })
  } catch (err: any) {
    console.error('[Regex] 验证正则表达式失败:', err)
    error(res, err.message || '验证正则表达式失败', 500)
  }
}

/**
 * 解析正则解释结果
 */
function parseRegexExplanation(rawOutput: string, pattern: string): {
  summary: string
  parts: Array<{ pattern: string; description: string }>
  examples: string[]
} {
  const parts: Array<{ pattern: string; description: string }> = []
  const examples: string[] = []

  // 提取代码块中的内容
  let content = rawOutput
    .replace(/^```(?:\w+)?\n?/, '')
    .replace(/\n?```$/, '')
    .trim()

  // 提取示例
  const exampleMatches = content.matchAll(/[`"']?([\u4e00-\u9fa5a-zA-Z0-9\s.,!?，。！？]+)[`"']?\s*(?:匹配|示例|例如)/g)
  for (const m of exampleMatches) {
    const example = m[1].trim()
    if (example && example.length > 0 && example.length < 100) {
      examples.push(example)
    }
  }

  // 提取正则部分解释
  const regexParts = pattern.match(/(\\[dswDSW]|[.*+?^${}()|[\]\\]|\(\?[=!:]|[\[\]][^\\\]]*(?:\\.[^\\\]]*)*[\]]|\{[\d,]+\}|[^.])/g) || []
  const commonDescriptions: Record<string, string> = {
    '\\d': '数字 [0-9]',
    '\\D': '非数字',
    '\\w': '单词字符 [a-zA-Z0-9_]',
    '\\W': '非单词字符',
    '\\s': '空白字符',
    '\\S': '非空白字符',
    '.': '任意字符',
    '*': '零次或多次',
    '+': '一次或多次',
    '?': '零次或一次',
    '^': '字符串开始',
    '$': '字符串结束',
    '|': '或',
  }

  for (const part of regexParts) {
    const desc = commonDescriptions[part] || ''
    if (desc) {
      parts.push({ pattern: part, description: desc })
    }
  }

  // 提取总结
  let summary = content.split('\n')[0] || ''
  if (summary.length > 100) {
    summary = summary.substring(0, 100) + '...'
  }

  return {
    summary,
    parts,
    examples: examples.slice(0, 5),
  }
}
