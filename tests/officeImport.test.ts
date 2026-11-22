// RTF and OpenDocument (.odt) imports. sample.rtf / sample.odt were written
// by macOS textutil from one HTML page, as TextEdit would save them.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { strToU8, zipSync } from 'fflate'
import { importOdt } from '../src/core/odtImport.ts'
import { importRtf } from '../src/core/rtfImport.ts'
import type { FileAccess } from '../src/core/kdocz.ts'
import type { Block, Document, Inline } from '../src/core/model.ts'

const DIR = join(__dirname, 'fixtures', 'office')

function memFs() {
  const written = new Map<string, Uint8Array>()
  const fs = { write: async (p: string, d: Uint8Array) => { written.set(p, d) } } as unknown as FileAccess
  return { fs, written }
}

const txt = (inl: Inline[]): string => inl.map(x => x.type === 'Text' ? x.text
  : x.type === 'Link' ? txt(x.children) : '').join('')

// One line per block: the shape the import should have.
function outline(doc: Document): string[] {
  return doc.children.map((b: Block) => {
    switch (b.type) {
      case 'Section': return `h${b.level} ${txt(b.children)}`
      case 'Paragraph': return `p${b.alignment === 'center' ? '(c)' : ''} ${txt(b.children)}`
      case 'List': return `${b.ordered ? 'ol' : 'ul'} ${b.items.map(i => txt(i.children)).join(' | ')}`
      case 'Table': return `table ${b.rows.map(r => r.join(',')).join(' / ')}`
      case 'Figure': return `fig ${b.path}`
      default: return b.type
    }
  })
}

const SAMPLE = [
  'h1 Introduction',
  'p Plain text with bold, italic and underlined words, café and naïve.',
  'h2 Method',
  'ul First point | Second point',
  'ol Step one | Step two',
  'p(c) Centred line',
  'table Name,Value / Alpha,1.5',
  'p See the site.',
]

describe('importRtf', () => {
  it('reads a TextEdit RTF', async () => {
    const doc = await importRtf(readFileSync(join(DIR, 'sample.rtf')), '/img', memFs().fs)
    expect(outline(doc)).toEqual(SAMPLE)
    const p = doc.children[1]
    expect(p.type === 'Paragraph' && p.children.map(x => x.type === 'Text' ? x.marks.join() : '')).toEqual(
      ['', 'bold', '', 'italic', '', 'underline', ''])
  })

  it('reads Word-style headings, unicode, footnotes and pictures', async () => {
    const png = '89504e470d0a1a0a0000000d49484452'
    const rtf = String.raw`{\rtf1\ansi\uc1{\stylesheet{\s0 Normal;}{\s1\b heading 1;}}
\pard\s1\outlinelevel0 Results\par
\pard\qc Na\u239?ve \'e9t\'e9{\footnote \pard Source: lab.}\par
\pard{\*\shppict{\pict\pngblip\picwgoal5670 ${png}}}{\nonshppict{\pict\wmetafile8 0102}}\par
}`
    const { fs, written } = memFs()
    const doc = await importRtf(rtf, '/img', fs)
    expect(outline(doc)).toEqual(['h1 Results', 'p(c) Naïve été', 'fig /img/image_001.png'])
    const para = doc.children[1]
    expect(para.type === 'Paragraph' && para.children.some(x => x.type === 'Footnote')).toBe(true)
    expect([...written.keys()]).toEqual(['/img/image_001.png'])
    expect(written.get('/img/image_001.png')![0]).toBe(0x89)
  })

  it('refuses other files', async () => {
    await expect(importRtf('hello', '/img', memFs().fs)).rejects.toThrow(/RTF/)
  })
})

describe('importOdt', () => {
  it('reads a TextEdit .odt', async () => {
    const doc = await importOdt(new Uint8Array(readFileSync(join(DIR, 'sample.odt'))), '/img', memFs().fs)
    expect(outline(doc)).toEqual(SAMPLE)
    const last = doc.children[doc.children.length - 1]
    expect(last.type === 'Paragraph' && last.children.find(x => x.type === 'Link')).toMatchObject({ url: 'https://example.org/' })
  })

  it('reads LibreOffice headings, footnotes, a title and pictures', async () => {
    const content = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"
 xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0"
 xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0"
 xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0">
<office:automatic-styles><style:style style:name="T1" style:family="text"><style:text-properties fo:font-style="italic"/></style:style></office:automatic-styles>
<office:body><office:text>
<text:p text:style-name="Title">My report</text:p>
<text:h text:style-name="Heading_20_1" text:outline-level="1">Aims</text:h>
<text:h text:outline-level="2">Detail</text:h>
<text:p>An <text:span text:style-name="T1">italic</text:span> word<text:s/>here.<text:note text:note-class="footnote"><text:note-citation>1</text:note-citation><text:note-body><text:p>A note.</text:p></text:note-body></text:note></text:p>
<text:p><draw:frame svg:width="8cm"><draw:image xlink:href="Pictures/a.png"/></draw:frame></text:p>
</office:text></office:body></office:document-content>`
    const bytes = zipSync({ 'mimetype': strToU8('application/vnd.oasis.opendocument.text'),
      'content.xml': strToU8(content), 'Pictures/a.png': new Uint8Array([0x89, 0x50, 0x4e, 0x47]) })
    const { fs, written } = memFs()
    const doc = await importOdt(bytes, '/img', fs)
    expect(doc.meta.title).toBe('My report')
    expect(outline(doc)).toEqual(['h1 Aims', 'h2 Detail', 'p An italic word here.', 'fig /img/image_001.png'])
    const p = doc.children[2]
    expect(p.type === 'Paragraph' && p.children.map(x => x.type)).toEqual(['Text', 'Text', 'Text', 'Footnote'])
    expect(doc.children[3]).toMatchObject({ width: '0.50\\textwidth' })
    expect(written.size).toBe(1)
  })

  it('refuses a file that is not an .odt', async () => {
    await expect(importOdt(new Uint8Array([1, 2, 3]), '/img', memFs().fs)).rejects.toThrow(/OpenDocument/)
  })
})
