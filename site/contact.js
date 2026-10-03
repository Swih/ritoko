export function initContact() {
  const form = document.querySelector('[data-contact-form]')
  if (!form || !window.fetch || !window.AbortController) return
  const button = form.querySelector('[data-send]')
  const status = form.querySelector('[data-form-status]')
  const original = button.innerHTML
  let sending = false
  form.addEventListener('submit', async (event) => {
    event.preventDefault()
    if (sending || !form.reportValidity() || form.elements._honey.value) return
    sending = true
    button.disabled = true
    button.textContent = 'Sending…'
    status.textContent = ''
    status.className = 'form-status'
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 15000)
    try {
      const values = Object.fromEntries(new FormData(form))
      const endpoint = form.action.replace('formsubmit.co/', 'formsubmit.co/ajax/')
      const response = await fetch(endpoint, {
        method: 'POST',
        // The explicit, public form URL identifies the same form in previews.
        // Do not forward local addresses, query strings or fragments as referrers.
        referrerPolicy: 'no-referrer',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(values),
        signal: controller.signal,
      })
      const result = await response.json()
      if (/activat|confirm.{0,20}email/i.test(result.message ?? '')) {
        form.dataset.deliveryState = 'activation-required'
        status.textContent =
          'The contact service needs recipient activation. Please email us directly using the link on this page.'
        status.classList.add('form-error')
      } else {
        if (!response.ok || ![true, 'true'].includes(result.success)) {
          form.dataset.deliveryState = 'rejected'
          throw new Error('Submission not confirmed')
        }
        form.dataset.deliveryState = 'accepted'
        status.textContent =
          'Thank you. Your workflow request has been submitted. You can email us if you need to add anything.'
        status.classList.add('form-success')
        form.reset()
      }
    } catch {
      if (form.dataset.deliveryState !== 'rejected') form.dataset.deliveryState = 'unconfirmed'
      status.textContent =
        'We could not confirm the submission. Your text is still here. Please use the direct email link to contact us.'
      status.classList.add('form-error')
    } finally {
      clearTimeout(timeout)
      sending = false
      button.disabled = false
      button.innerHTML = original
    }
  })
}
