// Placeholder until the Code tab (Phase 1) lands: the serialized LaTeX.
import { useMemo } from 'react'
import { serializeDocument } from '../core/serializer'
import { useApp } from '../app/store'

export function CodeView() {
  const doc = useApp(s => s.doc)
  const tex = useMemo(() => serializeDocument(doc), [doc])
  return <pre className='code-placeholder'>{tex}</pre>
}
