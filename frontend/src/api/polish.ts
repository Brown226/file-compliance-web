import request from '@/utils/request'

export interface PolishStyle {
  key: string
  name: string
  description: string
}

export interface PolishDiff {
  original: string
  polished: string
}

export interface PolishResult {
  original: string
  polished: string
  style: string
  styleName: string
  diffs: PolishDiff[]
  explanations: string[]
}

export function getPolishStylesApi() {
  return request.get<PolishStyle[]>('/polish/styles')
}

export function doPolishApi(data: { text: string; style: string }) {
  return request.post<PolishResult>('/polish', data)
}