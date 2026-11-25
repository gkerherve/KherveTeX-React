// While a window that takes pictures is open (Insert ▸ Figure), files
// dropped from Finder go to it rather than into the document
// (actions/file.ts routes the desktop app's drops).
let dropTarget: ((paths: string[]) => void) | null = null
export function setPictureDropTarget(f: ((paths: string[]) => void) | null): void { dropTarget = f }
export function pictureTarget(): ((paths: string[]) => void) | null { return dropTarget }
