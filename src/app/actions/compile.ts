// The Compile tab and the Compiler menu (MainWindow's act_compile_now,
// act_auto_compile, act_skip_images, act_compile_range, the engine group,
// Compiler status, Download offline bundle, Open the package cache).
import { isCommandChecked } from '../../ui/commands'
import { registerActions } from '../actions'
import {
  downloadBundle, kickCompile, openCache, setAutoCompile, setFastLatex, setCompileRange,
  setCompiler, setPictures, setSectionOnly, setSkipImages, showCompilerStatus,
} from '../compile'
import { appStore } from '../store'
import { applyLayoutMode } from './file'

const on = (arg: unknown) => arg === true

registerActions({
  compile_now: () => kickCompile(true),
  compile_section: (arg) => setSectionOnly(on(arg)),
  auto_compile: (arg) => setAutoCompile(on(arg)),
  fast_latex: (arg) => setFastLatex(on(arg)),
  pictures_full: () => setPictures('full'),
  pictures_medium: () => setPictures('medium'),
  pictures_low: () => setPictures('low'),
  pictures_none: () => setPictures('none'),
  skip_images: (arg) => setSkipImages(on(arg)),
  compile_range: (arg) => setCompileRange(on(arg)),
  compiler_latex: () => setCompiler('latex'),
  compiler_typst: () => setCompiler('typst'),
  compiler_status: () => showCompilerStatus(),
  download_bundle: () => downloadBundle(),
  open_cache: () => openCache(),
  // The View tab's PDF group (MainWindow._toggle_pdf_panel /
  // _toggle_pdf_detached) and Show PDF (_show_side_tab).
  pdf_panel: (arg) => applyLayoutMode(on(arg) ? (isCommandChecked('pdf_detach') ? 'window' : 'side') : 'visual'),
  pdf_detach: (arg) => applyLayoutMode(on(arg) ? 'window' : 'side'),
  view_pdf: () => {
    const l = appStore().get().layout
    if (l !== 'side' && l !== 'window') applyLayoutMode('side')
  },
})
