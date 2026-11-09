import { expect, it } from 'vitest'
import { friendlyDir } from '../src/core/friendlyDir.ts'

it('shows cloud folders by service and home as ~', () => {
  expect(friendlyDir('/Users/g/Library/CloudStorage/OneDrive-ImperialCollegeLondon/Documents/Talks'))
    .toBe('OneDrive (Imperial College London) › Documents › Talks')
  expect(friendlyDir('/Users/g/Library/CloudStorage/Dropbox/Papers')).toBe('Dropbox › Papers')
  expect(friendlyDir('/Users/g/Library/CloudStorage/GoogleDrive-me@x.com/My Drive')).toBe('Google Drive › My Drive')
  expect(friendlyDir('/Users/g/Documents/a')).toBe('~/Documents/a')
  expect(friendlyDir('/tmp/x')).toBe('/tmp/x')
})
