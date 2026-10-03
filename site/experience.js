import { cases } from './cases.js'
import { initHeroStory, initProcessStory, initRecordings } from './story.js'

const reduced = matchMedia('(prefers-reduced-motion: reduce)')
const text = (node, value) => {
  if (node && node.textContent !== value) node.textContent = value
}
const people = [
  [
    'Ada',
    'Lovelace',
    'Analytical Engines',
    'Engineer',
    '1 Engine Road',
    'ada@example.test',
    '+44 7000 000001',
  ],
  [
    'Grace',
    'Hopper',
    'Compiler Works',
    'Director',
    '2 Compiler Lane',
    'grace@example.test',
    '+44 7000 000002',
  ],
  [
    'Alan',
    'Turing',
    'Bletchley Logic',
    'Researcher',
    '3 Logic Street',
    'alan@example.test',
    '+44 7000 000003',
  ],
  [
    'Katherine',
    'Johnson',
    'Orbital Paths',
    'Analyst',
    '4 Orbit Avenue',
    'katherine@example.test',
    '+44 7000 000004',
  ],
  [
    'Margaret',
    'Hamilton',
    'Apollo Software',
    'Engineer',
    '5 Apollo Road',
    'margaret@example.test',
    '+44 7000 000005',
  ],
  [
    'Linus',
    'Torvalds',
    'Kernel Cooperative',
    'Developer',
    '6 Kernel Street',
    'linus@example.test',
    '+44 7000 000006',
  ],
  [
    'Barbara',
    'Liskov',
    'Substitution Labs',
    'Researcher',
    '7 Lab Road',
    'barbara@example.test',
    '+44 7000 000007',
  ],
  [
    'Edsger',
    'Dijkstra',
    'Shortest Path',
    'Researcher',
    '8 Path Lane',
    'edsger@example.test',
    '+44 7000 000008',
  ],
  [
    'Donald',
    'Knuth',
    'Literate Programs',
    'Author',
    '9 Program Street',
    'donald@example.test',
    '+44 7000 000009',
  ],
  [
    'Radia',
    'Perlman',
    'Spanning Networks',
    'Engineer',
    '10 Network Road',
    'radia@example.test',
    '+44 7000 000010',
  ],
]

// An authored diagram. Its clock measures playback, never a live engine run.
class RunDemo {
  constructor(element) {
    this.el = element
    this.rpa = element.dataset.kind === 'rpa'
    this.duration = 18000
    this.fields = [...element.querySelectorAll('[data-field]')]
    this.allFields = [...this.fields]
    this.fieldLabels = this.fields.map((field) => field.querySelector('span').textContent)
    this.rows = [...element.querySelectorAll('[data-row]')]
    this.playButton = element.querySelector('[data-play]')
    this.elapsed = 0
    this.playing = false
    this.held = false
    this.interrupted = false
    this.interruptRequested = false
    this.recording = false
    this.rerun = false
    this.playButton.addEventListener('click', () => this.toggle())
    element.querySelector('[data-reset]').addEventListener('click', () => this.restart())
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.playing) this.pause()
    })
    reduced.addEventListener('change', () => {
      this.pause()
      this.render()
    })
    this.render()
  }

  reset() {
    this.pause()
    this.elapsed = 0
    this.held = false
    this.interrupted = false
    this.interruptRequested = false
    this.rerun = false
    this.render()
  }

  restart() {
    this.reset()
    if (this.scenario === 'resume') this.interruptRequested = true
  }

  setRpa(value) {
    this.rpa = value
    this.fields = value ? this.allFields : this.allFields.slice(0, 3)
    this.el.classList.toggle('run-demo-rpa', value)
    this.el.querySelector('[data-fields]').classList.toggle('rpa-fields', value)
    this.allFields.forEach((field, index) => {
      field.hidden = !value && index > 2
      text(
        field.querySelector('span'),
        value ? this.fieldLabels[index] : (['Name', 'Company', 'Email'][index] ?? this.fieldLabels[index]),
      )
    })
    text(this.el.querySelector('.form-heading .overline'), value ? 'INPUT FORMS' : 'CUSTOMER RECORD')
    text(
      this.el.querySelector('.run-bar>.mono'),
      value ? 'challenge.xlsx → 10 rows' : 'customers.csv → 10 rows',
    )
    this.render()
  }

  pause() {
    this.playing = false
    cancelAnimationFrame(this.raf)
    this.render()
  }

  toggle() {
    if (this.playing) return this.pause()
    if (this.interrupted) {
      this.interrupted = false
      this.elapsed = 9000
    } else if (this.elapsed >= this.limit()) {
      if (this.held && !this.rerun) {
        this.rerun = true
        this.elapsed = 0
      } else {
        this.restart()
      }
    }
    if (reduced.matches) {
      this.elapsed = this.limit()
      this.render()
      return
    }
    this.playing = true
    this.lastTime = performance.now()
    this.raf = requestAnimationFrame((now) => this.tick(now))
    this.render()
  }

  limit() {
    return this.rerun ? 1800 : this.recording ? this.duration / 10 : this.duration
  }

  tick(now) {
    if (!this.playing) return
    this.elapsed = Math.min(this.elapsed + Math.max(0, now - this.lastTime), this.limit())
    this.lastTime = now
    if (this.interruptRequested && this.elapsed >= 8640 && !this.held) {
      this.elapsed = 8640
      this.held = true
      this.interrupted = true
      this.playing = false
    } else if (this.elapsed >= this.limit()) {
      this.playing = false
    }
    this.render()
    if (this.playing) this.raf = requestAnimationFrame((time) => this.tick(time))
  }

  interrupt() {
    this.recording = false
    this.reset()
    this.interruptRequested = true
    if (reduced.matches) return this.showInterrupted()
    this.toggle()
  }

  showInterrupted() {
    this.pause()
    this.recording = false
    this.rerun = false
    this.held = true
    this.interrupted = true
    this.elapsed = 8640
    this.render()
  }

  render() {
    const complete = this.elapsed >= this.limit()
    const rowDuration = this.duration / 10
    const current = complete && this.recording ? 0 : Math.min(9, Math.floor(this.elapsed / rowDuration))
    const fraction = complete ? 1 : (this.elapsed % rowDuration) / rowDuration
    const row = people[current]
    const values = this.recording
      ? ['Demo Customer', 'Example Company', 'demo@example.test']
      : this.rpa
        ? row
        : [`${row[0]} ${row[1]}`, row[2], row[5]]
    const filled =
      this.elapsed === 0
        ? 0
        : Math.min(this.fields.length, Math.floor((fraction / 0.65) * this.fields.length) + 1)
    this.fields.forEach((field, i) => {
      const active =
        !this.rerun &&
        !complete &&
        !this.interrupted &&
        this.elapsed > 0 &&
        fraction < 0.65 &&
        i === filled - 1
      field.classList.toggle('active', active)
      // The fields move between rows while their visible labels retain their meaning.
      field.style.order = this.rpa ? String((i * 3 + current * 2) % 7) : ''
      text(field.querySelector('[data-value]'), !this.rerun && (i < filled || complete) ? values[i] : '—')
    })
    this.rows.forEach((node, i) => {
      let state = 'pending'
      if (this.rerun) state = i === 4 ? 'review' : 'skipped'
      else if (this.held && i === 4) state = 'review'
      else if (i < current || (complete && (!this.recording || i === 0))) state = 'done'
      else if (i === current && this.elapsed > 0 && !this.interrupted) state = 'running'
      if (this.recording && i > 0) state = 'pending'
      const chip = node.querySelector('[data-row-state]')
      chip.className = `state ${state}`
      text(chip, state)
      node.classList.toggle('is-current', i === current && !complete && !this.interrupted)
    })
    const counts = {}
    for (const node of this.rows) {
      const state = node.querySelector('[data-row-state]').textContent
      counts[state] = (counts[state] ?? 0) + 1
    }
    text(
      this.el.querySelector('[data-journal-summary]'),
      ['done', 'skipped', 'review', 'running', 'pending']
        .filter((state) => counts[state])
        .map((state) => `${counts[state]} ${state}`)
        .join(' · '),
    )
    text(
      this.el.querySelector('[data-current-row]'),
      this.recording ? 'SEPARATE SAMPLE TASK' : `ROW ${String(current + 1).padStart(2, '0')} / 10`,
    )
    if (this.storyControlled)
      text(
        this.el.querySelector('.run-bar>.mono'),
        this.recording ? 'Example task → recorded steps' : 'customers.csv → 10 new rows',
      )
    this.el
      .querySelector('[data-submit]')
      .classList.toggle(
        'active',
        fraction >= 0.65 && fraction < 0.83 && !this.rerun && !this.interrupted && !complete,
      )
    const receipt = this.el.querySelector('[data-receipt]')
    receipt.classList.toggle('checked', (fraction >= 0.83 || complete) && !this.interrupted && !this.rerun)
    receipt.classList.toggle('uncertain', this.interrupted)
    text(
      this.el.querySelector('[data-receipt-text]'),
      this.rerun
        ? 'Already processed. Nothing is submitted again.'
        : this.interrupted
          ? 'Submitted; result unconfirmed. Held for review.'
          : fraction >= 0.83 || complete
            ? this.rpa
              ? complete
                ? 'Final batch score checked: 70 / 70 fields.'
                : 'Round advanced. The final score checks the batch.'
              : 'Result checked against the workflow’s expectation.'
            : this.rpa
              ? 'Final score is checked after all ten rows.'
              : 'Waiting for the result check',
    )
    const label = this.interrupted
      ? 'Interrupted after submission'
      : this.rerun
        ? 'Same file again · no new submissions'
        : complete
          ? this.recording
            ? 'First task recorded'
            : this.held
              ? 'Partial · 9 done, 1 review'
              : 'Complete · 10 done'
          : this.recording
            ? 'Your agent does the first task'
            : this.playing || this.storyPlaying
              ? 'Replaying the saved procedure'
              : this.elapsed > 0
                ? 'Playback paused'
                : 'Ready to replay'
    text(this.el.querySelector('[data-run-label]'), label)
    text(
      this.el.querySelector('[data-journal-note]'),
      this.held
        ? 'Row 05 remains held across later runs.'
        : this.recording
          ? 'The agent will now define inputs and checks.'
          : 'Every row keeps its own outcome.',
    )
    const button = this.interrupted
      ? 'Resume safely'
      : this.playing
        ? 'Pause'
        : complete
          ? this.held && !this.rerun
            ? 'Rerun the same file'
            : this.measuredPace
              ? 'Replay fast'
              : 'Replay sequence'
          : this.elapsed > 0
            ? 'Continue'
            : reduced.matches
              ? 'Show result'
              : this.measuredPace
                ? 'Play fast'
                : 'Play sequence'
    const buttonMarkup = `<span aria-hidden="true">${this.playing ? 'Ⅱ' : '▶'}</span> ${button}`
    if (this.buttonMarkup !== buttonMarkup) {
      this.playButton.innerHTML = buttonMarkup
      this.buttonMarkup = buttonMarkup
    }
    this.el.querySelector('[data-progress]').style.width =
      `${Math.min(100, (this.elapsed / this.limit()) * 100)}%`
    const seconds = Math.floor(this.elapsed / 1000)
    text(
      this.el.querySelector('[data-time]'),
      this.measuredPace ? `${(this.elapsed / 1000).toFixed(3)} s` : `00:${String(seconds).padStart(2, '0')}`,
    )
    text(
      this.el.querySelector('[data-caption]'),
      this.interrupted
        ? 'Interrupted after commit: 4 verified, 1 uncertain, 5 not started. Continue to see the journal guide the resume.'
        : this.rerun
          ? 'Illustration: verified rows are skipped; the uncertain row stays held. No second submission.'
          : this.measuredPace
            ? 'Timing reconstruction · 1.735 s total. Illustrative step timings; the original measured result is below.'
            : this.recording
              ? 'Interactive illustration · learning the task once with your agent.'
              : 'Interactive illustration · slowed for readability. No live submissions.',
    )
  }
}

export function initExperience() {
  const demos = new Map([...document.querySelectorAll('[data-run-demo]')].map((el) => [el, new RunDemo(el)]))
  const process = document.querySelector('[data-process]')
  if (process) initProcessStory(process, demos.get(process.querySelector('[data-run-demo]')))
  initHeroStory()
  initRecordings()
  const library = document.querySelector('[data-case-library]')
  if (library) initCases(library, demos)
}

function initCases(library, demos) {
  const demoElement = library.querySelector('[data-run-demo]')
  const demo = demos.get(demoElement)
  const slow = library.querySelector('[data-slow-view]')
  const real = library.querySelector('[data-real-view]')
  const recipe = library.querySelector('[data-recipe-view]')
  const options = [...library.querySelectorAll('[data-case]')]
  const modeButtons = [...library.querySelectorAll('[data-view]')]
  let selected = cases[0]

  const setView = (view) => {
    demo.reset()
    demo.measuredPace = view === 'real' && selected.id === 'rpa'
    demo.duration = demo.measuredPace ? 1735 : 18000
    demo.render()
    if (view === 'slow' && selected.id === 'resume') demo.showInterrupted()
    slow.hidden = view === 'real' && selected.id !== 'rpa'
    real.hidden = view !== 'real'
    modeButtons.forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.view === view))
    })
    text(
      library.querySelector('[data-mode-label]'),
      view === 'real'
        ? selected.id === 'resume'
          ? '34.2 s · actual recording'
          : '1,735 ms · timing reconstruction'
        : selected.evidence
          ? '18 s · illustration'
          : 'Workflow illustration',
    )
    const video = library.querySelector('video')
    if (view !== 'real' || selected.id !== 'resume') video.pause()
    library.querySelector('[data-rpa-proof]').hidden = selected.id !== 'rpa'
    library.querySelector('[data-video-proof]').hidden = selected.id !== 'resume'
    text(library.querySelector('[data-view="real"]'), selected.id === 'rpa' ? 'Full speed ↗' : 'Real time ↗')
    text(library.querySelector('[data-view="slow"]'), selected.evidence ? 'Slow showcase' : 'The procedure')
  }

  const select = (id, updateUrl = true) => {
    selected = cases.find((c) => c.id === id) ?? cases[0]
    demo.scenario = selected.id
    demo.reset()
    demo.setRpa(selected.id === 'rpa')
    options.forEach((button) => {
      const active = button.dataset.case === selected.id
      button.classList.toggle('selected', active)
      button.setAttribute('aria-pressed', String(active))
    })
    const updates = {
      '[data-case-meta]': `${selected.number} / ${selected.category.toUpperCase()} · ${selected.kind.toUpperCase()}`,
      '[data-case-title]': selected.title,
      '[data-case-description]': selected.description,
      '[data-case-input]': selected.input,
      '[data-case-output]': selected.output,
      '[data-case-boundary]': selected.boundary,
      '[data-recipe-input]': selected.input,
      '[data-recipe-output]': selected.output,
    }
    for (const [selector, value] of Object.entries(updates)) text(library.querySelector(selector), value)
    library.querySelector('[data-case-checks]').replaceChildren(
      ...selected.checks.map((check) => {
        const li = document.createElement('li')
        const tick = document.createElement('span')
        tick.setAttribute('aria-hidden', 'true')
        tick.textContent = '✓'
        li.append(tick, document.createTextNode(check))
        return li
      }),
    )
    library.querySelector('[data-recipe-steps]').replaceChildren(
      ...selected.steps.map((step) => {
        const li = document.createElement('li')
        li.textContent = step
        return li
      }),
    )
    library.querySelector('[data-case-source]').href = selected.source
    library.querySelector('[data-case-guide]').href = `/use-cases/${selected.slug}`
    library.querySelector('[data-measurement]').hidden = selected.id !== 'rpa'
    library.querySelector('[data-view="real"]').hidden = !selected.evidence
    demoElement.hidden = !selected.evidence
    recipe.hidden = Boolean(selected.evidence)
    demo.el.querySelector('.browser-bar>span:nth-child(2)').textContent =
      selected.id === 'rpa' ? 'rpachallenge.com · reconstructed view' : 'Back office · sample data'
    text(
      demo.el.querySelector('[data-form-title]'),
      selected.id === 'rpa' ? 'A different form. Every row.' : 'A new customer.',
    )
    setView('slow')
    if (updateUrl) history.replaceState(null, '', `#${selected.id}`)
  }
  options.forEach((button) => {
    button.addEventListener('click', () => select(button.dataset.case))
  })
  modeButtons.forEach((button) => {
    button.addEventListener('click', () => setView(button.dataset.view))
  })
  library.querySelectorAll('[data-filter]').forEach((button) => {
    button.addEventListener('click', () => {
      const filter = button.dataset.filter
      library.querySelectorAll('[data-filter]').forEach((item) => {
        item.setAttribute('aria-pressed', String(item === button))
      })
      options.forEach((option) => {
        option.hidden = filter !== 'All' && option.dataset.category !== filter
      })
      const visible = options.filter((option) => !option.hidden)
      text(library.querySelector('[data-case-count]'), `${visible.length} procedures to explore`)
      if (!visible.some((option) => option.dataset.case === selected.id)) select(visible[0].dataset.case)
    })
  })
  library.querySelectorAll('[data-video-time]').forEach((button) => {
    button.addEventListener('click', () => {
      const video = library.querySelector('video')
      video.currentTime = Number(button.dataset.videoTime)
      video.play().catch(() => {})
    })
  })
  window.addEventListener('hashchange', () => select(location.hash.slice(1), false))
  select(location.hash.slice(1) || 'rpa', false)
}
