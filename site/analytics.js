import { analyticsConfig as config } from './analytics-config.js'
import { contentRoutes } from './content-routes.js'

const preferenceKey = 'ritoko-analytics-consent'
const sections = new Set([
  'top',
  'process',
  'safety',
  'install',
  'rpa',
  'resume',
  'exports',
  'http',
  'mcp',
  'documents',
  'proof',
  'how',
  'compare',
  'tradeoffs',
  'faq',
])
const pages = new Set([
  ...contentRoutes,
  '/',
  '/index',
  '/use-cases',
  '/benchmarks',
  '/watch',
  '/contact',
  '/privacy',
  '/use-cases/rpa-challenge',
  '/use-cases/customer-onboarding',
  '/use-cases/reports-and-exports',
  '/use-cases/browser-and-http',
  '/use-cases/mcp-workflows',
  '/use-cases/document-processing',
])
const cases = new Set(['rpa', 'resume', 'exports', 'http', 'mcp', 'documents'])
let active = false
let started = false
const eventFields = {
  section_view: ['section', sections],
  install_copy_intent: ['client', new Set(['claude', 'codex', 'other'])],
  install_tab: ['client', new Set(['claude', 'codex', 'other'])],
  case_select: ['case', cases],
  demo_mode: ['mode', new Set(['slow', 'real'])],
  github_click: ['destination', new Set(['repository', 'documentation'])],
}
const simpleEvents = new Set([
  'use_cases_click',
  'faq_toggle',
  'video_start',
  'video_25',
  'video_50',
  'video_75',
  'video_complete',
])

function preference() {
  try {
    return localStorage.getItem(preferenceKey)
  } catch {
    return null
  }
}

function allowed() {
  return preference() === 'yes' && navigator.doNotTrack !== '1' && !navigator.globalPrivacyControl
}

function track(name, data = {}) {
  if (!active || !allowed()) return
  try {
    Promise.resolve(window.umami?.track(name, data)).catch(() => {})
  } catch {
    // Analytics must never break navigation or installation.
  }
}

function observe() {
  document.addEventListener('click', (event) => {
    if (!(event.target instanceof Element)) return
    const target = event.target.closest('a, button, summary')
    if (!target) return
    if (target.matches('[data-copy]')) {
      const panel = target.closest('[role="tabpanel"]')?.id
      const command = target.parentElement.querySelector('code')?.textContent ?? ''
      const client =
        panel === 'install-claude' || /claude/i.test(command)
          ? 'claude'
          : panel === 'install-codex' || /codex/i.test(command)
            ? 'codex'
            : 'other'
      track('install_copy_intent', { client })
    } else if (target.matches('[role="tab"]') && ['agent-claude', 'agent-codex'].includes(target.id)) {
      const client = target.id === 'agent-claude' ? 'claude' : target.id === 'agent-codex' ? 'codex' : 'other'
      track('install_tab', { client })
    } else if (target.matches('[data-case]') && cases.has(target.dataset.case)) {
      track('case_select', { case: target.dataset.case })
    } else if (target.matches('[data-view]') && ['slow', 'real'].includes(target.dataset.view)) {
      track('demo_mode', { mode: target.dataset.view })
    } else if (target.matches('summary')) {
      track('faq_toggle')
    } else if (target.matches('a')) {
      const url = new URL(target.href, location.href)
      if (url.hostname === 'github.com' && url.pathname.startsWith('/Swih/ritoko')) {
        track('github_click', {
          destination: url.pathname === '/Swih/ritoko' ? 'repository' : 'documentation',
        })
      } else if (url.origin === location.origin && url.pathname.replace(/\.html$/, '') === '/use-cases') {
        track('use_cases_click')
      }
    }
  })

  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting || document.hidden) continue
          track('section_view', { section: entry.target.id })
          observer.unobserve(entry.target)
        }
      },
      { threshold: 0, rootMargin: '-20% 0px -20% 0px' },
    )
    for (const section of document.querySelectorAll('section[id]')) {
      if (sections.has(section.id)) observer.observe(section)
    }
  }

  for (const video of document.querySelectorAll('video')) {
    const sent = new Set()
    const once = (name) => {
      if (sent.has(name)) return
      sent.add(name)
      track(name)
    }
    video.addEventListener('play', () => once('video_start'))
    video.addEventListener('timeupdate', () => {
      if (!Number.isFinite(video.duration) || video.duration <= 0) return
      for (const percent of [25, 50, 75]) {
        if (video.currentTime / video.duration >= percent / 100) once(`video_${percent}`)
      }
    })
    video.addEventListener('ended', () => once('video_complete'))
  }
}

function activate() {
  if (active || !allowed() || !window.umami) return
  active = true
  try {
    Promise.resolve(window.umami.track()).catch(() => {})
  } catch {}
  observe()
}

function start() {
  if (!allowed()) return
  if (started) {
    activate()
    return
  }
  started = true
  const script = document.createElement('script')
  script.src = `${new URL(config.origin).origin}/script.js`
  script.defer = true
  script.dataset.websiteId = config.websiteId
  script.dataset.autoTrack = 'false'
  script.dataset.doNotTrack = 'true'
  script.dataset.excludeSearch = 'true'
  script.dataset.excludeHash = 'true'
  script.dataset.beforeSend = 'ritokoAnalyticsBeforeSend'
  // Minimize all payloads, including event defaults. No query strings, fragments,
  // document title, clipboard contents, identifiers or external referrer paths.
  window.ritokoAnalyticsBeforeSend = (_type, payload) => {
    if (!allowed() || _type !== 'event') return false
    let data = {}
    if (payload.name) {
      if (Object.hasOwn(eventFields, payload.name)) {
        const [key, values] = eventFields[payload.name]
        if (!values.has(payload.data?.[key])) return false
        data = { [key]: payload.data[key] }
      } else if (!simpleEvents.has(payload.name)) return false
    }
    let referrer = ''
    try {
      referrer = document.referrer ? new URL(document.referrer).origin : ''
    } catch {}
    return {
      website: config.websiteId,
      hostname: location.hostname,
      url: location.pathname,
      referrer,
      language: navigator.language,
      screen: `${screen.width}x${screen.height}`,
      ...(payload.name ? { name: payload.name, data } : {}),
    }
  }
  script.onload = activate
  script.onerror = () => {
    started = false
  }
  document.head.append(script)
}

function init() {
  if (!config.enabled || !config.domains.includes(location.hostname)) return
  if (!pages.has(location.pathname.replace(/\.html$/, '').replace(/\/$/, '') || '/')) return
  try {
    if (new URL(config.origin).protocol !== 'https:' || !/^[\da-f-]{36}$/i.test(config.websiteId)) return
  } catch {
    return
  }
  if (navigator.doNotTrack === '1' || navigator.globalPrivacyControl) return

  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = '/analytics.css'
  document.head.append(link)
  const panel = document.createElement('aside')
  panel.className = 'analytics-choice'
  panel.setAttribute('aria-label', 'Site measurement preferences')
  const text = document.createElement('p')
  text.textContent =
    'Help improve Ritoko? Allow basic page and click statistics on our own analytics server. No recordings or form contents.'
  const accept = document.createElement('button')
  accept.type = 'button'
  accept.textContent = 'Allow statistics'
  const reject = document.createElement('button')
  reject.type = 'button'
  reject.textContent = 'No thanks'
  const privacy = document.createElement('a')
  privacy.href = '/privacy'
  privacy.textContent = 'Details'
  const settings = document.createElement('button')
  settings.type = 'button'
  settings.className = 'analytics-settings'
  settings.textContent = 'Privacy settings'
  settings.onclick = () => {
    panel.hidden = !panel.hidden
  }
  const choose = (value) => {
    try {
      localStorage.setItem(preferenceKey, value)
    } catch {
      return
    }
    panel.hidden = true
    if (value === 'yes') start()
  }
  accept.onclick = () => choose('yes')
  reject.onclick = () => choose('no')
  panel.append(text, accept, reject, privacy)
  panel.hidden = preference() !== null
  document.body.append(panel)
  ;(document.querySelector('.footer-bottom') ?? document.body).append(settings)
  start()
}

init()
