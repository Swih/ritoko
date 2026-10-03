import { readFileSync } from 'node:fs'

// Render the public measurements from the same source used by the showcase.
export function benchmarks({ head, header, footer, breadcrumb, origin }) {
  const facts = JSON.parse(
    readFileSync(new URL('../../site/assets/media/facts.json', import.meta.url), 'utf8'),
  )
  const rpa = facts.rpaChallenge
  const crash = facts.crashDemo
  const ms = (value) => `${value.toLocaleString('en-US')} ms`
  const measuredDate = new Date(`${facts.date}T12:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
  const schema = {
    '@type': 'TechArticle',
    '@id': `${origin}/benchmarks#article`,
    headline: 'Ritoko automation benchmarks and measurement methodology',
    description:
      'Original RPA Challenge timings and a local crash-and-resume test, with their measurement boundaries, environment and source files.',
    datePublished: '2026-10-04',
    author: { '@id': `${origin}/#organization` },
    publisher: { '@id': `${origin}/#organization` },
    mainEntityOfPage: `${origin}/benchmarks`,
    inLanguage: 'en',
    citation: [
      `${origin}/assets/media/facts.json`,
      'https://github.com/Swih/ritoko/blob/main/examples/rpa-challenge.json',
    ],
  }
  return `${head('Workflow automation benchmarks and methodology — Ritoko', schema.description, 'benchmarks', [breadcrumb('Measurements', 'benchmarks'), schema])}${header()}<main id="main" tabindex="-1"><article class="editorial benchmarks-page wrap">
  <a class="text-link" href="/use-cases">← Explore the use cases</a>
  <p class="overline">ORIGINAL MEASUREMENTS / ${measuredDate.toUpperCase()}</p>
  <h1>The result. <br><em>And what it measures.</em></h1>
  <p class="editorial-lede">Ritoko saves a procedure your agent learned, replays its deterministic steps and keeps a local journal for each item. Here are two tests you can inspect: changing browser forms, and recovery after an interrupted customer batch.</p>
  <div class="measurement-environment"><span>Ritoko ${facts.ritokoVersion}</span><span>Windows · ${facts.os}</span><span>Node ${facts.node}</span><span>Headless Chrome ${facts.chrome}</span></div>
  <section class="benchmark-section" id="rpa-challenge">
    <p class="overline">01 / CHANGING BROWSER FORMS</p><h2>RPA Challenge: ${rpa.fields} correct fields.</h2>
    <p>The saved workflow completed ${rpa.rows} spreadsheet rows with ${rpa.scorePercent}% success. The challenge moves its form fields after each submission. This is one measured run, not an average or a claim about every business website.</p>
    <div class="benchmark-table" role="region" aria-label="RPA Challenge timing comparison" tabindex="0"><table><caption>Three timings from the same run. Each covers a different interval.</caption><thead><tr><th scope="col">Measurement</th><th scope="col">Result</th><th scope="col">What it includes</th></tr></thead><tbody>
    <tr><th scope="row">Challenge timer</th><td>${ms(rpa.siteReportedMs)}</td><td>The elapsed time reported by the challenge website.</td></tr>
    <tr><th scope="row">Journal duration</th><td>${ms(rpa.journalDurationMs)}</td><td>The workflow run recorded by Ritoko, including its setup and checks.</td></tr>
    <tr><th scope="row">CLI wall-clock</th><td>${ms(rpa.cliWallClockMs)}</td><td>The complete CLI invocation, including work outside the challenge timer.</td></tr>
    </tbody></table></div>
    <figure class="editorial-proof"><a href="/assets/media/rpa-challenge-100.png"><img src="/assets/media/rpa-challenge-100.png" width="1280" height="720" loading="lazy" alt="Original RPA Challenge result: 100 percent success, 70 of 70 fields, in 1735 milliseconds."></a><figcaption>Original result capture. The 18-second animation in the showcase is an illustration for readability; it is not a timed recording.</figcaption></figure>
    <div class="benchmark-links"><a class="text-link" href="/use-cases/rpa-challenge">How the form workflow works ↗</a><a class="text-link" href="https://github.com/Swih/ritoko/blob/main/examples/rpa-challenge.json">Inspect the workflow source ↗</a></div>
  </section>
  <section class="benchmark-section" id="crash-recovery">
    <p class="overline">02 / INTERRUPT, RESUME, RERUN</p><h2>A crash leaves one item to check.</h2>
    <p>A local test back office accepts duplicate submissions. We kill the process after submission ${crash.killedAtRow} reaches the server, resume it, then run the same file again. The test adds ${crash.labLatencyMsPerSubmit} ms to each submission so the interruption is visible.</p>
    <div class="benchmark-table" role="region" aria-label="Crash recovery outcomes" tabindex="0"><table><caption>Item outcomes across the interruption and recovery.</caption><thead><tr><th scope="col">Stage</th><th scope="col">Journal state</th><th scope="col">Observed behavior</th></tr></thead><tbody>
    <tr><th scope="row">After the kill</th><td>4 done · 1 unconfirmed · 5 pending</td><td>Five submissions have reached the server. The fifth has no confirmed result in the journal.</td></tr>
    <tr><th scope="row">After resume</th><td>${crash.resumedRunCounts.done} done · ${crash.resumedRunCounts.review} review</td><td>The four verified items are kept. The uncertain fifth is held; the five pending items complete.</td></tr>
    <tr><th scope="row">After rerun</th><td>9 skipped · 1 review</td><td>The server still has ${crash.submissionsReceived} submissions with ${crash.uniqueSubmissions} unique customer keys.</td></tr>
    </tbody></table></div>
    <p>This demonstrates recovery through the same local Ritoko installation and journal. It does not establish a universal exactly-once guarantee. Each real workflow needs a stable business key and a check that proves the destination’s result. An uncertain commit stays held until someone checks and resolves it.</p>
    <div class="benchmark-links"><a class="text-link" href="/watch">Watch the ${facts.video.durationSeconds}-second real-time recording ↗</a><a class="text-link" href="/use-cases/customer-onboarding">Read the customer workflow ↗</a></div>
  </section>
  <div class="editorial-body"><section><h2>What uses a model?</h2><p>Your agent learns the task and helps repair a changed procedure. Unchanged deterministic browser, HTTP and MCP steps replay without a model call. Reading each new document with an agent or external service is a separate operation and may still use a model on every item.</p></section><section><h2>Inspect, then reproduce.</h2><p>The public measurement file records the runtime, timings and item counts. The repository contains the RPA workflow and setup instructions. Use the same inputs, timer boundary and runtime when comparing a new run; destination latency and session state can change the result.</p><a class="text-link" href="/assets/media/facts.json">Download the original measurement data ↗</a><a class="text-link" href="https://github.com/Swih/ritoko#install">Set up Ritoko locally ↗</a></section></div>
  </article></main>${footer()}`
}
