import request from '@/utils/request'

export interface GenerateRegexParams {
  description: string
  testCases?: string[]
  examples?: string[]
}

export interface GenerateRegexResult {
  regex: string
  rawOutput: string
}

export interface ExplainRegexParams {
  pattern: string
}

export interface RegexExplanation {
  summary: string
  parts: Array<{ pattern: string; description: string }>
  examples: string[]
}

export interface ExplainRegexResult {
  pattern: string
  explanation: RegexExplanation
  rawOutput: string
}

export interface ValidateRegexParams {
  pattern: string
  flags?: string
  testStrings?: string[]
}

export interface ValidateRegexResult {
  valid: boolean
  pattern: string
  flags: string
  results: Array<{
    input: string
    matched: boolean
    matchGroups?: string[]
  }>
}

// AI 生成正则表达式
export function generateRegexApi(params: GenerateRegexParams) {
  return request.post<GenerateRegexResult>('/regex/generate', params)
}

// 解释正则表达式
export function explainRegexApi(params: ExplainRegexParams) {
  return request.post<ExplainRegexResult>('/regex/explain', params)
}

// 验证正则表达式
export function validateRegexApi(params: ValidateRegexParams) {
  return request.post<ValidateRegexResult>('/regex/validate', params)
}
