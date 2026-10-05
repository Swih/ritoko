export type QueryVariant = { id: string; painPoint: string; queries: { en: string; fr: string } }
export type Sample = {
  engine: string
  date: string
  queryId: string
  language: 'en' | 'fr'
  query: string
  brandMention: boolean
  answerAccuracy: 'correct' | 'partly_correct' | 'incorrect' | 'unassessed'
  evidence: string
  claimChecks?: Array<{ text: string; accuracy: 'correct' | 'incorrect' | 'unclear' }>
  citationChecks?: Array<{
    claim: string
    url: string
    accuracy: 'supports' | 'does_not_support' | 'unclear'
  }>
  notes?: string
}
export type Report = {
  status: 'measured' | 'not_measured'
  sampleCount: number
  brandMentions: number
  brandMentionRate: number | null
  queryVariantCoverage: { covered: number; total: number; rate: number }
  answerAccuracy: Record<'correct' | 'partly_correct' | 'incorrect' | 'unassessed', number>
  claims: { total: number; correct: number; incorrect: number; unclear: number }
  citations: { total: number; supports: number; does_not_support: number; unclear: number }
  byEngine: Record<string, { samples: number; brandMentions: number }>
}
export const accuracyValues: Set<string>
export const citationValues: Set<string>
export function parseSamples(text: string, querySet: QueryVariant[]): Sample[]
export function makeReport(samples: Sample[], querySet: QueryVariant[]): Report
export function renderReport(report: Report): string
export function run(options?: { input?: string; json?: boolean }): string
