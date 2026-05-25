export type EntryModule = 'LIBRARY' | 'CONSISTENCY' | 'PROOFREAD' | 'RULE_ONLY' | 'MULTIMODAL' | 'DOC_REVIEW'

export interface PreAnalysisData {
  contractType: string
  noResultReason: string
  potentialParties: string[]
  suggestedReviewPoints: string[]
  suggestedCorePurposes: string[]
  llmAnalyzed: boolean
}

export interface PersistedState {
  currentStep: number
  title: string
  preAnalyzed: boolean
  preAnalysisData: PreAnalysisData
  selectedReviewPoints: string[]
  customPurposes: Array<{ value: string }>
  allSuggestedReviewPoints: string[]
  allSuggestedCorePurposes: string[]
  fileNames: string[]
  refFileNames: string[]
  savedAt: number
}

export type BackgroundStatus = 'idle' | 'pre-analyzing' | 'done' | 'failed'
