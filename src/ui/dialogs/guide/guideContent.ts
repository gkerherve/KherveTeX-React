// Help ▸ User guide (F1): the illustrated kTeX guide. Each chapter is
// HTML built with the small helpers below; the pictures live in
// public/guide/ (screenshots of this app: scripts/guide-shots/README.md).
// A "Show me" link (data-tab / data-group) brings that ribbon tab forward
// and makes the group flash, as the Search tools box does.
import { SHORTCUT_ROWS } from '../helpGuide'

export interface GuideChapter {
  id: string
  title: string
  // One line under the title, and in the contents.
  blurb: string
  // A short word for the side list's coloured badge.
  part: 'Start' | 'Write' | 'Insert' | 'Look' | 'Output' | 'Together' | 'More'
  html: string
}

const IMG = (name: string) => `guide/${name}`

// A screenshot with its caption; `wide` spans the full width.
function fig(name: string, caption: string, opts: { wide?: boolean; small?: boolean; callouts?: [number, number, number][] } = {}): string {
  const marks = (opts.callouts ?? []).map(([n, x, y]) =>
    `<span class="g-mark" style="left:${x}%;top:${y}%">${n}</span>`).join('')
  return `<figure class="g-fig${opts.wide ? ' g-wide' : ''}${opts.small ? ' g-small' : ''}">`
    + `<div class="g-shot">${marks}<img src="${IMG(name)}" alt="${caption.replace(/<[^>]+>/g, '').replace(/"/g, '&quot;')}" loading="lazy"></div>`
    + `<figcaption>${caption}</figcaption></figure>`
}

// Two pictures side by side.
function pair(a: [string, string], b: [string, string]): string {
  return `<div class="g-pair">${fig(a[0], a[1])}${fig(b[0], b[1])}</div>`
}

const tip = (html: string) => `<div class="g-call g-tip"><b>Tip</b><div>${html}</div></div>`
const note = (html: string) => `<div class="g-call g-note"><b>Good to know</b><div>${html}</div></div>`
const beta = (html: string) => `<div class="g-call g-beta"><b><span class="beta-tag">beta</span></b><div>${html}</div></div>`
const k = (keys: string) => keys.split('+').map(x => `<kbd>${x}</kbd>`).join('+')
const show = (tab: string, group: string, label = `Show me: ${tab} ▸ ${group}`) =>
  `<button type="button" class="g-show" data-tab="${tab}" data-group="${group}">${label} →</button>`

// Numbered steps.
const steps = (...items: string[]) => `<ol class="g-steps">${items.map(i => `<li>${i}</li>`).join('')}</ol>`

// A grid of cards: [title, text, chapter id].
const cards = (...items: [string, string, string][]) =>
  `<div class="g-cards">${items.map(([t, d, id]) => `<a class="g-card" href="#${id}"><b>${t}</b><span>${d}</span></a>`).join('')}</div>`

// A "what is where" table.
const table = (head: string[], rows: string[][]) =>
  `<table class="g-table"><thead><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>`
  + rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('') + '</tbody></table>'

const legend = (...items: string[]) => `<ol class="g-legend">${items.map(i => `<li>${i}</li>`).join('')}</ol>`

function shortcutsHtml(): string {
  return '<div class="g-keys">' + SHORTCUT_ROWS.map(([group, rows]) =>
    `<section><h4>${group}</h4><table>${rows.map(([key, what]) =>
      `<tr><td>${key.split(' / ').map(part => k(part.replace('Ctrl', 'Ctrl'))).join(' / ')}</td><td>${what}</td></tr>`).join('')}</table></section>`).join('')
    + '</div>'
}

export const GUIDE: GuideChapter[] = [
  {
    id: 'welcome', part: 'Start', title: 'Welcome to kTeX',
    blurb: 'Write like in Word, publish in LaTeX.',
    html: `
<p class="g-lead">kTeX is a word processor that writes real LaTeX. You type on a page that looks like the printed
result, with a Word-style ribbon, and every pause turns your document into a typeset PDF: the same quality as the
journals, theses and books that LaTeX is known for, without having to learn LaTeX first.</p>
${fig('desktop-window.webp', 'kTeX with the PDF beside the page. You write on the left; on the right, the PDF that LaTeX typesets from it, updated as you type.', { wide: true })}
<h3>Three things to know</h3>
<div class="g-three">
  <div><b>1. The page is the document.</b> Headings, lists, tables, equations and figures are real objects, not
  formatted text. kTeX turns them into clean, readable LaTeX for you.</div>
  <div><b>2. The PDF is the truth.</b> The page you type on mimics the PDF closely, but the PDF is what LaTeX
  prints. When the two differ, trust the PDF.</div>
  <div><b>3. Nothing is locked in.</b> Your <code>.ktex</code> file holds the LaTeX too. Export a
  <code>.tex</code>, a Word file or a zip for Overleaf at any time.</div>
</div>
<h3>Where to go from here</h3>
${cards(
  ['Getting started', 'Your first document in five minutes.', 'start'],
  ['The window', 'What every part of the screen does.', 'window'],
  ['The ribbon', 'Tabs, Search tools and the folded ribbon.', 'ribbon'],
  ['Equations', 'The equation builder, symbols and chemistry.', 'maths'],
  ['References', 'Zotero, KherveRef, BibTeX and citation styles.', 'references'],
  ['Design', 'Themes, style sets, watermarks and page colour.', 'design'],
)}
${tip(`Press ${k('F1')} at any time to open this guide, and type in its search box to find a topic. The
<b>Search tools</b> box at the top right of the window finds any button and takes you to it.`)}
`,
  },
  {
    id: 'start', part: 'Start', title: 'Getting started',
    blurb: 'The welcome page, how you want to work, and a first document.',
    html: `
<p>When kTeX starts, the <b>welcome page</b> offers everything you need to begin: a new document, a file to open,
a new project for a thesis or a book, the guided tour, and the examples and templates.</p>
${fig('welcome.webp', 'The welcome page. Pick a starting point on the left or in the middle, and choose how you want to work below.', { wide: true })}
<h3>How do you want to work?</h3>
${table(['Mode', 'What you see', 'Best for'], [
  ['<b>Visual + PDF side by side</b>', 'The page on the left, the compiled PDF on the right, updated as you type.', 'Most work, on a wide screen.'],
  ['<b>Visual + PDF in its own window</b>', 'The PDF in a separate window you can move to a second screen.', 'Two monitors.'],
  ['<b>Visual only</b>', 'The page and the Documents list; nothing compiles while you write.', 'Writing without distraction, laptops.'],
  ['<b>Page only, like Word</b>', 'Just the page.', 'The cleanest view.'],
])}
<p>You can change your mind later on the <b>View</b> menu (<i>Visual only</i>, <i>PDF side panel</i>
${k('Ctrl+4')}, <i>PDF in its own window</i>).</p>
<h3>Your first document in five minutes</h3>
${steps(
  `Press ${k('Ctrl+N')} (${k('Cmd+N')} on a Mac) for a blank page, or open the <b>Examples</b> tab and pick a ready-made document.`,
  'Choose the <b>Document type</b> on the Design tab: article, report, book, letter, slides, a journal class…',
  'Type your title. Click <b>Title</b> in the Styles gallery of the Home tab; then type and style the author line, the abstract and the headings the same way.',
  'Add what you need from the <b>Insert</b> and <b>References</b> tabs: a table, a figure, an equation, a citation.',
  `Watch the PDF update, or press <b>Compile PDF</b> at the top right (${k('Ctrl+Shift+C')}).`,
  `Save with ${k('Ctrl+S')}. Export a PDF, a Word file or the LaTeX from <b>File ▸ Export</b>.`,
)}
${tip('Not sure where to start? <b>Help ▸ Take the guided tour</b> opens a ten-minute tour that is itself a kTeX document: try every tool on it, nothing is saved unless you save it.')}
`,
  },
  {
    id: 'window', part: 'Start', title: 'The window at a glance',
    blurb: 'Menus, ribbon, page, PDF and status bar.',
    html: `
<p>Everything in kTeX lives in one window. The numbers below match the picture.</p>
${fig('desktop-window.webp', 'The kTeX window. The numbered areas are explained below.', {
  wide: true,
  callouts: [[1, 1.6, 3.2], [2, 92.5, 3.2], [3, 3.5, 6.2], [4, 27, 6.2], [5, 75.5, 6.2], [6, 88.5, 6.2], [7, 36, 13], [8, 33, 55], [9, 88, 45], [10, 3, 95.5], [11, 53, 95.5], [12, 93, 95.5]],
})}
${legend(
  '<b>Menu bar</b>: File, Edit, View, Insert, Format, Tools, Window and Help hold every command, including the rarer ones.',
  '<b>Search tools</b>: type what you want (“table of contents”, “watermark”) and press Enter: kTeX opens the right tab and runs it.',
  '<b>Quick access</b>: New, Open, Save, Print, Undo and Redo. Choose which show in <i>Preferences ▸ Ribbon &amp; Toolbar</i>.',
  '<b>Ribbon tabs</b>: Home, Insert, Draw, Design, Layout, View, References, Review, History, Compile, Examples and Help. Double-click a tab to fold the ribbon.',
  '<b>Send feedback</b>: kTeX is in beta; this button writes to the author. Every report helps.',
  '<b>Compile PDF</b> and auto-compile, the user guide and Preferences.',
  '<b>The ribbon</b>: the tools of the chosen tab, in named groups.',
  '<b>The page</b>: where you write. It follows the PDF layout: same fonts, margins, numbering and page breaks.',
  '<b>The PDF</b>: the typeset result. Click in it to jump to the same place on the page.',
  '<b>Recent files</b> and the document name, with its save state.',
  '<b>Zoom</b>: the page zoom, then the PDF zoom; and the light / dark switch.',
  '<b>Compiler status</b>: whether LaTeX (tectonic) is ready.',
)}
${note('Contextual tabs appear only when you need them: click in a table and <b>Table Design</b> and <b>Table Layout</b> join the ribbon; click a picture, an equation or a theorem for theirs. They disappear when you click elsewhere, as in Word.')}
`,
  },
  {
    id: 'ribbon', part: 'Start', title: 'The ribbon, search and menus',
    blurb: 'Every tab, the contextual tabs, Search tools and folding the ribbon.',
    html: `
<p>The ribbon groups the tools by task. Here is every tab, from left to right.</p>
<div class="g-tabs">
${([
  ['home', 'Home', 'Export, the clipboard, fonts and character styles, paragraphs and lists, and the <b>Styles</b> gallery (Normal, Title, Heading 1–3…).', 'Styles'],
  ['insert', 'Insert', 'Page breaks and the date, tables, coloured boxes and checklists, figures, drawings and charts, timelines, progress bars and steps (Plan), pull quotes, sidebars, ratings, gauges, QR codes, code and drop caps (Elements), tables of contents and links.', 'Illustrations'],
  ['insert', 'Math', 'Equations (inline, display, the equation builder, symbols, matrices), units and constants, theorems and algorithms, function plots, statistics, Venn diagrams, number lines, triangles and the unit circle.', 'Equations'],
  ['insert', 'Science', 'Physics notation, significant figures and nuclides; chemical reactions, structures, schemes, MO diagrams, hazard labels, Bohr models and element tiles; data plots, circuits, Feynman diagrams, forces, rays, waves and energy levels; lab notebooks, risk matrices and safety signs.', 'Chemistry'],
  ['draw', 'Draw', 'Draw on the page with a pen, pencil or highlighter; erase; add your own pens. <span class="beta-tag">beta</span>', 'Pens'],
  ['design', 'Design', 'Themes, style sets, colours, fonts, paragraph spacing, watermark, page colour and borders, and the document type.', 'Document Formatting'],
  ['layout', 'Layout', 'Margins, orientation, paper size, columns, indents and spacing; header, footer, page numbers and header style; margin notes.', 'Page Setup'],
  ['view', 'View', 'Visual, Code and Console; the PDF panel and detached PDF; zoom; LaTeX source; the Documents panel.', 'Views'],
  ['references', 'References', 'Citations, the reference library and style; import from Zotero, Mendeley, EndNote, KherveRef or a file; footnotes; captions and cross-references.', 'Citations'],
  ['review', 'Review', 'Spelling, comments, Track Changes, Accept / Reject, and sharing with Overleaf.', 'Comments'],
  ['compile', 'Compile', 'Compile now, auto-compile, compile range, skip images, export PDF and print preview; version snapshots, the version history and GitHub.', 'Compile'],
  ['examples', 'Examples', 'Ready-made documents and templates of every kind, and your own templates.', 'Examples & templates'],
] as [string, string, string, string][]).map(([f, name, text, group]) =>
  `<div class="g-tabrow"><div class="g-tabhead"><b>${name}</b><span>${text}</span>${show(name, group, 'Show me')}</div><img src="${IMG(`tab-${f}.webp`)}" alt="The ${name} tab" loading="lazy"></div>`).join('')}
</div>
<p><b>Help</b> (this guide, keyboard shortcuts, the welcome page, updates, About) is the <b>?</b> menu by Settings, top right.</p>
<h3>Contextual tabs</h3>
<p>Click inside a table, a picture, an equation, a theorem, a box or any element and its own tab appears on the right of the others,
coloured, as in Word.</p>
${pair(['table-context.webp', 'Click in a table: <b>Table Design</b> (styles, header row, shading) and <b>Table Layout</b> (rows, columns, merge, sort) appear.'],
  ['equation-context.webp', 'Click on an equation: the <b>Equation</b> tab edits it, numbers it, labels it or deletes it.'])}
<h3>Search tools</h3>
<p>The <b>Search tools</b> box, at the right of the menu bar, knows every button and menu item. Type a few letters:
each result says where the tool lives (<i>Insert ▸ Contents ▸ Table of Contents</i>). Press Enter or click: kTeX opens
that tab, flashes the group and runs the tool.</p>
${fig('search.webp', 'Searching for “table”: every tool whose name matches, with its tab and group.')}
<h3>Fold the ribbon</h3>
<p><b>Double-click any tab name</b> to fold the ribbon to the row of tab names and give the page the room. Click a
tab to use it once; double-click again to bring the ribbon back.</p>
${fig('ribbon-folded.webp', 'The folded ribbon: only the tab names remain, and the page starts right under them.', { wide: true })}
${tip('Want fewer tabs? <b>Preferences ▸ Ribbon &amp; Toolbar</b> hides the tabs and quick-access buttons you never use, and can hide the group titles.')}
`,
  },
  {
    id: 'writing', part: 'Write', title: 'Writing and formatting',
    blurb: 'Styles, fonts, paragraphs, lists, spelling and AutoCorrect.',
    html: `
${fig('tab-home.webp', 'The Home tab.', { wide: true })}
<h3>Paragraph styles: the heart of a LaTeX document</h3>
<p>In kTeX a heading is not big bold text: it is a <i>Heading</i>. Choose the style of the current paragraph in the
<b>Styles</b> gallery, and kTeX numbers it, puts it in the table of contents and prints it the way the document type
wants. The tiles are drawn in the font and size the PDF uses.</p>
${table(['Style', 'Becomes in LaTeX', 'Use it for'], [
  ['Normal (Body text)', 'a paragraph', 'Everything you write.'],
  ['Title, Author, Affiliation, Correspondence', '<code>\\title</code>, <code>\\author</code>…', 'The title block, printed by <code>\\maketitle</code>.'],
  ['Abstract, Keywords', '<code>abstract</code>, keywords', 'The summary of an article.'],
  ['Chapter', '<code>\\chapter</code>', 'Reports, theses and books.'],
  ['Heading 1 to 5', '<code>\\section</code> … <code>\\subparagraph</code>', 'The structure of the text.'],
  ['Frame (slide), Box (framed)', 'a Beamer frame, a framed box', 'Slides; boxed text.'],
])}
<h3>Fonts and characters</h3>
<p>The <b>Font</b> group sets the font, the size and bold ${k('Ctrl+B')}, italic ${k('Ctrl+I')}, underline
${k('Ctrl+U')}, strike-through, subscript, superscript, small caps, code, highlight and font colour. <b>Change Case</b>
switches between Sentence case, lowercase, UPPERCASE and Capitalise Each Word. Every mark becomes the matching LaTeX
command, so the PDF always agrees with the page.</p>
<h3>Paragraphs and lists</h3>
<p>Bullets, numbering and multilevel lists start a list; ${k('Tab')} and ${k('Shift+Tab')} nest and un-nest an item.
Alignment, line spacing, shading and borders sit beside them. <b>Sort</b> orders the selected paragraphs A→Z or Z→A.
<b>Show/Hide ¶</b> (${k('Ctrl+*')}) shows the paragraph marks and page breaks, as in Word.</p>
<h3>Spelling and AutoCorrect</h3>
<p>Misspelt words get a red wavy line; right-click one for suggestions. <b>Review ▸ Spelling list</b> (${k('F7')})
lists them all. AutoCorrect replaces <code>--&gt;</code> with →, <code>(c)</code> with ©, <code>...</code> with …,
<code>--</code> with an en dash and more as you type; switch each rule on or off in <b>Preferences ▸ AutoCorrect</b>.</p>
${tip('A page break looks as in Word: the text after it starts on a new sheet, and with ¶ shown you see the dotted <i>Page Break</i> line.')}
${show('Home', 'Styles')}
`,
  },
  {
    id: 'insert', part: 'Insert', title: 'Tables, pictures and diagrams',
    blurb: 'Tables, figures, drawings, flowcharts, charts and SmartArt; where everything is on the Insert tab.',
    html: `
${fig('tab-insert.webp', 'The Insert tab.', { wide: true })}
${table(['Group', 'What is in it'], [
  ['<b>Pages</b>', 'Page break, page number, horizontal rule, the date.'],
  ['<b>Tables &amp; Boxes</b>', 'Table, coloured Box, Checklist.'],
  ['<b>Illustrations</b>', 'Figure; <b>Drawing</b> (drawing canvas, shapes, flowchart builder, SmartArt); <b>Charts</b> (chart editor, quick chart, Gantt chart, chart from a table); Icon; Screenshot.'],
  ['<b>Plan</b>', 'Timeline, Progress Bars, Steps.'],
  ['<b>Elements</b>', 'Pull Quote, Sidebar, Rating, Gauge, QR Code, Code Listing, Drop Cap.'],
  ['<b>Contents</b>, <b>Links</b>', 'Tables of contents and figures; links, cross-references, citations.'],
])}
${note('Equations, theorems and chemistry have moved to their own <b>Math</b> and <b>Science</b> tabs; headers and footers to the <b>Layout</b> tab.')}
<h3>Tables</h3>
<p><b>Table</b> opens Word's grid: move over it to choose the size and click. The table is a real LaTeX table with a
caption and a label for cross-references. While the caret is in it, <b>Table Design</b> picks a style (plain, grid,
booktabs, striped, no lines), a <b>Fancy Style</b> in one colour (banded, coloured header, accent lines), a header row,
repeated header rows and shading; <b>Table Layout</b> adds and deletes rows and columns, merges and splits cells, aligns,
sorts, moves the table and makes a <b>Chart from Table</b>.</p>
${pair(['insert-table-menu.webp', 'Insert ▸ Table: drag over the grid, or choose Insert Table… for exact numbers.'],
  ['table-context.webp', 'A table in the tour, with the Table Design tab open.'])}
<h3>Figures</h3>
<p><b>Figure</b> places an image (PNG, JPG, PDF, SVG…) with a caption and a label. Drag pictures from the Finder or
Explorer straight onto the page. Click a picture for the <b>Picture</b> tab: left, centre, right; 25 to 100 % of the
text width; caption; edit or delete. <b>Screenshot</b> inserts a capture of your screen.</p>
<h3>Drawings and shapes</h3>
<p><b>Drawing</b> opens a vector canvas: lines, arrows, shapes, text, a library of symbols, a grid and snapping. The
drawing goes into the document as a vector figure; double-click it to edit it again. <b>Shapes</b> starts the canvas with
the shape you pick.</p>
${fig('drawing.webp', 'The drawing canvas: tools on the left, the shape properties on the right.', { wide: true })}
<h3>Flowcharts</h3>
<p>The <b>Flowchart builder</b> (${k('Ctrl+Shift+F')}) builds a TikZ flowchart by clicking: each shape you click is
added after the selected box and joined by an arrow. Drag boxes to move them, edit the text and the arrow labels on the
right, choose the direction and the colours, and <b>Tidy up</b> lays it out for you.</p>
${fig('flowchart.webp', 'The flowchart builder: shapes along the top, the chart in the middle, its text and links on the right.', { wide: true })}
<h3>Charts</h3>
<p><b>Charts ▸ Chart…</b> opens the chart editor. Pick one of ten types on the left (each says what it is for), type or paste
your numbers in the sheet below the chart (as in Excel: ${k('Tab')} and ${k('Enter')} move between cells, a block
pasted from Excel fills the sheet), and format it on the right: titles, axis titles, legend, gridlines, data labels,
colours and the value range; on the <b>Series</b> tab, each series' colour, line style, width, marker and a smooth line.
The chart goes into the document as a vector PDF, crisp at any size. <b>Double-click it on the page</b> to change
anything later: the type, the data, the look.</p>
${fig('chart.webp', 'The chart editor: chart types and what they are for on the left, the chart and its data sheet in the middle, the Format panel on the right.', { wide: true })}
${table(['Type', 'Use it for'], [
  ['Column, Stacked column', 'Comparing amounts across a few groups; parts of a total.'],
  ['Bar, Stacked bar', 'The same, horizontal: long category names, many categories.'],
  ['Line, Area', 'A trend over time or an ordered sequence.'],
  ['Scatter, Scatter with lines', 'Measured X, Y data: correlations, curves, calibrations, kinetics.'],
  ['Pie, Doughnut', 'Shares of one total (the first series).'],
])}
<h3>SmartArt</h3>
${fig('smartart.webp', '<b>SmartArt</b>: type a list and pick a layout (list, process, cycle, hierarchy, relationship, pyramid, matrix).', { small: true })}
${show('Insert', 'Illustrations')}
`,
  },
  {
    id: 'boxes', part: 'Insert', title: 'Coloured boxes and checklists',
    blurb: 'Note, Tip, Warning and Danger boxes, your own boxes, and tick-box lists.',
    html: `
<p>A box sets text apart in a coloured frame with a title bar, as textbooks and manuals do. It is on
<b>Insert ▸ Tables &amp; Boxes ▸ Box</b>: the button inserts a Note, the arrow offers every kind.</p>
${table(['Box', 'Use it for'], [
  ['<b>Note</b>', 'Something worth knowing that is not part of the main line of the text.'],
  ['<b>Tip</b>', 'A shortcut or a better way to do something.'],
  ['<b>Information</b>', 'Background or context.'],
  ['<b>Important</b>', 'What must not be missed: a deadline, a requirement.'],
  ['<b>Warning</b>', 'A risk of a wrong result or lost work.'],
  ['<b>Danger</b>', 'Harm to people or equipment.'],
  ['<b>Key points</b>', 'A summary at the end of a section.'],
  ['<b>Custom…</b>', 'Your own heading (Exercise, Did you know?) in any colour.'],
])}
${steps(
  'Put the caret where the box should go and choose <b>Insert ▸ Box</b> (or a kind from its arrow).',
  'Type inside it. <b>Enter</b> starts another paragraph in the same box; <b>Enter</b> on an empty line, <b>Shift+Enter</b> or <b>Text after box</b> leaves it.',
  'While the caret is in the box, its <b>Box</b> tab is open: change its <b>Type</b>, its <b>Name &amp; Colour</b> (or click its title bar), move it, remove the frame but keep the text, or delete it.',
)}
${tip('Hover over a box: a grip (⋮⋮) appears in the left margin. Drag it to move the whole box; a line shows where it will land. Tables, theorems and every element move the same way.')}
<h3>Checklists</h3>
<p><b>Insert ▸ Tables &amp; Boxes ▸ Checklist</b> adds a list with tick boxes, e.g. "Before you submit". <b>Click a box on the
page to tick or untick it.</b> Click elsewhere on the checklist to select it: its <b>Checklist</b> tab offers square boxes or
circles, one to three columns, ticked items in grey, Tick all and Untick all, and the colour. <b>Edit…</b> (or a
double-click) takes one item per line; start a line with <code>[x]</code> to tick it.</p>
${show('Insert', 'Tables & Boxes')}
`,
  },
  {
    id: 'elements', part: 'Insert', title: 'Elements: timelines, quotes, QR codes…',
    blurb: 'Plan and Elements: drawn, editable blocks with their own tabs.',
    html: `
<p>The <b>Plan</b> and <b>Elements</b> groups of the Insert tab add drawn blocks that look the same on the page as in
the PDF. They all work the same way:</p>
${steps(
  'Click the button: the element goes in at the caret, with example content, already selected.',
  'Its own tab opens on the ribbon with all its options. Change any of them and the element redraws at once.',
  '<b>Edit…</b> (or a double-click on the element) opens its contents: items, text, data, labels.',
  '<b>Move up</b> / <b>Move down</b>, or drag the grip (⋮⋮) in the left margin, moves it. It never splits across a page.',
  '<b>Delete</b>, or the <b>×</b> in its top-right corner, removes it (Ctrl+Z brings it back). <b>Close</b> puts the caret after it.',
)}
${table(['Element', 'What it is', 'Edit… takes'], [
  ['<b>Timeline</b>', 'Dated events down the page or across it.', 'Date | Title | Text, one per line'],
  ['<b>Progress Bars</b>', 'Labelled bars with percentages: rounded, square or thin, three lengths.', 'Label: 70, one per line'],
  ['<b>Steps</b>', 'Numbered circles joined by arrows: across or down.', 'Title | text, one per line'],
  ['<b>Pull Quote</b>', 'A sentence set large in colour: rules, side bar or quote marks.', 'The quotation and who said it'],
  ['<b>Sidebar</b>', 'A tinted panel beside the text (right or left), or across it.', 'A title and the text'],
  ['<b>Rating</b>', 'Stars or dots out of 5 or 10, halves allowed.', 'Item: 4.5, one per line'],
  ['<b>Gauge</b>', 'Round meters for percentages: half circles or rings.', 'Label: 64, one per line'],
  ['<b>QR Code</b>', 'A code readers scan with a phone: three sizes, any colour.', 'The link and a caption'],
  ['<b>Code Listing</b>', 'Program code in colour, 13 languages, light, dark or plain, line numbers.', 'The code itself (Tab indents)'],
  ['<b>Drop Cap</b>', 'A large first letter over 2 to 5 lines, in the text or the margin.', 'The letter and the rest of the word'],
])}
<h3>Charts, Gantt charts and icons</h3>
<p><b>Insert ▸ Illustrations ▸ Charts</b> holds <b>Chart…</b> (the full chart editor), <b>Quick Chart</b> (columns, bars,
a line or a pie from a few numbers, edited on the page), <b>Gantt Chart</b> (tasks and milestones over days, weeks,
months, quarters or years) and <b>Chart from Table</b>. <b>Icon</b> puts a small picture in the text (phone, e-mail,
star, warning, flask…): 54 icons with a search box, four sizes, any colour.</p>
${tip('Click in a table, then <b>Table Layout ▸ Chart from Table</b>: a chart of its numbers appears under it. The first row names the series, the first column the labels.')}
<h3>Coloured tables</h3>
<p>In a table, <b>Table Design ▸ Fancy Styles</b> draws it in one colour: <b>Banded</b> (a filled header and tinted
alternate rows), <b>Coloured header</b> (a filled header and grey rules) or <b>Accent lines</b> (coloured rules only).
<b>Colour</b> picks the colour.</p>
${show('Insert', 'Elements')}
`,
  },
  {
    id: 'maths', part: 'Insert', title: 'The Math tab',
    blurb: 'Equations, units and constants, theorems and algorithms, graphs, statistics and geometry.',
    html: `
<p>Mathematics is where LaTeX shines. The <b>Math</b> tab gathers everything for it.</p>
${table(['Tool', 'Shortcut', 'What it does'], [
  ['<b>Inline math</b>', k('Ctrl+M'), 'Maths inside a sentence, like <i>E</i> = <i>mc</i>².'],
  ['<b>Math block</b>', k('Ctrl+Shift+M'), 'A displayed, numbered equation.'],
  ['<b>Equation builder</b>', k('Ctrl+Shift+E'), 'Build an equation visually from templates, with a live preview.'],
  ['<b>Symbol</b>', k('Ctrl+Shift+G'), 'Greek letters, operators, arrows, relations…'],
  ['<b>Matrix</b>', '', 'Any size; round, square, curly or determinant brackets; symbols, zeros, identity or a general m × n with dots.'],
])}
<h3>The equation builder</h3>
<p>Click a template (fractions, sums, integrals, matrices, brackets, functions, multi-line) or simply type:
<code>/</code> makes a fraction, <code>^</code> a superscript, <code>_</code> a subscript, and a backslash name such as
<code>alpha</code> a Greek letter. ${k('Tab')} jumps to the next empty box. <b>Show LaTeX</b> reveals the code.</p>
${fig('equation-builder.webp', 'The equation builder, with Euler’s identity typed in.', { wide: true })}
${tip('Double-click any equation on the page to reopen it in the builder; <b>Insert</b> then replaces it in place.')}
<h3>Numbers</h3>
<p><b>Units</b> sets a value with its unit and uncertainty as SI quantities are: type <code>9.81</code>,
<code>0.02</code> and <code>m/s^2</code> for (9.81 ± 0.02) m s⁻²; <code>6.02e23</code> becomes 6.02 × 10²³.
<b>Constants</b> inserts 19 physical constants with their values and units.</p>
<h3>Theorems and algorithms</h3>
<p><b>Theorem</b> inserts a theorem; its arrow offers lemma, proposition, corollary, definition, example, remark and
proof. They are numbered as in the PDF, and theorems are set in italics. While the caret is in one, its <b>Theorem</b> tab
changes its kind, gives it a <b>Name</b> (shown in brackets), adds a <b>Proof After</b> it, leaves it with
<b>Text after</b>, moves, removes or deletes it.</p>
<p><b>Algorithm</b> sets pseudocode as papers print it: write it with indented blocks, and <code>function</code>,
<code>if … then</code>, <code>else</code>, <code>for</code>, <code>while</code> and <code>return</code> become bold, numbered
lines; <code>x = …</code> shows as x ← ….</p>
<h3>Graphs &amp; Data</h3>
${table(['Tool', 'What it draws'], [
  ['<b>Function Plot</b>', 'Graphs of y = f(x): type <code>sin(x)</code>, <code>0.5*x^2 - 2</code>, <code>exp(-x^2)</code>… one per line, with axes, a grid and a legend.'],
  ['<b>Statistics</b>', 'A histogram or a box plot of your numbers, with n, the mean, the median and s worked out.'],
  ['<b>Venn Diagram</b>', 'Two or three sets; A, B, AB, ABC… say what each region holds.'],
  ['<b>Number Line</b>', 'Open and closed points and intervals, for inequalities.'],
  ['<b>Geometry</b>', 'Any figure: see below.'],
  ['<b>Unit Circle</b>', 'Your angles with their (cos, sin) values and the sine and cosine lines.'],
])}
<h3>Geometry</h3>
<p>Pick a shape (triangle from three sides, right triangle, square, rectangle, parallelogram, trapezium, regular
polygon, circle) and its sizes: side lengths, angles, right-angle marks and equal-side ticks are worked out and drawn.
To change anything, <b>Edit as Points</b> turns the figure into a short script, one instruction per line:</p>
${table(['Write', 'To get'], [
  ['<code>A = (0, 0)</code>', 'a point A'],
  ['<code>polygon A B C fill</code>', 'a shaded polygon through the points'],
  ['<code>segment A B dashed</code>, <code>arrow A B</code>', 'a line (dashed), an arrow'],
  ['<code>circle O 2</code>', 'a circle of radius 2 around O'],
  ['<code>angle A B C</code>, <code>right A B C</code>', 'the angle at B with its value, a right-angle mark'],
  ['<code>length A B 5 cm</code>', 'a length (or your label) beside AB'],
  ['<code>tick A B 2</code>', 'two equal-side ticks on AB'],
  ['<code>dot A</code>, <code>text A "words" below</code>', 'a dot, a label'],
])}
${show('Math', 'Equations')}
`,
  },
  {
    id: 'science', part: 'Insert', title: 'The Science tab',
    blurb: 'Notation, chemistry, physics and data, safety and the lab notebook.',
    html: `
<p>The <b>Science</b> tab holds the tools of the lab and the lecture room. Every drawn one works like the elements: it
opens its own tab, <b>Edit…</b> changes its contents, it moves with the grip and deletes with the ×.</p>
<h3>Notation</h3>
${table(['Tool', 'What it does'], [
  ['<b>Physics</b>', 'Bra-kets, matrix elements, operators, commutators, derivatives, ∇, norms, the Schrödinger equation.'],
  ['<b>Sig. Figures</b>', 'Rounds a value to its uncertainty (1 significant figure, 2 if it starts with 1); with a second value and + − × ÷, combines them and propagates the errors.'],
  ['<b>Nuclide</b>', '²³⁸₉₂U from the element and mass number; choose alpha, beta or gamma decay and the whole equation is written, the daughter found for you.'],
])}
<h3>Chemistry</h3>
${table(['Tool', 'What it does'], [
  ['<b>Chemical reaction</b>', 'Type <code>2H2 + O2 -&gt; 2H2O</code>: a typeset reaction (mhchem).'],
  ['<b>Chemical structure</b>', 'Structural formulas with chemfig, from a palette, with a live preview.'],
  ['<b>Reaction Scheme</b>', 'Molecules joined by arrows, reagents above and conditions below.'],
  ['<b>MO Diagram</b>', 'The molecular orbital diagram of H₂ to Ne₂, filled with electrons.'],
  ['<b>Hazard Labels</b>', 'GHS red diamonds, Danger or Warning, and the H and P statements written out from their codes.'],
  ['<b>Bohr Model</b>, <b>Element Tiles</b>', 'An atom with its shells; periodic-table tiles. All 118 elements.'],
])}
<h3>Physics &amp; Data</h3>
${table(['Tool', 'What it draws'], [
  ['<b>Data Plot</b>', 'Your measured data (XPS, XRD, IR…): paste columns, reverse the x axis, label the peaks.'],
  ['<b>Circuit</b>', 'Batteries, resistors, lamps, switches, capacitors, diodes, meters, in series or parallel.'],
  ['<b>Ray Diagram</b>', 'A converging or diverging lens, the rays, and the image worked out.'],
  ['<b>Feynman</b>', 'Four processes, with your particle labels.'],
  ['<b>Wave</b>', 'Sine, square, triangle, sawtooth, damped, standing, beats, wave packet or longitudinal; λ or T, A, crests or nodes, a direction arrow, a second wave.'],
  ['<b>Forces</b>', 'A free-body diagram: a box, a ball or a block on a slope.'],
  ['<b>Energy Levels</b>', 'Levels and transitions, as for hydrogen.'],
])}
<h3>Safety &amp; the lab</h3>
<p><b>Risk Matrix</b> places your risks on a 5 × 5 likelihood × severity grid; <b>Safety Signs</b> draws mandatory,
prohibition, warning, emergency and fire signs. <b>Lab Notebook</b> is a dated entry with any sections you like:
<b>Edit…</b> shows it as text where <code>## Heading</code> starts a section, and in a section <code>-</code> makes
bullets, <code>1.</code> numbered steps, <code>[ ]</code> and <code>[x]</code> tick boxes, <code>| a | b |</code> table
rows, <code>**bold**</code> and <code>$…$</code> maths. Its tab adds a section, starts from a template (Experiment,
Synthesis, Measurement, Field work, Meeting), and adds signature lines.</p>
${fig('chemistry.webp', 'The chemical reaction editor: palettes above, the formula below, the typeset reaction on top.', { wide: true })}
${show('Science', 'Chemistry')}
`,
  },
  {
    id: 'worktabs', part: 'Insert', title: 'Extra tabs: office, accounts, architecture, chemical engineering, earth science',
    blurb: 'Five extra tabs, off until you switch them on: letters and meetings, statements and invoices, plans and schedules, process diagrams and balances, geology plots and logs.',
    html: `
<p>Five extra tabs are there for particular kinds of work. They are hidden until you tick them in
<b>Settings ▸ Ribbon &amp; Toolbar</b> (under <i>Extra tabs for your work</i>). Everything they insert works like the other
elements: click it and its own tab opens (Edit…, its options, Colour, Move up / Move down, Delete, Close), even when its main tab
is hidden; a double-click opens Edit…, the grip in the margin moves it and the × removes it. <b>Edit…</b> is a window with
fields and a grid of rows: add, remove and move rows with buttons, no codes to type.</p>
<h3>Office</h3>
${table(['Tool', 'What it does'], [
  ['<b>Letterhead</b>', 'Organisation, tagline, address and contact line: on a coloured band, centred, or beside a side bar.'],
  ['<b>Signature Block</b>', 'One to four signature lines with names, roles and dated lines.'],
  ['<b>Stamp</b>', 'A tilted rubber stamp: APPROVED, PAID, DRAFT… with a date.'],
  ['<b>Meeting Agenda</b>', 'Numbered items with times and who leads each.'],
  ['<b>Action Items</b>', 'Action, owner, due date and a coloured status (Open, In progress, Done, Late).'],
  ['<b>Calendar</b>', 'A month with your events on their days.'],
  ['<b>Fillable Form</b>', 'Text boxes, tick boxes and drop-downs that are filled in in any PDF reader.'],
  ['<b>Certificate</b>', 'A framed certificate with the name, what it is for, the date and signature.'],
])}
<h3>Accountants</h3>
${table(['Tool', 'What it does'], [
  ['<b>Financial Statement</b>', 'Headings, lines, subtotals and totals for up to three years; empty subtotals and totals add themselves up; negatives in brackets, thousands separators, a double-ruled total.'],
  ['<b>Budget vs Actual</b>', 'Variance (green under, red over), % used and totals worked out.'],
  ['<b>Invoice</b>', 'From and to, number and dates, items × price; subtotal, VAT and total due worked out.'],
  ['<b>Loan Schedule</b>', 'Amount, rate, term and frequency: the payment, total interest and the balance year by year.'],
  ['<b>KPI Cards</b>', 'Key figures as cards with their change in green or red.'],
  ['<b>Waterfall Chart</b>', 'How a starting figure becomes the end one, rises in green and falls in red.'],
])}
<h3>Architect</h3>
${table(['Tool', 'What it does'], [
  ['<b>Floor Plan</b>', 'Rooms in metres (position, width, depth) drawn with walls, doors, windows, names, areas and overall dimensions.'],
  ['<b>Scale &amp; North</b>', 'A scale bar true to 1:50, 1:100… and a north arrow.'],
  ['<b>Title Block</b>', 'Practice, project, client, drawing title and number, scale, date, drawn, checked, revision.'],
  ['<b>Room Schedule</b>', 'Rooms with sizes, areas worked out, finishes and the total floor area.'],
  ['<b>Revisions</b>', 'Revision letter, date, description and initials.'],
])}
<h3>Chemical Engineering</h3>
${table(['Tool', 'What it does'], [
  ['<b>Process Flow Diagram</b>', 'Units (tanks, pumps, heat exchangers, reactors, valves…) placed on a grid and joined by numbered main, secondary and utility streams. The PDF uses the <i>chemplants</i> package\'s standard symbols.'],
  ['<b>McCabe–Thiele</b>', 'From α, R, q and the feed, distillate and bottoms compositions: the stages stepped off and counted, with the feed stage (drawn with <i>pgfplots</i>).'],
  ['<b>Stream Table</b>', 'One column per stream, one row per property and unit.'],
  ['<b>Mass Balance</b>', 'Each component in and out of each stream; totals and closure worked out, green within 2%.'],
])}
<h3>Earth Science</h3>
${table(['Tool', 'What it does'], [
  ['<b>Ternary Diagram</b>', 'Samples plotted from three proportions - QAPF, sand-silt-clay… (<i>pgfplots</i>\' ternary library).'],
  ['<b>Rose Diagram</b>', 'An equal-area rose of azimuths: strikes, joints, palaeocurrents; class width and bidirectional to choose.'],
  ['<b>Stratigraphic Column</b>', 'Units with thickness, lithology and age, youngest on top, with the usual lithology patterns and a thickness scale.'],
])}
`,
  },
  {
    id: 'contents', part: 'Insert', title: 'Tables of contents and lists',
    blurb: 'Contents, lists of figures and tables, updating and removing them.',
    html: `
<p><b>Insert ▸ Contents</b> adds a table of contents, a list of figures or a list of tables, built from your headings
and captions. As in Word, it shows on the page with its numbers, dotted leaders and page numbers. Click an entry to
go to that heading.</p>
${pair(['toc-menu.webp', 'Insert ▸ Table of Contents: an Automatic Table with 1, 2 or 3 levels, Update Table, and Remove.'],
  ['toc.webp', 'The table of contents on the page, selected: the × removes it.'])}
${steps(
  'Put the caret where the table should go (usually after the title).',
  'Choose <b>Insert ▸ Table of Contents ▸ Automatic Table</b> with the number of levels you want.',
  'Page numbers come from the last compiled PDF; <b>Update Table</b> compiles again to refresh them.',
  'To remove it, click the word <b>Contents</b> and press the <b>×</b> that appears, or use <i>Remove Table of Contents</i>.',
)}
<p><b>Table of Figures</b> works the same way for figures and tables. Only captioned figures and tables are listed:
add a caption from the Picture or Table tab, or <b>References ▸ Insert Caption</b>.</p>
${note('A document keeps one table of contents: inserting another replaces it with the new number of levels.')}
${show('Insert', 'Contents')}
`,
  },
  {
    id: 'references', part: 'Insert', title: 'Citations and references',
    blurb: 'The reference library, importing from reference managers, styles, footnotes and captions.',
    html: `
${fig('tab-references.webp', 'The References tab.', { wide: true })}
<h3>Cite as you write</h3>
${steps(
  'Add references to the document’s library (below).',
  'Click <b>Insert citation</b> and pick one or more references.',
  'Choose how they print with <b>Style</b>: author–year, numbered, IEEE…',
  'The reference list is printed at the end of the document, in that style.',
)}
<h3>Where references come from</h3>
${table(['Source', 'How'], [
  ['<b>Zotero</b>', 'Pick references in Zotero (with the Better BibTeX add-on), or take the whole library.'],
  ['<b>KherveRef</b> (kRef)', 'Choose references in a KherveRef library; they are added to the document.'],
  ['<b>Mendeley</b> <span class="beta-tag">beta</span>', 'Export from Mendeley as BibTeX, then import the file. Not yet tested with real exports: your feedback is welcome.'],
  ['<b>EndNote</b> <span class="beta-tag">beta</span>', 'Export from EndNote (.enw, .xml or BibTeX), then import. Also in beta.'],
  ['<b>Import file</b>', 'Any BibTeX (.bib), RIS (.ris) or EndNote (.enw, .xml) file, from any reference manager.'],
])}
${pair(['references-manager.webp', 'The reference library: add, edit and remove entries; key, type and fields.'],
  ['references-style.webp', 'Style: how citations and the list print.'])}
<h3>Footnotes, captions and cross-references</h3>
<p><b>Footnote</b> puts a note at the caret; it prints at the foot of the page. <b>Insert Caption</b> captions the figure
or table at the caret. <b>Cross-reference</b> points to a heading, figure, table or equation by its label, and the number
follows if it changes. <b>Captions &amp; labels</b> lists every caption and label in the document, to change them or
go to one. <b>Tools ▸ Check citations</b> lists cited keys no library defines.</p>
${show('References', 'Citations')}
`,
  },
  {
    id: 'design', part: 'Look', title: 'Design: themes and page look',
    blurb: 'Themes, style sets, colours, fonts, spacing, watermark, page colour and the document type.',
    html: `
${fig('tab-design.webp', 'The Design tab.', { wide: true })}
<p>The Design tab changes the look of the whole document at once, as in Word, while the LaTeX stays clean.</p>
${table(['Tool', 'What it changes'], [
  ['<b>Themes</b>', 'A coordinated set of colours, fonts and heading style in one click.'],
  ['<b>Style sets</b>', 'How headings look: Basic, Elegant, Shaded, Lines, Centred, Casual…'],
  ['<b>Colours</b>', 'The accent colours used by headings and lines.'],
  ['<b>Fonts</b>', 'The body font and whether headings are serif or sans-serif.'],
  ['<b>Paragraph Spacing</b>', 'Indented paragraphs (LaTeX) or spaced paragraphs (Word), and line spacing.'],
  ['<b>Watermark</b>', 'CONFIDENTIAL, DRAFT, SAMPLE… or your own text, across every page.'],
  ['<b>Page Colour</b>, <b>Page Borders</b>', 'A tinted page; a line or box round each page.'],
  ['<b>Title Page</b>', 'A designed title page in the accent colour: coloured band, centred with rules, side bar, minimal or framed.'],
  ['<b>Chapter Titles</b>', 'How each chapter (or section) opens: big number, coloured band, ruled, boxed number, side bar or centred.'],
  ['<b>Header Style</b>', 'A coloured band, a title and rule, or a thumb tab on the page edge, on every page after the first.'],
  ['<b>Set as Default</b>', 'New documents start with this design.'],
  ['<b>Document type</b>', 'article, report, book, letter, beamer slides, memoir, KOMA-Script and journal classes.'],
])}
${pair(['design-themes.webp', 'Themes.'], ['design-colours.webp', 'Colours.'])}
${pair(['design-watermark.webp', 'Watermark: the ready-made ones, or Custom Watermark.'], ['design-watermark-page.webp', 'A DRAFT watermark on the page.'])}
<h3>The same tour, two designs</h3>
<p>The default LaTeX look on the left; the <i>Lines (Stylish)</i> style set with the <i>Blue</i> colours on the right.
Same text, one click apart.</p>
<div class="g-pdfs">
  ${fig('pdf-plain-p1.webp', 'Default LaTeX design.')}
  ${fig('pdf-design-p1.webp', 'Lines (Stylish), Blue.')}
</div>
${note('Heading styles are applied in the standard classes (article, report, book). Journal classes keep the look the journal asks for.')}
${show('Design', 'Document Formatting')}
`,
  },
  {
    id: 'layout', part: 'Look', title: 'Page layout',
    blurb: 'Margins, orientation, paper size, columns, indents and spacing.',
    html: `
${fig('tab-layout.webp', 'The Layout tab.', { wide: true })}
<p><b>Margins</b>, <b>Orientation</b>, <b>Size</b> (A4, Letter, A5…) and <b>Columns</b> (one, two or three) reflow
the whole document at once, on the page and in the PDF. <b>Indent</b> and <b>Spacing</b> set the left and right
indents and the space before and after the current paragraph.</p>
${pair(['layout-margins.webp', 'Margins: Normal, Narrow, Moderate, Wide, or Custom Margins.'], ['layout-columns.webp', 'Columns.'])}
<h3>Header, footer and margin notes</h3>
<p><b>Header</b>, <b>Footer</b> and <b>Page Number</b> set what is printed at the top and bottom of every page, in three
zones (left, centre, right) with fields such as the title or the date; <b>Header Style</b> adds a coloured band, a rule or
a thumb tab. <b>Margin Note</b> puts a note in the right margin, beside the line it belongs to, as plain coloured text,
with a line beside it or in a tinted box; <b>Wide Margin</b> makes the right margin 4.5 cm so notes have room.</p>
${tip('For a two-column block inside a single-column page (a list of authors, a comparison), use <b>Insert ▸ Multi-column region</b>.')}
${show('Layout', 'Page Setup')}
${show('Layout', 'Margin Notes')}
`,
  },
  {
    id: 'draw', part: 'Look', title: 'Drawing with a pen',
    blurb: 'Circle, underline and highlight with pens, pencils and highlighters.',
    html: `
${beta(`Drawing is in beta. kTeX ties each stroke to the word under it, but LaTeX lays out the page a little differently
from the editor, so in the PDF a circle or a highlight <b>may often miss the word</b> it marks: beside it, on the
wrong line, or a little off. Always check the PDF after compiling, and please send feedback.`)}
${fig('draw.webp', 'The Draw tab: a red circle round a word and a yellow highlighter over a phrase.', { wide: true })}
${steps(
  'Open the <b>Draw</b> tab and click a pen in the gallery: it stands up when it is chosen.',
  'Draw on the page with the mouse, the trackpad (click and hold) or a stylus.',
  'Click the chosen pen again to change its <b>thickness</b> and <b>colour</b>.',
  `Click <b>Draw</b> again, or press ${k('Esc')}, to go back to typing.`,
)}
<h3>Pens and erasers</h3>
<p>The gallery holds Word’s pens: black, red, white, green, blue, purple, yellow, orange and light-blue pens, a
pencil, and yellow, pink and green highlighters. <b>Add</b> adds a pen, a pencil or a highlighter in the colour of your
choice; <i>Reset Pens</i> brings back the starting set. Your pens are kept from one session to the next.</p>
<p><b>Eraser</b> removes the whole stroke you pass over, like Word’s stroke eraser; its menu has <i>Erase All Ink</i>.</p>
<h3>Where the ink goes</h3>
<p>A stroke drawn on a paragraph follows its word: add text above it and the stroke moves with the word, on the page
and in the PDF. Strokes on headings, tables, figures or in the margins stay where you drew them on the page.</p>
${note('Ink is not on the Undo list: remove a stroke with the Eraser.')}
${show('Draw', 'Pens')}
`,
  },
  {
    id: 'views', part: 'Output', title: 'Views: page, code and PDF',
    blurb: 'Visual, Code and Console; the PDF beside the page or in its own window.',
    html: `
${fig('tab-view.webp', 'The View tab.', { wide: true })}
${table(['View', 'Shortcut', 'What it shows'], [
  ['<b>Visual</b>', k('Ctrl+1'), 'The page, where you write.'],
  ['<b>Code</b>', k('Ctrl+2'), 'The LaTeX kTeX generates, highlighted and editable: changes are read back into the page.'],
  ['<b>Console</b>', '', 'The compiler’s messages in plain text, when something goes wrong.'],
  ['<b>PDF</b>', k('Ctrl+4'), 'The compiled PDF beside the page.'],
  ['<b>Detach PDF</b>', '', 'The PDF in its own window, for a second screen.'],
  ['<b>Documents</b>', k('Ctrl+5'), 'The Documents panel: the files of a project.'],
])}
${fig('view-code.webp', 'The Code view: the document as LaTeX, with colours for commands, environments and maths. Edit here and the page follows.', { wide: true })}
<p><b>Show LaTeX source</b> shows raw LaTeX blocks in the page as code rather than as the PDF prints them.
<b>Fit page width</b> (${k('Ctrl+0')}) zooms the page to the window. Right-click on the page, the code or the PDF for
<i>Show in…</i>, which jumps to the same place in another view.</p>
${tip('The switch at the bottom right of the window toggles the dark theme; the page itself stays white, like paper.')}
${show('View', 'Views')}
`,
  },
  {
    id: 'compile', part: 'Output', title: 'Compiling, exporting and printing',
    blurb: 'Compile PDF, Typst, exporting to PDF, Word and LaTeX, importing and printing.',
    html: `
${fig('tab-compile.webp', 'The Compile tab.', { wide: true })}
<h3>Compiling</h3>
<p>kTeX compiles with <b>tectonic</b>, a complete LaTeX engine that comes with the app and works offline, straight
after installation. With <b>Auto-compile</b> on, every pause in your typing updates the PDF; otherwise press
<b>Compile PDF</b> (${k('Ctrl+Shift+C')}). <b>Skip images</b> compiles faster by leaving pictures out;
<b>Compile range</b> compiles only the part you marked with <i>Insert ▸ LaTeX ▸ Compile start / end</i>.
<b>Tools ▸ Compiler</b> chooses LaTeX or Typst and shows the compiler status.</p>
<div class="g-pdfs">${fig('pdf-plain-p1.webp', 'Page 1 of the tour, compiled.')}${fig('pdf-plain-p3.webp', 'Page 3: equations numbered and aligned by LaTeX.')}</div>
<h3>Exporting</h3>
${table(['File ▸ Export', 'Gives'], [
  ['.pdf', 'The typeset PDF.'],
  ['.docx', 'A Word document, for colleagues who use Word.'],
  ['.tex', 'The LaTeX source, ready for any LaTeX compiler.'],
  ['LaTeX package (.zip)', 'The .tex with its pictures and bibliography, for a journal or Overleaf.'],
])}
<h3>Importing</h3>
<p><b>File ▸ Import</b> reads LaTeX (.tex, or a whole package as .zip / .tar.gz), Word (.docx), .rtf and .odt, a Google
Doc from its link, PDF and Markdown. What the editor does not understand is kept as raw LaTeX, so nothing is lost.
You can also drop a file on the window to open it.</p>
<h3>Printing</h3>
<p><b>File ▸ Print preview</b> (${k('Ctrl+Shift+P')}) shows the pages as they will come out of the printer;
<b>Print</b> (${k('Ctrl+P')}) goes straight to the print dialog.</p>
${show('Compile', 'Compile')}
`,
  },
  {
    id: 'review', part: 'Together', title: 'Reviewing and sharing',
    blurb: 'Comments, Track Changes and Overleaf.',
    html: `
${fig('tab-review.webp', 'The Review tab.', { wide: true })}
<h3>Comments</h3>
<p>Select a passage and press <b>New comment</b> (${k('Ctrl+Alt+M')}) to leave a note for yourself or a co-author.
Previous and Next go through them; Accept and Reject close them. Comments print in a review column of the PDF when you
want them to.</p>
${fig('review-comment.webp', 'Writing a comment on a passage of the tour.', { wide: true })}
<h3>Track Changes</h3>
<p>With <b>Track Changes</b> on, insertions and deletions are marked with their author, as in Word. <b>All Markup</b> /
<b>Simple Markup</b> choose how much you see; <b>Accept</b> and <b>Reject</b> settle each change. How tracked changes
look is set in <b>Preferences ▸ Track Changes</b>.</p>
<h3>Overleaf</h3>
<p><b>Send to Overleaf</b> puts your version in an Overleaf project, and <b>Get changes from Overleaf</b> brings your
co-authors’ edits back. Both need an Overleaf plan with Git access; on a free plan, <b>Download for Overleaf</b> makes a
zip to upload as a new project.</p>
${show('Review', 'Comments')}
`,
  },
  {
    id: 'history', part: 'Together', title: 'Versions and Git',
    blurb: 'Snapshots, version history, branches and GitHub.',
    html: `
${fig('tab-history.webp', 'Versions and Cloud, on the Compile tab.', { wide: true })}
<p>Every saved document lives in a Git repository, so you can always go back. <b>Save snapshot and upload</b> records
a version (and uploads it if the document is connected to the cloud). <b>View version history</b> lists every
snapshot with its date and author; click one to see what changed, in red and green, and to go back to it.
<b>File ▸ Version History ▸ Branches</b> keeps alternative versions side by side.</p>
<p><b>GitHub</b> signs you in, publishes the document to a repository or connects it to one of yours, and opens a
document from GitHub. <i>Other cloud connections</i> handles GitLab and other servers.</p>
${note('Snapshots use your usual Git name and email, so they look the same as commits made from the command line.')}
${show('Compile', 'Versions')}
`,
  },
  {
    id: 'projects', part: 'Together', title: 'Long documents: projects',
    blurb: 'Theses and books as several documents.',
    html: `
<p>A thesis or a book is easier to handle as one document per chapter. <b>File ▸ Project ▸ New project</b> (or
<i>New project (thesis, book)</i> on the welcome page) creates one; <b>Split into documents</b> turns the current document
into a project, one document per chapter or section.</p>
<p>The <b>Documents</b> panel (${k('Ctrl+5')}) lists the documents of the project: click one to open it, drag to
reorder them, and drop files on it to add them. Numbering, cross-references and the bibliography run across the whole
project, and the PDF is the complete book.</p>
${show('View', 'Documents')}
`,
  },
  {
    id: 'examples', part: 'More', title: 'Examples and templates',
    blurb: 'Ready-made documents, and your own templates.',
    html: `
${fig('tab-examples.webp', 'The Examples tab: each button opens a gallery of page previews.', { wide: true })}
<p>The Examples tab holds ready-made documents of every kind: articles in one, two or three columns, journal
preprints (Elsevier, IEEE, ACM, Springer…), theses and books, reports, lab reports, letters and CVs, slides, posters,
planners and more. Each opens in its own window, so what you are working on stays open.</p>
<p><b>Boxes &amp; elements</b> shows the boxes and elements in real documents (a status report, a CV, a programming tutorial,
a magazine feature, a business plan…); <b>Science</b> starts with the Science toolkit (every Math and Science tool),
an XPS lab report, a physics problem sheet and revision notes, a chemistry practical, a maths worksheet, an algorithms
handout and a risk assessment.</p>
<p>Made a document you will want again? <b>Save as Template</b> keeps it; it then appears under <b>My templates</b>
and in <b>File ▸ New from Template</b>.</p>
${note('Examples marked <span class="beta-tag">beta</span> use newer classes; check the PDF and tell us if something looks wrong.')}
${show('Examples', 'Examples & templates')}
`,
  },
  {
    id: 'prefs', part: 'More', title: 'Preferences',
    blurb: 'Make kTeX your own: every choice applies at once.',
    html: `
<p><b>Tools ▸ Preferences</b> (the gear at the top right) opens a window like Word’s: a grid of panes, with Back,
Forward, Show All and a search box. Every change applies at once; there is no OK button to press.</p>
${fig('preferences.webp', 'The Preferences window.')}
${table(['Pane', 'What you set'], [
  ['General, View', 'The welcome page, the theme, what shows on the page.'],
  ['Ribbon &amp; Toolbar', 'Which tabs and quick-access buttons show; group titles.'],
  ['Edit', 'The size of inserted pictures.'],
  ['Spelling &amp; Grammar', 'Ignore words in UPPERCASE; flag repeated words.'],
  ['AutoCorrect', 'Arrows, symbols, dashes, capitalising sentences.'],
  ['Accessibility', 'Larger controls.'],
  ['Save', 'AutoSave every few minutes.'],
  ['Track Changes', 'How insertions and deletions look.'],
  ['User Information', 'Your name, initials, email and affiliation; the author of new documents.'],
  ['File Locations', 'Where your styles and templates are kept.'],
])}
`,
  },
  {
    id: 'ai', part: 'More', title: 'Working with Claude or ChatGPT',
    blurb: 'Let an AI assistant read and edit your document.',
    html: `
<p><b>Tools ▸ Connect to Claude or ChatGPT</b> lets an AI assistant work on the document open in kTeX: read it,
insert sections, equations, tables and drawings, fix the LaTeX, compile and look at the pages. Everything it does lands
in your document in front of you, and each step can be undone with ${k('Ctrl+Z')}.</p>
<p>You decide how much it may do: <b>Read only</b>, <b>Edit</b> (write, compile and save in place) or <b>Full</b> (also open, import and export files). The assistant is told when
something is not allowed, and asks you rather than working round it.</p>
${note('Your unsaved work is protected: the assistant cannot open another document or start a new one over unsaved changes unless you allow it.')}
`,
  },
  {
    id: 'shortcuts', part: 'More', title: 'Keyboard shortcuts',
    blurb: 'Every shortcut. On a Mac, read Ctrl as Cmd.',
    html: `
<p>On a Mac, read ${k('Ctrl')} as ${k('Cmd')}. <b>Help ▸ Keyboard shortcuts</b> shows this list too.</p>
${shortcutsHtml()}
`,
  },
  {
    id: 'trouble', part: 'More', title: 'Troubleshooting and help',
    blurb: 'When the PDF does not appear, and how to reach us.',
    html: `
<h3>The PDF does not update</h3>
${steps(
  'Look at the status bar: the compiler must say <i>OK</i>. If not, <b>Tools ▸ Compiler ▸ Compiler status</b> tells you why.',
  'Open <b>View ▸ Console</b>: the first error message usually names the line and the problem.',
  'A raw LaTeX block you typed by hand is the usual suspect: switch to the <b>Code</b> view to check it.',
  'Is <b>Auto-compile</b> on (Compile tab)? Otherwise press <b>Compile PDF</b>.',
)}
<h3>Common questions</h3>
<dl class="g-faq">
  <dt>Why does the page differ slightly from the PDF?</dt>
  <dd>The page imitates LaTeX’s layout closely, but LaTeX makes the final decisions on line and page breaks. The PDF
  is what prints.</dd>
  <dt>A picture is missing in the PDF.</dt>
  <dd>Pictures are found relative to the document’s folder. Save the document first, then insert the picture again;
  a missing picture shows as a labelled placeholder instead of stopping the compile.</dd>
  <dt>My pen stroke is in the wrong place in the PDF.</dt>
  <dd>Drawing is in beta: see <a href="#draw">Drawing with a pen</a>. Erase the stroke and draw it again on the word.</dd>
  <dt>Can I open my document in Overleaf or any LaTeX editor?</dt>
  <dd>Yes: <b>File ▸ Export ▸ LaTeX package (.zip)</b>, or <b>Download for Overleaf</b> on the Review tab.</dd>
  <dt>Does kTeX need the internet?</dt>
  <dd>No. Compiling works offline; only GitHub, Overleaf, Google Docs import and updates need a connection.</dd>
</dl>
<h3>Tell us</h3>
<p>kTeX is in beta and grows with your feedback. <b>Help ▸ Send feedback</b> (or the <span class="beta-tag">beta</span>
<b>Send feedback</b> button on the ribbon) writes to the author: what you tried, what happened, and a screenshot if
you can. kTeX checks for updates by itself and tells you what changed.</p>
${show('Help', 'Help')}
`,
  },
]
