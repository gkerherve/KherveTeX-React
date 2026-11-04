// khervedoc/git_backend.py for the web view: every call is a git2-rs command
// in src-tauri/src/git.rs, which keeps the Python function's name, its
// arguments and its messages. In a plain browser there is no git: the
// fallback behaves as git_backend does without pygit2 (is_available() is
// false, every query is empty, every operation fails).
import { invoke } from '@tauri-apps/api/core'
import { isTauri } from './index'

// history_detailed's dict.
export interface CommitInfo {
  oid: string
  short_oid: string
  // ISO-8601 local time, to the second.
  timestamp: string
  epoch: number
  // "Name <email>"
  author: string
  subject: string
  body: string
}

// history_graph's dict: a commit with its place in the branch graph.
export interface GraphRow extends CommitInfo {
  parents: string[]
  rail: number
  rails_before: [number, number][]
  rails_after: [number, number][]
  branches: string[]
  is_merge: boolean
}

// list_branches' dict.
export interface BranchInfo {
  name: string
  ref: string
  oid: string
  current: boolean
  // null for a local branch, else the remote's name ("origin").
  remote: string | null
}

export interface Identity {
  name: string
  email: string
}

// (ok, message), as the Python functions return.
export type GitResult = [boolean, string]

export interface GitBackend {
  isAvailable(): boolean
  initRepo(repoDir: string): Promise<boolean>
  findEnclosingRepo(repoDir: string): Promise<string | null>
  // The new commit's id, or null when nothing changed.
  commitAll(repoDir: string, message: string | null, fileStem: string | null): Promise<string | null>
  getRemotes(repoDir: string): Promise<[string, string][]>
  setRemote(repoDir: string, name: string, url: string): Promise<boolean>
  removeRemote(repoDir: string, name: string): Promise<boolean>
  currentBranch(repoDir: string): Promise<string | null>
  pull(repoDir: string, remoteName?: string): Promise<GitResult>
  push(repoDir: string, remoteName?: string): Promise<GitResult>
  systemGitAvailable(): Promise<boolean>
  restoreToCommit(repoDir: string, oid: string, paths?: string[] | null): Promise<GitResult>
  history(repoDir: string, limit?: number): Promise<[string, string, string][]>
  historyDetailed(repoDir: string, limit?: number, fileStem?: string | null): Promise<CommitInfo[]>
  listBranches(repoDir: string): Promise<BranchInfo[]>
  createBranch(repoDir: string, name: string, startOid?: string | null): Promise<GitResult>
  switchBranch(repoDir: string, name: string): Promise<GitResult>
  deleteBranch(repoDir: string, name: string): Promise<GitResult>
  historyGraph(repoDir: string, limit?: number): Promise<GraphRow[]>
  diffForCommit(repoDir: string, oid: string): Promise<string>
  // repo.default_signature (the user's git identity), null when none is set.
  defaultSignature(repoDir: string): Promise<Identity | null>
}

export const tauriGit: GitBackend = {
  isAvailable: () => true,
  initRepo: (repoDir) => invoke('git_init_repo', { repoDir }),
  findEnclosingRepo: (repoDir) => invoke('git_find_enclosing_repo', { repoDir }),
  commitAll: (repoDir, message, fileStem) => invoke('git_commit_all', { repoDir, message, fileStem }),
  getRemotes: (repoDir) => invoke('git_get_remotes', { repoDir }),
  setRemote: (repoDir, name, url) => invoke('git_set_remote', { repoDir, name, url }),
  removeRemote: (repoDir, name) => invoke('git_remove_remote', { repoDir, name }),
  currentBranch: (repoDir) => invoke('git_current_branch', { repoDir }),
  pull: (repoDir, remoteName = 'origin') => invoke('git_pull', { repoDir, remoteName }),
  push: (repoDir, remoteName = 'origin') => invoke('git_push', { repoDir, remoteName }),
  systemGitAvailable: () => invoke('git_system_git_available'),
  restoreToCommit: (repoDir, oid, paths = null) => invoke('git_restore_to_commit', { repoDir, oid, paths }),
  history: (repoDir, limit = 50) => invoke('git_history', { repoDir, limit }),
  historyDetailed: (repoDir, limit = 200, fileStem = null) =>
    invoke('git_history_detailed', { repoDir, limit, fileStem }),
  listBranches: (repoDir) => invoke('git_list_branches', { repoDir }),
  createBranch: (repoDir, name, startOid = null) => invoke('git_create_branch', { repoDir, name, startOid }),
  switchBranch: (repoDir, name) => invoke('git_switch_branch', { repoDir, name }),
  deleteBranch: (repoDir, name) => invoke('git_delete_branch', { repoDir, name }),
  historyGraph: (repoDir, limit = 300) => invoke('git_history_graph', { repoDir, limit }),
  diffForCommit: (repoDir, oid) => invoke('git_diff_for_commit', { repoDir, oid }),
  defaultSignature: (repoDir) => invoke('git_default_signature', { repoDir }),
}

const UNAVAILABLE = 'Git is not available in the browser version.'

export const browserGit: GitBackend = {
  isAvailable: () => false,
  initRepo: async () => false,
  findEnclosingRepo: async () => null,
  commitAll: async () => null,
  getRemotes: async () => [],
  setRemote: async () => false,
  removeRemote: async () => false,
  currentBranch: async () => null,
  pull: async () => [false, UNAVAILABLE],
  push: async () => [false, UNAVAILABLE],
  systemGitAvailable: async () => false,
  restoreToCommit: async () => [false, UNAVAILABLE],
  history: async () => [],
  historyDetailed: async () => [],
  listBranches: async () => [],
  createBranch: async () => [false, UNAVAILABLE],
  switchBranch: async () => [false, UNAVAILABLE],
  deleteBranch: async () => [false, UNAVAILABLE],
  historyGraph: async () => [],
  diffForCommit: async () => '',
  defaultSignature: async () => null,
}

let current: GitBackend | null = null

export function git(): GitBackend {
  if (!current) current = isTauri() ? tauriGit : browserGit
  return current
}

// Tests swap in a fake.
export function setGitBackend(g: GitBackend | null): void {
  current = g
}
