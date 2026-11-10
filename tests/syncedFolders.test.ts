// Port of test_word_sections_and_breaks.py's project tests: a project's
// figures stay out of folders a cloud service syncs, and a file read that
// timed out there is not taken for no network.
import { describe, expect, it } from 'vitest'
import { isOfflineFailure, slowFileFromLog } from '../src/core/compiler.ts'
import { isSyncedFolder } from '../src/core/projectStore.ts'

describe('test_word_sections_and_breaks.py', () => {
  it('test_project_figures_stay_out_of_synced_folders', () => {
    expect(isSyncedFolder('/Users/x/Library/CloudStorage/OneDrive-Example/Thesis')).toBe(true)
    expect(isSyncedFolder('/Users/x/Dropbox/Thesis')).toBe(true)
    expect(isSyncedFolder('/Users/x/Library/Mobile Documents/com~apple~CloudDocs/Thesis')).toBe(true)
    expect(isSyncedFolder('/Users/x/Documents/Thesis')).toBe(false)
  })

  it('test_a_file_read_that_timed_out_is_not_offline', () => {
    const log = 'warning: error closing out input /a/b c/figure_021.png\ncaused by: Operation timed out (os error 60)\n'
    expect(slowFileFromLog(log)).toBe('/a/b c/figure_021.png')
    expect(isOfflineFailure(log)).toBe(true)   // why the slow file is checked first
    expect(slowFileFromLog('error sending request')).toBeNull()
  })
})
