# Design: Import Existing Branch as Workspace

**Issue:** https://github.com/superset-sh/superset/issues/691
**Date:** 2026-01-09

## Problem

Users working across multiple machines need to continue work on branches created elsewhere. Currently, Superset always creates new branches when creating workspaces. There's no way to create a worktree workspace from an existing remote branch.

## Solution

Add ability to create a workspace from an existing local or remote branch, rather than always creating a new branch.

---

## User Interface

### New Workspace Modal Changes

Add a toggle control below the modal title:
- **"New branch"** (default) - current behavior
- **"Existing branch"** - new flow

**When "New branch" is selected:**
- Text input for branch name
- Base branch dropdown
- No changes from current behavior

**When "Existing branch" is selected:**
- Hide branch name text input
- Hide base branch dropdown
- Show searchable dropdown listing available branches
- Filter out branches already in use by worktrees
- Group branches into "Local" and "Remote" sections

### Branch List Behavior

- On modal open: display cached local + remote branches immediately
- Background: run `git fetch --prune` and update list when complete
- Exclude branches that already have a worktree (via existing `inUse` data)

---

## Backend

### New Mutation: `createFromExistingBranch`

**Location:** `apps/desktop/src/lib/trpc/routers/workspaces/procedures/create.ts`

**Input:**
```typescript
{
  projectId: string
  branch: string        // e.g., "feat/my-feature"
  isRemote: boolean     // whether this is a remote branch
}
```

**Logic:**
1. Validate branch exists
2. Determine worktree path using existing naming convention
3. Insert worktree record with `gitStatus: null`
4. Insert workspace record
5. Return immediately with `isInitializing: true`
6. Background: create worktree, update `gitStatus` when complete

### Git Operations

**Modify `createWorktree` function:**

Add parameter to distinguish modes:
```typescript
createWorktree(mainRepoPath, branch, worktreePath, options: {
  createBranch: boolean      // true = new branch, false = existing
  startPoint?: string        // only used when createBranch is true
})
```

**Commands:**
- New branch: `git worktree add <path> -b <branch> <startPoint>^{commit}`
- Existing branch: `git worktree add <path> <branch>`

For remote branches (e.g., `origin/feat/foo`), git automatically creates a local tracking branch with upstream configured.

### Database

No schema changes. For existing branches:
- `baseBranch` column set to `null` (we didn't branch from anything)
- `branch` column stores the branch name

### Initialization Flow

Same as current, minus branch creation:
1. Syncing - refresh default branch
2. Fetching - ensure latest refs
3. Creating worktree - `git worktree add` without `-b`
4. Copying config - copy `.superset` if present
5. Finalizing - update `gitStatus`

---

## Files to Modify

**UI:**
- `apps/desktop/src/renderer/components/NewWorkspaceModal/NewWorkspaceModal.tsx`

**New Component:**
- `apps/desktop/src/renderer/components/NewWorkspaceModal/components/BranchPicker/`

**Backend:**
- `apps/desktop/src/lib/trpc/routers/workspaces/procedures/create.ts`
- `apps/desktop/src/lib/trpc/routers/workspaces/utils/git.ts`
- `apps/desktop/src/lib/trpc/routers/workspaces/utils/workspace-init.ts`

**No changes needed:**
- Database schema
- Branch listing procedure
- Worktree deletion/cleanup

---

## Error Handling

- Branch doesn't exist → "Branch not found"
- Branch already has worktree → "Branch is already checked out in another worktree"
- Network issues → Proceed with local ref if available, or clear error message
