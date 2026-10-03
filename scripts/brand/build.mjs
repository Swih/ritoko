import { copyFile, mkdir, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Asset preparation only. Pass installed Potrace and Sharp package directories.
// node scripts/brand/build.mjs <potrace-package> <sharp-package>
const require = createRequire(import.meta.url)
const potrace = require(process.argv[2] || 'potrace')
const sharp = require(process.argv[3] || 'sharp')
const root = fileURLToPath(new URL('../../', import.meta.url))
const kit = join(root, 'design/brand/ritoko')
const assets = join(root, 'site/assets')
const brand = join(assets, 'brand')
await mkdir(brand, { recursive: true })
await mkdir(kit, { recursive: true })

const source = join(kit, 'source.png')
const { data, info } = await sharp(source).greyscale().raw().toBuffer({ resolveWithObject: true })
let minX = info.width
let minY = info.height
let maxX = 0
let maxY = 0
for (let y = 0; y < info.height; y++) {
  for (let x = 0; x < info.width; x++) {
    if (data[(y * info.width + x) * info.channels] >= 128) continue
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x)
    maxY = Math.max(maxY, y)
  }
}

const traced = await new Promise((resolve, reject) => {
  potrace.trace(source, { threshold: 128, turdSize: 8, alphaMax: 1, optTolerance: 0.15 }, (error, svg) =>
    error ? reject(error) : resolve(svg),
  )
})
const rawPath = traced.match(/\bd="([^"]+)"/)[1]
const pieces = (rawPath.match(/M/g) || []).length
if (pieces !== 3) throw new Error(`Expected the three selected strokes, found ${pieces}`)

// Normalize the actual contours to a square, leaving 56 units of side clearance.
const scale = 912 / (maxX - minX + 1)
const dx = 512 - ((minX + maxX) / 2) * scale
const dy = 512 - ((minY + maxY) / 2) * scale
const path = rawPath.replace(/([MLCZ])([^MLCZ]*)/g, (_, command, coordinates) => {
  if (command === 'Z') return 'Z'
  const numbers = coordinates.match(/-?\d*\.?\d+/g).map(Number)
  return (
    command +
    numbers.map((value, index) => Number((value * scale + (index % 2 === 0 ? dx : dy)).toFixed(2))).join(' ')
  )
})
const palette = {
  red: '#b3301a',
  ink: '#1c1a16',
  coral: '#e8684a',
  paper: '#f4f0e6',
  dark: '#14130f',
  text: '#eee8da',
}
const shape = (color) => `<path d="${path}" fill="${color}" fill-rule="evenodd"/>`
const svg = (body, size = 1024) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 1024 1024"><title>Ritoko</title>${body}</svg>\n`

for (const name of ['red', 'coral']) {
  const stem = name === 'coral' ? 'ritoko' : 'ritoko-brick'
  const content = svg(shape(palette[name]))
  await writeFile(join(brand, `${stem}.svg`), content)
  await sharp(Buffer.from(content))
    .png()
    .toFile(join(brand, `${stem}.png`))
}

for (const stem of ['ritoko-black', 'ritoko-cream', 'ritoko-coral']) {
  for (const extension of ['svg', 'png']) {
    await rm(join(brand, `${stem}.${extension}`), { force: true })
  }
}

const favicon = svg(
  `<rect width="1024" height="1024" rx="180" fill="${palette.dark}"/>${shape(palette.coral)}`,
)
await writeFile(join(assets, 'favicon.svg'), favicon)
await sharp(Buffer.from(favicon)).resize(32, 32).png().toFile(join(assets, 'favicon-32.png'))
const sizes = [16, 24, 32, 48, 64, 128, 256]
const frames = await Promise.all(
  sizes.map((size) => sharp(Buffer.from(favicon)).resize(size, size).png().toBuffer()),
)
const header = Buffer.alloc(6 + 16 * sizes.length)
header.writeUInt16LE(1, 2)
header.writeUInt16LE(sizes.length, 4)
let offset = header.length
for (let index = 0; index < sizes.length; index++) {
  const at = 6 + 16 * index
  header[at] = sizes[index] === 256 ? 0 : sizes[index]
  header[at + 1] = header[at]
  header.writeUInt16LE(1, at + 4)
  header.writeUInt16LE(32, at + 6)
  header.writeUInt32LE(frames[index].length, at + 8)
  header.writeUInt32LE(offset, at + 12)
  offset += frames[index].length
}
await writeFile(join(root, 'site/favicon.ico'), Buffer.concat([header, ...frames]))
await copyFile(join(root, 'site/favicon.ico'), join(kit, 'favicon.ico'))
const touch = svg(
  `<rect width="1024" height="1024" fill="${palette.dark}"/><g transform="translate(64 64) scale(.875)">${shape(palette.coral)}</g>`,
)
await sharp(Buffer.from(touch)).resize(180, 180).png().toFile(join(assets, 'apple-touch-icon.png'))

// Verify tracing against the selected source's actual silhouette, before scaling.
const silhouette = `<svg xmlns="http://www.w3.org/2000/svg" width="${info.width}" height="${info.height}"><path d="${rawPath}" fill="black"/></svg>`
const raster = await sharp(Buffer.from(silhouette)).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
let intersection = 0
let union = 0
for (let pixel = 0; pixel < info.width * info.height; pixel++) {
  const original = data[pixel * info.channels] < 128
  const vector = raster.data[pixel * raster.info.channels + raster.info.channels - 1] >= 128
  if (original && vector) intersection++
  if (original || vector) union++
}
const fidelity = intersection / union
if (fidelity < 0.99) throw new Error(`Trace fidelity below 99%: ${fidelity}`)
await writeFile(
  join(kit, 'geometry.json'),
  `${JSON.stringify(
    {
      path,
      pieces,
      palette,
      defaultTheme: 'dark',
      primaryColor: palette.coral,
      sourceSize: [info.width, info.height],
      silhouetteIoU: fidelity,
      icoSizes: sizes,
    },
    null,
    2,
  )}\n`,
)

const cards = [
  ['Thème sombre · principal', palette.dark, palette.coral, '#e8684a'],
  ['Fond crème · alternative', palette.paper, palette.red, '#b3301a'],
]
const preview = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="800" viewBox="0 0 1600 800">
<rect width="1600" height="800" fill="${palette.dark}"/>
<text x="64" y="65" font-family="Georgia,serif" font-size="38" fill="${palette.text}">Ritoko · étape par étape</text>
${cards.map(([title, bg, fg, hex], index) => `<g transform="translate(${64 + index * 748} 108)"><rect width="724" height="440" rx="14" fill="${bg}" stroke="#dcd4c2"/><g transform="translate(170 14) scale(.375)">${shape(fg)}</g><text x="24" y="378" font-family="Segoe UI,sans-serif" font-size="23" fill="${fg}">${title}</text><text x="24" y="414" font-family="Consolas,monospace" font-size="19" fill="${fg}">${hex}</text></g>`).join('')}
<text x="64" y="613" font-family="Segoe UI,sans-serif" font-size="24" fill="${palette.text}">Icône navigateur</text>
${[16, 32, 48, 64, 128].map((size, index) => `<g transform="translate(${80 + index * 230} ${687 - size / 2}) scale(${size / 1024})"><rect width="1024" height="1024" rx="180" fill="${palette.dark}"/>${shape(palette.coral)}</g><text x="${80 + index * 230}" y="779" font-family="Consolas,monospace" font-size="18" fill="${palette.text}">${size} px</text>`).join('')}
</svg>`
await writeFile(join(kit, 'palette-preview.svg'), preview)
await sharp(Buffer.from(preview)).png().toFile(join(kit, 'palette-preview.png'))

const rows = ['done', 'done', 'done', 'done', 'review']
const social = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
<rect width="1200" height="630" fill="${palette.dark}"/>
<path d="M64 0V630" stroke="${palette.coral}" stroke-opacity=".3"/>
${Array.from({ length: 12 }, (_, index) => `<path d="M0 ${42 + index * 48}H1200" stroke="${palette.text}" stroke-opacity=".035"/>`).join('')}
<g transform="translate(96 41) scale(.063)">${shape(palette.coral)}</g>
<text x="174" y="87" font-family="Georgia,serif" font-weight="bold" font-size="38" fill="${palette.text}">Ritoko</text>
<g font-family="Georgia,serif" font-size="65" font-weight="bold" fill="${palette.text}"><text x="104" y="223">Record once.</text><text x="104" y="293">Replay forever.</text><text x="104" y="363" font-style="italic" fill="${palette.coral}">Resume safely.</text></g>
<g font-family="Segoe UI,sans-serif" font-size="23" fill="#c3bba9"><text x="104" y="430">Browser tasks learned once, replayed step by step.</text><text x="104" y="466">Every item checked. Uncertainty held for review.</text></g>
<rect x="750" y="155" width="350" height="353" rx="10" fill="#1c1a15" stroke="#4f493c"/>
<g font-family="Consolas,monospace" font-size="18" fill="${palette.text}"><text x="774" y="193">KEY</text><text x="944" y="193">STATUS</text>
${rows.map((status, index) => `<path d="M750 ${215 + index * 56}H1100" stroke="#302d26"/><text x="774" y="${251 + index * 56}">INV-0${index + 1}</text><rect x="930" y="${228 + index * 56}" width="134" height="33" rx="4" fill="${status === 'review' ? '#3a2a12' : '#1c3221'}"/><text x="945" y="${251 + index * 56}" fill="${status === 'review' ? '#f2b75e' : '#93d39e'}">${status}</text>`).join('')}</g>
<text x="104" y="578" font-family="Consolas,monospace" font-size="19" fill="#c3bba9">ritoko.com · Claude Code + Codex CLI · MIT</text>
</svg>`
await writeFile(join(kit, 'social.svg'), social)
await sharp(Buffer.from(social)).png().toFile(join(assets, 'og-cadence.png'))
console.log(
  JSON.stringify({
    pieces,
    silhouetteIoU: fidelity,
    svgBytes: Buffer.byteLength(svg(shape(palette.coral))),
    icoSizes: sizes,
    kit,
    brand,
  }),
)
