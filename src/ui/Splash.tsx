// The start-up splash screen (splash.py): kherveDOC's blue card drawn in
// code (no image file, crisp at any DPI, carrying the live version), with
// the app icon, two sheets of paper bearing a formula, and a status line
// and progress bar that follow the steps main.tsx reports. It is the
// "splash" window of tauri.conf.json, shown while the main window loads
// hidden; main.tsx shows the main window and closes this one when ready.
import { useEffect, useState, type ReactElement } from 'react'
import { SHORT_NAME, VERSION } from '../version'
import { AppIcon } from './icons'

export const SPLASH_HASH = '#splash'
export const SPLASH_STEP_EVENT = 'splash-step'
// The least time the splash stays up, from the start of the main page.
const MIN_SHOW_MS = 1800

const WIDTH = 640
const HEIGHT = 380
// The steps main() reports, in order; the bar advances through them.
export const STEPS = ['Loading the editor', 'Building the window', 'Opening the document', 'Ready'] as const

// Two stacked sheets of paper: text lines, a heading and a formula — the
// document the app produces (_pages).
function Pages({ x, y, w, h }: { x: number; y: number; w: number; h: number }) {
  const sheets = [[26, -18, 70 / 255], [0, 0, 235 / 255]] as const
  const x0 = x + 22
  const x1 = x + w - 22
  const bars: ReactElement[] = []
  let yy = y + 26
  bars.push(<rect key='h' x={x0} y={yy} width={90} height={7} rx={3} fill='#1f63c6' />)
  yy += 22
  for (let i = 0; i < 4; i++) {
    bars.push(<rect key={`a${i}`} x={x0} y={yy} width={(x1 - x0) * (i === 3 ? 0.62 : 1)} height={4} rx={2}
      fill='rgba(40,60,90,0.35)' />)
    yy += 11
  }
  const formulaY = yy + 4
  yy += 42
  for (let i = 0; i < 3; i++) {
    bars.push(<rect key={`b${i}`} x={x0} y={yy} width={(x1 - x0) * (i === 2 ? 0.4 : 1)} height={4} rx={2}
      fill='rgba(40,60,90,0.35)' />)
    yy += 11
  }
  return (
    <g>
      {sheets.map(([dx, dy, a], k) => (
        <g key={k}>
          <rect x={x + dx + 3} y={y + dy + 4} width={w} height={h} rx={4} fill='rgba(0,0,0,0.16)' />
          <rect x={x + dx} y={y + dy} width={w} height={h} rx={4} fill={`rgba(255,255,255,${a})`} />
        </g>
      ))}
      {bars}
      <text x={(x0 + x1) / 2} y={formulaY + 15} textAnchor='middle' dominantBaseline='central'
        fontFamily="'Times New Roman', Times, serif" fontStyle='italic' fontSize='13pt' fill='#0c2f66'>
        E = ℏω = ∫ ψ* Ĥ ψ dτ
      </text>
    </g>
  )
}

export function Splash() {
  const [step, setStep] = useState<string>(STEPS[0])
  useEffect(() => {
    let off: (() => void) | undefined
    void import('@tauri-apps/api/event').then(({ listen }) =>
      listen<string>(SPLASH_STEP_EVENT, e => setStep(e.payload))).then(f => { off = f })
    // Should the main window never say it is ready, show it anyway: a
    // hidden window would look like an app that did not start.
    const t = window.setTimeout(() => {
      void import('@tauri-apps/api/webviewWindow').then(async ({ WebviewWindow, getCurrentWebviewWindow }) => {
        await (await WebviewWindow.getByLabel('main'))?.show()
        await getCurrentWebviewWindow().close()
      })
    }, 20000)
    return () => { off?.(); clearTimeout(t) }
  }, [])
  const i = STEPS.indexOf(step as typeof STEPS[number])
  const fraction = i >= 0 ? i / (STEPS.length - 1) : 0
  const lines: ReactElement[] = []
  for (let x = 0; x < WIDTH; x += 32) {
    lines.push(<line key={x} x1={x} y1={0} x2={x - 120} y2={HEIGHT} stroke='rgba(255,255,255,0.07)' strokeWidth={1} />)
  }
  const font = "-apple-system, 'Segoe UI', system-ui, sans-serif"
  return (
    <svg width={WIDTH} height={HEIGHT} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} style={{ display: 'block' }}
      role='img' aria-label={`${SHORT_NAME} ${VERSION} is starting`}>
      <defs>
        <linearGradient id='splash-bg' x1='0' y1='0' x2='1' y2='1'>
          <stop offset='0' stopColor='#1f63c6' />
          <stop offset='1' stopColor='#0c2f66' />
        </linearGradient>
        <clipPath id='splash-clip'><rect width={WIDTH} height={HEIGHT} rx={14} /></clipPath>
      </defs>
      <g clipPath='url(#splash-clip)'>
        <rect width={WIDTH} height={HEIGHT} fill='url(#splash-bg)' />
        {lines}
        <Pages x={372} y={70} w={210} h={250} />
        <foreignObject x={40} y={52} width={96} height={96}><AppIcon size={96} /></foreignObject>
        <text x={40} y={197} dominantBaseline='central' fontFamily={font} fontWeight={700} fontSize='34pt'
          fill='#ffffff'>{SHORT_NAME}</text>
        <text x={42} y={238} fontFamily={font} fontSize='12.5pt' fill='rgba(255,255,255,0.84)'>
          Write like in Word, publish in LaTeX</text>
        <text x={42} y={HEIGHT - 76} dominantBaseline='central' fontFamily={font} fontSize='10.5pt'
          fill='rgba(255,255,255,0.78)'>{step}{step === STEPS[STEPS.length - 1] ? '' : '…'}</text>
        <rect x={42} y={HEIGHT - 62} width={290} height={5} rx={2.5} fill='rgba(255,255,255,0.14)' />
        {fraction > 0 && <rect x={42} y={HEIGHT - 62} width={290 * fraction} height={5} rx={2.5} fill='#9cc4ff' />}
        <text x={42} y={HEIGHT - 24} dominantBaseline='central' fontFamily={font} fontSize='9.5pt'
          fill='rgba(255,255,255,0.59)'>{VERSION}</text>
        <text x={WIDTH - 22} y={HEIGHT - 24} textAnchor='end' dominantBaseline='central' fontFamily={font}
          fontSize='9.5pt' fill='rgba(255,255,255,0.59)'>© 2026 Gwilherm Kerherve · GPL-3.0</text>
      </g>
    </svg>
  )
}

// From the main window: the next start-up step, then (at "Ready") the main
// window shown and the splash closed.
export async function splashStep(step: typeof STEPS[number]): Promise<void> {
  const { isTauri } = await import('../platform')
  if (!isTauri()) return
  const { emit } = await import('@tauri-apps/api/event')
  await emit(SPLASH_STEP_EVENT, step).catch(() => {})
  if (step !== 'Ready') return
  const { WebviewWindow, getCurrentWebviewWindow } = await import('@tauri-apps/api/webviewWindow')
  const me = getCurrentWebviewWindow()
  if (me.label !== 'main') return
  // The web app starts in well under a second, where Qt took several: hold
  // the picture long enough to be seen.
  const shown = performance.now()
  if (shown < MIN_SHOW_MS) await new Promise(r => setTimeout(r, MIN_SHOW_MS - shown))
  await me.show().catch(() => {})
  await me.setFocus().catch(() => {})
  await (await WebviewWindow.getByLabel('splash'))?.close().catch(() => {})
}
