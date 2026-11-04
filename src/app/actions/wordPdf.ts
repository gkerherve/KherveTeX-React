// File ▸ Import .docx / .pdf and Export .docx: MainWindow._import_docx,
// _import_pdf and _export_docx. The importers write embedded images into
// "<stem>_images" in the window's temp build dir until the document is
// saved somewhere.
import pkg from '../../../package.json'
import { exportDocx } from '../../core/docxExport'
import { importDocx } from '../../core/docxImport'
import type { Document as KDocument } from '../../core/model'
import { basename, join } from '../../core/paths'
import { importPdf } from '../../core/pdfImport'
import { platform } from '../../platform'
import { critical } from '../../platform/MessageBox'
import { registerActions } from '../actions'
import { buildDir, docStem, resolvedSourceDir, setImportSourceDir } from '../compile'
import { appStore, replaceDoc } from '../store'
import { fileAccess, offerSaveBefore } from './file'

const VERSION = 'v' + pkg.version.split('.').slice(0, 2).join('.')

let statusTimer: ReturnType<typeof setTimeout> | null = null
function showMessage(msg: string, ms: number): void {
  appStore().set({ status: msg })
  if (statusTimer) clearTimeout(statusTimer)
  statusTimer = setTimeout(() => { if (appStore().get().status === msg) appStore().set({ status: '' }) }, ms)
}

async function imageDirFor(path: string): Promise<string> {
  return join(await buildDir(), `${docStem(path)}_images`)
}

async function countImages(imageDir: string): Promise<number> {
  const p = platform()
  if (!(await p.exists(imageDir))) return 0
  return (await p.listDir(imageDir)).filter(e => e.name.startsWith('image_')).length
}

// pdf.js in the app: the worker the preview sets up (src/preview/pdfjs).
const loadPdfJs = async () => {
  await import('../../preview/pdfjs')
  return (await import('pdfjs-dist')) as never
}

// importers.import_docx(path, image_dir)
export async function importDocxFile(path: string): Promise<[KDocument, string]> {
  const imageDir = await imageDirFor(path)
  return [await importDocx(await platform().readFile(path), imageDir, fileAccess()), imageDir]
}

// importers.import_pdf(path, image_dir, progress)
export async function importPdfFile(path: string,
  progress: ((page: number, total: number) => void) | null = null): Promise<[KDocument, string]> {
  const imageDir = await imageDirFor(path)
  const doc = await importPdf(await platform().readFile(path), imageDir, fileAccess(), progress, { loadPdfJs })
  return [doc, imageDir]
}

// The imported document replaces this one, untitled, with the title
// "<stem> (imported)"; docx and pdf images live in the build dir, so the
// import source dir is cleared.
function showImported(doc: KDocument, path: string): void {
  setImportSourceDir(null)
  replaceDoc(doc, { path: null, dirty: false })
  void platform().setTitle(`KherveTeX ${VERSION} — ${docStem(path)} (imported)`).catch(() => {})
}

async function importDocxAction(): Promise<void> {
  const picked = await platform().openFileDialog({ title: 'Import Word document',
    filters: [{ name: 'Word', extensions: ['docx'] }, { name: 'All files', extensions: [] }] })
  if (!picked?.length) return
  const path = picked[0]
  if (!(await offerSaveBefore(`importing ${basename(path)}`))) return
  appStore().set({ status: 'Importing…' })
  let doc: KDocument
  let imageDir: string
  try {
    [doc, imageDir] = await importDocxFile(path)
  } catch (exc) {
    appStore().set({ status: '' })
    await critical('Import failed', exc instanceof Error ? exc.message : String(exc))
    return
  }
  showImported(doc, path)
  showMessage(`Imported ${basename(path)} (${await countImages(imageDir)} image(s) extracted to ${imageDir})`, 8000)
}

async function importPdfAction(): Promise<void> {
  const picked = await platform().openFileDialog({ title: 'Import PDF',
    filters: [{ name: 'PDF', extensions: ['pdf'] }, { name: 'All files', extensions: [] }] })
  if (!picked?.length) return
  const path = picked[0]
  if (!(await offerSaveBefore(`importing ${basename(path)}`))) return
  // The QProgressDialog's "Importing…" with the page count, in the status bar.
  appStore().set({ status: 'Importing…' })
  let doc: KDocument
  let imageDir: string
  try {
    [doc, imageDir] = await importPdfFile(path, (page, total) =>
      appStore().set({ status: `Importing… ${page}/${total}` }))
  } catch (exc) {
    appStore().set({ status: '' })
    await critical('Import failed', exc instanceof Error ? exc.message : String(exc))
    return
  }
  showImported(doc, path)
  showMessage(`Imported ${basename(path)} (${await countImages(imageDir)} image(s) extracted)`, 8000)
}

async function exportDocxAction(): Promise<void> {
  const path = await platform().saveFileDialog({ title: 'Export Word', defaultName: 'document.docx',
    filters: [{ name: 'Word', extensions: ['docx'] }] })
  if (!path) return
  const doc = appStore().get().doc
  appStore().set({ status: 'Exporting…' })
  // Relative figure paths resolve where the document's files are.
  const base = resolvedSourceDir() ?? '.'
  const bytes = await exportDocx(doc, base, fileAccess(), (i, total) =>
    appStore().set({ status: `Exporting… ${i}/${total}` }))
  await platform().writeFile(path, bytes)
  showMessage(`Exported ${path}`, 4000)
}

registerActions({
  import_docx: () => importDocxAction(),
  import_pdf: () => importPdfAction(),
  export_docx: () => exportDocxAction(),
})
