// The "try it online" notice: shown only in the browser build, where the
// PDF comes from SwiftLaTeX instead of the desktop app's tectonic.
import { useState } from 'react'
import { platform } from '../platform'
import { SHORT_NAME } from '../version'

export const DOWNLOAD_URL = 'https://khervetools.com/tools/khervetex'

export function OnlineStrip() {
  const [shown, setShown] = useState(() => platform().kind === 'browser')
  if (!shown) return null
  return (
    <div className='online-strip' role='note'>
      <span>
        You are trying {SHORT_NAME} online. Its PDF is made by SwiftLaTeX in your browser, not the
        desktop app's engine, so fonts, packages and layout may differ, and some documents may not
        compile. Files stay in this tab until you save them.{' '}
        <a href={DOWNLOAD_URL} target='_blank' rel='noopener'>Download {SHORT_NAME}</a> for the real thing.
      </span>
      <button title='Hide' aria-label='Hide' onClick={() => setShown(false)}>{'×'}</button>
    </div>
  )
}
