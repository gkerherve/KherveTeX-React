// updater.py's plain functions (changelog_markdown, auto_enabled) and the
// notes the update dialog shows.
import { describe, expect, it } from 'vitest'
// Loaded by path at run time: the tests' tsconfig (nodenext) does not
// type-check the app's bundler-style imports.
const load = (p: string) => import(/* @vite-ignore */ p)
const { autoEnabled, changelogMarkdown, releaseNotes, shortVersion } = await load('../src/app/actions/updater.ts')
const { notesHtml } = await load('../src/ui/dialogs/UpdateDialog.tsx')

describe('updater', () => {
  it('test_changelog_markdown_bolds_the_prefix', () => {
    expect(changelogMarkdown(['v0.12: lists no longer merge', 'Plain subject'])).toBe(
      '- **v0.12** — lists no longer merge\n- Plain subject')
  })

  it('release notes are the subjects, one per line, bullets not doubled', () => {
    expect(releaseNotes('v0.10: updater\r\n\n- v0.9: git\n')).toBe('- **v0.10** — updater\n- **v0.9** — git')
    expect(releaseNotes(undefined)).toBe('')
  })

  it('shows versions as the title does', () => {
    expect(shortVersion('0.338.0')).toBe('v0.338')
    expect(shortVersion('97.0.0')).toBe('v97')
    expect(shortVersion('v1033.0.0')).toBe('v1033')
  })

  it('updates automatically unless turned off', () => {
    expect(autoEnabled()).toBe(true)
  })

  it('renders the notes escaped', () => {
    expect(notesHtml('- **v0.10** — a <b> tag\nThanks')).toBe(
      '<ul><li><b>v0.10</b> — a &lt;b&gt; tag</li></ul><p>Thanks</p>')
  })
})
