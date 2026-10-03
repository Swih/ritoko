// Shared by stage.html and the terminal PNG renderer: turns REAL captured CLI text into colored HTML.
// Colors are presentation only; the text itself is never changed here.
window.RitokoTerm = (() => {
  const esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c])
  const STATUS = /^(done|review|failed|partial|skipped|running|pending|stopped)$/
  const TOKEN =
    /("(?:[^"\\]|\\.)*"\s*:)|("(?:[^"\\]|\\.)*")|(\b(?:done|review|failed|partial|skipped|running|pending|stopped)\b)|(~\/\.ritoko\S*)|((?<![\w-])\d+(?:\.\d+)?s?\b)/g
  function out(text) {
    let html = ''
    let last = 0
    for (const m of text.matchAll(TOKEN)) {
      html += esc(text.slice(last, m.index))
      const [tok, key, str, word, path, num] = m
      if (key) html += `<span class="k">${esc(key)}</span>`
      else if (str) {
        const inner = str.slice(1, -1)
        html += STATUS.test(inner)
          ? `<span class="s-${inner}">${esc(str)}</span>`
          : `<span class="v">${esc(str)}</span>`
      } else if (word) html += `<span class="s-${word}">${esc(word)}</span>`
      else if (path) html += `<span class="p">${esc(path)}</span>`
      else if (num) html += `<span class="n">${esc(num)}</span>`
      else html += esc(tok)
      last = m.index + tok.length
    }
    return html + esc(text.slice(last))
  }
  // line = { t: 'cmd' | 'out' | 'note' | 'fold', text }
  function line(l) {
    if (l.t === 'cmd') return `<div class="ln cmd"><span class="ps">~/ritoko $</span> ${esc(l.text)}</div>`
    if (l.t === 'note') return `<div class="ln note">${esc(l.text)}</div>`
    if (l.t === 'fold') return `<div class="ln fold">${esc(l.text)}</div>`
    return `<div class="ln">${out(l.text) || '&nbsp;'}</div>`
  }
  const css = `
.ln{white-space:pre-wrap;word-break:break-all}
.ps{color:#7ee787}.cmd{color:#f0f3f8;font-weight:600}
.k{color:#8cb4ff}.v{color:#a5d6a7}.n{color:#f2cc8f}.p{color:#7f8aa3}
.s-done{color:#7ee787}.s-review{color:#ffb454;font-weight:700}.s-failed{color:#ff7b72}.s-partial{color:#ffb454}
.s-skipped{color:#79dcf0}.s-running{color:#8cb4ff}.s-pending{color:#8b95a9}.s-stopped{color:#ff7b72}
.note{color:#ffb454;background:#ffb4541a;border-left:3px solid #ffb454;padding:1px 8px;margin:5px 0}
.fold{color:#6b7790;font-style:italic}`
  return { line, css, out }
})()
