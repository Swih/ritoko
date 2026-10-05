import { describe, expect, it } from 'vitest'
import querySet from '../scripts/geo/queries.json' with { type: 'json' }
import type { Sample } from '../scripts/geo/report.mjs'
import { makeReport, parseSamples, renderReport } from '../scripts/geo/report.mjs'

const uncertainQuery = querySet.find((entry) => entry.id === 'uncertain-write')
if (!uncertainQuery) throw new Error('Missing fixed test query')

// Synthetic rows below exercise the calculation only; they are not product measurements.
const fixture = (overrides: Partial<Sample> = {}): Sample => ({
  engine: 'Fixture engine (test only)',
  date: '2026-10-05',
  queryId: 'uncertain-write',
  language: 'en',
  query: uncertainQuery.queries.en,
  brandMention: true,
  answerAccuracy: 'correct',
  claimChecks: [
    { text: 'Test claim', accuracy: 'correct' },
    { text: 'Test claim', accuracy: 'incorrect' },
  ],
  citationChecks: [
    { claim: 'Test claim', url: 'https://example.test/source', accuracy: 'supports' },
    { claim: 'Test claim', url: 'https://example.test/other', accuracy: 'does_not_support' },
  ],
  evidence: 'test fixture only',
  ...overrides,
})

describe('manual GEO measurement report', () => {
  it('keeps zero samples distinct from a measured zero-mention result', () => {
    const empty = makeReport([], querySet)
    expect(empty.status).toBe('not_measured')
    expect(empty.brandMentionRate).toBeNull()
    expect(renderReport(empty)).toContain('does not mean zero brand mentions')

    const observed = makeReport(
      [fixture({ brandMention: false, claimChecks: [], citationChecks: [] })],
      querySet,
    )
    expect(observed.status).toBe('measured')
    expect(observed.brandMentions).toBe(0)
    expect(observed.brandMentionRate).toBe(0)
  })

  it('counts coverage, answer accuracy, factual claims and citation support independently', () => {
    const samples = [
      fixture(),
      fixture({
        language: 'fr',
        query: uncertainQuery.queries.fr,
        brandMention: false,
        answerAccuracy: 'partly_correct',
      }),
    ]
    const report = makeReport(samples, querySet)
    expect(report.queryVariantCoverage).toEqual({ covered: 2, total: 12, rate: 2 / 12 })
    expect(report.answerAccuracy.correct).toBe(1)
    expect(report.answerAccuracy.partly_correct).toBe(1)
    expect(report.claims).toMatchObject({ total: 4, correct: 2, incorrect: 2, unclear: 0 })
    expect(report.citations).toMatchObject({ total: 4, supports: 2, does_not_support: 2, unclear: 0 })
  })

  it('rejects altered prompts and unknown query ids rather than mixing incomparable samples', () => {
    expect(() => parseSamples(JSON.stringify(fixture({ query: 'A different question' })), querySet)).toThrow(
      'query must exactly match',
    )
    expect(() => parseSamples(JSON.stringify(fixture({ queryId: 'made-up' })), querySet)).toThrow(
      'queryId and language',
    )
  })
})
