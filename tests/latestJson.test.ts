// The updater manifest: every platform's signed bundle under the keys
// tauri-plugin-updater looks for.
import { describe, expect, test } from 'vitest'
// @ts-expect-error a plain .mjs script without types
import { manifest } from '../scripts/latest_json.mjs'

describe('latest.json', () => {
  test('Windows, Mac and both Linux bundles', () => {
    const m = manifest({ repo: 'o/r', tag: 'v9', version: '9.0.0', notes: 'n', sigs: {
      'kTeX_9.0.0_x64-setup.exe': 'w', 'kTeX_aarch64.app.tar.gz': 'm',
      'kTeX_9.0.0_amd64.AppImage': 'a', 'kTeX_9.0.0_amd64.deb': 'd',
    } })
    expect(Object.keys(m.platforms).sort()).toEqual(['darwin-aarch64', 'darwin-aarch64-app', 'linux-x86_64-appimage',
      'linux-x86_64-deb', 'windows-x86_64', 'windows-x86_64-nsis'])
    expect(m.platforms['linux-x86_64-deb']).toEqual({ signature: 'd', url: 'https://github.com/o/r/releases/download/v9/kTeX_9.0.0_amd64.deb' })
    // No plain linux-x86_64: a .deb install would fetch the AppImage.
    expect(m.platforms['linux-x86_64']).toBeUndefined()
  })
})
