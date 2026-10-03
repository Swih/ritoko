// Usage: node --env-file=<private-file> scripts/analytics/report.mjs [days]
// UMAMI_ORIGIN, UMAMI_WEBSITE_ID, UMAMI_API_KEY stay outside the public site.
const { UMAMI_ORIGIN: origin, UMAMI_WEBSITE_ID: id, UMAMI_API_KEY: key } = process.env
const days = Number(process.argv[2] ?? 7)
if (!origin || !id || !key)
  throw new Error('Set UMAMI_ORIGIN, UMAMI_WEBSITE_ID and UMAMI_API_KEY in a private env file.')
if (new URL(origin).protocol !== 'https:') throw new Error('UMAMI_ORIGIN must use HTTPS.')
if (!/^[\da-f-]{36}$/i.test(id)) throw new Error('Invalid website ID.')
if (!Number.isInteger(days) || days < 1 || days > 90)
  throw new Error('Days must be an integer between 1 and 90.')
const endAt = Date.now()
const range = new URLSearchParams({ startAt: String(endAt - days * 86400000), endAt: String(endAt) })
const base = `${new URL(origin).origin}/api/websites/${id}`
const endpoints = {
  overview: `${base}/stats?${range}`,
  activeLastFiveMinutes: `${base}/active`,
  pages: `${base}/metrics?${range}&type=path&limit=20`,
  referrers: `${base}/metrics?${range}&type=referrer&limit=20`,
  events: `${base}/metrics?${range}&type=event&limit=30`,
}
const entries = await Promise.all(
  Object.entries(endpoints).map(async ([name, url]) => {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(15000),
      redirect: 'error',
    })
    if (!response.ok) throw new Error(`Analytics ${name}: HTTP ${response.status}`)
    return [name, await response.json()]
  }),
)
console.log(
  JSON.stringify(
    { days, retrievedAt: new Date(endAt).toISOString(), ...Object.fromEntries(entries) },
    null,
    2,
  ),
)
