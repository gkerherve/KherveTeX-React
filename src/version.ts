// The app's names and version, as the title bar, splash, About, Welcome and
// update messages show them. The big name is KherveTeX, the short one kTeX
// (2026-11-13): files, installers, the .app, settings and the MCP server keep
// "KherveTeX". The version is the commit count (package.json "N.0.0",
// N = git rev-list --count HEAD after the commit), shown "vN"; releases from
// before the switch ("0.338.0") still show "v0.338". As semver, N.0.0 is
// newer than any 0.x, so copies on the old numbering update to it.
import pkg from '../package.json'

export const APP_NAME = 'KherveTeX'
export const SHORT_NAME = 'kTeX'
// Where beta feedback goes (the About box, the Welcome page, Help > Send feedback).
export const FEEDBACK_EMAIL = 'g.kerherve@ic.ac.uk'
// Help ▸ Buy me a coffee (as in KherveFitting); its QR code is public/buymeacoffee_qr.png.
export const COFFEE_URL = 'https://buymeacoffee.com/gkerherve'

export function shortVersion(v: string): string {
  const [major, minor] = v.replace(/^v/, '').split('.')
  return 'v' + (major === '0' && minor !== undefined ? `0.${minor}` : major)
}

export const VERSION = shortVersion(pkg.version)
