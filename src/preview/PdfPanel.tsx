// Placeholder until the pdf.js preview (Phase 1) lands.
import { PlaceholderPage } from '../ui/PlaceholderPage'

export function PdfPanel({ zoom, pageW, pageH }: { zoom: number; pageW: number; pageH: number }) {
  return <>{[0, 1].map(i => (
    <div key={i} className='pdf-page' style={{ width: pageW, height: pageH, zoom: zoom / 100 }}>
      {i === 0 && <PlaceholderPage />}
    </div>
  ))}</>
}
