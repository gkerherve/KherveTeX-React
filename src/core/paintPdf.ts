// The drawing as a vector PDF page cropped to its content (export.save_pdf,
// which renders the scene through QPdfWriter): one page `rect` × 72/dpi
// points, paths filled and stroked as drawn, text in the PDF base fonts,
// gradients as shadings, embedded images with their alpha.
import { unzlibSync, zlibSync } from 'fflate'
import { alphaF, textMetrics, type Cmd, type Color, type Mat, type Rect, type Scene } from './paintModel.ts'
import { scenePrims, type Prim } from './paintRender.ts'

const f = (v: number) => {
  if (!Number.isFinite(v)) return '0'
  const s = (Math.round(v * 10000) / 10000).toString()
  return s.includes('e') ? v.toFixed(6) : s
}

interface Obj { id: number; body: string | Uint8Array; dict?: string }

class PdfBuilder {
  objs: Obj[] = []
  add(body: string | Uint8Array, dict?: string): number {
    const id = this.objs.length + 1
    this.objs.push({ id, body, dict })
    return id
  }
  reserve(): number {
    return this.add('')
  }
  set(id: number, body: string): void {
    this.objs[id - 1].body = body
  }
  bytes(rootId: number): Uint8Array {
    const enc = new TextEncoder()
    const parts: Uint8Array[] = []
    let len = 0
    const push = (b: Uint8Array | string) => {
      const u = typeof b === 'string' ? latin1(b) : b
      parts.push(u)
      len += u.length
    }
    push('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n')
    const offsets: number[] = []
    for (const o of this.objs) {
      offsets.push(len)
      if (o.dict !== undefined) {
        const data = typeof o.body === 'string' ? latin1(o.body) : o.body
        push(`${o.id} 0 obj\n<< ${o.dict} /Length ${data.length} >>\nstream\n`)
        push(data)
        push('\nendstream\nendobj\n')
      } else {
        push(`${o.id} 0 obj\n${o.body as string}\nendobj\n`)
      }
    }
    const xref = len
    push(`xref\n0 ${this.objs.length + 1}\n0000000000 65535 f \n`)
    for (const off of offsets) push(`${String(off).padStart(10, '0')} 00000 n \n`)
    push(`trailer\n<< /Size ${this.objs.length + 1} /Root ${rootId} 0 R /Info ${this.add('<< /Creator (kherveDOC) /Producer (KherveTeX) >>')} 0 R >>\nstartxref\n${xref}\n%%EOF\n`)
    void enc
    const out = new Uint8Array(len)
    let at = 0
    for (const p of parts) { out.set(p, at); at += p.length }
    return out
  }
}

function latin1(s: string): Uint8Array {
  const u = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i) & 0xff
  return u
}

// WinAnsi text for a PDF string literal.
const WIN_ANSI: Record<number, number> = {
  0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87,
  0x02c6: 0x88, 0x2030: 0x89, 0x0160: 0x8a, 0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e, 0x2018: 0x91,
  0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x02dc: 0x98,
  0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b, 0x0153: 0x9c, 0x017e: 0x9e, 0x0178: 0x9f,
}
function pdfString(s: string): string {
  let out = '('
  for (const ch of s) {
    let c = ch.codePointAt(0)!
    if (c > 0xff) c = WIN_ANSI[c] ?? 0x3f
    else if (c >= 0x80 && c < 0xa0) c = 0x3f
    const chr = String.fromCharCode(c)
    out += chr === '(' || chr === ')' || chr === '\\' ? '\\' + chr : chr
  }
  return out + ')'
}

function baseFont(family: string, bold: boolean, italic: boolean): string {
  const fam = family.toLowerCase()
  if (/courier|mono|consol/.test(fam)) {
    return 'Courier' + (bold && italic ? '-BoldOblique' : bold ? '-Bold' : italic ? '-Oblique' : '')
  }
  if (/times|georgia|serif|garamond|palatino|cambria/.test(fam) && !/sans/.test(fam)) {
    return bold && italic ? 'Times-BoldItalic' : bold ? 'Times-Bold' : italic ? 'Times-Italic' : 'Times-Roman'
  }
  return 'Helvetica' + (bold && italic ? '-BoldOblique' : bold ? '-Bold' : italic ? '-Oblique' : '')
}

const rgbOp = (c: Color, op: 'rg' | 'RG') => `${f(c.r / 255)} ${f(c.g / 255)} ${f(c.b / 255)} ${op}`

function pathOps(cmds: Cmd[]): string {
  return cmds.map(c => (c[0] === 'M' ? `${f(c[1])} ${f(c[2])} m` : c[0] === 'L' ? `${f(c[1])} ${f(c[2])} l`
    : `${f(c[1])} ${f(c[2])} ${f(c[3])} ${f(c[4])} ${f(c[5])} ${f(c[6])} c`)).join('\n')
}

// ----------------------------------------------------------- PNG decoding
// PNG -> 8-bit RGB + alpha planes (non-interlaced 8-bit gray/RGB/RGBA only).
function decodePng(b64: string): { w: number; h: number; rgb: Uint8Array; alpha: Uint8Array | null } | null {
  try {
    const bin = atob(b64)
    const u = latin1(bin)
    if (u[0] !== 0x89 || u[1] !== 0x50) return null
    let p = 8
    let w = 0
    let h = 0
    let depth = 0
    let ctype = 0
    let interlace = 0
    const idat: Uint8Array[] = []
    while (p < u.length) {
      const len = (u[p] << 24 | u[p + 1] << 16 | u[p + 2] << 8 | u[p + 3]) >>> 0
      const type = String.fromCharCode(u[p + 4], u[p + 5], u[p + 6], u[p + 7])
      const data = u.subarray(p + 8, p + 8 + len)
      if (type === 'IHDR') {
        w = (data[0] << 24 | data[1] << 16 | data[2] << 8 | data[3]) >>> 0
        h = (data[4] << 24 | data[5] << 16 | data[6] << 8 | data[7]) >>> 0
        depth = data[8]; ctype = data[9]; interlace = data[12]
      } else if (type === 'IDAT') {
        idat.push(data)
      } else if (type === 'IEND') {
        break
      }
      p += 12 + len
    }
    const ch = ({ 0: 1, 2: 3, 4: 2, 6: 4 } as Record<number, number>)[ctype]
    if (!ch || depth !== 8 || interlace) return null
    const total = idat.reduce((a, b) => a + b.length, 0)
    const z = new Uint8Array(total)
    let at = 0
    for (const d of idat) { z.set(d, at); at += d.length }
    const raw = unzlibSync(z)
    const stride = w * ch
    const px = new Uint8Array(h * stride)
    for (let y = 0; y < h; y++) {
      const ft = raw[y * (stride + 1)]
      const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
      for (let x = 0; x < stride; x++) {
        const a = x >= ch ? px[y * stride + x - ch] : 0
        const b = y > 0 ? px[(y - 1) * stride + x] : 0
        const c = x >= ch && y > 0 ? px[(y - 1) * stride + x - ch] : 0
        let v = line[x]
        if (ft === 1) v += a
        else if (ft === 2) v += b
        else if (ft === 3) v += (a + b) >> 1
        else if (ft === 4) {
          const pp = a + b - c
          const pa = Math.abs(pp - a)
          const pb = Math.abs(pp - b)
          const pc = Math.abs(pp - c)
          v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c
        }
        px[y * stride + x] = v & 0xff
      }
    }
    const rgb = new Uint8Array(w * h * 3)
    const alpha = ch === 2 || ch === 4 ? new Uint8Array(w * h) : null
    for (let i = 0; i < w * h; i++) {
      if (ch <= 2) {
        rgb[i * 3] = rgb[i * 3 + 1] = rgb[i * 3 + 2] = px[i * ch]
      } else {
        rgb[i * 3] = px[i * ch]; rgb[i * 3 + 1] = px[i * ch + 1]; rgb[i * 3 + 2] = px[i * ch + 2]
      }
      if (alpha) alpha[i] = px[i * ch + ch - 1]
    }
    return { w, h, rgb, alpha }
  } catch {
    return null
  }
}

// export.save_pdf: the `rect` of the scene on one page of rect × 72/dpi pt.
export function sceneToPdf(s: Scene, rect: Rect): Uint8Array {
  const dpi = s.dpi || 96
  const k = 72 / dpi
  const W = rect.w * k
  const H = rect.h * k
  const pdf = new PdfBuilder()
  const catalog = pdf.reserve()
  const pages = pdf.reserve()
  const fonts = new Map<string, string>()
  const gstates = new Map<string, string>()
  const shadings: string[] = []
  const images: string[] = []
  const res: { font: string[]; gs: string[]; sh: string[]; xo: string[] } = { font: [], gs: [], sh: [], xo: [] }

  const font = (name: string) => {
    if (!fonts.has(name)) {
      const id = pdf.add(`<< /Type /Font /Subtype /Type1 /BaseFont /${name} /Encoding /WinAnsiEncoding >>`)
      const key = `F${fonts.size + 1}`
      fonts.set(name, key)
      res.font.push(`/${key} ${id} 0 R`)
    }
    return fonts.get(name)!
  }
  const gs = (fill: number, strokeA: number) => {
    const key = `${f(fill)}/${f(strokeA)}`
    if (!gstates.has(key)) {
      const id = pdf.add(`<< /Type /ExtGState /ca ${f(fill)} /CA ${f(strokeA)} >>`)
      const name = `G${gstates.size + 1}`
      gstates.set(key, name)
      res.gs.push(`/${name} ${id} 0 R`)
    }
    return gstates.get(key)!
  }

  const ops: string[] = []
  ops.push(`${f(k)} 0 0 ${f(-k)} ${f(-rect.x * k)} ${f(H + rect.y * k)} cm`)
  // a white page (QImage / QPdfWriter backgrounds are white)
  const emit = (p: Prim, alpha: number) => {
    switch (p.k) {
      case 'g': {
        const m: Mat = p.m
        ops.push('q')
        ops.push(`${f(m[0])} ${f(m[1])} ${f(m[2])} ${f(m[3])} ${f(m[4])} ${f(m[5])} cm`)
        for (const c of p.children) emit(c, alpha * p.opacity)
        ops.push('Q')
        break
      }
      case 'path': {
        if (!p.cmds.length) break
        const d = pathOps(p.cmds)
        if (p.fill && 'grad' in p.fill) {
          const g = p.fill.grad
          const c1 = color(g.c1)
          const c2 = color(g.c2)
          let coords: string
          let type: number
          let a = c1
          let b = c2
          if (g.kind === 'radial') { type = 3; coords = '0.5 0.5 0 0.5 0.5 0.7071' }
          else if (g.kind === 'sun') { type = 3; coords = '0.25 0.25 0 0.35 0.35 0.95'; a = c2; b = c1 }
          else {
            type = 2
            const rad = (g.angle ?? 90) * Math.PI / 180
            const dx = Math.cos(rad) / 2
            const dy = Math.sin(rad) / 2
            coords = `${f(0.5 - dx)} ${f(0.5 - dy)} ${f(0.5 + dx)} ${f(0.5 + dy)}`
          }
          const fn = `<< /FunctionType 2 /Domain [0 1] /C0 [${f(a.r / 255)} ${f(a.g / 255)} ${f(a.b / 255)}] /C1 [${f(b.r / 255)} ${f(b.g / 255)} ${f(b.b / 255)}] /N 1 >>`
          const id = pdf.add(`<< /ShadingType ${type} /ColorSpace /DeviceRGB /Coords [${coords}] /Function ${fn} /Extend [true true] >>`)
          const name = `S${shadings.length + 1}`
          shadings.push(name)
          res.sh.push(`/${name} ${id} 0 R`)
          const bb = p.fill.bbox
          ops.push('q', `/${gs(alpha * alphaF(c1), 1)} gs`, d, p.evenOdd ? 'W* n' : 'W n',
            `${f(bb.w || 1)} 0 0 ${f(bb.h || 1)} ${f(bb.x)} ${f(bb.y)} cm`, `/${name} sh`, 'Q')
        } else if (p.fill) {
          const c = p.fill.color
          ops.push('q', `/${gs(alpha * alphaF(c), 1)} gs`, rgbOp(c, 'rg'), d, p.evenOdd ? 'f*' : 'f', 'Q')
        }
        if (p.stroke) {
          const st = p.stroke
          ops.push('q', `/${gs(1, alpha * alphaF(st.color))} gs`, rgbOp(st.color, 'RG'), `${f(st.width)} w`,
            `${({ butt: 0, round: 1, square: 2 })[st.cap]} J`, `${({ miter: 0, round: 1, bevel: 2 })[st.join]} j`,
            '2 M', `[${st.dash.map(f).join(' ')}] 0 d`, d, 'S', 'Q')
        }
        break
      }
      case 'text': {
        if (!p.text) break
        const name = font(baseFont(p.font.family, p.font.bold, p.font.italic))
        let x = p.x
        if (p.anchor === 'middle') {
          x -= textMetrics().width(p.text, p.font) / 2
        }
        ops.push('q', `/${gs(alpha * alphaF(p.color), 1)} gs`, rgbOp(p.color, 'rg'), 'BT', `/${name} ${f(p.font.px)} Tf`,
          `1 0 0 -1 ${f(x)} ${f(p.y)} Tm`, `${pdfString(p.text)} Tj`, 'ET', 'Q')
        break
      }
      case 'image': {
        const img = decodePng(p.b64)
        if (!img) break
        let smask = ''
        if (img.alpha) {
          const sid = pdf.add(zlibSync(img.alpha), `/Type /XObject /Subtype /Image /Width ${img.w} /Height ${img.h} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode`)
          smask = ` /SMask ${sid} 0 R`
        }
        const id = pdf.add(zlibSync(img.rgb), `/Type /XObject /Subtype /Image /Width ${img.w} /Height ${img.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode${smask}`)
        const name = `I${images.length + 1}`
        images.push(name)
        res.xo.push(`/${name} ${id} 0 R`)
        ops.push('q', `/${gs(alpha, alpha)} gs`, `${f(p.w)} 0 0 ${f(-p.h)} 0 ${f(p.h)} cm`, `/${name} Do`, 'Q')
        break
      }
    }
  }
  if (s.raster) emit({ k: 'image', b64: s.raster, w: s.rasterW ?? s.width, h: s.rasterH ?? s.height }, 1)
  for (const p of scenePrims(s)) emit(p, 1)
  const content = pdf.add(zlibSync(latin1(ops.join('\n'))), '/Filter /FlateDecode')
  const resources = `<< /ProcSet [/PDF /Text /ImageC] ${res.font.length ? `/Font << ${res.font.join(' ')} >>` : ''}`
    + ` ${res.gs.length ? `/ExtGState << ${res.gs.join(' ')} >>` : ''} ${res.sh.length ? `/Shading << ${res.sh.join(' ')} >>` : ''}`
    + ` ${res.xo.length ? `/XObject << ${res.xo.join(' ')} >>` : ''} >>`
  const page = pdf.add(`<< /Type /Page /Parent ${pages} 0 R /MediaBox [0 0 ${f(W)} ${f(H)}] /Contents ${content} 0 R /Resources ${resources} >>`)
  pdf.set(pages, `<< /Type /Pages /Kids [${page} 0 R] /Count 1 >>`)
  pdf.set(catalog, `<< /Type /Catalog /Pages ${pages} 0 R >>`)
  return pdf.bytes(catalog)
}

function color(s: string): Color {
  const h = s.replace('#', '')
  if (h.length === 8) return { r: parseInt(h.slice(2, 4), 16), g: parseInt(h.slice(4, 6), 16), b: parseInt(h.slice(6, 8), 16), a16: parseInt(h.slice(0, 2), 16) * 257 }
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a16: 65535 }
}
