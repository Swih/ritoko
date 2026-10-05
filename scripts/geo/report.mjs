#!/usr/bin/env node
// Deterministic report over manually collected GEO samples. It makes no network requests.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export const accuracyValues = new Set(['correct', 'incorrect', 'unclear'])
export const citationValues = new Set(['supports', 'does_not_support', 'unclear'])
const answerValues = new Set(['correct', 'partly_correct', 'incorrect', 'unassessed'])

export function parseSamples(text, querySet) {
  const rows = text.split(/\r?\n/).filter((line) => line.trim())
  const samples = []
  for (const [index, line] of rows.entries()) {
    let sample
    try {
      sample = JSON.parse(line)
    } catch (error) {
      throw new Error(`Line ${index + 1}: invalid JSON (${error.message})`)
    }
    validateSample(sample, index + 1, querySet)
    samples.push(sample)
  }
  return samples
}

function validateSample(sample, line, querySet) {
  const fail = (message) => {
    throw new Error(`Line ${line}: ${message}`)
  }
  if (!sample || typeof sample !== 'object' || Array.isArray(sample)) fail('sample must be a JSON object')
  for (const field of ['engine', 'date', 'queryId', 'language', 'query', 'answerAccuracy', 'evidence']) {
    if (typeof sample[field] !== 'string' || !sample[field].trim())
      fail(`${field} must be a non-empty string`)
  }
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(sample.date) ||
    new Date(`${sample.date}T00:00:00Z`).toISOString().slice(0, 10) !== sample.date
  )
    fail('date must be a real ISO date (YYYY-MM-DD)')
  const fixed = querySet.find((item) => item.id === sample.queryId)
  if (!fixed || !['en', 'fr'].includes(sample.language))
    fail('queryId and language must match a fixed query variant')
  if (fixed.queries[sample.language] !== sample.query)
    fail('query must exactly match the selected fixed query variant')
  if (typeof sample.brandMention !== 'boolean') fail('brandMention must be true or false')
  if (!answerValues.has(sample.answerAccuracy))
    fail(`answerAccuracy must be one of ${[...answerValues].join(', ')}`)
  if (typeof sample.evidence !== 'string' || !sample.evidence.trim())
    fail('evidence must point to a saved answer URL or local evidence path')
  if (!Array.isArray(sample.claimChecks ?? [])) fail('claimChecks must be an array')
  for (const [i, claim] of (sample.claimChecks ?? []).entries()) {
    if (!claim || typeof claim.text !== 'string' || !claim.text.trim() || !accuracyValues.has(claim.accuracy))
      fail(`claimChecks[${i}] needs text and accuracy correct|incorrect|unclear`)
  }
  if (!Array.isArray(sample.citationChecks ?? [])) fail('citationChecks must be an array')
  for (const [i, citation] of (sample.citationChecks ?? []).entries()) {
    let validUrl = false
    try {
      validUrl = ['http:', 'https:'].includes(new URL(citation.url).protocol)
    } catch {}
    if (
      !validUrl ||
      typeof citation.claim !== 'string' ||
      !citation.claim.trim() ||
      !citationValues.has(citation.accuracy)
    )
      fail(`citationChecks[${i}] needs claim, an http(s) URL and accuracy supports|does_not_support|unclear`)
  }
  if (sample.notes !== undefined && typeof sample.notes !== 'string')
    fail('notes must be a string when supplied')
}

const counts = (values, keys) =>
  Object.fromEntries(keys.map((key) => [key, values.filter((v) => v === key).length]))

export function makeReport(samples, querySet) {
  const covered = new Set(samples.map(({ queryId, language }) => `${queryId}:${language}`))
  const claimAccuracy = samples.flatMap((sample) => (sample.claimChecks ?? []).map((item) => item.accuracy))
  const citationAccuracy = samples.flatMap((sample) =>
    (sample.citationChecks ?? []).map((item) => item.accuracy),
  )
  const measured = samples.length > 0
  return {
    status: measured ? 'measured' : 'not_measured',
    sampleCount: samples.length,
    brandMentions: samples.filter((sample) => sample.brandMention).length,
    brandMentionRate: measured
      ? samples.filter((sample) => sample.brandMention).length / samples.length
      : null,
    queryVariantCoverage: {
      covered: covered.size,
      total: querySet.length * 2,
      rate: covered.size / (querySet.length * 2),
    },
    answerAccuracy: counts(
      samples.map((sample) => sample.answerAccuracy),
      [...answerValues],
    ),
    claims: { total: claimAccuracy.length, ...counts(claimAccuracy, [...accuracyValues]) },
    citations: { total: citationAccuracy.length, ...counts(citationAccuracy, [...citationValues]) },
    byEngine: Object.fromEntries(
      [...new Set(samples.map((sample) => sample.engine))].sort().map((engine) => {
        const engineSamples = samples.filter((sample) => sample.engine === engine)
        return [
          engine,
          {
            samples: engineSamples.length,
            brandMentions: engineSamples.filter((sample) => sample.brandMention).length,
          },
        ]
      }),
    ),
  }
}

export function renderReport(report) {
  const percent = (value) => `${(value * 100).toFixed(1)}%`
  if (report.status === 'not_measured')
    return [
      '# Ritoko GEO measurement',
      '',
      '**Status: not measured.** No real engine responses have been entered. Zero samples means no result; it does not mean zero brand mentions.',
      '',
      'Collect answers manually with the fixed prompts in `scripts/geo/queries.json`, then save documented observations as one JSON object per line. See `docs/research/geo-measurement.md`.',
      '',
    ].join('\n')
  const engineLines = Object.entries(report.byEngine).map(
    ([engine, data]) => `| ${engine} | ${data.samples} | ${data.brandMentions} |`,
  )
  return [
    '# Ritoko GEO measurement',
    '',
    `**Status: measured** · ${report.sampleCount} manually recorded answer(s)`,
    '',
    `- Brand mentions: ${report.brandMentions}/${report.sampleCount} (${percent(report.brandMentionRate)})`,
    `- Fixed query-variant coverage: ${report.queryVariantCoverage.covered}/${report.queryVariantCoverage.total} (${percent(report.queryVariantCoverage.rate)})`,
    `- Answer accuracy: ${report.answerAccuracy.correct} correct, ${report.answerAccuracy.partly_correct} partly correct, ${report.answerAccuracy.incorrect} incorrect, ${report.answerAccuracy.unassessed} unassessed`,
    `- Claim checks: ${report.claims.correct} correct, ${report.claims.incorrect} incorrect, ${report.claims.unclear} unclear (${report.claims.total} total)`,
    `- Citation checks: ${report.citations.supports} support the cited claim, ${report.citations.does_not_support} do not, ${report.citations.unclear} unclear (${report.citations.total} total)`,
    '',
    '| Engine | Samples | Brand mentions |',
    '| --- | ---: | ---: |',
    ...engineLines,
    '',
    'This is a summary of the entered observations, not a ranking or a prediction of future answers.',
    '',
  ].join('\n')
}

export function run({ input, json = false } = {}) {
  if (!input) throw new Error('Usage: node scripts/geo/report.mjs <samples.jsonl> [--json]')
  const querySet = JSON.parse(readFileSync(new URL('./queries.json', import.meta.url), 'utf8'))
  const samples = parseSamples(readFileSync(resolve(input), 'utf8'), querySet)
  const report = makeReport(samples, querySet)
  return json ? JSON.stringify(report, null, 2) : renderReport(report)
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [input, ...flags] = process.argv.slice(2)
    if (flags.some((flag) => flag !== '--json'))
      throw new Error(`Unknown option: ${flags.find((flag) => flag !== '--json')}`)
    console.log(run({ input, json: flags.includes('--json') }))
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
