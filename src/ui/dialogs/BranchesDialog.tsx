// File ▸ Version History ▸ Branches…: MainWindow._show_branches opens the
// history dialog — which carries the branch bar — without a file filter,
// so every branch of the folder's repository is in view.
import { openHistoryDialog } from './HistoryDialog'

export function openBranchesDialog(repoDir: string, onReload: () => Promise<void> | void): Promise<void> {
  return openHistoryDialog(repoDir, null, onReload)
}
