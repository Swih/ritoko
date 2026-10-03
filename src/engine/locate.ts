import type { Frame, FrameLocator, Locator, Page } from 'playwright-core'
import type { Selector, Target } from './schema.ts'

type Role = Parameters<Page['getByRole']>[0]

export function toLocator(root: Page | FrameLocator, s: Selector): Locator {
  switch (s.by) {
    case 'role':
      return root.getByRole(s.role as Role, { name: s.name, exact: s.exact ?? true })
    case 'label':
      return root.getByLabel(s.text, { exact: s.exact ?? true })
    case 'placeholder':
      return root.getByPlaceholder(s.text, { exact: s.exact ?? true })
    case 'text':
      return root.getByText(s.text, { exact: s.exact ?? true })
    case 'testid':
      return root.getByTestId(s.id)
    case 'css':
      return root.locator(s.css)
    case 'xpath':
      return root.locator(`xpath=${s.xpath}`)
  }
}

/** Where a target's selectors apply: the page, or the iframe it names. */
const within = (page: Page, frame?: string) => (frame ? page.frameLocator(frame) : page)

export class SelectorError extends Error {
  readonly target: Target

  constructor(target: Target) {
    super(`No selector matched exactly one element: ${describe(target.primary)}`)
    this.target = target
  }
}

export function describe(s: Selector): string {
  const { by, ...rest } = s
  return `${by}(${JSON.stringify(rest)})`
}

/**
 * Tries the primary selector, then each fallback, and returns the first that matches exactly one element.
 * `start` lets the runner begin with the selector that worked last time.
 */
export async function resolve(
  page: Page,
  target: Target,
  {
    timeout = 10_000,
    state = 'visible',
    start = 0,
  }: { timeout?: number; state?: 'visible' | 'attached'; start?: number } = {},
): Promise<{ locator: Locator; index: number }> {
  const all = [target.primary, ...target.fallbacks]
  const root = within(page, target.frame)
  const order = [start, ...all.keys()].filter((i, pos, arr) => i < all.length && arr.indexOf(i) === pos)
  for (const [attempt, index] of order.entries()) {
    const locator = toLocator(root, all[index] as Selector)
    try {
      await locator.first().waitFor({ state, timeout: attempt === 0 ? timeout : 1_500 })
    } catch {
      continue
    }
    if ((await locator.count()) === 1) return { locator, index }
  }
  throw new SelectorError(target)
}

/**
 * Proposes robust selectors for the element behind an aria ref (from an "ai" snapshot), best first.
 * Every candidate is checked to match exactly that element, inside its iframe when it has one (`frame`).
 * When nothing robust exists, the only selector is a positional CSS path, flagged `fragile`.
 */
export async function candidates(
  page: Page,
  ref: string,
): Promise<{ frame?: string; selectors: Selector[]; fragile?: true }> {
  const handle = await page
    .locator(`aria-ref=${ref}`)
    .elementHandle({ timeout: 2_000 })
    .catch(() => {
      throw new Error(`Unknown ref ${ref}: take a new snapshot`)
    })
  const frame = await frameSelector(await handle.ownerFrame())
  const root = within(page, frame)

  const facts = await handle.evaluate((el: Element) => {
    const attr = (n: string) => el.getAttribute(n) ?? undefined
    const labels = 'labels' in el && el.labels ? [...(el.labels as NodeListOf<HTMLLabelElement>)] : []
    const prev = el.previousElementSibling
    const near =
      prev?.tagName === 'LABEL' ? prev : (el.parentElement?.querySelector(':scope > label') ?? undefined)
    // Nearest non-blank sibling text, e.g. "<input type=checkbox> Remember me".
    const adjacent = (step: 'previousSibling' | 'nextSibling') => {
      for (let node = el[step]; node; node = node[step]) {
        const text = node.textContent?.replace(/\s+/g, ' ').trim()
        if (text) return text.length <= 80 ? text : undefined
      }
      return undefined
    }
    const ancestors: [string, string][] = []
    for (let up = el.parentElement; up; up = up.parentElement)
      for (const name of ['data-testid', 'data-test', 'data-qa', 'id', 'role']) {
        const value = up.getAttribute(name)
        if (value) ancestors.push([name, value])
      }
    const path: string[] = []
    for (let node: Element | null = el; node; node = node.parentElement) {
      const current = node
      if (current.id && document.querySelectorAll(`#${CSS.escape(current.id)}`).length === 1) {
        path.unshift(`#${CSS.escape(current.id)}`)
        break
      }
      const tag = current.tagName.toLowerCase()
      const same = [...(current.parentElement?.children ?? [])].filter((c) => c.tagName === current.tagName)
      path.unshift(same.length > 1 ? `${tag}:nth-of-type(${same.indexOf(current) + 1})` : tag)
    }
    return {
      tag: el.tagName.toLowerCase(),
      type: attr('type'),
      id: el.id || undefined,
      name: attr('name'),
      testid: attr('data-testid') ?? attr('data-test') ?? attr('data-qa'),
      placeholder: attr('placeholder'),
      label: labels[0]?.textContent?.trim() || undefined,
      nearLabel: near?.textContent?.trim() || undefined,
      text: el instanceof HTMLElement ? el.innerText.trim().slice(0, 80) || undefined : undefined,
      textBefore: adjacent('previousSibling'),
      textAfter: adjacent('nextSibling'),
      ancestors,
      path: path.join(' > '),
    }
  })
  // Role and accessible name come from the page snapshot: refs stay stable across page snapshots,
  // whereas an element-level snapshot would reset them.
  const line =
    (await page.ariaSnapshot({ mode: 'ai' })).split('\n').find((l) => l.includes(`[ref=${ref}]`)) ?? ''
  const role = line.match(/- ([\w-]+)(?: "((?:[^"\\]|\\.)*)")?/)
  const verified = async (proposals: Selector[]) => {
    const unique: Selector[] = []
    for (const s of proposals) {
      const loc = toLocator(root, s)
      if ((await loc.count()) !== 1) continue
      if (await loc.evaluate((el, target) => el === target, handle)) unique.push(s)
    }
    return unique
  }

  const proposals: Selector[] = []
  if (role?.[1] && role[2]) proposals.push({ by: 'role', role: role[1], name: JSON.parse(`"${role[2]}"`) })
  if (facts.label) proposals.push({ by: 'label', text: facts.label })
  if (facts.placeholder) proposals.push({ by: 'placeholder', text: facts.placeholder })
  if (facts.testid) proposals.push({ by: 'testid', id: facts.testid })
  if (facts.nearLabel)
    proposals.push({
      by: 'xpath',
      xpath: `//label[normalize-space()=${xpathString(facts.nearLabel)}]/following::${facts.tag}[1]`,
    })
  if (facts.text && ['a', 'button'].includes(facts.tag)) proposals.push({ by: 'text', text: facts.text })
  let selectors = await verified(proposals)

  // Unlabeled elements: anchor on adjacent text, then attributes often generated per page load,
  // then the position among similar elements in a uniquely identified container.
  if (!selectors.length) {
    const tag = `${facts.tag}${facts.type ? `[@type=${xpathString(facts.type)}]` : ''}`
    const sibling = (axis: string, text: string) =>
      `//${tag}[${axis}::node()[normalize-space()][1][normalize-space()=${xpathString(text)}]]`
    const fallbacks: Selector[] = []
    if (facts.textAfter) fallbacks.push({ by: 'xpath', xpath: sibling('following-sibling', facts.textAfter) })
    if (facts.textBefore)
      fallbacks.push({ by: 'xpath', xpath: sibling('preceding-sibling', facts.textBefore) })
    if (facts.name) fallbacks.push({ by: 'css', css: `${facts.tag}[name=${JSON.stringify(facts.name)}]` })
    if (facts.id) fallbacks.push({ by: 'css', css: `${facts.tag}[id=${JSON.stringify(facts.id)}]` })
    for (const [name, value] of facts.ancestors) {
      const container = `//*[@${name}=${xpathString(value)}]`
      if ((await toLocator(root, { by: 'xpath', xpath: container }).count()) !== 1) continue
      const similar = `${container}//${tag}`
      const index = await toLocator(root, { by: 'xpath', xpath: similar }).evaluateAll(
        (elements, target) => elements.indexOf(target as HTMLElement),
        handle,
      )
      fallbacks.push({ by: 'xpath', xpath: `(${similar})[${index + 1}]` })
      break
    }
    selectors = await verified(fallbacks)
  }
  const fragile = selectors.length ? [] : await verified([{ by: 'css', css: facts.path }])
  await handle.dispose()
  return {
    ...(frame ? { frame } : {}),
    ...(fragile.length ? { selectors: fragile, fragile: true } : { selectors }),
  }
}

/** Selector chain of the iframe holding `frame`, from the page; undefined for the main frame. */
async function frameSelector(frame: Frame | null): Promise<string | undefined> {
  const parent = frame?.parentFrame()
  if (!frame || !parent) return undefined
  const element = await frame.frameElement()
  const own = await element.evaluate((el: Element) => {
    const tag = el.tagName.toLowerCase()
    for (const name of ['id', 'name', 'title']) {
      const css = `${tag}[${name}=${JSON.stringify(el.getAttribute(name))}]`
      if (el.getAttribute(name) && document.querySelectorAll(css).length === 1) return css
    }
    return `${tag} >> nth=${[...document.querySelectorAll(tag)].indexOf(el)}`
  })
  await element.dispose()
  const outer = await frameSelector(parent)
  return outer ? `${outer} >> internal:control=enter-frame >> ${own}` : own
}

function xpathString(text: string): string {
  if (!text.includes("'")) return `'${text}'`
  if (!text.includes('"')) return `"${text}"`
  return `concat(${text
    .split("'")
    .map((part) => `'${part}'`)
    .join(`, "'", `)})`
}
