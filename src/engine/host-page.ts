/**
 * In-page runtime of host mode: Ritoko compiles an item into plans, and the agent runs them in its own
 * integrated browser (Claude or Codex app), which no external process can drive. The runtime function must
 * stay self-contained (it is serialized with String() and evaluated in the page) and free of repeated spaces
 * inside string literals (compact() squeezes them).
 */
export type HostSelector = { by: string; [key: string]: unknown }
export type HostTarget = { primary: HostSelector; fallbacks: HostSelector[]; frame?: string }
export type HostStep = {
  index: number
  id: string
  do: string
  commit?: boolean
  target?: HostTarget
  value?: string
  checked?: boolean
  key?: string
  text?: string
  url?: string
  ms?: number
  fileName?: string
  timeoutMs: number
  onDialog?: 'accept' | 'dismiss'
  dialogText?: string
}
/** A segment of an item (the steps between two navigations), plus how this call should run it. */
export type HostProgram = {
  steps: HostStep[]
  /** Hand-off token of the item: a downloaded file travels as `<token>.<step index>`. */
  token: string
  /** First step to run: the page keeps the whole segment's plan, a later call resumes in the middle. */
  from?: number
  /** A wait that outlives this many ms returns `pending` and continues in the next call. */
  budgetMs: number
  /** Once the commit step ran, the call lasts this long at most: slow generations overlap across tabs. */
  settleMs?: number
  waitedMs?: number
  /** Cursor after a navigation-only segment, with no page actions. */
  next?: number
}
/** `sent`: index of the last step whose action was dispatched in this call (-1: none). */
export type HostResult =
  | { ok: true; next: number; sent: number; staged?: { bytes: number; type: string } }
  | { ok: true; pending: number; sent: number; waited: number }
  | { ok: false; at: number; error: string; selector: boolean; sent: number }
  | { ok: false; missing: true }

export async function hostProgram(program: HostProgram): Promise<HostResult> {
  const started = Date.now()
  let deadline = started + program.budgetMs
  let sent = -1
  let staged: string | undefined
  const dialogs = { confirm: window.confirm, alert: window.alert, prompt: window.prompt }
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
  const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim()
  const visible = (el: Element) => el.getClientRects().length > 0
  const implicit: Record<string, string> = {
    button: 'button,input[type=button],input[type=submit],input[type=reset],[role=button]',
    link: 'a[href],[role=link]',
    textbox:
      'input:not([type]),input[type=text],input[type=email],input[type=tel],input[type=url],input[type=search],input[type=password],input[type=number],textarea,[contenteditable=true],[role=textbox]',
    checkbox: 'input[type=checkbox],[role=checkbox]',
    radio: 'input[type=radio],[role=radio]',
    combobox: 'select,[role=combobox]',
    heading: 'h1,h2,h3,h4,h5,h6,[role=heading]',
    img: 'img,[role=img]',
  }
  const name = (el: Element) => {
    const labelled = el.getAttribute('aria-labelledby')
    const labels = 'labels' in el ? [...((el as HTMLInputElement).labels ?? [])] : []
    return norm(
      el.getAttribute('aria-label') ||
        (labelled
          ? labelled
              .split(' ')
              .map((id) => document.getElementById(id)?.textContent)
              .join(' ')
          : '') ||
        labels.map((l) => l.textContent).join(' ') ||
        el.getAttribute('alt') ||
        el.getAttribute('title') ||
        (el as HTMLElement).innerText ||
        el.getAttribute('placeholder') ||
        (el as HTMLInputElement).value,
    )
  }
  const same = (a: string, b: string, exact: unknown) =>
    exact === false ? a.toLowerCase().includes(b.toLowerCase()) : a === b
  const query = (root: Document, s: HostSelector): Element[] => {
    const all = (css: string) => [...root.querySelectorAll(css)]
    switch (s.by) {
      case 'role':
        return all(implicit[s.role as string] ?? `[role=${s.role}]`).filter(
          (el) => s.name === undefined || same(name(el), norm(s.name as string), s.exact),
        )
      case 'label':
        return all('input,textarea,select,[contenteditable=true],[role=textbox]').filter((el) =>
          same(name(el), norm(s.text as string), s.exact),
        )
      case 'placeholder':
        return all('[placeholder]').filter((el) =>
          same(norm(el.getAttribute('placeholder')), norm(s.text as string), s.exact),
        )
      case 'text':
        return all('body *').filter(
          (el) =>
            same(norm((el as HTMLElement).innerText), norm(s.text as string), s.exact) &&
            ![...el.children].some((c) =>
              same(norm((c as HTMLElement).innerText), norm(s.text as string), s.exact),
            ),
        )
      case 'testid':
        return all(`[data-testid="${CSS.escape(s.id as string)}"]`)
      case 'css':
        return all(s.css as string)
      case 'xpath': {
        const r = root.evaluate(s.xpath as string, root, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null)
        return Array.from({ length: r.snapshotLength }, (_, i) => r.snapshotItem(i) as Element)
      }
      default:
        return []
    }
  }
  const locate = (t: HostTarget) => {
    const frame = t.frame ? (document.querySelector(t.frame) as HTMLIFrameElement | null) : null
    const root = t.frame ? frame?.contentDocument : document
    if (!root) return undefined
    for (const s of [t.primary, ...t.fallbacks]) {
      const found = query(root, s).filter(visible)
      if (found.length === 1) return found[0] as HTMLElement
    }
    return undefined
  }
  class Miss extends Error {}
  const until = async <T>(fn: () => T | undefined, ms: number, what: string): Promise<T> => {
    const end = Math.min(Date.now() + ms, deadline)
    for (;;) {
      const v = fn()
      if (v) return v
      if (Date.now() > end) throw new Miss(what)
      await sleep(100)
    }
  }
  const setValue = (el: HTMLElement, value: string) => {
    if (el.isContentEditable) {
      el.focus()
      document.execCommand('selectAll', false)
      document.execCommand('insertText', false, value)
      return
    }
    const proto = Object.getPrototypeOf(el)
    Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
  }
  // Files arrive as data URLs from the boot snippet (in memory, or in sessionStorage when they fit).
  const carried = (index: number) => {
    const memory = (globalThis as { __ritokoFiles?: Record<string, string> }).__ritokoFiles
    const data: string | undefined = (memory ?? JSON.parse(sessionStorage['ritoko:files'] ?? '{}'))[index]
    if (!data?.startsWith('data:'))
      throw new Error('the file to upload did not reach the page (open the step URL first)')
    const bytes = Uint8Array.from(atob(data.slice(data.indexOf(',') + 1)), (c) => c.charCodeAt(0))
    return new File([bytes], program.steps.find((s) => s.index === index)?.fileName ?? 'upload', {
      type: data.slice(5, data.indexOf(';')),
    })
  }
  // A click anywhere on this button is safe: it covers the page, and hands over the staged file if any.
  const shield = () => {
    const button = document.createElement('button')
    button.id = 'ritoko-shield'
    button.textContent = staged ? 'Ritoko · transmettre' : 'Ritoko'
    button.style.cssText =
      'position:fixed;inset:0;z-index:2147483647;width:100vw;height:100vh;margin:0;border:0;border-radius:0;background:rgba(179,48,26,.15);color:#fff;font:600 28px system-ui;cursor:pointer'
    if (staged)
      button.onclick = () => {
        const area = document.createElement('textarea')
        area.value = staged as string
        area.style.cssText = 'position:fixed;left:-9999px'
        document.body.append(area)
        area.select()
        const copied = document.execCommand('copy')
        area.remove()
        button.textContent = copied ? 'Ritoko · transmis' : 'Ritoko · échec'
      }
    ;(document.body ?? document.documentElement).append(button)
  }

  document.getElementById('ritoko-shield')?.remove()
  try {
    for (const step of program.steps) {
      if (step.index < (program.from ?? 0)) continue
      const began = Date.now()
      try {
        if (step.onDialog) {
          const yes = step.onDialog === 'accept'
          window.confirm = () => yes
          window.alert = () => {}
          window.prompt = () => (yes ? (step.dialogText ?? '') : null)
        }
        const target = step.target
        const el = target
          ? await until(
              () => locate(target),
              step.timeoutMs,
              `no element matches ${JSON.stringify(target.primary)}`,
            )
          : undefined
        if (step.do === 'click')
          await until(
            () => !(el as HTMLButtonElement).disabled || undefined,
            step.timeoutMs,
            'the element stays disabled',
          )
        // A download clicks once and must see its file: with little budget left it waits for the next call.
        if (step.do === 'download' && deadline - Date.now() < 10_000)
          return { ok: true, pending: step.index, sent, waited: Date.now() - began }
        const file = step.do === 'upload' ? carried(step.index) : undefined
        if (step.do !== 'expect' && step.do !== 'wait') sent = step.index
        switch (step.do) {
          case 'fill':
            setValue(el as HTMLElement, step.value ?? '')
            break
          case 'click':
            el?.click()
            break
          case 'hover':
            el?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
            break
          case 'check':
            if ((el as HTMLInputElement).checked !== (step.checked ?? true)) el?.click()
            break
          case 'select': {
            const select = el as HTMLSelectElement
            const option = [...select.options].find(
              (o) => norm(o.text) === step.value || o.value === step.value,
            )
            if (!option) throw new Error(`no option "${step.value}"`)
            setValue(select, option.value)
            break
          }
          case 'press':
            ;(el ?? document.activeElement)?.dispatchEvent(
              new KeyboardEvent('keydown', { key: step.key, bubbles: true }),
            )
            break
          case 'upload': {
            const dt = new DataTransfer()
            dt.items.add(file as File)
            if (el instanceof HTMLInputElement && el.type === 'file') {
              el.files = dt.files
              el.dispatchEvent(new Event('change', { bubbles: true }))
            } else {
              el?.focus()
              el?.dispatchEvent(
                new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }),
              )
            }
            await sleep(1500)
            break
          }
          case 'wait':
            if (!target) {
              const remaining =
                (step.ms ?? 1000) - (step.index === program.from ? (program.waitedMs ?? 0) : 0)
              const allowed = Math.max(0, deadline - Date.now())
              await sleep(Math.min(Math.max(0, remaining), allowed))
              if (remaining > allowed)
                return { ok: true, pending: step.index, sent, waited: Date.now() - began }
            }
            break
          case 'expect':
            if (step.text)
              await until(
                () =>
                  (target ? el?.innerText : document.body.innerText)?.includes(step.text as string) ||
                  undefined,
                step.timeoutMs,
                `text "${step.text}" not found`,
              )
            if (step.value !== undefined && (el as HTMLInputElement).value !== step.value)
              throw new Error(`value is "${(el as HTMLInputElement).value}", expected "${step.value}"`)
            if (step.url && !location.href.includes(step.url)) throw new Error(`url is ${location.href}`)
            break
          case 'download': {
            // Capture fetched files and direct download links. Stop the native save behind the shield.
            const w = window as unknown as { fetch: typeof fetch; __ritokoFetch?: typeof fetch }
            w.__ritokoFetch ??= w.fetch
            const original = w.__ritokoFetch
            const caught: Blob[] = []
            let captureError: Error | undefined
            const anchorClick = HTMLAnchorElement.prototype.click
            const capture = (blob: Blob) => {
              if (blob.size > 200 * 1024 * 1024) captureError = new Error('the download exceeds 200 MB')
              else caught.push(blob)
            }
            const fetchLink = (href: string) => {
              original(href, { credentials: 'include' })
                .then(async (response) => {
                  if (!response.ok) throw new Error(`download failed: HTTP ${response.status}`)
                  capture(await response.blob())
                })
                .catch((error) => {
                  captureError = error as Error
                })
            }
            const link = (event: Event) => {
              const a = (event.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null
              if (!a) return
              event.preventDefault()
              fetchLink(a.href)
            }
            HTMLAnchorElement.prototype.click = function () {
              fetchLink(this.href)
            }
            document.addEventListener('click', link, true)
            w.fetch = async function (this: unknown, ...args: Parameters<typeof fetch>) {
              const res = await original.apply(this, args)
              const type = res.headers.get('content-type') ?? ''
              if (
                /^(image|video|audio)\/|octet-stream|application\/pdf|text\/csv/.test(type) ||
                res.headers.has('content-disposition')
              ) {
                const blob = await res.clone().blob()
                capture(blob)
              }
              return res
            } as typeof fetch
            try {
              el?.click()
              // The click is done: waiting for its file is not bound by the call's budget (no second click).
              const end = Date.now() + Math.min(step.timeoutMs, 60_000)
              while (!caught.length) {
                if (captureError) throw captureError
                if (Date.now() > end) throw new Error('the click produced no file')
                await sleep(100)
              }
              await sleep(1500)
            } finally {
              w.fetch = original
              document.removeEventListener('click', link, true)
              HTMLAnchorElement.prototype.click = anchorClick
            }
            const blob = caught.sort((a, b) => b.size - a.size)[0] as Blob
            const data = await new Promise<string>((ok, fail) => {
              const reader = new FileReader()
              reader.onload = () => ok(reader.result as string)
              reader.onerror = () => fail(reader.error ?? new Error('could not read the download'))
              reader.readAsDataURL(blob)
            })
            staged = `RITOKO|${program.token}.${step.index}|${data}`
            return {
              ok: true,
              next: step.index + 1,
              sent,
              staged: { bytes: blob.size, type: blob.type || 'application/octet-stream' },
            }
          }
        }
        if (step.commit && program.settleMs) deadline = Math.min(deadline, Date.now() + program.settleMs)
      } catch (error) {
        const miss = error instanceof Miss
        // A wait that outlives this call's budget continues in the next call.
        if (miss && Date.now() >= deadline)
          return { ok: true, pending: step.index, sent, waited: Date.now() - began }
        return { ok: false, at: step.index, error: (error as Error).message, selector: miss, sent }
      }
    }
    const last = program.steps.at(-1)
    return { ok: true, next: last ? last.index + 1 : (program.next ?? 0), sent }
  } finally {
    Object.assign(window, dialogs)
    shield()
  }
}

/** The runtime as an expression, without the indentation and comments that only cost tokens. */
const compact = (source: string) =>
  source
    .split('\n')
    .map((line) => line.trim().replace(/ {2,}/g, ' '))
    .filter((line) => line && !line.startsWith('//'))
    .join('\n')
export const runtimeSource = `(${compact(String(hostProgram))})`

/**
 * What the agent runs in the page, synchronously first (the page's CSP forbids eval after an await): take the
 * runtime and the plan from the #ritoko= fragment of the carry URL, or from sessionStorage (same tab, same
 * origin: a reload or a post keeps them), and run the plan from step `from`. Without either, the page is
 * covered by a bare shield (a click that follows in the same batch is harmless) and Ritoko sends the long form.
 */
const BOOT = `((o,t,w)=>{const g=self,[u,f]=location.href.split('#ritoko=');let d,s=g.__ritokoRun;try{d=JSON.parse(decodeURIComponent(f))}catch{}if(d){g.__ritokoFiles=d.files;s=g.__ritokoRun={r:d.runtime,p:d.plan};try{sessionStorage['ritoko:run']=JSON.stringify(s);sessionStorage['ritoko:files']=JSON.stringify(d.files)}catch{}history.replaceState(null,'',u)}if(!s)try{s=JSON.parse(sessionStorage['ritoko:run'])}catch{}if(!s||(t&&s.p.token!==t)){document.getElementById('ritoko-shield')?.remove();const b=document.createElement('button');b.id='ritoko-shield';b.style.cssText='position:fixed;inset:0;z-index:2147483647;width:100vw;height:100vh';document.body.append(b);return{ok:false,missing:true}}return(g.__ritokoHost??=(0,eval)(s.r))({...s.p,from:o,waitedMs:w})})`
export const bootCode = (from: number, token?: string, waitedMs = 0) =>
  `${BOOT}(${from},${JSON.stringify(token ?? '')},${waitedMs})`

/** The long form: runtime and the plan itself in the code, for a page the carry did not reach. */
export const inlineCode = (program: HostProgram) =>
  `(globalThis.__ritokoHost ??= ${runtimeSource})(${JSON.stringify(program)})`
