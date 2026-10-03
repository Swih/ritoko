/**
 * In-page runtime of host mode: Ritoko compiles a slice of an item into this function's input, and the agent
 * runs it in its own integrated browser (Claude or Codex app), which no external process can drive.
 * It must stay self-contained: it is serialized with String() and evaluated in the page.
 */
export type HostSelector = { by: string; [key: string]: unknown }
export type HostTarget = { primary: HostSelector; fallbacks: HostSelector[]; frame?: string }
export type HostStep = {
  index: number
  id: string
  do: string
  target?: HostTarget
  value?: string
  checked?: boolean
  key?: string
  text?: string
  url?: string
  ms?: number
  timeoutMs: number
  onDialog?: 'accept' | 'dismiss'
  dialogText?: string
}
export type HostProgram = { steps: HostStep[]; budgetMs: number; token: string; carry?: string }
export type HostResult =
  | { ok: true; next: number; staged?: { bytes: number; type: string } }
  | { ok: true; pending: number }
  | { ok: false; at: number; error: string; selector: boolean }

export async function hostProgram(program: HostProgram): Promise<HostResult> {
  const started = Date.now()
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
    const root = frame ? frame.contentDocument : document
    if (!root) return undefined
    for (const s of [t.primary, ...t.fallbacks]) {
      const found = query(root, s).filter(visible)
      if (found.length === 1) return found[0] as HTMLElement
    }
    return undefined
  }
  class Miss extends Error {}
  const until = async <T>(fn: () => T | undefined, ms: number, what: string): Promise<T> => {
    const end = Math.min(Date.now() + ms, started + program.budgetMs)
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
  const carried = async () => {
    const data = program.carry ? decodeURIComponent(location.hash.slice(program.carry.length + 2)) : ''
    if (!data.startsWith('data:'))
      throw new Error('the file to upload did not reach the page (open the step URL first)')
    history.replaceState(null, '', location.pathname + location.search)
    const blob = await (await fetch(data)).blob()
    return new File([blob], 'upload', { type: blob.type })
  }

  for (const step of program.steps) {
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
      switch (step.do) {
        case 'fill':
          setValue(el as HTMLElement, step.value ?? '')
          break
        case 'click':
          await until(
            () => !(el as HTMLButtonElement).disabled || undefined,
            step.timeoutMs,
            'the element stays disabled',
          )
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
          const file = await carried()
          const dt = new DataTransfer()
          dt.items.add(file)
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
          if (!target) await sleep(Math.min(step.ms ?? 0, program.budgetMs))
          break
        case 'expect':
          if (step.text)
            await until(
              () => document.body.innerText.includes(step.text as string),
              step.timeoutMs,
              `text "${step.text}" not found`,
            )
          if (step.value !== undefined && (el as HTMLInputElement).value !== step.value)
            throw new Error(`value is "${(el as HTMLInputElement).value}", expected "${step.value}"`)
          if (step.url && !location.href.includes(step.url)) throw new Error(`url is ${location.href}`)
          break
        case 'download': {
          // Capture what the click fetches (largest media response), and abort the site's own save: the app
          // would otherwise open a native "Save as" dialog. The file then leaves through the clipboard.
          const w = window as unknown as { fetch: typeof fetch; __ritokoFetch?: typeof fetch }
          w.__ritokoFetch ??= w.fetch
          const original = w.__ritokoFetch
          const caught: Blob[] = []
          w.fetch = async function (this: unknown, ...args: Parameters<typeof fetch>) {
            const res = await original.apply(this, args)
            const type = res.headers.get('content-type') ?? ''
            if (/^(image|video|audio)\/|octet-stream/.test(type)) {
              const blob = await res.clone().blob()
              if (blob.size > 20_000) {
                caught.push(blob)
                throw new TypeError('ritoko: captured')
              }
            }
            return res
          } as typeof fetch
          try {
            el?.click()
            await until(() => caught.length > 0 || undefined, step.timeoutMs, 'the click produced no file')
            await sleep(1500)
          } finally {
            w.fetch = original
          }
          const blob = caught.sort((a, b) => b.size - a.size)[0] as Blob
          const data = await new Promise<string>((ok) => {
            const reader = new FileReader()
            reader.onload = () => ok(reader.result as string)
            reader.readAsDataURL(blob)
          })
          document.getElementById('ritoko-handoff')?.remove()
          const button = document.createElement('button')
          button.id = 'ritoko-handoff'
          button.textContent = 'Ritoko · transmettre'
          button.style.cssText =
            'position:fixed;right:24px;bottom:120px;z-index:2147483647;background:#b3301a;color:#fff;font:600 14px system-ui;padding:10px 16px;border:0;border-radius:8px'
          button.onclick = () => {
            const area = document.createElement('textarea')
            area.value = `RITOKO|${program.token}|${data}`
            area.style.cssText = 'position:fixed;left:-9999px'
            document.body.append(area)
            area.select()
            const copied = document.execCommand('copy')
            area.remove()
            button.textContent = copied ? 'Ritoko · transmis' : 'Ritoko · échec'
          }
          document.body.append(button)
          return { ok: true, next: step.index + 1, staged: { bytes: blob.size, type: blob.type } }
        }
      }
    } catch (error) {
      const miss = error instanceof Miss
      // A wait that outlives this call's budget continues in the next call.
      if (miss && Date.now() >= started + program.budgetMs) return { ok: true, pending: step.index }
      return { ok: false, at: step.index, error: (error as Error).message, selector: miss }
    }
  }
  const last = program.steps.at(-1)
  return { ok: true, next: last ? last.index + 1 : 0 }
}
