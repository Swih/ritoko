// Animated explainer: record → replay → crash → run again.
// Items are tokens; the journal shows each row's state per run.
// Everything is driven by the Web Animations API so the whole timeline can pause.
// With prefers-reduced-motion, beats render their end state without movement.

const NS = 'http://www.w3.org/2000/svg'
const KEYS = ['INV-01', 'INV-02', 'INV-03', 'INV-04', 'INV-05', 'INV-06', 'INV-07', 'INV-08']
const CRASHED = 4 // zero-based: row 5
const STEPS = ['goto', 'fill', 'fill', 'fill', 'commit', 'expect']

const LAYOUTS = {
  wide: {
    vb: [1000, 470],
    sheet: { x: 16, y: 44, w: 168, h: 404 },
    rowY: (i) => 104 + i * 42,
    sheetPos: (i) => [100, 104 + i * 42],
    chrome: { x: 214, y: 96, w: 520, h: 236 },
    mode: [474, 152],
    track: { y: 236, x1: 244, x2: 704 },
    nodes: [280, 350, 410, 470, 560, 650],
    crashLabel: [560, 304],
    tray: { x: 474, y: 356, w: 230, h: 46 },
    trayLabel: [488, 383],
    trayPos: [650, 379],
    journal: { x: 756, y: 44, w: 228, h: 404 },
    runHead: [
      [880, 88],
      [948, 88],
    ],
    keyX: 770,
    chipX: [880, 948],
    chipW: 60,
    skipLane: (from, to) => [
      [from[0], 30],
      [to[0], 30],
    ],
  },
  tall: {
    vb: [400, 706],
    sheet: { x: 12, y: 8, w: 376, h: 110 },
    sheetPos: (i) => [62 + (i % 4) * 92, 60 + Math.floor(i / 4) * 34],
    chrome: { x: 12, y: 130, w: 376, h: 190 },
    mode: [200, 174],
    track: { y: 240, x1: 30, x2: 370 },
    nodes: [58, 110, 158, 206, 266, 330],
    crashLabel: [266, 300],
    tray: { x: 96, y: 332, w: 292, h: 42 },
    trayLabel: [110, 358],
    trayPos: [340, 353],
    journal: { x: 12, y: 386, w: 376, h: 312 },
    rowY: (i) => 464 + i * 31,
    runHead: [
      [250, 440],
      [340, 440],
    ],
    keyX: 30,
    chipX: [250, 340],
    chipW: 70,
    skipLane: () => [],
  },
}

const CAPTION = [
  'Recording: 6 steps',
  'Run 1: 4 done · 4 pending',
  'Run 1: process killed after row 5 committed',
  'Run 1: 7 done · 1 review. Run 2: 7 skipped · 1 held · nothing submitted twice',
]
const MODE = [
  ['RECORDING · AGENT + MODEL', 'rec', 'WORKFLOW SAVED · 6 STEPS', 'rec'],
  ['REPLAY · NO MODEL', 'play'],
  ['REPLAY · INTERRUPTED', 'rec'],
  ['RESUME · RUN 1', 'play'],
]

const el = (name, attrs = {}, parent) => {
  const node = document.createElementNS(NS, name)
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v)
  if (parent) parent.append(node)
  return node
}
const text = (parent, x, y, value, cls, extra = {}) => {
  const t = el('text', { x, y, class: cls, ...extra }, parent)
  t.textContent = value
  return t
}

class Cancelled extends Error {}

export class Explainer {
  constructor(root) {
    this.root = root
    this.canvas = root.querySelector('[data-stage]')
    this.status = root.querySelector('[data-stage-status]')
    this.playBtn = root.querySelector('[data-stage-play]')
    this.replayBtn = root.querySelector('[data-stage-replay]')
    this.caption = root.querySelector('[data-beat-caption]')
    this.beatButtons = [...root.querySelectorAll('[data-beat]')]
    this.anims = new Set()
    this.gen = 0
    this.done = -1 // last beat whose end state is shown
    this.current = 0
    this.playing = false
    this.paused = false
    this.userPaused = false
    this.started = false
    this.reduced = matchMedia('(prefers-reduced-motion: reduce)')
    this.narrow = matchMedia('(max-width: 899px)')

    this.build()
    this.applyEnd(-1)
    this.setCurrent(0)

    for (const b of this.beatButtons) b.addEventListener('click', () => this.goTo(Number(b.dataset.beat)))
    this.playBtn.addEventListener('click', () => this.togglePause())
    this.replayBtn.addEventListener('click', () => this.goTo(0))
    this.narrow.addEventListener('change', () => this.relayout())
    this.reduced.addEventListener('change', () => this.goTo(this.reduced.matches ? 3 : 0, false))

    if (this.reduced.matches) {
      this.applyEnd(3)
      this.setCurrent(3)
      this.syncControls()
    }

    new IntersectionObserver(
      (entries) => {
        const visible = entries.some((e) => e.isIntersecting)
        if (visible && !this.started && !this.reduced.matches) {
          this.playFrom(0)
        } else if (!visible && this.playing && !this.paused) {
          this.pause()
        } else if (visible && this.playing && this.paused && !this.userPaused) {
          this.resume()
        }
      },
      { threshold: 0.35 },
    ).observe(this.canvas)
  }

  /* ------------------------------------------------------------ drawing */
  build() {
    const L = this.narrow.matches ? LAYOUTS.tall : LAYOUTS.wide
    this.L = L
    this.canvas.querySelector('svg')?.remove()
    const svg = el('svg', {
      viewBox: `0 0 ${L.vb[0]} ${L.vb[1]}`,
      role: 'img',
      'aria-label':
        "Diagram: spreadsheet rows travel through the recorded steps in Ritoko's Chrome window into a journal. Run 1 marks four rows done, then the process is killed after row 5 commits. On resume, row 5 is held for review and the remaining rows run. A second run of the same spreadsheet skips every finished row and keeps row 5 held.",
      class: this.narrow.matches ? 'is-tall' : 'is-wide',
    })
    this.svg = svg
    this.clock = el('g', {}, svg)

    // spreadsheet
    const s = L.sheet
    el('rect', { x: s.x, y: s.y, width: s.w, height: s.h, rx: 6, class: 'sv-frame sv-frame--sunk' }, svg)
    text(svg, s.x + 14, s.y + 22, 'orders.xlsx', 'sv-title')
    el('line', { x1: s.x, x2: s.x + s.w, y1: s.y + 34, y2: s.y + 34, class: 'sv-rule sv-rule--strong' }, svg)
    KEYS.forEach((_, i) => {
      const [x, y] = L.sheetPos(i)
      el('rect', { x: x - 31, y: y - 12, width: 62, height: 24, rx: 4, class: 'sv-ghost' }, svg)
      if (!this.narrow.matches)
        text(svg, s.x + 16, y, String(i + 1), 'sv-label sv-label--small', { 'dominant-baseline': 'central' })
    })

    // Chrome window with the recorded steps
    const c = L.chrome
    el('rect', { x: c.x, y: c.y, width: c.w, height: c.h, rx: 6, class: 'sv-frame' }, svg)
    el('line', { x1: c.x, x2: c.x + c.w, y1: c.y + 26, y2: c.y + 26, class: 'sv-rule sv-rule--strong' }, svg)
    for (let k = 0; k < 3; k++)
      el('circle', { cx: c.x + 14 + k * 12, cy: c.y + 13, r: 3.5, class: 'sv-ghost' }, svg)
    text(svg, c.x + 54, c.y + 17, "Ritoko's Chrome", 'sv-label sv-label--small')
    this.mode = text(svg, L.mode[0], L.mode[1], '', 'sv-mode', { 'text-anchor': 'middle' })
    const t = L.track
    el('line', { x1: t.x1, x2: t.x2, y1: t.y, y2: t.y, class: 'sv-track' }, svg)
    this.nodes = STEPS.map((name, i) => {
      const x = L.nodes[i]
      if (name === 'commit') {
        const g = el('g', { class: 'sv-gate' }, svg)
        el('line', { x1: x, x2: x, y1: t.y - 34, y2: t.y + 34 }, g)
        text(g, x, t.y - 42, 'commit', '')
        return g
      }
      const g = el('g', { class: 'sv-node' }, svg)
      el('circle', { cx: x, cy: t.y, r: 7 }, g)
      text(g, x, t.y + 30, name, '')
      return g
    })
    this.agent = el('g', { class: 'sv-agent' }, svg)
    el('circle', { cx: 0, cy: 0, r: 14 }, this.agent)
    this.crashFlash = el('rect', { x: c.x, y: c.y, width: c.w, height: c.h, rx: 6, class: 'sv-crash' }, svg)
    this.crashLabel = text(
      svg,
      L.crashLabel[0],
      L.crashLabel[1],
      'process killed after commit',
      'sv-crash-label',
      {
        'text-anchor': 'middle',
      },
    )

    // review tray
    const r = L.tray
    this.tray = el('g', {}, svg)
    el('rect', { x: r.x, y: r.y, width: r.w, height: r.h, rx: 6, class: 'sv-tray' }, this.tray)
    text(this.tray, L.trayLabel[0], L.trayLabel[1], 'held for review', 'sv-tray-label')

    // journal
    const j = L.journal
    el('rect', { x: j.x, y: j.y, width: j.w, height: j.h, rx: 6, class: 'sv-frame sv-frame--sunk' }, svg)
    text(svg, j.x + 14, j.y + 22, 'journal.sqlite', 'sv-title')
    el('line', { x1: j.x, x2: j.x + j.w, y1: j.y + 34, y2: j.y + 34, class: 'sv-rule sv-rule--strong' }, svg)
    this.runHeads = L.runHead.map(([x, y], k) => text(svg, x, y, `RUN ${k + 1}`, 'sv-runhead'))
    this.chips = [[], []]
    KEYS.forEach((key, i) => {
      const y = L.rowY(i)
      text(svg, L.keyX, y, key, 'sv-key', { 'dominant-baseline': 'central' })
      if (i < KEYS.length - 1)
        el(
          'line',
          {
            x1: j.x + 8,
            x2: j.x + j.w - 8,
            y1: y + (L.rowY(1) - L.rowY(0)) / 2,
            y2: y + (L.rowY(1) - L.rowY(0)) / 2,
            class: 'sv-rule',
          },
          svg,
        )
      for (const run of [0, 1]) {
        const g = el('g', { class: 'chp s-blank' }, svg)
        el('rect', { x: L.chipX[run] - L.chipW / 2, y: y - 11, width: L.chipW, height: 22, rx: 4 }, g)
        const label = text(g, L.chipX[run], y, '', '')
        this.chips[run][i] = { g, label }
      }
    })

    // tokens last, so they travel above everything
    this.tokens = KEYS.map((key) => {
      const g = el('g', { class: 'tok s-pending' }, svg)
      el('rect', { x: -30, y: -11, width: 60, height: 22, rx: 4 }, g)
      text(g, 0, 0, key, '')
      return { g, x: 0, y: 0 }
    })
    this.canvas.append(svg)
  }

  relayout() {
    this.cancel()
    this.build()
    this.applyEnd(this.done)
    this.syncControls()
  }

  /* ------------------------------------------------------------ state */
  place(tok, [x, y], opacity = 1) {
    tok.x = x
    tok.y = y
    tok.g.style.transform = `translate(${x}px, ${y}px)`
    tok.g.style.opacity = opacity
  }
  setTok(tok, state) {
    tok.g.setAttribute('class', `tok s-${state}`)
  }
  setChip(run, i, state) {
    const chip = this.chips[run][i]
    chip.g.setAttribute('class', `chp s-${state || 'blank'}`)
    chip.label.textContent = state || '—'
  }
  show(node, on) {
    node.style.opacity = on ? 1 : 0
  }
  setMode(value, kind) {
    this.mode.textContent = value
    this.mode.setAttribute('class', `sv-mode sv-mode--${kind}`)
  }
  activeRun(k) {
    this.runHeads.forEach((h, idx) => {
      h.classList.toggle('is-active', idx === k)
    })
  }

  /** Render the end state of a beat instantly (-1 = before recording). */
  applyEnd(beat) {
    const L = this.L
    this.done = beat
    this.nodes.forEach((n) => {
      this.show(n, beat >= 0)
      n.style.transform = ''
    })
    this.show(this.agent, false)
    this.show(this.crashLabel, beat === 2)
    this.crashFlash.style.opacity = 0
    this.show(this.tray, beat === 3)
    this.activeRun(beat === 3 ? 1 : beat >= 1 ? 0 : -1)
    if (beat < 0) this.setMode('', 'rec')
    else if (beat === 0) this.setMode(MODE[0][2], MODE[0][3])
    else this.setMode(MODE[beat][0], MODE[beat][1])

    this.tokens.forEach((tok, i) => {
      this.setTok(tok, 'pending')
      this.place(tok, L.sheetPos(i))
      this.setChip(0, i, beat >= 1 ? 'pending' : '')
      this.setChip(1, i, '')
      this.chips[0][i].g.style.transform = ''
      this.chips[1][i].g.style.transform = ''
    })
    if (beat >= 1)
      for (let i = 0; i < CRASHED; i++) {
        this.setChip(0, i, 'done')
        this.place(this.tokens[i], L.sheetPos(i), 0)
      }
    if (beat >= 2) {
      const tok = this.tokens[CRASHED]
      this.setTok(tok, 'running')
      this.place(tok, [L.nodes[4] + 36, L.track.y])
      this.setChip(0, CRASHED, 'running')
    }
    if (beat >= 3) {
      this.tokens.forEach((tok, i) => {
        if (i === CRASHED) return
        this.setChip(0, i, 'done')
        this.setChip(1, i, 'skipped')
        this.place(tok, L.sheetPos(i), 0)
      })
      this.setTok(this.tokens[CRASHED], 'review')
      this.place(this.tokens[CRASHED], L.trayPos)
      this.setChip(0, CRASHED, 'review')
      this.setChip(1, CRASHED, 'review')
      this.setMode('RUN 2 · SAME SPREADSHEET', 'play')
    }
    this.status.textContent = beat < 0 ? 'Journal: empty, nothing recorded yet' : CAPTION[beat]
  }

  /* ------------------------------------------------------------ timing */
  track(anim) {
    this.anims.add(anim)
    if (this.paused) anim.pause()
    anim.finished.then(
      () => this.anims.delete(anim),
      () => this.anims.delete(anim),
    )
    return anim
  }
  async run(node, keyframes, options) {
    const gen = this.gen
    const anim = this.track(node.animate(keyframes, { fill: 'forwards', ...options }))
    try {
      await anim.finished
    } catch {
      throw new Cancelled()
    }
    if (gen !== this.gen) throw new Cancelled()
    try {
      anim.commitStyles()
    } catch {}
    anim.cancel()
  }
  wait(ms) {
    return this.run(this.clock, [{ opacity: 1 }, { opacity: 1 }], { duration: ms })
  }
  async fade(node, to, duration = 260) {
    await this.run(node, [{ opacity: getComputedStyle(node).opacity }, { opacity: to }], { duration })
    node.style.opacity = to
  }
  /** Move a token through points at a constant speed (px per ms). */
  async travel(tok, points, speed = 0.42, easing = 'ease-in-out') {
    const path = [[tok.x, tok.y], ...points]
    const seg = path.slice(1).map((p, k) => Math.hypot(p[0] - path[k][0], p[1] - path[k][1]))
    const total = seg.reduce((a, b) => a + b, 0) || 1
    let acc = 0
    const frames = path.map((p, k) => {
      if (k > 0) acc += seg[k - 1]
      return { transform: `translate(${p[0]}px, ${p[1]}px)`, offset: acc / total }
    })
    await this.run(tok.g, frames, { duration: total / speed, easing })
    this.place(tok, path.at(-1), Number(getComputedStyle(tok.g).opacity))
  }
  async pop(node) {
    await this.run(
      node,
      [{ transform: 'scale(1)' }, { transform: 'scale(1.18)' }, { transform: 'scale(1)' }],
      {
        duration: 320,
        easing: 'ease-out',
      },
    )
    node.style.transform = ''
  }

  /* ------------------------------------------------------------ beats */
  async beatRecord() {
    const L = this.L
    this.setMode(MODE[0][0], MODE[0][1])
    this.agent.style.transform = `translate(${L.track.x1}px, ${L.track.y}px)`
    await this.fade(this.agent, 1, 200)
    for (const [i, node] of this.nodes.entries()) {
      await this.run(this.agent, [{ transform: `translate(${L.nodes[i]}px, ${L.track.y}px)` }], {
        duration: 420,
        easing: 'ease-in-out',
      })
      this.agent.style.transform = `translate(${L.nodes[i]}px, ${L.track.y}px)`
      node.style.transform = ''
      await Promise.all([
        this.fade(node, 1, 200),
        this.run(node, [{ transform: 'scale(0.4)' }, { transform: 'scale(1)' }], {
          duration: 260,
          easing: 'ease-out',
        }),
      ])
      node.style.transform = ''
      await this.wait(i === 4 ? 420 : 140)
    }
    await this.fade(this.agent, 0, 200)
    this.setMode(MODE[0][2], MODE[0][3])
    this.status.textContent = CAPTION[0]
  }

  async process(i, run, state, delay) {
    const L = this.L
    const tok = this.tokens[i]
    await this.wait(delay)
    this.setTok(tok, 'running')
    this.setChip(run, i, 'running')
    const chip = [L.chipX[run], L.rowY(i)]
    await this.travel(tok, [[L.track.x1, L.track.y], [L.track.x2, L.track.y], chip])
    await this.fade(tok.g, 0, 140)
    this.setChip(run, i, state)
    await this.pop(this.chips[run][i].g)
  }

  async beatReplay() {
    this.setMode(...MODE[1])
    this.activeRun(0)
    for (let i = 0; i < KEYS.length; i++) {
      this.setChip(0, i, 'pending')
      await this.wait(45)
    }
    this.status.textContent = 'Run 1: 8 rows frozen in the journal'
    await Promise.all([0, 1, 2, 3].map((i, k) => this.process(i, 0, 'done', k * 650)))
    this.status.textContent = CAPTION[1]
  }

  async beatCrash() {
    const L = this.L
    const tok = this.tokens[CRASHED]
    this.setTok(tok, 'running')
    this.setChip(0, CRASHED, 'running')
    await this.travel(
      tok,
      [
        [L.track.x1, L.track.y],
        [L.nodes[4] + 36, L.track.y],
      ],
      0.36,
      'ease-in',
    )
    this.setMode(...MODE[2])
    for (let k = 0; k < 2; k++) {
      await this.run(this.crashFlash, [{ opacity: 0 }, { opacity: 0.22 }, { opacity: 0 }], { duration: 260 })
    }
    await this.fade(this.crashLabel, 1, 200)
    this.status.textContent = CAPTION[2]
  }

  async beatRerun() {
    const L = this.L
    // resume: the committed row is held, the rest of the batch runs
    this.setMode(...MODE[3])
    this.activeRun(0)
    await this.fade(this.crashLabel, 0, 200)
    await this.fade(this.tray, 1, 260)
    const held = this.tokens[CRASHED]
    this.setTok(held, 'review')
    this.setChip(0, CRASHED, 'review')
    await this.travel(held, [L.trayPos], 0.3)
    await this.pop(this.chips[0][CRASHED].g)
    await Promise.all([5, 6, 7].map((i, k) => this.process(i, 0, 'done', k * 650)))
    this.status.textContent = 'Run 1 resumed: 7 done · 1 review'
    await this.wait(900)

    // later: the same spreadsheet again
    this.setMode('RUN 2 · SAME SPREADSHEET', 'play')
    this.activeRun(1)
    const again = KEYS.map((_, i) => i).filter((i) => i !== CRASHED)
    await Promise.all(
      again.map((i) => {
        const tok = this.tokens[i]
        this.setTok(tok, 'pending')
        this.place(tok, L.sheetPos(i), 0)
        return this.fade(tok.g, 1, 300)
      }),
    )
    for (let i = 0; i < KEYS.length; i++) {
      this.setChip(1, i, 'pending')
      await this.wait(40)
    }
    const skip = again.map(async (i, k) => {
      const tok = this.tokens[i]
      await this.wait(k * 170)
      this.setTok(tok, 'skipped')
      const to = [L.chipX[1], L.rowY(i)]
      await this.travel(tok, [...L.skipLane([tok.x, tok.y], to), to], 0.9)
      await this.fade(tok.g, 0, 120)
      this.setChip(1, i, 'skipped')
    })
    const hold = (async () => {
      await this.wait(400)
      this.setChip(1, CRASHED, 'review')
      await this.pop(this.chips[1][CRASHED].g)
    })()
    await Promise.all([...skip, hold])
    this.status.textContent = CAPTION[3]
  }

  /* ------------------------------------------------------------ control */
  setCurrent(beat) {
    this.current = beat
    this.beatButtons.forEach((b, i) => {
      if (i === beat) b.setAttribute('aria-current', 'step')
      else b.removeAttribute('aria-current')
      b.closest('li')?.classList.toggle('is-current', i === beat)
    })
    const text = this.beatButtons[beat]?.closest('li')?.querySelector('.beat-text')
    if (this.caption && text) this.caption.innerHTML = text.innerHTML
  }

  cancel() {
    this.gen++
    for (const a of this.anims) a.cancel()
    this.anims.clear()
    this.playing = false
    this.paused = false
  }

  async playFrom(beat) {
    this.started = true
    this.cancel()
    const gen = this.gen
    this.applyEnd(beat - 1)
    this.playing = true
    this.userPaused = false
    this.syncControls()
    const beats = [this.beatRecord, this.beatReplay, this.beatCrash, this.beatRerun]
    try {
      for (let b = beat; b < beats.length; b++) {
        this.setCurrent(b)
        await beats[b].call(this)
        this.done = b
        if (b < beats.length - 1) await this.wait(1100)
      }
    } catch (e) {
      if (!(e instanceof Cancelled)) throw e
      return
    }
    if (gen === this.gen) {
      this.playing = false
      this.applyEnd(3)
      this.syncControls()
    }
  }

  goTo(beat, focusStage = false) {
    if (this.reduced.matches) {
      this.cancel()
      this.applyEnd(beat)
      this.setCurrent(beat)
      this.syncControls()
      return
    }
    this.playFrom(beat)
    if (focusStage) this.canvas.scrollIntoView({ block: 'nearest' })
  }

  pause() {
    this.paused = true
    for (const a of this.anims) a.pause()
    this.syncControls()
  }
  resume() {
    this.paused = false
    for (const a of this.anims) a.play()
    this.syncControls()
  }
  togglePause() {
    if (!this.playing) return this.playFrom(0)
    if (this.paused) {
      this.userPaused = false
      this.resume()
    } else {
      this.userPaused = true
      this.pause()
    }
  }

  syncControls() {
    const reduced = this.reduced.matches
    this.playBtn.hidden = reduced
    this.replayBtn.hidden = reduced
    const label = !this.playing ? 'Play' : this.paused ? 'Resume' : 'Pause'
    this.playBtn.textContent = label
    this.playBtn.setAttribute('aria-label', `${label} animation`)
  }
}
