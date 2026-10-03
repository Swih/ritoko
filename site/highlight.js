// A tiny JSON highlighter for the workflow excerpt. Not a parser: one regex per line.
// Lines starting with "…" are editorial elisions and are dimmed.

const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const TOKEN = /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?)|([{}[\],:])/g

const string = (raw, cls) =>
  `<span class="${cls}">${escapeHtml(raw).replace(/\{\{[^}]+\}\}/g, (m) => `<span class="tk-tpl">${m}</span>`)}</span>`

function line(src) {
  if (src.trim().startsWith('…')) return `<span class="ln ln--elide">${escapeHtml(src)}</span>`
  let out = ''
  let last = 0
  for (const m of src.matchAll(TOKEN)) {
    out += escapeHtml(src.slice(last, m.index))
    const [all, str, colon, bool, num, punc] = m
    if (str && colon) out += `${string(str, 'tk-key')}<span class="tk-punc">${escapeHtml(colon)}</span>`
    else if (str) out += string(str, 'tk-str')
    else if (bool) out += `<span class="tk-bool">${bool}</span>`
    else if (num) out += `<span class="tk-num">${num}</span>`
    else if (punc) out += `<span class="tk-punc">${escapeHtml(punc)}</span>`
    else out += escapeHtml(all)
    last = m.index + all.length
  }
  out += escapeHtml(src.slice(last))
  const commit = /"commit"\s*:\s*true/.test(src)
  return `<span class="ln${commit ? ' ln--commit' : ''}">${out || ' '}</span>`
}

export const highlightJson = (source) => source.split('\n').map(line).join('')
