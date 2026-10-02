import type { Locator, Page } from 'playwright-core'
import type { Selector, Target } from './schema.ts'

type Role = Parameters<Page['getByRole']>[0]

export function toLocator(page: Page, s: Selector): Locator {
  switch (s.by) {
    case 'role':
      return page.getByRole(s.role as Role, { name: s.name, exact: s.exact ?? true })
    case 'label':
      return page.getByLabel(s.text, { exact: s.exact ?? true })
    case 'placeholder':
      return page.getByPlaceholder(s.text, { exact: s.exact ?? true })
    case 'text':
      return page.getByText(s.text, { exact: s.exact ?? true })
    case 'testid':
      return page.getByTestId(s.id)
    case 'css':
      return page.locator(s.css)
    case 'xpath':
      return page.locator(`xpath=${s.xpath}`)
  }
}

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
  const order = [start, ...all.keys()].filter((i, pos, arr) => i < all.length && arr.indexOf(i) === pos)
  for (const [attempt, index] of order.entries()) {
    const locator = toLocator(page, all[index] as Selector)
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
 * Every candidate is checked to match exactly that element.
 */
export async function candidates(page: Page, ref: string): Promise<Selector[]> {
  const handle = await page
    .locator(`aria-ref=${ref}`)
    .elementHandle({ timeout: 2_000 })
    .catch(() => {
      throw new Error(`Unknown ref ${ref}: take a new snapshot`)
    })

  const facts = await handle.evaluate((el: Element) => {
    const attr = (n: string) => el.getAttribute(n) ?? undefined
    const labels = 'labels' in el && el.labels ? [...(el.labels as NodeListOf<HTMLLabelElement>)] : []
    const prev = el.previousElementSibling
    const near =
      prev?.tagName === 'LABEL' ? prev : (el.parentElement?.querySelector(':scope > label') ?? undefined)
    return {
      tag: el.tagName.toLowerCase(),
      id: el.id || undefined,
      name: attr('name'),
      testid: attr('data-testid') ?? attr('data-test') ?? attr('data-qa'),
      placeholder: attr('placeholder'),
      label: labels[0]?.textContent?.trim() || undefined,
      nearLabel: near?.textContent?.trim() || undefined,
      text: el instanceof HTMLElement ? el.innerText.trim().slice(0, 80) || undefined : undefined,
    }
  })
  // Role and accessible name come from the page snapshot: refs stay stable across page snapshots,
  // whereas an element-level snapshot would reset them.
  const line =
    (await page.ariaSnapshot({ mode: 'ai' })).split('\n').find((l) => l.includes(`[ref=${ref}]`)) ?? ''
  const role = line.match(/- ([\w-]+)(?: "((?:[^"\\]|\\.)*)")?/)

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
  // id/name attributes are often generated per page load: only a last resort.
  const lastResort = proposals.length === 0
  if (lastResort && facts.name)
    proposals.push({ by: 'css', css: `${facts.tag}[name=${JSON.stringify(facts.name)}]` })
  if (lastResort && facts.id)
    proposals.push({ by: 'css', css: `${facts.tag}[id=${JSON.stringify(facts.id)}]` })

  const unique: Selector[] = []
  for (const s of proposals) {
    const loc = toLocator(page, s)
    if ((await loc.count()) !== 1) continue
    if (await loc.evaluate((el, target) => el === target, handle)) unique.push(s)
  }
  await handle.dispose()
  return unique
}

function xpathString(text: string): string {
  if (!text.includes("'")) return `'${text}'`
  if (!text.includes('"')) return `"${text}"`
  return `concat(${text
    .split("'")
    .map((part) => `'${part}'`)
    .join(`, "'", `)})`
}
