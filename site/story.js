const reduced = matchMedia('(prefers-reduced-motion: reduce)')
const put = (node, value) => {
  if (node && node.textContent !== value) node.textContent = value
}

// A visible, pausable illustration clock. It stops offscreen and in background tabs.
class Loop {
  constructor(root, duration, render, still = 0) {
    this.root = root
    this.duration = duration
    this.render = render
    this.time = reduced.matches ? still : 0
    this.still = still
    this.paused = false
    this.visible = false
    this.buttons = [...root.querySelectorAll('[data-loop-toggle]')]
    this.buttons.forEach((button) => {
      button.addEventListener('click', () => {
        this.paused = !this.paused
        this.sync()
      })
    })
    root.querySelector('[data-loop-reset]')?.addEventListener('click', () => this.seek(0))
    this.observer = new IntersectionObserver(
      (entries) => {
        this.visible = entries[0].isIntersecting
        this.sync()
      },
      { threshold: 0.12 },
    )
    this.observer.observe(root)
    document.addEventListener('visibilitychange', () => this.sync())
    reduced.addEventListener('change', () => {
      if (reduced.matches) this.time = this.still
      this.sync()
    })
    this.sync()
  }
  seek(time) {
    this.time = time
    this.sync()
  }
  sync() {
    cancelAnimationFrame(this.frame)
    this.active = this.visible && !document.hidden && !this.paused && !reduced.matches
    this.root.dataset.loopPlaying = String(this.active)
    this.buttons.forEach((button) => {
      button.hidden = reduced.matches
      const small = button.classList.contains('hero-pause')
      const name = this.paused ? '▶ Resume' : 'Ⅱ Pause'
      put(button, `${name}${small ? '' : ' demo'}`)
      button.setAttribute(
        'aria-label',
        `${this.paused ? 'Resume' : 'Pause'} ${small ? 'header example' : 'process demonstration'}`,
      )
    })
    put(
      this.root.querySelector('[data-loop-status]'),
      reduced.matches
        ? 'Choose a step · reduced motion'
        : this.paused
          ? 'Demonstration paused'
          : 'Automatic demonstration · loops continuously',
    )
    this.render(this.time, this.active)
    if (this.active) {
      this.last = performance.now()
      this.frame = requestAnimationFrame((now) => this.tick(now))
    }
  }
  tick(now) {
    if (!this.active) return
    this.time = (this.time + Math.min(100, now - this.last)) % this.duration
    this.last = now
    this.render(this.time, true)
    this.frame = requestAnimationFrame((time) => this.tick(time))
  }
}

export function initHeroStory() {
  const root = document.querySelector('[data-hero-story]')
  if (!root) return
  const customers = [
    ['Ada Lovelace', 'Analytical Engines', 'ada@example.test'],
    ['Grace Hopper', 'Compiler Works', 'grace@example.test'],
    ['Alan Turing', 'Bletchley Logic', 'alan@example.test'],
  ]
  const fields = [...root.querySelectorAll('[data-hero-field]')]
  const rows = [...root.querySelectorAll('[data-hero-row]')]
  new Loop(
    root,
    14400,
    (time) => {
      const learn = time < 3000
      const saved = time >= 3000 && time < 4500
      const complete = time >= 11400
      const index = Math.min(2, Math.max(0, Math.floor((time - 4500) / 2300)))
      const fraction = learn
        ? Math.min(1, time / 2300)
        : saved || complete
          ? 1
          : ((time - 4500) % 2300) / 2300
      const values =
        learn || saved ? ['Demo Customer', 'Example Company', 'demo@example.test'] : customers[index]
      const filled = Math.min(3, Math.floor((fraction / 0.65) * 3) + 1)
      const phase = learn
        ? '01 / YOUR AGENT LEARNS'
        : saved
          ? '02 / SAVE THE PROCEDURE'
          : complete
            ? '04 / EACH RESULT REMEMBERED'
            : '03 / REPLAY EVERY NEW ROW'
      put(root.querySelector('[data-hero-phase]'), phase)
      put(
        root.querySelector('[data-hero-note]'),
        learn
          ? 'One example. Find → fill → submit → check.'
          : saved
            ? 'Inputs, a business key and a result check.'
            : complete
              ? 'Three new customers. Three checked results.'
              : `Customer ${index + 1} / 3 · saved steps, new values.`,
      )
      put(
        root.querySelector('[data-hero-task]'),
        learn
          ? 'LEARN ONE EXAMPLE'
          : saved
            ? 'PROCEDURE SAVED'
            : complete
              ? 'BATCH COMPLETE'
              : `CREATE CUSTOMER ${index + 1} / 3`,
      )
      put(
        root.querySelector('[data-hero-description]'),
        learn || saved
          ? 'The agent learns with a separate sample customer.'
          : 'The CSV supplies the next customer’s values.',
      )
      put(
        root.querySelector('[data-hero-model]'),
        learn
          ? 'First example · with your agent'
          : saved
            ? 'Ready for a new list'
            : 'Direct browser replay · 0 model calls',
      )
      fields.forEach((field, i) => {
        put(field.querySelector('[data-hero-value]'), i < filled ? values[i] : '—')
        field.classList.toggle('active', !saved && !complete && fraction < 0.65 && i === filled - 1)
      })
      put(
        root.querySelector('[data-hero-receipt]'),
        saved
          ? 'Email identifies each new item'
          : fraction >= 0.83 || complete
            ? 'Customer’s email checked ✓'
            : fraction >= 0.65
              ? 'Submit customer → check result'
              : 'Fill the fields from this row',
      )
      root.querySelector('[data-hero-submit]').classList.toggle('checked', fraction >= 0.83 && !saved)
      put(
        root.querySelector('[data-hero-journal-title]'),
        complete
          ? '3 CUSTOMERS · 3 CHECKED RESULTS'
          : learn || saved
            ? 'NEW CSV ROWS · WAITING TO RUN'
            : 'ITEM JOURNAL · RESULT BY RESULT',
      )
      rows.forEach((node, i) => {
        const state =
          learn || saved
            ? 'pending'
            : complete || i < index || (i === index && fraction >= 0.83)
              ? 'done'
              : i === index
                ? 'running'
                : 'pending'
        const chip = node.querySelector('[data-hero-state]')
        chip.className = `state ${state}`
        put(chip, state)
      })
      root.querySelectorAll('[data-source-row]').forEach((node) => {
        node.classList.toggle(
          'active',
          !learn && !saved && !complete && Number(node.dataset.sourceRow) === index,
        )
      })
    },
    12000,
  )
}

export function initProcessStory(root, demo) {
  const starts = [0, 3200, 7600, 18400]
  const element = demo.el
  demo.storyControlled = true
  element.classList.add('story-controlled')
  const definition = document.createElement('div')
  definition.className = 'workflow-definition'
  definition.innerHTML =
    '<div class="pane-label"><span>customer-onboarding / workflow</span><span>Saved locally</span></div><ol><li><span>Input</span><strong>customers.csv</strong><small>New rows supply new customer values.</small></li><li><span>Business key</span><strong>item.Email</strong><small>Identify each customer across future runs.</small></li><li><span>Parameters</span><strong>Name · Company · Email</strong><small>Fill the fields using the current row.</small></li><li><span>Commit</span><strong>Submit customer</strong><small>A retry after this point may duplicate the effect.</small></li><li><span>Expectation</span><strong>Confirm this customer’s email</strong><small>Mark done only after the item-specific check.</small></li></ol><p class="small">An illustrated workflow contract. Your agent writes the site-specific steps.</p>'
  element.after(definition)
  const labels = [
    [
      'THE FIRST TIME · WITH YOUR AGENT',
      'Your agent creates a separate sample customer. Browser actions are recorded; the agent defines the repeatable workflow.',
    ],
    [
      'KEEP THE PROCEDURE · CHANGE THE INPUT',
      'The new CSV supplies the values. The saved workflow says how to submit each customer and prove that it exists.',
    ],
    [
      'EVERY NEW ROW · WITHOUT A MODEL',
      'Ritoko creates ten customers from the CSV. Each checked result becomes done in the local journal.',
    ],
    [
      'INTERRUPT → RESUME → RUN AGAIN',
      'Row five was submitted, but its result is uncertain. Hold it for review, finish the rest, then skip verified customers on the next run.',
    ],
  ]
  let previous = -1
  const loop = new Loop(
    root,
    36100,
    (time, active) => {
      const phase = time < starts[1] ? 0 : time < starts[2] ? 1 : time < starts[3] ? 2 : 3
      const local = time - starts[phase]
      if (previous !== phase) {
        root.querySelectorAll('[data-chapter]').forEach((button) => {
          const on = Number(button.dataset.chapter) === phase
          button.classList.toggle('active', on)
          if (on) button.setAttribute('aria-current', 'step')
          else button.removeAttribute('aria-current')
        })
        put(root.querySelector('[data-phase] .phase-tag'), labels[phase][0])
        put(root.querySelector('[data-phase] p'), labels[phase][1])
        previous = phase
      }
      definition.hidden = phase !== 1
      element.hidden = phase === 1
      demo.recording = phase === 0
      demo.storyPlaying = active
      demo.duration = phase === 2 ? 9000 : 18000
      demo.held = phase === 3
      demo.interrupted = phase === 3 && local < 2200
      demo.rerun = phase === 3 && local >= 13200
      demo.elapsed =
        phase === 0
          ? Math.min(local, 1800)
          : phase === 2
            ? Math.min(local, 9000)
            : phase === 3
              ? local < 2200
                ? 8640
                : local < 13200
                  ? Math.min(18000, 9000 + local - 2200)
                  : Math.min(1800, local - 13200)
              : 0
      element.classList.toggle('learning-example', phase === 0)
      demo.render()
      put(
        element.querySelector('[data-journal-note]'),
        demo.held
          ? 'Row 05 stays held. Mobile preview: rows 1, 5 & 10.'
          : 'Each result is checked. Mobile preview: rows 1, 5 & 10.',
      )
    },
    1800,
  )
  root.querySelectorAll('[data-chapter]').forEach((button) => {
    button.addEventListener('click', () => {
      const index = Number(button.dataset.chapter)
      const offset = reduced.matches || loop.paused ? [1800, 0, 4500, 0][index] : 0
      loop.seek(starts[index] + offset)
    })
  })
  root.querySelector('[data-interrupt]').addEventListener('click', () => loop.seek(starts[3]))
}

export function initRecordings() {
  document.querySelectorAll('[data-recording]').forEach((root) => {
    root.querySelectorAll('[data-seek]').forEach((button) => {
      button.addEventListener('click', () => {
        const video = root.querySelector('video')
        video.currentTime = Number(button.dataset.seek)
        video.play().catch(() => {})
      })
    })
  })
}
