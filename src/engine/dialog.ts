import type { Dialog, Page } from 'playwright-core'

export type DialogAnswer = { onDialog?: 'accept' | 'dismiss'; dialogText?: string }

/**
 * Runs an action with explicit handling of JS alert/confirm/prompt dialogs, which Playwright would
 * otherwise dismiss silently. The first dialog gets the expected answer; any other dialog is dismissed
 * to unblock the page and fails the action. Returns the answered dialog as `type dialog "message"`.
 */
export async function withDialogs(
  page: Page,
  { onDialog, dialogText }: DialogAnswer,
  action: () => Promise<void>,
): Promise<string | undefined> {
  let answered: string | undefined
  let unexpected: string | undefined
  const handle = (dialog: Dialog) => {
    const seen = `${dialog.type()} dialog "${dialog.message()}"`
    const expected = onDialog !== undefined && answered === undefined
    if (expected) answered = seen
    else unexpected ??= seen
    const answer = expected && onDialog === 'accept' ? dialog.accept(dialogText) : dialog.dismiss()
    answer.catch(() => {}) // The page may already be gone.
  }
  page.on('dialog', handle)
  try {
    await action()
  } finally {
    page.off('dialog', handle)
  }
  if (unexpected)
    throw new Error(
      `Unexpected ${unexpected} appeared and was dismissed; the action may have taken effect. Answer it explicitly with "accept" or "dismiss" (step onDialog, browser_act dialog) on the click or press that opens it.`,
    )
  return answered
}
