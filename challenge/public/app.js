// Score and timer in the header of every page, like rpachallenge.com.
const clock = (ms) => new Date(ms).toISOString().slice(14, 19)
async function refresh() {
  const s = await (await fetch('/api/stats', { cache: 'no-store' })).json()
  document.querySelector('#score').textContent = `Score ${s.accepted}/${s.rows}`
  document.querySelector('#timer').textContent = `Time ${clock(s.elapsedMs)}`
}
refresh()
setInterval(refresh, 500)
