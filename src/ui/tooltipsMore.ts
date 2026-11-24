// The long hover help of everything added with the elements, the Math and
// Science tabs, fancy tables and the page designs: what it does, how to
// use it, and what it becomes in the PDF. Merged into TIPS (tooltips.ts).
import type { Tip } from './tooltips.ts'
import { CHAPTER_STYLES, PAGE_EDGES, TITLE_STYLES } from '../core/design.ts'
import { FEYNMAN_PROCESSES, GHS, MO_MOLECULES, NOTEBOOK_TEMPLATES } from '../core/science.ts'
import { SIGNS } from '../core/science2.ts'
import { GEO_SHAPES } from '../core/geometry.ts'
import { CONSTANTS, PHYSICS } from '../core/sciMath.ts'
import { CALLOUT_KINDS } from '../core/model.ts'

const T = (title: string, what: string, latex = ''): Tip => ({ title, what, latex })
const ELEMENT = ' Click it on the page to select it: its own tab opens with all its options, Edit… (or a double-click) changes its contents, Move up / Move down or the grip in the left margin moves it, Delete or the × in its corner removes it, and Close puts the caret after it.'

export const MORE_TIPS: Record<string, Tip> = {
  // ------------------------------------------------- shared element buttons
  act_w_edit: T('Edit…', 'Opens the editor of the selected element: its items, text, data, labels or sizes, all in one dialog. A double-click on the element does the same. Ctrl+Enter in a text field closes the dialog with OK.', 'The element\'s LaTeX is rewritten from what you enter.'),
  act_w_color: T('Colour', 'The main colour of the selected element: its ticks, bars, lines, frame, dots or letter. Pick one of the eight colours, or Other colour… for any colour with the colour picker.', 'Becomes a \\definecolor used by the element\'s drawing.'),
  act_w_delete: T('Delete', 'Removes the selected element from the document. Ctrl+Z brings it back. The × in the element\'s top-right corner does the same.', ''),
  act_w_close: T('Close', 'Leaves the element: the caret goes to the text after it (a new paragraph if there is none) and this tab closes. Clicking in the text anywhere else does the same.', ''),
  act_block_up: T('Move up', 'Moves the selected box, table or element above the block before it. You can also drag it: hover over it and drag the grip (⋮⋮) that shows in the left margin, a line shows where it will land.', 'Its LaTeX moves with it.'),
  act_block_down: T('Move down', 'Moves the selected box, table or element below the block after it. Or drag the grip (⋮⋮) in the left margin.', 'Its LaTeX moves with it.'),

  // --------------------------------------------------------- Insert tab
  act_table_menu: T('Table', 'Inserts a table: drag over the grid to choose the rows and columns, or Insert Table… for a dialog with a caption. Click in a table for the Table Design (styles, fancy colours, shading) and Table Layout (rows, columns, merge, sort, Chart from Table) tabs.', 'Becomes a numbered table float with a tabular inside.'),
  act_ins_checklist: T('Checklist', 'A list of items with tick boxes, e.g. "Before you submit". Click a box on the page to tick or untick it. Its tab offers boxes or circles, one to three columns, greying ticked items, Tick all / Untick all and a colour. Edit… takes one item per line; start a line with [x] to tick it.' + ELEMENT, 'Drawn with TikZ boxes inside a list; columns use multicol.'),
  act_ill_drawing: T('Drawing', 'The drawing tools in one menu: Drawing… opens a canvas for diagrams and sketches that stay editable; Shapes inserts a line, arrow, rectangle, star, callout and more; Flowchart builder makes a flowchart from a list of steps; SmartArt makes lists, processes, cycles and hierarchies.', 'Vector figures in the PDF.'),
  act_ill_charts: T('Charts', 'The charts in one menu: Chart… (the full chart dialog), Quick Chart (a bar, line or pie chart from a few numbers, edited on the page), Gantt Chart (tasks over months or weeks) and Chart from Table (a chart of the table the caret is in).', 'Drawn with TikZ, the same in the editor and the PDF.'),
  act_ins_icon: T('Icon', 'A small picture in the text, where the caret is: phone, e-mail, location, star, tick, warning, flask, atom, LinkedIn, GitHub… 54 icons with a search box. Click it for the Icon tab: four sizes and any colour; Edit… picks another icon. Good for CVs, flyers and review lists.', 'Becomes \\faIcon{name} from the fontawesome5 package.'),
  act_screenshot: T('Screenshot', 'Takes a picture of a window or part of the screen and inserts it as a figure, as Word\'s Screenshot does.', 'Becomes a figure with \\includegraphics.'),
  act_ins_timeline: T('Timeline', 'Dated events on a line: down the page (dates on the left, title and text on the right) or across it (dates above, text below). Edit… takes one event per line as "Date | Title | Text". Its tab adds an event, switches the layout and changes the colour.' + ELEMENT, 'Drawn with TikZ.'),
  act_ins_progress: T('Progress Bars', 'Labelled bars that show percentages: how far a project, a thesis or a skill has come. Edit… takes one bar per line as "Label: 70". Its tab sets the style (rounded, square, thin), the length (4, 7 or 10 cm), whether the figures show, and the colour.' + ELEMENT, 'Drawn with TikZ in a table.'),
  act_ins_steps: T('Steps', 'Numbered circles joined by arrows, for a method or "how it works": across the page with the text under each step, or down it. Edit… takes one step per line as "Title | text".' + ELEMENT, 'Drawn with TikZ (arrows.meta).'),
  act_ins_pullquote: T('Pull Quote', 'A sentence set large and in colour to catch the eye, as magazines do, with who said it under it. Three styles: rules above and below, a bar on the left, or large quotation marks on a tinted panel.' + ELEMENT, 'A tcolorbox.'),
  act_ins_sidebar: T('Sidebar', 'A tinted panel for a fact file, a definition or further reading, with an optional title. Right or left: the next paragraph flows beside it in the PDF; Full width: a panel across the page. Edit… takes the title and the text (a blank line starts a new paragraph).' + ELEMENT, 'A tcolorbox, inside wrapfigure when beside the text.'),
  act_ins_rating: T('Rating', 'Stars or dots out of 5 or 10, one row per item, halves allowed: for product reviews, surveys and skills. Edit… takes one item per line as "Comfort: 4.5". Its tab switches stars or dots, out of 5 or 10, and whether the score shows.' + ELEMENT, 'Drawn with TikZ.'),
  act_ins_gauge: T('Gauge', 'Round meters showing percentages side by side, e.g. budget used, time elapsed: half circles or full rings. Edit… takes one gauge per line as "Budget used: 64".' + ELEMENT, 'Drawn with TikZ.'),
  act_ins_qrcode: T('QR Code', 'A QR code for a link or any text; readers scan it with a phone. Asks for the link and an optional caption. Its tab sets the size (small, medium, large), the position (left, centre, right) and the colour.' + ELEMENT, 'Becomes \\qrcode from the qrcode package.'),
  act_ins_code: T('Code Listing', 'Program code with its keywords, strings and comments in colour, line numbers and a frame. Thirteen languages (Python, C, C++, Java, JavaScript, MATLAB, R, Bash, SQL, HTML, LaTeX, Fortran, plain text), a light, dark or plain theme, and a title. Edit… takes the code itself; Tab indents.' + ELEMENT, 'Becomes a lstlisting from the listings package.'),
  act_ins_dropcap: T('Drop Cap', 'Makes the first letter of the paragraph the caret is in a large capital over 2 to 5 lines, the rest of the word in small capitals, as books and magazines start a chapter. Click the letter for its tab: height, in the text or in the margin, colour, small capitals on or off. Delete turns it back into ordinary text.', 'Becomes \\lettrine from the lettrine package.'),
  act_ins_marginnote: T('Margin Note', 'A note in the right margin, level with the line it belongs to: as plain coloured text, with a line beside it, or in a tinted box. A small dot marks its place in the text. Wide Margin makes the right margin 4.5 cm so the notes have room.', 'Becomes \\marginpar.'),
  act_mn_room: T('Wide Margin', 'Makes the right margin 4.5 cm, so margin notes have room; press again for 2.5 cm. The notes take the margin\'s width.', 'Changes the geometry package\'s right margin.'),
  act_toc: T('Table of Contents', 'Inserts the list of headings with their page numbers, as LaTeX prints it. It updates itself when you compile. Click its title to select it; its × removes it.', 'Becomes \\tableofcontents.'),
  act_table_of_figures: T('Table of Figures', 'Inserts the list of captioned figures (or tables, from the arrow) with their page numbers.', 'Becomes \\listoffigures or \\listoftables.'),
  act_update_toc: T('Update Table', 'Compiles the document again so the table of contents shows the latest headings and page numbers.', ''),
  act_hf_pagenum: T('Page Number', 'Puts the page number in the header or footer: left, centre or right, in several styles, or removes it.', 'Set with fancyhdr.'),
  act_hf_header: T('Header', 'The text at the top of every page: three zones (left, centre, right) with fields such as the title, the chapter or the date. Choose a ready-made header or edit it on the page.', 'Set with fancyhdr.'),
  act_hf_footer: T('Footer', 'The text at the bottom of every page, in three zones, with the page number or other fields.', 'Set with fancyhdr.'),

  // --------------------------------------------------------- Checklist
  act_ck_tick_all: T('Tick all', 'Ticks every item of the checklist.', ''),
  act_ck_untick_all: T('Untick all', 'Clears every tick of the checklist, to use it again.', ''),
  act_ck_box: T('Boxes', 'Square tick boxes.', ''),
  act_ck_circle: T('Circles', 'Round tick circles.', ''),
  act_ck_cols_1: T('1 column', 'The items one under the other.', ''),
  act_ck_cols_2: T('2 columns', 'The items in two columns, for a long list.', 'Uses multicol.'),
  act_ck_cols_3: T('3 columns', 'The items in three columns, for short items such as a packing list.', 'Uses multicol.'),
  act_ck_grey: T('Grey done items', 'Shows ticked items in grey, so what is left to do stands out.', ''),
  // Progress bars
  act_pg_rounded: T('Rounded', 'Bars with round ends.', ''), act_pg_square: T('Square', 'Bars with square ends.', ''), act_pg_thin: T('Thin', 'Thin lines instead of thick bars: lighter, for skills on a CV.', ''),
  act_pg_short: T('Short (4 cm)', 'Bars 4 cm long.', ''), act_pg_medium: T('Medium (7 cm)', 'Bars 7 cm long.', ''), act_pg_long: T('Long (10 cm)', 'Bars 10 cm long.', ''),
  act_pg_percent: T('Show percentages', 'Writes each bar\'s figure (70 %) at its end.', ''),
  // Timeline
  act_tl_add: T('Add Event', 'Adds an event at the end and opens Edit… to fill it in.', ''),
  act_tl_vertical: T('Down the page', 'Dates on the left of a vertical line, each title and text on the right: for a CV or a history.', ''),
  act_tl_horizontal: T('Across', 'Events side by side on a horizontal line, dates above and text below: for a project plan or a programme.', ''),
  // QR
  act_qr_small: T('Small', 'A 2 cm QR code.', ''), act_qr_medium: T('Medium', 'A 3 cm QR code.', ''), act_qr_large: T('Large', 'A 4.5 cm QR code, easy to scan from a poster.', ''),
  act_qr_left: T('Left', 'The QR code against the left margin.', ''), act_qr_center: T('Centre', 'The QR code centred.', ''), act_qr_right: T('Right', 'The QR code against the right margin.', ''),
  // Code
  act_cd_lang: T('Language', 'The programming language, which decides which words are coloured as keywords.', 'The listings language= option.'),
  act_cd_light: T('Light', 'Dark text on a light grey background, keywords in blue.', ''), act_cd_dark: T('Dark', 'Light text on a dark background, as in a code editor.', ''), act_cd_plain: T('Plain', 'Black on white, for printing.', ''),
  act_cd_numbers: T('Line numbers', 'Numbers each line on the left.', ''), act_cd_frame: T('Frame', 'A thin frame around the code.', ''),
  // Margin note
  act_mn_plain: T('Text only', 'The note as coloured text.', ''), act_mn_line: T('Line beside', 'A coloured line down the left of the note.', ''), act_mn_box: T('Box', 'The note in a tinted box with a coloured frame.', ''),
  // Drop cap
  act_dc_dropped: T('Dropped', 'The big letter inside the text, the lines flowing beside it.', ''),
  act_dc_margin: T('In margin', 'The big letter hanging in the left margin, the text keeping its full width.', 'lettrine lhang=1.'),
  act_dc_smallcaps: T('Small capitals after', 'The rest of the first word in small capitals after the big letter, as is traditional.', ''),
  // Pull quote, sidebar, rating, gauge, steps, gantt, chart, icon
  act_pq_rules: T('Rules', 'A coloured line above and below the quotation, centred.', ''), act_pq_bar: T('Side bar', 'A thick coloured bar on the left, the quotation beside it.', ''),
  act_pq_marks: T('Quote marks', 'A large opening quotation mark on a tinted panel.', ''),
  act_sb_right: T('Right', 'Beside the next paragraph, on the right; the text flows around it.', 'wrapfigure r.'), act_sb_left: T('Left', 'Beside the next paragraph, on the left.', 'wrapfigure l.'),
  act_sb_full: T('Full width', 'A panel across the width of the page.', ''),
  act_rt_stars: T('Stars', 'Five-pointed stars, half stars for halves.', ''), act_rt_dots: T('Dots', 'Round dots.', ''),
  act_rt_max_5: T('Out of 5', 'Five stars or dots per row.', ''), act_rt_max_10: T('Out of 10', 'Ten stars or dots per row.', ''), act_rt_value: T('Show the score', 'Writes the score (4.5) after the stars.', ''),
  act_gg_half: T('Half circle', 'A half-circle meter for each value.', ''), act_gg_ring: T('Ring', 'A full ring for each value, the figure in the middle.', ''),
  act_st_horizontal: T('Across', 'The steps side by side, joined by arrows.', ''), act_st_vertical: T('Down', 'The steps one under the other, each number beside its text.', ''),
  act_gt_grid: T('Grid lines', 'Faint vertical lines at each period.', ''),
  act_ch_bar: T('Columns', 'Vertical bars, one group per label.', ''), act_ch_hbar: T('Bars', 'Horizontal bars, for long labels.', ''), act_ch_line: T('Line', 'Points joined by lines, one line per series.', ''),
  act_ch_pie: T('Pie', 'A pie of the first series, with each slice\'s share.', ''),
  act_ch_small: T('Small', 'An 8 cm wide chart.', ''), act_ch_medium: T('Medium', 'An 11 cm wide chart.', ''), act_ch_large: T('Large', 'A 14 cm wide chart (made smaller if the page is narrower).', ''),
  act_ch_legend: T('Legend', 'The key of the series under the chart.', ''),
  act_ic_normalsize: T('Text size', 'The icon as big as the text.', ''), act_ic_large: T('Large', 'A little larger than the text.', ''), act_ic_Large: T('Larger', 'Clearly larger than the text.', ''), act_ic_huge: T('Huge', 'A large icon, for a flyer or a title.', ''),

  // ------------------------------------------------------ fancy tables
  act_tbl_fancy_banded: T('Banded', 'The table in one colour: the header row filled with white bold text, every other row lightly tinted, a coloured line under it. Pick the colour with Colour.', 'Uses \\rowcolor from colortbl.'),
  act_tbl_fancy_header: T('Coloured header', 'A filled header row in the colour, thin grey lines between the rows and a coloured line under the table.', 'Uses \\rowcolor and coloured rules.'),
  act_tbl_fancy_accent: T('Accent lines', 'No fills: a thick coloured line above and below and a thin one under the header, the header\'s text in the colour. Elegant and prints well in grey.', 'Coloured rules.'),
  act_tbl_fancy_color: T('Colour', 'The colour of a Banded, Coloured header or Accent lines table: eight presets or Other colour… for any.', ''),
  act_tbl_chart: T('Chart from Table', 'Makes a chart of this table\'s numbers and puts it under the table: the first row names the series, the first column the labels; cells that are not numbers count as 0. The chart is then an ordinary chart: click it to switch to bars, a line or a pie.', 'Drawn with TikZ.'),

  // ------------------------------------------------------- Design tab
  act_title_page: T('Title Page', 'A designed title page in the accent colour of Design ▸ Colours: a coloured band across the top, centred between rules, a side bar, minimal, or framed. The title, author and date are taken from the document; the text starts on the next page.', 'Redefines \\maketitle as a titlepage.'),
  act_chapter_titles: T('Chapter Titles', 'How each chapter opens (each section, in a document without chapters): a big number, a coloured band, ruled, a boxed number, a side bar, or centred. They take the accent colour of Design ▸ Colours.', 'Set with titlesec.'),
  act_page_edge: T('Header Style', 'A design on every page after the first, in the accent colour: a coloured band across the top with the title and page number, the title and page number over a rule, or a thumb tab on the page edge that moves down for each chapter, as in a reference book.', 'Drawn on each page with a shipout hook and TikZ.'),

  // ------------------------------------------------------- Math tab
  act_sci_matrix: T('Matrix', 'Inserts a matrix: choose the rows and columns, the brackets (round, square, curly, determinant bars, double bars or none) and what fills it (a₁₁ symbols, zeros, the identity, or a general m × n with dots). It is an ordinary equation afterwards, to edit freely.', 'Becomes pmatrix, bmatrix, vmatrix… from amsmath.'),
  act_sci_units: T('Units', 'A value with its unit, set as SI quantities are: a thin space before the unit, negative powers instead of slashes, 6.02e23 as 6.02 × 10²³, and the uncertainty as (1.25 ± 0.03). Type units as kg m/s^2, J/mol/K, µm, °C, Ω, eV or %.', 'Plain LaTeX maths (\\mathrm units), no package needed.'),
  act_sci_constants: T('Constants', '19 physical constants with their symbols, values and units (CODATA): c, h, ħ, e, k_B, N_A, R, F, ε₀, μ₀, G, g, mₑ, mₚ, u, eV, σ, R∞, a₀. Pick one to insert it where the caret is.', 'Plain LaTeX maths.'),
  act_sci_algorithm: T('Algorithm', 'Pseudocode as computer science papers print it: numbered lines, bold function / if / else / for / while / return, and "x = …" shown as x ← …. Write it with indentation for the blocks; $…$ is maths. A caption names it.' + ELEMENT, 'Becomes an algorithm with algpseudocode.'),
  act_sci_function: T('Function Plot', 'Graphs of y = f(x): type one function per line, such as sin(x), 0.5*x^2 - 2, exp(-x^2), 2x + 1, sqrt(x) or ln(x) (also cos, tan, asin, acos, atan, sinh, cosh, tanh, log, abs, pi, e). Choose the x range; the y range is automatic unless you set it. Axes, ticks, an optional grid and a legend.' + ELEMENT, 'Drawn with TikZ from the computed curve.'),
  act_sci_stats: T('Statistics', 'A histogram or a box plot of your numbers (paste a column, or type them with spaces or commas), with n, the mean, the median and the standard deviation worked out and shown. Choose the number of bars and what the numbers measure.' + ELEMENT, 'Drawn with TikZ.'),
  act_sci_venn: T('Venn Diagram', 'Two or three overlapping sets with what each region holds: A, B, C for one set only, AB, AC, BC for two, ABC for all three and O for outside. Name the sets, e.g. Physics, Chemistry, Biology.' + ELEMENT, 'Drawn with TikZ.'),
  act_sci_numberline: T('Number Line', 'A number line for inequalities and intervals: choose the range and the step, closed (●) or open (○) points with labels, and intervals drawn as a thick coloured bar, e.g. -2 to 3 or 1 to ∞.' + ELEMENT, 'Drawn with TikZ.'),
  act_sci_geometry: T('Geometry', 'Any figure. Start from a shape (triangle from three sides, right triangle, square, rectangle, parallelogram, trapezium, regular polygon, circle with radius and sector) and set its sizes: side lengths, angles with arcs, right-angle marks and equal-side ticks are worked out and drawn. Edit as Points turns it into a short script you can change entirely: move any corner, add segments, circles, arrows, angles, lengths and labels.' + ELEMENT, 'Drawn with TikZ.'),
  act_sci_unitcircle: T('Unit Circle', 'The unit circle with your angles (in degrees): each radius drawn with its point and its (cos, sin) values, and the dashed sine and cosine lines.' + ELEMENT, 'Drawn with TikZ.'),
  act_geo_shape: T('Shape', 'Changes the figure to another ready-made shape, or to Free (points) to write your own.', ''),
  act_geo_points: T('Edit as Points', 'Turns the figure into its script: every corner as a named point with coordinates, and the polygon, lengths, angles and ticks as instructions. Then Edit… lets you change anything: A = (0, 0) a point; polygon A B C fill; segment A B dashed; arrow A B; circle O 2; angle A B C; right A B C; length A B 5 cm; tick A B 2; dot A; text A "words" below.', ''),
  act_geo_sides: T('Side lengths', 'Writes each side\'s length beside it, outside the figure.', ''), act_geo_angles: T('Angles', 'Marks each corner\'s angle with an arc and its value, and right angles with a small square.', ''),
  act_geo_ticks: T('Equal-side ticks', 'Marks sides of the same length with the same number of small ticks, as geometry textbooks do.', ''), act_geo_fill: T('Shaded', 'Fills the figure with a light tint.', ''),
  act_uc_proj: T('Sine and cosine lines', 'Dashed lines from each point down to the x axis and across to the y axis.', ''),
  act_fn_grid: T('Grid', 'Faint grid lines at each axis tick.', ''),
  act_st_hist: T('Histogram', 'Bars counting how many values fall in each range, with the mean marked.', ''), act_st_box: T('Box plot', 'The minimum, quartiles, median and maximum as a box and whiskers, with the mean as a dot.', ''),
  act_tri_angles: T('Angles', 'Shows the angles at the corners.', ''),

  // ------------------------------------------------------ Science tab
  act_sci_physics: T('Physics', 'Physics notation, inserted as an equation where the caret is: kets |ψ⟩, bras, bra-kets ⟨φ|ψ⟩, matrix elements, expectation values, operators Â, commutators [A, B], derivatives d/dx and ∂/∂x, gradient, divergence, curl and Laplacian, bold and unit vectors, absolute values, norms, integrals and the Schrödinger equation.', 'Plain LaTeX maths with self-sizing brackets, no package needed.'),
  act_sci_sigfig: T('Sig. Figures', 'Rounds a measured value to its uncertainty: the uncertainty to one significant figure (two if it starts with 1), the value to the same decimal place, in scientific notation when very large or small. With a second value and an operation (+, −, ×, ÷) it combines them first, adding independent errors in quadrature.', 'Plain LaTeX maths, e.g. (9.81 ± 0.02) m s⁻².'),
  act_sci_nuclear: T('Nuclide', 'A nuclide such as ²³⁸₉₂U from the element and its mass number (the atomic number is looked up). Choose a decay (alpha, beta−, beta+, gamma) and the whole decay equation is written out with the daughter nucleus worked out.', 'Plain LaTeX maths.'),
  act_chemistry: T('Chemical reaction', 'A chemical equation typed in plain text, e.g. 2H2 + O2 -> 2H2O: subscripts, charges, states and arrows are set correctly.', 'Becomes \\ce{…} from mhchem.'),
  act_chemfig: T('Chemical structure', 'A structural formula drawn with chemfig, built from a palette of rings, chains and groups with a live preview.', 'Becomes \\chemfig{…}.'),
  act_sci_scheme: T('Reaction Scheme', 'Several molecules joined by reaction arrows, each with its name under it, reagents above the arrow and conditions below: e.g. ethanol → ethanal → ethanoic acid. Edit… takes "name | chemfig formula" lines with "-> above | below" lines between them.' + ELEMENT, 'Becomes \\schemestart … \\schemestop with \\chemfig and \\chemname.'),
  act_sci_mo: T('MO Diagram', 'The molecular orbital energy diagram of a homonuclear diatomic from H₂ to Ne₂: the atomic orbitals either side, the molecular orbitals in the middle, filled with electrons by the aufbau principle and Hund\'s rule, with σ2p and π2p in the right order for the molecule. Its tab picks the molecule.' + ELEMENT, 'Drawn with TikZ.'),
  act_sci_hazard: T('Hazard Labels', 'GHS hazard pictograms (explosive, flammable, oxidising, gas under pressure, corrosive, toxic, harmful, health hazard, environment) as red diamonds, with the signal word (Danger or Warning) and the H and P statements written out in full from their codes (H225, P280…). For SOPs, risk assessments and lab manuals.' + ELEMENT, 'Drawn with TikZ and fontawesome5 icons.'),
  act_sci_bohr: T('Bohr Model', 'An atom with its nucleus and electron shells, the electrons placed on each shell, from the element\'s name, symbol or atomic number. All 118 elements.' + ELEMENT, 'Drawn with TikZ.'),
  act_sci_element: T('Element Tiles', 'Periodic-table tiles: atomic number, symbol, name and atomic mass, coloured by family (alkali metal, transition metal, halogen, noble gas…). List the elements by symbol, name or number.' + ELEMENT, 'Drawn with TikZ.'),
  act_sci_plot: T('Data Plot', 'A plot of measured data such as a spectrum (XPS, XRD, IR, UV-Vis): paste two or more columns from a spreadsheet or a text file (x, then one column per curve), name the axes, label peaks with "x: label". Its tab reverses the x axis (for binding energy or wavenumber), shows the y numbers, or draws points instead of lines.' + ELEMENT, 'Drawn with TikZ.'),
  act_sci_circuit: T('Circuit', 'An electric circuit from a list of parts in order: battery, cell, resistor, lamp, switch, capacitor, inductor, diode, LED, ammeter, voltmeter, motor, fuse, each with its label (R1 = 100 Ω). Series: the parts around one loop; parallel: the first part as the source and the others on branches.' + ELEMENT, 'Drawn with TikZ, standard circuit symbols.'),
  act_sci_optics: T('Ray Diagram', 'A converging or diverging lens with its focal points, the object, and the principal rays traced through: the image is worked out from the lens equation and drawn (dashed when virtual), with u, v and the magnification written under it.' + ELEMENT, 'Drawn with TikZ.'),
  act_sci_feynman: T('Feynman', 'A Feynman diagram of a common process: e⁺e⁻ → μ⁺μ⁻ (s-channel), e⁻e⁻ scattering (t-channel), Compton scattering or beta decay, with fermion arrows and wavy boson lines. Edit… changes the particle labels.' + ELEMENT, 'Drawn with TikZ.'),
  act_sci_wave: T('Wave', 'A sine wave with its wavelength λ and amplitude A marked with arrows; set λ, A and how many cycles show. Its tab adds a second wave a quarter of a cycle behind, for phase.' + ELEMENT, 'Drawn with TikZ.'),
  act_sci_forces: T('Forces', 'A free-body diagram: a box, a ball or a block on a slope, with labelled force arrows. Edit… takes one force per line as "Weight W: 270, 1.6" (direction in degrees, 0 = right, 90 = up, then the length in cm) and the slope angle.' + ELEMENT, 'Drawn with TikZ.'),
  act_sci_levels: T('Energy Levels', 'An energy-level diagram (hydrogen by default): one level per line as "n = 2: -3.40" (in eV), and transitions as "3 → 2: Hα 656 nm" drawn as arrows. Close levels have their labels spread apart.' + ELEMENT, 'Drawn with TikZ.'),
  act_sci_notebook: T('Lab Notebook', 'A dated lab-notebook entry in a framed box with any sections you like. Edit… shows it as text: a "## Heading" line starts a section; in a section, - bullets, 1. numbered steps, [ ] / [x] tick boxes, | a | b | table rows, **bold**, *italic*, $maths$. Its tab adds a section, starts from a template (Experiment, Synthesis, Measurement, Field work, Meeting), puts headings beside or above the text, and adds signature lines.' + ELEMENT, 'A breakable tcolorbox.'),
  act_sci_risk: T('Risk Matrix', 'A 5 × 5 risk matrix, likelihood × severity, coloured green to red by score, with your risks numbered in their cells and listed with their scores. Edit… takes one risk per line as "HF splash: 2, 5". Show the same risk before and after controls to make the case.' + ELEMENT, 'Drawn with TikZ.'),
  act_sci_signs: T('Safety Signs', 'Safety signs in the ISO 7010 style: mandatory (blue: goggles, gloves, lab coat, mask, hard hat, ear protection), prohibition (red: no smoking, no food, no phones, do not touch), warning (yellow: toxic, radiation, electricity, biohazard, magnet, hot surface), emergency (green: first aid, eye wash, shower, exit) and fire (red: extinguisher), with captions.' + ELEMENT, 'Drawn with TikZ and fontawesome5 icons.'),
  act_sg_menu: T('Signs', 'Tick the signs to show, by family.', ''), act_sg_captions: T('Captions', 'Writes what each sign means under it.', ''),
  act_nb_add: T('Add Section', 'Adds a section with its own heading at the end of the entry: Hypothesis, Reagents, Safety, Data… anything.', ''),
  act_nb_templates: T('Templates', 'Starts the entry from a set of sections: Experiment, Synthesis, Measurement, Field work, Meeting or Simple. Text already under a heading of the same name is kept.', ''),
  act_nb_beside: T('Headings beside', 'Each heading in bold at the start of its text, for short entries.', ''), act_nb_above: T('Headings above', 'Each heading on its own line in the colour, the text under it.', ''),
  act_nb_signature: T('Signature lines', 'Adds Signed, Witness and Date lines at the foot, as a lab notebook needs.', ''),
  act_plot_reverse: T('Reverse x axis', 'The x axis from high to low, as binding energy and wavenumber spectra are shown.', ''),
  act_plot_yticks: T('y axis numbers', 'Shows numbers on the y axis; off for spectra in arbitrary units.', ''), act_plot_points: T('Points, not lines', 'Draws each data point as a dot instead of joining them.', ''),
  act_circ_series: T('Series', 'All the parts around one loop, the first (the source) on the left.', ''), act_circ_parallel: T('Parallel', 'The first part as the source on the left, the others side by side between two rails.', ''),
  act_el_mass: T('Atomic mass', 'Shows each element\'s standard atomic mass under its name.', ''),
  act_hz_danger: T('Danger', 'The signal word for the more severe hazards, in red.', ''), act_hz_warning: T('Warning', 'The signal word for the less severe hazards.', ''),
  act_alg_numbers: T('Line numbers', 'Numbers each line of the algorithm.', ''),
  act_fb_box: T('Box', 'A box on a horizontal surface.', ''), act_fb_ball: T('Ball', 'A ball, e.g. a projectile.', ''), act_fb_slope: T('On a slope', 'A block on an inclined plane at the angle you set in Edit….', ''),
  act_op_converging: T('Converging', 'A convex lens: parallel rays meet at the focal point.', ''), act_op_diverging: T('Diverging', 'A concave lens: parallel rays spread as if from the focal point; the image is always virtual.', ''),
  act_wv_labels: T('λ and A', 'Marks the wavelength and the amplitude.', ''), act_wv_second: T('Second wave (90° behind)', 'Adds a second wave a quarter of a cycle behind the first.', ''),

  act_box_style: T('Name & Colour', 'The box\'s heading and its colour in one dialog: any name (Exercise, Did you know?) and any colour. A click on the box\'s title bar opens it too.', 'Becomes a kCustomBox in that colour.'),
  act_box_para_after: T('Text after box', 'Starts an ordinary paragraph after the box, to carry on writing (also Shift+Enter or Cmd/Ctrl+Enter in the box).', ''),
  act_box_remove: T('Remove box', 'Removes the box but keeps its text as ordinary paragraphs.', ''),
  act_box_delete: T('Delete box', 'Deletes the box and everything in it. Ctrl+Z brings it back.', ''),
  // ------------------------------------------------------- Examples tab
  act_gallery_boxes_elements: T('Boxes & elements', 'Example documents built with coloured boxes, the Insert elements, fancy tables and the page designs: Coloured boxes, Fancy elements, a project status report, a CV with a timeline, a programming tutorial, a magazine feature, an event programme, a business plan, a product review and a research plan.', ''),
}

// Families of buttons: one tip per member.
for (const [k, name, desc] of TITLE_STYLES) MORE_TIPS[`act_titlestyle:${k}`] = T(name, desc)
for (const [k, name, desc] of CHAPTER_STYLES) MORE_TIPS[`act_chapterstyle:${k}`] = T(name, desc)
for (const [k, name, desc] of PAGE_EDGES) MORE_TIPS[`act_pageedge:${k}`] = T(name, desc)
for (const [k, name] of FEYNMAN_PROCESSES) MORE_TIPS[`act_fey_${k}`] = T(name, `Draws the Feynman diagram of ${name} with its own particle labels.`)
for (const m of MO_MOLECULES) MORE_TIPS[`act_mo_${m}`] = T(m.replace('2', '₂'), `The molecular orbital diagram of ${m.replace('2', '₂')}, filled with its electrons.`)
for (const [k, name] of GHS) MORE_TIPS[`act_ghs_${k}`] = T(name, `Shows or hides the GHS "${name}" pictogram.`)
for (const [k, cap] of SIGNS) MORE_TIPS[`act_sg_${k}`] = T(cap, `Shows or hides the "${cap}" sign.`)
for (const [k, name] of GEO_SHAPES) MORE_TIPS[`act_geo_${k}`] = T(name, k === 'custom' ? 'Your own figure from points: Edit… shows the script.' : `Changes the figure to a ${name.toLowerCase()}; Edit… sets its sizes.`)
for (const n of [2, 3, 4, 5]) MORE_TIPS[`act_dc_lines_${n}`] = T(`${n} lines`, `The big letter spans ${n} lines of text.`)
for (const [name, heads] of NOTEBOOK_TEMPLATES) MORE_TIPS[`act_nb_tpl_${name.replace(/\W/g, '')}`] = T(name, `Sections: ${heads.join(', ')}.`)
CONSTANTS.forEach(([name], i) => { MORE_TIPS[`act_sci_const_${i}`] = T(name, `Inserts the ${name.toLowerCase()} with its symbol, value and unit.`) })
PHYSICS.forEach(([name], i) => { MORE_TIPS[`act_sci_phys_${i}`] = T(name, `Inserts ${name} as an equation where the caret is.`) })
for (const [k, { name }] of Object.entries(CALLOUT_KINDS)) {
  MORE_TIPS[`act_box_kind_${k}`] = T(name, k === 'custom' ? 'A box with your own name and colour.' : `Makes this box a ${name} box, in its own colour and with its own heading.`)
  MORE_TIPS[`act_box_insert_${k}`] = T(name, k === 'custom' ? 'A box with your own name and colour: asks for both.' : `Inserts a ${name} box where the caret is.`)
}
