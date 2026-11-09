// The folder as people know it: cloud folders by their service
// ("OneDrive (Imperial College London) › Documents"), home as "~".
export function friendlyDir(dir: string): string {
  const cloud = /^\/Users\/[^/]+\/Library\/CloudStorage\/([^/]+)(\/.*)?$/.exec(dir)
  if (cloud) {
    const [service, ...rest] = cloud[1].split('-')
    const who = rest.join('-').replace(/([a-z])([A-Z])/g, '$1 $2')
    const name = service === 'GoogleDrive' ? 'Google Drive' : service
    return [who && service !== 'GoogleDrive' ? `${name} (${who})` : name,
      ...(cloud[2] ?? '').split('/').filter(Boolean)].join(' › ')
  }
  return dir.replace(/^\/Users\/[^/]+(?=\/|$)/, '~')
}
