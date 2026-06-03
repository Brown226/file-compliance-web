import { ref, computed, watch } from 'vue'
import type { Ref } from 'vue'

export interface PreAnalysisResult {
  fileCount: number
  totalSize: number
  supportedFormats: string[]
  potentialIssues: string[]
  suggestedMode: string
}

export function usePreAnalysis() {
  const isAnalyzing = ref(false)
  const analysisResult = ref<PreAnalysisResult | null>(null)

  const analyzeFiles = async (files: File[]) => {
    isAnalyzing.value = true
    try {
      const result: PreAnalysisResult = {
        fileCount: files.length,
        totalSize: files.reduce((sum, f) => sum + f.size, 0),
        supportedFormats: [...new Set(files.map(f => f.name.split('.').pop()?.toLowerCase() || ''))],
        potentialIssues: [],
        suggestedMode: 'LIBRARY'
      }
      analysisResult.value = result
      return result
    } finally {
      isAnalyzing.value = false
    }
  }

  return {
    isAnalyzing,
    analysisResult,
    analyzeFiles
  }
}
