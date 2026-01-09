# Import Existing Branch - Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable users to create workspaces from existing local/remote branches instead of always creating new branches.

**Architecture:** Extend the workspace creation flow with a new mode. Modify `createWorktree` git function to support existing branches (no `-b` flag). Add a branch picker UI component that fetches branches in the background.

**Tech Stack:** React, tRPC, Drizzle ORM, simple-git, shadcn/ui (Command/Popover)

---

## Task 1: Modify `createWorktree` to Support Existing Branches

**Files:**
- Modify: `apps/desktop/src/lib/trpc/routers/workspaces/utils/git.ts:127-211`
- Test: `apps/desktop/src/lib/trpc/routers/workspaces/utils/git.test.ts`

**Step 1: Write the failing test**

Add to `git.test.ts`:

```typescript
describe("createWorktree", () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  test("creates worktree from existing local branch", async () => {
    const repoPath = createTestRepo("existing-branch-test");

    // Create initial commit on main
    writeFileSync(join(repoPath, "file.txt"), "content");
    execSync("git add . && git commit -m 'initial'", { cwd: repoPath, stdio: "ignore" });

    // Create an existing branch
    execSync("git branch feature-branch", { cwd: repoPath, stdio: "ignore" });

    const { createWorktree } = await import("./git");
    const worktreePath = join(TEST_DIR, "worktree-existing");

    await createWorktree(repoPath, "feature-branch", worktreePath, {
      createBranch: false,
    });

    // Verify worktree was created
    expect(existsSync(worktreePath)).toBe(true);
    expect(existsSync(join(worktreePath, "file.txt"))).toBe(true);

    // Verify we're on the right branch
    const branch = execSync("git branch --show-current", { cwd: worktreePath, encoding: "utf-8" }).trim();
    expect(branch).toBe("feature-branch");
  });

  test("creates worktree with new branch from startPoint", async () => {
    const repoPath = createTestRepo("new-branch-test");

    // Create initial commit
    writeFileSync(join(repoPath, "file.txt"), "content");
    execSync("git add . && git commit -m 'initial'", { cwd: repoPath, stdio: "ignore" });

    const { createWorktree } = await import("./git");
    const worktreePath = join(TEST_DIR, "worktree-new");

    await createWorktree(repoPath, "new-feature", worktreePath, {
      createBranch: true,
      startPoint: "HEAD",
    });

    expect(existsSync(worktreePath)).toBe(true);

    const branch = execSync("git branch --show-current", { cwd: worktreePath, encoding: "utf-8" }).trim();
    expect(branch).toBe("new-feature");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd apps/desktop && bun test src/lib/trpc/routers/workspaces/utils/git.test.ts -t "createWorktree"`

Expected: FAIL - current `createWorktree` doesn't accept options object

**Step 3: Update `createWorktree` function signature and implementation**

Replace the function in `git.ts`:

```typescript
export interface CreateWorktreeOptions {
  /** If true, creates a new branch with `-b`. If false, uses existing branch. */
  createBranch: boolean;
  /** The ref to branch from. Only used when createBranch is true. */
  startPoint?: string;
}

export async function createWorktree(
  mainRepoPath: string,
  branch: string,
  worktreePath: string,
  options: CreateWorktreeOptions,
): Promise<void> {
  const usesLfs = await repoUsesLfs(mainRepoPath);

  try {
    const parentDir = join(worktreePath, "..");
    await mkdir(parentDir, { recursive: true });

    const env = await getGitEnv();

    if (usesLfs) {
      const lfsAvailable = await checkGitLfsAvailable(env);
      if (!lfsAvailable) {
        throw new Error(
          `This repository uses Git LFS, but git-lfs was not found. ` +
            `Please install git-lfs (e.g., 'brew install git-lfs') and run 'git lfs install'.`,
        );
      }
    }

    const args = ["-C", mainRepoPath, "worktree", "add", worktreePath];

    if (options.createBranch) {
      // New branch mode: git worktree add <path> -b <branch> <startPoint>^{commit}
      const startPoint = options.startPoint || "origin/main";
      args.push("-b", branch, `${startPoint}^{commit}`);
    } else {
      // Existing branch mode: git worktree add <path> <branch>
      args.push(branch);
    }

    await execFileAsync("git", args, { env, timeout: 120_000 });

    console.log(
      `Created worktree at ${worktreePath} with branch ${branch}${options.createBranch ? ` from ${options.startPoint}` : " (existing)"}`,
    );
  } catch (error) {
    // ... existing error handling unchanged ...
  }
}
```

**Step 4: Run test to verify it passes**

Run: `cd apps/desktop && bun test src/lib/trpc/routers/workspaces/utils/git.test.ts -t "createWorktree"`

Expected: PASS

**Step 5: Update all callers of `createWorktree`**

In `workspace-init.ts:219`, update the call:

```typescript
await createWorktree(mainRepoPath, branch, worktreePath, {
  createBranch: true,
  startPoint,
});
```

**Step 6: Run full test suite to verify no regressions**

Run: `cd apps/desktop && bun test`

Expected: All tests pass

**Step 7: Commit**

```bash
git add apps/desktop/src/lib/trpc/routers/workspaces/utils/git.ts apps/desktop/src/lib/trpc/routers/workspaces/utils/git.test.ts apps/desktop/src/lib/trpc/routers/workspaces/utils/workspace-init.ts
git commit -m "feat(desktop): add createBranch option to createWorktree

Allows creating worktrees from existing branches by omitting the -b flag.
This is the foundation for importing existing branches as workspaces."
```

---

## Task 2: Add `createFromExistingBranch` Mutation

**Files:**
- Modify: `apps/desktop/src/lib/trpc/routers/workspaces/procedures/create.ts`
- Modify: `apps/desktop/src/lib/trpc/routers/workspaces/utils/workspace-init.ts`

**Step 1: Add initialization function for existing branches**

Add to `workspace-init.ts` after the existing `initializeWorkspaceWorktree` function:

```typescript
export interface ExistingBranchInitParams {
  workspaceId: string;
  projectId: string;
  worktreeId: string;
  worktreePath: string;
  branch: string;
  mainRepoPath: string;
}

/**
 * Background initialization for workspace from existing branch.
 * Similar to initializeWorkspaceWorktree but uses existing branch instead of creating new.
 */
export async function initializeExistingBranchWorktree({
  workspaceId,
  projectId,
  worktreeId,
  worktreePath,
  branch,
  mainRepoPath,
}: ExistingBranchInitParams): Promise<void> {
  const manager = workspaceInitManager;

  try {
    await manager.acquireProjectLock(projectId);

    if (manager.isCancellationRequested(workspaceId)) {
      return;
    }

    // Step 1: Sync with remote
    manager.updateProgress(workspaceId, "syncing", "Syncing with remote...");
    await refreshDefaultBranch(mainRepoPath);

    if (manager.isCancellationRequested(workspaceId)) {
      return;
    }

    // Step 2: Fetch latest
    manager.updateProgress(workspaceId, "fetching", "Fetching latest changes...");
    const hasRemote = await hasOriginRemote(mainRepoPath);
    if (hasRemote) {
      try {
        const git = (await import("simple-git")).default(mainRepoPath);
        await git.fetch(["--prune"]);
      } catch {
        // Silently continue if fetch fails
      }
    }

    if (manager.isCancellationRequested(workspaceId)) {
      return;
    }

    // Step 3: Create worktree from existing branch
    manager.updateProgress(workspaceId, "creating_worktree", "Creating git worktree...");
    await createWorktree(mainRepoPath, branch, worktreePath, {
      createBranch: false,
    });
    manager.markWorktreeCreated(workspaceId);

    if (manager.isCancellationRequested(workspaceId)) {
      try {
        await removeWorktree(mainRepoPath, worktreePath);
      } catch (e) {
        console.error("[workspace-init] Failed to cleanup worktree after cancel:", e);
      }
      return;
    }

    // Step 4: Copy config
    manager.updateProgress(workspaceId, "copying_config", "Copying configuration...");
    copySupersetConfigToWorktree(mainRepoPath, worktreePath);

    if (manager.isCancellationRequested(workspaceId)) {
      try {
        await removeWorktree(mainRepoPath, worktreePath);
      } catch (e) {
        console.error("[workspace-init] Failed to cleanup worktree after cancel:", e);
      }
      return;
    }

    // Step 5: Finalize
    manager.updateProgress(workspaceId, "finalizing", "Finalizing setup...");

    localDb
      .update(worktrees)
      .set({
        gitStatus: {
          branch,
          needsRebase: false,
          lastRefreshed: Date.now(),
        },
      })
      .where(eq(worktrees.id, worktreeId))
      .run();

    manager.updateProgress(workspaceId, "ready", "Ready");

    track("workspace_initialized", {
      workspace_id: workspaceId,
      project_id: projectId,
      branch,
      from_existing: true,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[workspace-init] Failed to initialize ${workspaceId}:`, errorMessage);

    if (manager.wasWorktreeCreated(workspaceId)) {
      try {
        await removeWorktree(mainRepoPath, worktreePath);
      } catch (cleanupError) {
        console.error("[workspace-init] Failed to cleanup partial worktree:", cleanupError);
      }
    }

    manager.updateProgress(workspaceId, "failed", "Initialization failed", errorMessage);
  } finally {
    manager.finalizeJob(workspaceId);
    manager.releaseProjectLock(projectId);
  }
}
```

**Step 2: Add the tRPC mutation**

Add to `create.ts` inside `createCreateProcedures`, after `openWorktree`:

```typescript
createFromExistingBranch: publicProcedure
  .input(
    z.object({
      projectId: z.string(),
      branch: z.string(),
      name: z.string().optional(),
    }),
  )
  .mutation(async ({ input }) => {
    const project = localDb
      .select()
      .from(projects)
      .where(eq(projects.id, input.projectId))
      .get();
    if (!project) {
      throw new Error(`Project ${input.projectId} not found`);
    }

    // Check if branch already has a worktree
    const existingWorktree = localDb
      .select()
      .from(worktrees)
      .where(eq(worktrees.projectId, input.projectId))
      .all()
      .find((wt) => wt.branch === input.branch);

    if (existingWorktree) {
      throw new Error(`Branch "${input.branch}" already has a worktree. Use "Open Existing" to reopen it.`);
    }

    const worktreePath = join(
      homedir(),
      SUPERSET_DIR_NAME,
      WORKTREES_DIR_NAME,
      project.name,
      input.branch,
    );

    // Insert worktree record (baseBranch is null for existing branches)
    const worktree = localDb
      .insert(worktrees)
      .values({
        projectId: input.projectId,
        path: worktreePath,
        branch: input.branch,
        baseBranch: null,
        gitStatus: null,
      })
      .returning()
      .get();

    const maxTabOrder = getMaxWorkspaceTabOrder(input.projectId);

    const workspace = localDb
      .insert(workspaces)
      .values({
        projectId: input.projectId,
        worktreeId: worktree.id,
        type: "worktree",
        branch: input.branch,
        name: input.name ?? input.branch,
        tabOrder: maxTabOrder + 1,
      })
      .returning()
      .get();

    setLastActiveWorkspace(workspace.id);
    activateProject(project);

    track("workspace_created", {
      workspace_id: workspace.id,
      project_id: project.id,
      branch: input.branch,
      from_existing: true,
    });

    workspaceInitManager.startJob(workspace.id, input.projectId);

    // Start background initialization
    initializeExistingBranchWorktree({
      workspaceId: workspace.id,
      projectId: input.projectId,
      worktreeId: worktree.id,
      worktreePath,
      branch: input.branch,
      mainRepoPath: project.mainRepoPath,
    });

    const setupConfig = loadSetupConfig(project.mainRepoPath);

    return {
      workspace,
      initialCommands: setupConfig?.setup || null,
      worktreePath,
      projectId: project.id,
      isInitializing: true,
    };
  }),
```

**Step 3: Add import for new init function**

Update imports in `create.ts`:

```typescript
import { initializeWorkspaceWorktree, initializeExistingBranchWorktree } from "../utils/workspace-init";
```

**Step 4: Run typecheck**

Run: `cd apps/desktop && bun run typecheck`

Expected: No errors

**Step 5: Commit**

```bash
git add apps/desktop/src/lib/trpc/routers/workspaces/procedures/create.ts apps/desktop/src/lib/trpc/routers/workspaces/utils/workspace-init.ts
git commit -m "feat(desktop): add createFromExistingBranch mutation

New tRPC mutation that creates a workspace from an existing branch
without creating a new branch. Sets baseBranch to null since we're
using an existing branch rather than branching from something."
```

---

## Task 3: Add Branch Listing Query with Background Fetch

**Files:**
- Modify: `apps/desktop/src/lib/trpc/routers/workspaces/procedures/branch.ts`

**Step 1: Add query that returns structured branch data**

Add to `createBranchProcedures` in `branch.ts`:

```typescript
getAvailableBranches: publicProcedure
  .input(
    z.object({
      projectId: z.string(),
    }),
  )
  .query(async ({ input }) => {
    const project = localDb
      .select()
      .from(projects)
      .where(eq(projects.id, input.projectId))
      .get();
    if (!project) {
      throw new Error(`Project ${input.projectId} not found`);
    }

    const branches = await listBranches(project.mainRepoPath, { fetch: false });

    // Get branches in use by worktrees
    const projectWorktrees = localDb
      .select()
      .from(worktrees)
      .where(eq(worktrees.projectId, input.projectId))
      .all();
    const inUseBranches = new Set(projectWorktrees.map((wt) => wt.branch));

    // Filter out in-use branches and deduplicate (local takes precedence)
    const localSet = new Set(branches.local);
    const availableLocal = branches.local.filter((b) => !inUseBranches.has(b));
    const availableRemote = branches.remote.filter(
      (b) => !inUseBranches.has(b) && !localSet.has(b)
    );

    return {
      local: availableLocal,
      remote: availableRemote,
      inUse: Array.from(inUseBranches),
    };
  }),

fetchBranches: publicProcedure
  .input(
    z.object({
      projectId: z.string(),
    }),
  )
  .mutation(async ({ input }) => {
    const project = localDb
      .select()
      .from(projects)
      .where(eq(projects.id, input.projectId))
      .get();
    if (!project) {
      throw new Error(`Project ${input.projectId} not found`);
    }

    // Fetch and return updated branches
    const branches = await listBranches(project.mainRepoPath, { fetch: true });

    const projectWorktrees = localDb
      .select()
      .from(worktrees)
      .where(eq(worktrees.projectId, input.projectId))
      .all();
    const inUseBranches = new Set(projectWorktrees.map((wt) => wt.branch));

    const localSet = new Set(branches.local);
    const availableLocal = branches.local.filter((b) => !inUseBranches.has(b));
    const availableRemote = branches.remote.filter(
      (b) => !inUseBranches.has(b) && !localSet.has(b)
    );

    return {
      local: availableLocal,
      remote: availableRemote,
      inUse: Array.from(inUseBranches),
    };
  }),
```

**Step 2: Add worktrees import**

Add to imports in `branch.ts`:

```typescript
import { projects, workspaces, worktrees } from "@superset/local-db";
```

**Step 3: Run typecheck**

Run: `cd apps/desktop && bun run typecheck`

Expected: No errors

**Step 4: Commit**

```bash
git add apps/desktop/src/lib/trpc/routers/workspaces/procedures/branch.ts
git commit -m "feat(desktop): add getAvailableBranches and fetchBranches queries

- getAvailableBranches: returns cached local/remote branches, excluding those in use
- fetchBranches: mutation that fetches from remote first, then returns updated list

Both queries filter out branches already used by worktrees."
```

---

## Task 4: Create BranchPicker Component

**Files:**
- Create: `apps/desktop/src/renderer/components/NewWorkspaceModal/components/BranchPicker/BranchPicker.tsx`
- Create: `apps/desktop/src/renderer/components/NewWorkspaceModal/components/BranchPicker/index.ts`

**Step 1: Create the component**

Create `BranchPicker.tsx`:

```typescript
// ABOUTME: Searchable branch picker with local/remote grouping for workspace creation.
// ABOUTME: Fetches branches in background and filters out branches already in use.

import { Button } from "@superset/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@superset/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@superset/ui/popover";
import { useEffect, useState } from "react";
import { GoGitBranch } from "react-icons/go";
import { HiCheck, HiChevronUpDown } from "react-icons/hi2";
import { LuLoader2, LuRefreshCw } from "react-icons/lu";
import { trpc } from "renderer/lib/trpc";

interface BranchPickerProps {
  projectId: string;
  value: string | null;
  onChange: (branch: string, isRemote: boolean) => void;
  disabled?: boolean;
}

export function BranchPicker({
  projectId,
  value,
  onChange,
  disabled,
}: BranchPickerProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const {
    data: branches,
    isLoading,
    refetch,
  } = trpc.workspaces.getAvailableBranches.useQuery(
    { projectId },
    { enabled: !!projectId }
  );

  const fetchMutation = trpc.workspaces.fetchBranches.useMutation({
    onSuccess: () => {
      refetch();
    },
  });

  // Trigger background fetch when component mounts
  useEffect(() => {
    if (projectId && !fetchMutation.isPending) {
      fetchMutation.mutate({ projectId });
    }
  }, [projectId]);

  const filteredLocal = (branches?.local ?? []).filter((b) =>
    b.toLowerCase().includes(search.toLowerCase())
  );
  const filteredRemote = (branches?.remote ?? []).filter((b) =>
    b.toLowerCase().includes(search.toLowerCase())
  );

  const hasResults = filteredLocal.length > 0 || filteredRemote.length > 0;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="w-full h-9 justify-between font-normal"
          disabled={disabled || isLoading}
        >
          <span className="flex items-center gap-2 truncate">
            <GoGitBranch className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate font-mono text-sm">
              {value || "Select branch..."}
            </span>
          </span>
          <span className="flex items-center gap-1">
            {fetchMutation.isPending && (
              <LuLoader2 className="size-3 animate-spin text-muted-foreground" />
            )}
            <HiChevronUpDown className="size-4 shrink-0 text-muted-foreground" />
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command shouldFilter={false}>
          <div className="flex items-center border-b">
            <CommandInput
              placeholder="Search branches..."
              value={search}
              onValueChange={setSearch}
              className="flex-1"
            />
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0 mr-1"
              onClick={() => fetchMutation.mutate({ projectId })}
              disabled={fetchMutation.isPending}
            >
              <LuRefreshCw
                className={`size-3.5 ${fetchMutation.isPending ? "animate-spin" : ""}`}
              />
            </Button>
          </div>
          <CommandList className="max-h-[300px]">
            {!hasResults && <CommandEmpty>No branches found</CommandEmpty>}
            {filteredLocal.length > 0 && (
              <CommandGroup heading="Local">
                {filteredLocal.map((branch) => (
                  <CommandItem
                    key={`local-${branch}`}
                    value={branch}
                    onSelect={() => {
                      onChange(branch, false);
                      setOpen(false);
                      setSearch("");
                    }}
                    className="flex items-center justify-between"
                  >
                    <span className="flex items-center gap-2 truncate">
                      <GoGitBranch className="size-3.5 shrink-0 text-muted-foreground" />
                      <span className="truncate font-mono">{branch}</span>
                    </span>
                    {value === branch && (
                      <HiCheck className="size-4 text-primary shrink-0" />
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {filteredRemote.length > 0 && (
              <CommandGroup heading="Remote">
                {filteredRemote.map((branch) => (
                  <CommandItem
                    key={`remote-${branch}`}
                    value={branch}
                    onSelect={() => {
                      onChange(branch, true);
                      setOpen(false);
                      setSearch("");
                    }}
                    className="flex items-center justify-between"
                  >
                    <span className="flex items-center gap-2 truncate">
                      <GoGitBranch className="size-3.5 shrink-0 text-muted-foreground" />
                      <span className="truncate font-mono">{branch}</span>
                    </span>
                    {value === branch && (
                      <HiCheck className="size-4 text-primary shrink-0" />
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
```

**Step 2: Create index.ts**

Create `index.ts`:

```typescript
export { BranchPicker } from "./BranchPicker";
```

**Step 3: Run typecheck**

Run: `cd apps/desktop && bun run typecheck`

Expected: No errors

**Step 4: Commit**

```bash
git add apps/desktop/src/renderer/components/NewWorkspaceModal/components/BranchPicker/
git commit -m "feat(desktop): add BranchPicker component

Searchable dropdown with local/remote branch grouping.
Fetches branches in background on mount and provides manual refresh."
```

---

## Task 5: Add React Query Hook for New Mutation

**Files:**
- Modify: `apps/desktop/src/renderer/react-query/workspaces/index.ts`

**Step 1: Check existing hooks pattern**

Read the file to understand the pattern.

**Step 2: Add the hook**

Add after existing workspace hooks:

```typescript
export function useCreateFromExistingBranch() {
  const utils = trpc.useUtils();

  return trpc.workspaces.createFromExistingBranch.useMutation({
    onSuccess: (data) => {
      utils.workspaces.getActive.invalidate();
      utils.workspaces.getByProject.invalidate({ projectId: data.projectId });
      utils.workspaces.getWorktreesByProject.invalidate({ projectId: data.projectId });
      utils.projects.getRecents.invalidate();
    },
  });
}
```

**Step 3: Run typecheck**

Run: `cd apps/desktop && bun run typecheck`

Expected: No errors

**Step 4: Commit**

```bash
git add apps/desktop/src/renderer/react-query/workspaces/index.ts
git commit -m "feat(desktop): add useCreateFromExistingBranch hook

Invalidates workspace and project queries on success."
```

---

## Task 6: Update NewWorkspaceModal with Branch Mode

**Files:**
- Modify: `apps/desktop/src/renderer/components/NewWorkspaceModal/NewWorkspaceModal.tsx`

**Step 1: Add imports and state**

Add imports:

```typescript
import { BranchPicker } from "./components/BranchPicker";
import { useCreateFromExistingBranch } from "renderer/react-query/workspaces";
```

Add state (after existing state declarations around line 71):

```typescript
const [existingBranch, setExistingBranch] = useState<string | null>(null);
const [isRemoteBranch, setIsRemoteBranch] = useState(false);
```

Add hook:

```typescript
const createFromExisting = useCreateFromExistingBranch();
```

**Step 2: Update mode type**

The mode type already exists as `type Mode = "existing" | "new";` - this is the toggle between "New" and "Existing" tabs.

**Step 3: Add handler for creating from existing branch**

Add after `handleCreateWorkspace`:

```typescript
const handleCreateFromExistingBranch = async () => {
  if (!selectedProjectId || !existingBranch) return;

  try {
    const result = await createFromExisting.mutateAsync({
      projectId: selectedProjectId,
      branch: existingBranch,
    });

    handleClose();

    if (result.isInitializing) {
      toast.success("Workspace created", {
        description: "Setting up in the background...",
      });
    } else {
      toast.success("Workspace created");
    }
  } catch (err) {
    toast.error(
      err instanceof Error ? err.message : "Failed to create workspace",
    );
  }
};
```

**Step 4: Update resetForm**

Add to `resetForm` function:

```typescript
setExistingBranch(null);
setIsRemoteBranch(false);
```

**Step 5: Replace ExistingWorktreesList with new UI**

The current "Existing" tab shows `ExistingWorktreesList`. We need to change this to show:
1. The BranchPicker for selecting an existing branch
2. A "Create Workspace" button
3. Below that, still show the ExistingWorktreesList for reopening closed worktrees

Replace the `mode === "existing"` section (around line 444-449):

```typescript
) : (
  <div className="space-y-4">
    <div className="space-y-3">
      <div className="space-y-1.5">
        <label className="text-xs text-muted-foreground">
          Branch
        </label>
        <BranchPicker
          projectId={selectedProjectId}
          value={existingBranch}
          onChange={(branch, isRemote) => {
            setExistingBranch(branch);
            setIsRemoteBranch(isRemote);
          }}
          disabled={createFromExisting.isPending}
        />
      </div>

      <Button
        className="w-full h-8 text-sm"
        onClick={handleCreateFromExistingBranch}
        disabled={
          !existingBranch ||
          createFromExisting.isPending
        }
      >
        Create Workspace
      </Button>
    </div>

    <div className="pt-2 border-t border-border">
      <div className="text-[10px] text-muted-foreground/60 uppercase tracking-wider py-1">
        Reopen closed worktrees
      </div>
      <ExistingWorktreesList
        projectId={selectedProjectId}
        onOpenSuccess={handleClose}
      />
    </div>
  </div>
)}
```

**Step 6: Run typecheck and lint**

Run: `cd apps/desktop && bun run typecheck && bun run lint`

Expected: No errors

**Step 7: Commit**

```bash
git add apps/desktop/src/renderer/components/NewWorkspaceModal/NewWorkspaceModal.tsx
git commit -m "feat(desktop): add existing branch selection to NewWorkspaceModal

When 'Existing' tab is selected, shows:
1. Branch picker to select from local/remote branches
2. Create Workspace button
3. List of closed worktrees that can be reopened

Closes #691"
```

---

## Task 7: Manual Testing

**Step 1: Build and run the app**

Run: `cd apps/desktop && bun run dev`

**Step 2: Test the feature**

1. Open a project
2. Click "New Workspace"
3. Select a project
4. Click "Existing" tab
5. Verify the branch picker shows local and remote branches
6. Verify branches already used by worktrees are filtered out
7. Select a branch and click "Create Workspace"
8. Verify the workspace is created and initialization runs in background
9. Verify the worktree is created with the correct branch

**Step 3: Test error cases**

1. Try to create a workspace from a branch that already has a worktree (should error)
2. Test with a project that has no remote (should show only local branches)
3. Test the refresh button in the branch picker

---

## Task 8: Run Full Test Suite

**Step 1: Run all tests**

Run: `cd apps/desktop && bun test`

Expected: All tests pass

**Step 2: Run typecheck**

Run: `bun run typecheck`

Expected: No errors

**Step 3: Run lint**

Run: `bun run lint`

Expected: No errors

---

## Summary of Files Changed

**Modified:**
- `apps/desktop/src/lib/trpc/routers/workspaces/utils/git.ts` - Added `CreateWorktreeOptions` interface
- `apps/desktop/src/lib/trpc/routers/workspaces/utils/git.test.ts` - Added tests for existing branch worktree creation
- `apps/desktop/src/lib/trpc/routers/workspaces/utils/workspace-init.ts` - Added `initializeExistingBranchWorktree`
- `apps/desktop/src/lib/trpc/routers/workspaces/procedures/create.ts` - Added `createFromExistingBranch` mutation
- `apps/desktop/src/lib/trpc/routers/workspaces/procedures/branch.ts` - Added `getAvailableBranches` and `fetchBranches`
- `apps/desktop/src/renderer/react-query/workspaces/index.ts` - Added `useCreateFromExistingBranch` hook
- `apps/desktop/src/renderer/components/NewWorkspaceModal/NewWorkspaceModal.tsx` - Integrated BranchPicker

**Created:**
- `apps/desktop/src/renderer/components/NewWorkspaceModal/components/BranchPicker/BranchPicker.tsx`
- `apps/desktop/src/renderer/components/NewWorkspaceModal/components/BranchPicker/index.ts`
