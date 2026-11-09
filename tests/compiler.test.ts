// Port of ../KherveTeX/tests/test_compiler.py: the .tex rewrites before
// tectonic runs, and compile_tex's cache-first / online-retry logic with a
// fake engine (Python monkeypatches _run_tracked).
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync, mkdirSync, cpSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  applyCompileRange, applyNotCompileRanges, applyTypstCompileRange, compileTex,
  COMPILE_END, COMPILE_START, missingFromLog, NOT_COMPILE_END, NOT_COMPILE_START,
  pageCounts, pageMarksFromLog, rewriteIncludegraphics, stripImages,
  type CompilerHost, type HostRun,
} from '../src/core/compiler.ts'

const tmp = () => mkdtempSync(join(tmpdir(), 'khervetex-test-'))
const rewrite = (src: string, dir: string | null) => rewriteIncludegraphics(src, dir, p => existsSync(p))

function nodeHost(run: CompilerHost['run']): CompilerHost {
  return {
    exists: async p => existsSync(p),
    stat: async p => {
      if (!existsSync(p)) return null
      const s = statSync(p)
      return { isDir: s.isDirectory(), isFile: s.isFile(), mtime: s.mtimeMs }
    },
    listDir: async p => readdirSync(p, { withFileTypes: true }).map(e => {
      const s = statSync(join(p, e.name))
      return { name: e.name, path: join(p, e.name), isDir: s.isDirectory(), isFile: s.isFile(), mtime: s.mtimeMs }
    }),
    mkdir: async p => { mkdirSync(p, { recursive: true }) },
    copy: async (s, d) => { cpSync(s, d, { recursive: true, preserveTimestamps: true }) },
    readText: async p => readFileSync(p, 'utf8'),
    writeText: async (p, t) => writeFileSync(p, t),
    remove: async p => rmSync(p, { recursive: true, force: true }),
    findTectonic: async () => 'tectonic',
    findTypst: async () => null,
    run,
    cancelRunning: async () => {},
    styleDirs: async () => [],
    pathListSep: ':',
  }
}

const proc = (code: number, out: string): HostRun => ({ code, stdout: out, stderr: '', timedOut: false, error: null })

// Replay `responses` keyed by the only-cached flag, as _fake_tectonic.
function fakeTectonic(dir: string, responses: Partial<Record<'true' | 'false', [number, string, boolean]>>) {
  const calls: boolean[] = []
  const host = nodeHost(async (_prog, args) => {
    const cached = args.includes('--only-cached')
    calls.push(cached)
    const [code, out, makePdf] = responses[String(cached) as 'true' | 'false']!
    if (makePdf) writeFileSync(join(dir, 'document.pdf'), '%PDF')
    return proc(code, out)
  })
  return { calls, host }
}

describe('test_compiler', () => {
  it('test_relative_path_resolves_against_source_dir', () => {
    const d = tmp()
    mkdirSync(join(d, 'Images'))
    writeFileSync(join(d, 'Images', 'foo.png'), '')
    const out = rewrite('\\includegraphics[width=0.5\\textwidth]{Images/foo.png}', d)
    // Absolute path with forward slashes, options preserved.
    expect(out).toContain('Images/foo.png')
    expect(out).toContain(d.replaceAll('\\', '/'))
    expect(out).toContain('width=0.5')
    // No placeholder leaked in.
    expect(out).not.toContain('missing image')
  })

  it('test_missing_relative_path_becomes_placeholder', () => {
    const out = rewrite('\\includegraphics{Images/does_not_exist.png}', tmp())
    expect(out).not.toContain('\\includegraphics')
    expect(out).toContain('missing image')
    // Underscore is escaped because the placeholder is typeset by LaTeX.
    expect(out).toContain('does\\_not\\_exist.png')
  })

  it('test_absolute_existing_path_left_alone', () => {
    const d = tmp()
    writeFileSync(join(d, 'a.png'), '')
    const src = `\\includegraphics{${join(d, 'a.png').replaceAll('\\', '/')}}`
    expect(rewrite(src, d)).toBe(src)
  })

  it('test_no_source_dir_missing_image_still_placeholder', () => {
    expect(rewrite('\\includegraphics{Images/foo.png}', null)).toContain('missing image')
  })

  it('test_multiple_includegraphics_each_handled', () => {
    const d = tmp()
    writeFileSync(join(d, 'ok.png'), '')
    const out = rewrite('\\includegraphics{ok.png}\n\\includegraphics{missing.png}', d)
    // First survives as an \includegraphics (absolute), second is a placeholder.
    expect(out.split('\\includegraphics').length - 1).toBe(1)
    expect(out).toContain('missing image')
    expect(out).toContain('missing.png')
  })

  it('test_underscore_in_missing_path_escaped_in_placeholder', () => {
    // The placeholder is typeset by LaTeX, so underscores in the path have
    // to be escaped or compilation fails on the placeholder itself.
    expect(rewrite('\\includegraphics{QuickStart_Preference.png}', tmp())).toContain('\\_')
  })

  it('test_compile_uses_cache_only_when_everything_is_cached', async () => {
    const d = tmp()
    const { calls, host } = fakeTectonic(d, { true: [0, 'ok', true] })
    const r = await compileTex('x', d, {}, host)
    expect(r.ok).toBe(true)
    expect(calls).toEqual([true])
  })

  it('copies only the folders beside the document that it uses', async () => {
    const src = tmp(), d = tmp()
    for (const n of ['Images', 'Projects', 'Big Library']) mkdirSync(join(src, n))
    writeFileSync(join(src, 'Images', 'a.png'), 'x')
    const { host } = fakeTectonic(d, { true: [0, 'ok', true] })
    await compileTex('\\includegraphics{Images/a.png}', d, { sourceDir: src }, host)
    expect(existsSync(join(d, 'Images'))).toBe(true)
    expect(existsSync(join(d, 'Projects'))).toBe(false)
    expect(existsSync(join(d, 'Big Library'))).toBe(false)
    // Beside a class of its own, every folder goes (its Fonts/ ...).
    writeFileSync(join(src, 'mine.cls'), '%')
    await compileTex('x', d, { sourceDir: src }, host)
    expect(existsSync(join(d, 'Projects'))).toBe(true)
  })

  it('test_compile_goes_online_when_cache_misses_a_package', async () => {
    const d = tmp()
    const { calls, host } = fakeTectonic(d, {
      true: [0, "! LaTeX Error: File `tikz.sty' not found.", true],
      false: [0, 'ok', true],
    })
    const r = await compileTex('x', d, {}, host)
    expect(r.ok).toBe(true)
    expect(calls).toEqual([true, false])
  })

  it('test_compile_offline_reports_missing_package', async () => {
    const d = tmp()
    const { host } = fakeTectonic(d, {
      true: [0, "! LaTeX Error: File `tikz.sty' not found.", true],
      false: [1, 'caused by: error sending request for url', false],
    })
    const r = await compileTex('x', d, {}, host)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('tikz.sty')
    expect(r.error).toContain('Offline')
  })

  it('test_compile_goes_online_when_cache_misses_a_bibtex_style', async () => {
    const d = tmp()
    const calls: boolean[] = []
    const host = nodeHost(async (_p, args) => {
      const cached = args.includes('--only-cached')
      calls.push(cached)
      writeFileSync(join(d, 'document.pdf'), '%PDF')
      if (cached) {  // BibTeX names the missing .bst only in the .blg
        writeFileSync(join(d, 'document.blg'), "I couldn't open style file plainnat.bst\n")
        return proc(0, 'warning: errors were issued by BibTeX')
      }
      writeFileSync(join(d, 'document.blg'), 'Database file #1: k.bib\n')
      return proc(0, 'ok')
    })
    writeFileSync(join(d, 'document.blg'), "I couldn't open style file old.bst\n")
    const r = await compileTex('x', d, {}, host)
    expect(r.ok).toBe(true)
    expect(calls).toEqual([true, false])
  })

  it('test_stale_blg_does_not_force_an_online_run', async () => {
    const d = tmp()
    writeFileSync(join(d, 'document.blg'), "I couldn't open style file old.bst\n")
    const { calls, host } = fakeTectonic(d, { true: [0, 'ok', true] })
    expect((await compileTex('x', d, {}, host)).ok).toBe(true)
    expect(calls).toEqual([true])
  })
})

// Beyond the Python suite: the remaining compile_tex branches and the pure
// helpers it relies on.
describe('compiler helpers', () => {
  it('missing class stops the preview', async () => {
    const d = tmp()
    const { host } = fakeTectonic(d, {
      true: [0, "! LaTeX Error: File `foo.cls' not found.", true],
      false: [0, "! LaTeX Error: File `foo.cls' not found.", true],
    })
    const r = await compileTex('x', d, {}, host)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('Document class foo is not available')
  })

  it('a missing font sends the compile online', () => {
    const log = 'Font \\T1/cmr/m/n/12=ecrm1200 at 12.0pt not loadable: Metric (TFM) file\n'
    expect(missingFromLog(log)).toEqual(['ecrm1200'])
  })

  it('timeout reports the 15-minute message', async () => {
    const d = tmp()
    const host = nodeHost(async () => ({ code: null, stdout: '', stderr: '', timedOut: true, error: null }))
    const r = await compileTex('x', d, {}, host)
    expect(r.error).toContain('over 15 minutes')
  })

  it('no tectonic', async () => {
    const d = tmp()
    const host = { ...nodeHost(async () => proc(0, '')), findTectonic: async () => null }
    const r = await compileTex('x', d, {}, host)
    expect(r.error).toContain('tectonic is not installed')
  })

  it('compile range keeps only the marked body', () => {
    const src = ['\\documentclass{article}', '\\begin{document}', 'a', COMPILE_START, 'b', COMPILE_END, 'c',
      '\\end{document}'].join('\n')
    expect(applyCompileRange(src)).toBe(['\\documentclass{article}', '\\begin{document}', '\\iffalse', 'a',
      COMPILE_START, '\\fi', 'b', '\\iffalse', COMPILE_END, 'c', '\\fi', '\\end{document}'].join('\n'))
  })

  it('not-compile ranges are hidden', () => {
    const src = ['x', NOT_COMPILE_START, 'y', NOT_COMPILE_END, 'z'].join('\n')
    expect(applyNotCompileRanges(src)).toBe(['x', '\\iffalse', NOT_COMPILE_START, 'y', NOT_COMPILE_END, '\\fi', 'z'].join('\n'))
  })

  it('typst compile range keeps #set rules', () => {
    const src = ['#set page(width: 1cm)', 'a', '// ===== KHERVETEX COMPILE START =====', 'b'].join('\n')
    expect(applyTypstCompileRange(src)).toBe(['#set page(width: 1cm)', '/*', 'a',
      '// ===== KHERVETEX COMPILE START =====', '*/', 'b'].join('\n'))
  })

  it('skip images draws the path', () => {
    expect(stripImages('\\includegraphics[width=1cm]{a_b.png}')).toBe('\\fbox{\\texttt{\\footnotesize a\\_b.png}}')
  })

  it('page marks: the last pass wins', () => {
    const marks = pageMarksFromLog('KDOC:0:intro:0 KDOC:1:ch:3 KDOC:1:ch:4')
    expect(marks).toEqual([{ index: 0, label: 'intro', shipped: 0 }, { index: 1, label: 'ch', shipped: 4 }])
    expect(pageCounts(marks, 9)).toEqual([4, 5])
  })
})
