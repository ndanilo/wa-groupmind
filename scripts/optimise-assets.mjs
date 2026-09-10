/**
 * One-off asset pipeline for docs/assets.
 *
 * The brand files come out of the image tool as oversized JPEGs with a flat dark
 * background baked in, regardless of the .png extension. This turns the logo files
 * into real transparent PNGs and re-encodes everything else at web sizes.
 *
 * Idempotent: anything already in its target format and size is skipped.
 *
 * Run from the repo root:  node scripts/optimise-assets.mjs
 */
import sharp from 'sharp'
import { readFile, writeFile, unlink, readdir } from 'node:fs/promises'
import { statSync, existsSync } from 'node:fs'

// Windows keeps a read handle open behind sharp's cache, which makes writing back
// to a path we just read fail with UNKNOWN. Everything here goes through buffers.
sharp.cache(false)

const DIR = 'docs/assets'
const luminance = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b
const kb = (p) => (statSync(p).size / 1024).toFixed(0).padStart(5)

/**
 * Derives an alpha channel from luminance, assuming the subject was composited over
 * a flat dark field. Glows fade out instead of leaving a hard matte edge.
 *
 * `floor` discards the faint vignette the generator paints across the backdrop.
 * Without it a ghost rectangle survives at very low alpha and is visible on white.
 */
async function knockout(buf, { floor = 0.1, boost = 1.7 } = {}) {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const { width: w, height: h, channels: ch } = info
  const bg = [data[0], data[1], data[2]]
  const base = luminance(bg[0], bg[1], bg[2])

  let peak = 0
  for (let i = 0; i < w * h; i += 1) {
    const o = i * ch
    const l = luminance(data[o], data[o + 1], data[o + 2])
    if (l > peak) peak = l
  }

  const out = Buffer.alloc(w * h * 4)
  for (let i = 0; i < w * h; i += 1) {
    const o = i * ch
    const q = i * 4
    const r = data[o]
    const g = data[o + 1]
    const b = data[o + 2]

    let a = ((luminance(r, g, b) - base) / (peak - base)) * boost
    a = Math.min(1, Math.max(0, a))
    a = a <= floor ? 0 : (a - floor) / (1 - floor)
    if (a <= 0) continue

    // Unpremultiply against the background so colours stay true once it is gone.
    out[q] = Math.min(255, Math.max(0, Math.round((r - (1 - a) * bg[0]) / a)))
    out[q + 1] = Math.min(255, Math.max(0, Math.round((g - (1 - a) * bg[1]) / a)))
    out[q + 2] = Math.min(255, Math.max(0, Math.round((b - (1 - a) * bg[2]) / a)))
    out[q + 3] = Math.round(a * 255)
  }

  return sharp(out, { raw: { width: w, height: h, channels: 4 } })
    .trim({ threshold: 10 })
    .png()
    .toBuffer()
}

/**
 * Repaints achromatic (white) glyphs dark while leaving saturated brand colour
 * alone, so the wordmark stays readable on a light-theme README.
 */
async function darkenText(buf) {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const { width: w, height: h } = info
  const out = Buffer.from(data)
  for (let i = 0; i < w * h; i += 1) {
    const q = i * 4
    const max = Math.max(out[q], out[q + 1], out[q + 2])
    const min = Math.min(out[q], out[q + 1], out[q + 2])
    const saturation = max === 0 ? 0 : (max - min) / max
    if (saturation < 0.22 && max > 90) {
      out[q] = 15
      out[q + 1] = 20
      out[q + 2] = 40
    }
  }
  return sharp(out, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer()
}

async function replace(path, buf) {
  if (existsSync(path)) await unlink(path)
  await writeFile(path, buf)
  const m = await sharp(path).metadata()
  const shape = `${m.format} ${m.width}x${m.height}${m.hasAlpha ? ' a' : ''}`
  console.log(path.replace(`${DIR}/`, '').padEnd(24) + shape.padEnd(20) + kb(path) + ' KB')
}

const logoDone = existsSync(`${DIR}/logo.png`) && (await sharp(`${DIR}/logo.png`).metadata()).format === 'png'
if (!logoDone) {
  const mark = await knockout(await readFile(`${DIR}/logo.png`))
  await replace(
    `${DIR}/logo.png`,
    await sharp(mark)
      .resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png({ compressionLevel: 9 })
      .toBuffer(),
  )
} else {
  console.log('logo.png'.padEnd(24) + 'already processed')
}

if (existsSync(`${DIR}/wordmark.png`)) {
  const wm = await knockout(await readFile(`${DIR}/wordmark.png`))
  const light = await darkenText(wm)
  await replace(`${DIR}/wordmark.png`, await sharp(wm).resize({ width: 1200 }).png({ compressionLevel: 9 }).toBuffer())
  await replace(
    `${DIR}/wordmark-light.png`,
    await sharp(light).resize({ width: 1200 }).png({ compressionLevel: 9 }).toBuffer(),
  )
}

const rasters = [
  ['demo-answer.png', 'demo-answer.jpg', 1200],
  ['demo-infographic.png', 'demo-infographic.jpg', 1200],
  ['demo-pairing.png', 'demo-pairing.jpg', 1200],
  ['demo-webhook.png', 'demo-webhook.jpg', 1200],
  ['demo-poster.png', 'demo-poster.jpg', 760],
  ['hero.png', 'hero.jpg', 1600],
]

for (const [src, dst, width] of rasters) {
  if (!existsSync(`${DIR}/${src}`)) continue
  const buf = await sharp(await readFile(`${DIR}/${src}`))
    .resize({ width, withoutEnlargement: true })
    .jpeg({ quality: 88, mozjpeg: true })
    .toBuffer()
  await unlink(`${DIR}/${src}`)
  await replace(`${DIR}/${dst}`, buf)
}

// GitHub wants 1280x640 for the social preview; the render is 2.02:1 so it crops a hair.
if (existsSync(`${DIR}/social-preview.png`)) {
  const buf = await sharp(await readFile(`${DIR}/social-preview.png`))
    .resize(1280, 640, { fit: 'cover' })
    .jpeg({ quality: 90, mozjpeg: true })
    .toBuffer()
  await unlink(`${DIR}/social-preview.png`)
  await replace(`${DIR}/social-preview.jpg`, buf)
}

for (const f of await readdir(DIR)) {
  if (f.includes('.tmp')) await unlink(`${DIR}/${f}`)
}

const total = (await readdir(DIR))
  .filter((f) => /\.(png|jpe?g)$/i.test(f))
  .reduce((sum, f) => sum + statSync(`${DIR}/${f}`).size, 0)
console.log(`\ntotal ${(total / 1024 / 1024).toFixed(2)} MB`)
