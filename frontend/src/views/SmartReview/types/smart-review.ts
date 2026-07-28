export type EntryModule = 'LIBRARY' | 'CONSISTENCY' | 'PROOFREAD' | 'RULE_ONLY' | 'DOC_REVIEW' | 'CONTRACT'

export type ReviewObjective = 'COMPLIANCE' | 'COMPARE' | 'PROOFREAD'

export type ReviewEvidenceSource = 'STANDARD' | 'RULE_LIBRARY' | 'REFERENCE'

export type ReviewPlan = {
  objective: ReviewObjective
  evidence: {
    sources: ReviewEvidenceSource[]
    maxkbKnowledgeIds: string[]
    ruleLibraryId: string | null
    refFileGroupId: string | null
    enabledPrefixes: string[]
  }
  enhancements: {
    intraFileConsistency: boolean
    crossFileConsistency: boolean
  }
  execution: {
    profile: 'AI_ONLY' | 'RULE_ONLY' | 'HYBRID'
  }
  templateId?: string
  contractStance?: 'owner' | 'contractor'
}

export interface PersistedState {
  currentStep: number
  title: string
  preAnalyzed: boolean
  preAnalysisData: {
    contractType: string
    noResultReason: string
    potentialParties: string[]
    suggestedReviewPoints: string[]
    suggestedCorePurposes: string[]
    llmAnalyzed: boolean
  }
  selectedReviewPoints: string[]
  customPurposes: Array<{ value: string }>
  allSuggestedReviewPoints: string[]
  allSuggestedCorePurposes: string[]
  fileNames: string[]
  refFileNames: string[]
  savedAt: number
}
