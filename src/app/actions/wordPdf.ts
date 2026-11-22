// File ▸ Import .docx / .pdf and Export .docx: MainWindow._import_docx,
// _import_pdf and _export_docx. The importers write embedded images into
// "<stem>_images" in the window's temp build dir until the document is
// saved somewhere.
import { strip } from '../../core/py'
import { exportDocx } from '../../core/docxExport'
import { importDocx } from '../../core/docxImport'
import type { Document as KDocument } from '../../core/model'
import { basename, join } from '../../core/paths'
import { importPdf } from '../../core/pdfImport'
import { importOdt } from '../../core/odtImport'
import { importRtf } from '../../core/rtfImport'
import { platform } from '../../platform'
import { critical, messageBox } from '../../platform/MessageBox'
import { promptText } from '../../ui/dialogs/EditorDialogs'
import { registerActions } from '../actions'
import { buildDir, docStem, resolvedSourceDir } from '../compile'
import { appStore } from '../store'
import { userName } from './editor'
import { getExtraBibliography, refreshKherverefBib } from './refs'
import { defaultTarget, fileAccess, finishImport, offerSaveBefore, registerSaveAsExport } from './file'

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
  return [dateOff(await importDocx(await platform().readFile(path), imageDir, fileAccess())), imageDir]
}

// Rich Text (.rtf) and OpenDocument text (.odt: LibreOffice, OpenOffice,
// Google Docs' "Download ▸ OpenDocument"); pictures go to the image dir.
export async function importOfficeFile(path: string): Promise<[KDocument, string]> {
  const imageDir = await imageDirFor(path)
  const bytes = await platform().readFile(path)
  const doc = path.toLowerCase().endsWith('.odt')
    ? await importOdt(bytes, imageDir, fileAccess())
    : await importRtf(bytes, imageDir, fileAccess())
  return [doc, imageDir]
}

// importers.import_pdf(path, image_dir, progress)
export async function importPdfFile(path: string,
  progress: ((page: number, total: number) => void) | null = null): Promise<[KDocument, string]> {
  const imageDir = await imageDirFor(path)
  const doc = await importPdf(await platform().readFile(path), imageDir, fileAccess(), progress, { loadPdfJs })
  return [dateOff(doc), imageDir]
}

// The imported document replaces this one, untitled, with the title
// "<stem> (imported)" (file.finishImport); docx and pdf images live in the
// build dir, so the import source dir is cleared.
function showImported(doc: KDocument, path: string, message: string): void {
  finishImport(doc, path, { sourceDir: null, message })
}

// The importers write \date{} under an imported title (as the Python app
// does); here that is the date switched off (Insert ▸ Date), so the page
// shows no date either and the switch can bring it back. Every way in
// (File ▸ Import, File ▸ Open of a .docx / .pdf, a drop) comes through here.
function dateOff(doc: KDocument): KDocument {
  if (strip(doc.meta.frontmatter_extras) === '\\date{}') {
    doc.meta.frontmatter_extras = ''
    doc.meta.show_date = false
  }
  return doc
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
  showImported(doc, path,
    `Imported ${basename(path)} (${await countImages(imageDir)} image(s) extracted to ${imageDir})`)
}

async function importOfficeAction(): Promise<void> {
  const picked = await platform().openFileDialog({ title: 'Import RTF or OpenDocument',
    filters: [{ name: 'RTF / OpenDocument (.rtf, .odt)', extensions: ['rtf', 'odt'] },
      { name: 'All files', extensions: [] }] })
  if (!picked?.length) return
  const path = picked[0]
  if (!(await offerSaveBefore(`importing ${basename(path)}`))) return
  appStore().set({ status: 'Importing…' })
  let doc: KDocument
  let imageDir: string
  try {
    [doc, imageDir] = await importOfficeFile(path)
  } catch (exc) {
    appStore().set({ status: '' })
    await critical('Import failed', exc instanceof Error ? exc.message : String(exc))
    return
  }
  showImported(doc, path, `Imported ${basename(path)} (${await countImages(imageDir)} image(s) extracted)`)
}

// The id of a Google Doc from its link (or a .gdoc file's text).
export function googleDocId(s: string): string | null {
  return /\/document\/(?:u\/\d+\/)?d\/([\w-]{20,})/.exec(s)?.[1]
    ?? /"doc_id"\s*:\s*"([\w-]{20,})"/.exec(s)?.[1] ?? null
}

// File ▸ Import ▸ Google Doc: Google Docs needs your Google sign-in, which
// your browser has. The browser downloads the document as Word (.docx),
// then that file is imported. *source* is a link or a .gdoc file's text.
export async function importGoogleDoc(source?: string): Promise<void> {
  const link = source ?? await promptText('Import a Google Doc',
    'Paste the link of the Google Doc (Share ▸ Copy link, or the address in your browser):', '')
  if (!link) return
  const id = googleDocId(link)
  if (!id) {
    await critical('Import a Google Doc', 'That is not a Google Docs link. It looks like '
      + 'https://docs.google.com/document/d/…/edit')
    return
  }
  await platform().openUrl(`https://docs.google.com/document/d/${id}/export?format=docx`).catch(() => {})
  const go = await messageBox({ title: 'Import a Google Doc', icon: 'information',
    text: 'Your browser is downloading the Google Doc as a Word file (.docx), with its pictures, '
      + 'tables and headings (usually into Downloads).\n\nWhen it has finished, choose that file.',
    buttons: [{ label: 'Choose the downloaded file…', default: true }, { label: 'Cancel' }] })
  if (go !== 'Choose the downloaded file…') return
  await importDocxAction()
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
  showImported(doc, path, `Imported ${basename(path)} (${await countImages(imageDir)} image(s) extracted)`)
}

async function exportDocxAction(): Promise<void> {
  const path = await platform().saveFileDialog({ title: 'Export Word', defaultName: defaultTarget('.docx'),
    filters: [{ name: 'Word', extensions: ['docx'] }] })
  if (path) await writeDocxTo(path)
}
registerSaveAsExport('.docx', writeDocxTo)

export async function writeDocxTo(path: string): Promise<void> {
  const doc = appStore().get().doc
  appStore().set({ status: 'Exporting…' })
  // Relative figure paths resolve where the document's files are.
  const base = resolvedSourceDir() ?? '.'
  // The references, so citations print numbered with their list, and the
  // name that signs comments without one.
  try { await refreshKherverefBib(doc) } catch { /* the references as last read */ }
  const bytes = await exportDocx(doc, base, fileAccess(), (i, total) =>
    appStore().set({ status: `Exporting… ${i}/${total}` }), { bibText: getExtraBibliography(), author: userName() })
  await platform().writeFile(path, bytes)
  showMessage(`Exported ${path}`, 4000)
}

registerActions({
  import_docx: () => importDocxAction(),
  import_pdf: () => importPdfAction(),
  import_office: () => importOfficeAction(),
  import_gdoc: () => importGoogleDoc(),
  export_docx: () => exportDocxAction(),
})
