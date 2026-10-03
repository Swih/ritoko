// Ritoko site: theme, menu, tabs, copy buttons, JSON highlighting, explainer.

import { initContact } from './contact.js'
import { initExperience } from './experience.js'
import './analytics.js'

const root = document.documentElement

/* ---------------------------------------------------------------- theme */
const themeButton = document.querySelector('.theme-toggle')
const effectiveTheme = () => (root.dataset.theme === 'light' ? 'light' : 'dark')
const syncThemeButton = () => {
  const theme = effectiveTheme()
  const next = theme === 'dark' ? 'light' : 'dark'
  themeButton?.setAttribute('aria-label', `Switch to ${next === 'light' ? 'cream' : 'dark'} theme`)
  themeButton?.setAttribute('title', `Switch to ${next === 'light' ? 'cream' : 'dark'} theme`)
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', theme === 'dark' ? '#14130f' : '#f4f0e6')
}
themeButton?.addEventListener('click', () => {
  const next = effectiveTheme() === 'dark' ? 'light' : 'dark'
  root.dataset.theme = next
  try {
    localStorage.setItem('ritoko-theme', next)
  } catch {}
  syncThemeButton()
})
syncThemeButton()

/* ---------------------------------------------------------------- menu */
const navToggle = document.querySelector('.nav-toggle')
const navList = document.getElementById('nav-list')
const setMenu = (open) => {
  navToggle?.setAttribute('aria-expanded', String(open))
  navList?.classList.toggle('is-open', open)
}
navToggle?.addEventListener('click', () => setMenu(navToggle.getAttribute('aria-expanded') !== 'true'))
navList?.addEventListener('click', (e) => {
  if (e.target.closest('a')) setMenu(false)
})
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && navToggle?.getAttribute('aria-expanded') === 'true') {
    setMenu(false)
    navToggle.focus()
  }
})
document.addEventListener('click', (e) => {
  if (!e.target.closest('.site-nav')) setMenu(false)
})

/* ---------------------------------------------------------------- tabs (WAI-ARIA pattern) */
for (const group of document.querySelectorAll('[data-tabs]')) {
  const tabs = [...group.querySelectorAll('[role="tab"]')]
  const select = (tab, focus = false) => {
    for (const t of tabs) {
      const on = t === tab
      t.setAttribute('aria-selected', String(on))
      t.tabIndex = on ? 0 : -1
      document.getElementById(t.getAttribute('aria-controls')).hidden = !on
    }
    if (focus) tab.focus()
  }
  tabs.forEach((tab, i) => {
    tab.addEventListener('click', () => select(tab))
    tab.addEventListener('keydown', (e) => {
      const move = { ArrowRight: 1, ArrowLeft: -1, Home: -i, End: tabs.length - 1 - i }[e.key]
      if (move === undefined) return
      e.preventDefault()
      select(tabs[(i + move + tabs.length) % tabs.length], true)
    })
  })
}

/* ---------------------------------------------------------------- copy buttons */
const status = Object.assign(document.createElement('p'), { className: 'sr-only' })
status.setAttribute('role', 'status')
document.body.append(status)

for (const button of document.querySelectorAll('[data-copy]')) {
  const label = button.textContent
  button.setAttribute('aria-label', `Copy command: ${button.parentElement.querySelector('code').textContent}`)
  button.addEventListener('click', async () => {
    const value = button.parentElement.querySelector('code').textContent.trim()
    let ok = false
    try {
      await navigator.clipboard.writeText(value)
      ok = true
    } catch {
      const area = Object.assign(document.createElement('textarea'), { value })
      area.setAttribute('readonly', '')
      area.style.position = 'fixed'
      area.style.opacity = '0'
      document.body.append(area)
      area.select()
      try {
        ok = document.execCommand('copy')
      } catch {}
      area.remove()
    }
    button.textContent = ok ? 'Copied' : 'Select'
    button.classList.toggle('is-done', ok)
    status.textContent = ok ? 'Command copied to the clipboard.' : 'Copy failed. Select the command manually.'
    setTimeout(() => {
      button.textContent = label
      button.classList.remove('is-done')
    }, 1800)
  })
}

initExperience()
initContact()
