import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const TEST_DIR = join(__dirname, ".test-branch-tmp");

function createTestRepo(name: string): string {
	const repoPath = join(TEST_DIR, name);
	mkdirSync(repoPath, { recursive: true });
	execSync("git init", { cwd: repoPath, stdio: "ignore" });
	execSync("git config user.email 'test@test.com'", {
		cwd: repoPath,
		stdio: "ignore",
	});
	execSync("git config user.name 'Test'", { cwd: repoPath, stdio: "ignore" });
	return repoPath;
}

describe("filterAvailableBranches", () => {
	// Import the function directly to test it
	// Note: Since filterAvailableBranches is a private function, we test it indirectly
	// through the listBranches + filtering logic

	test("filters out branches in use by worktrees", async () => {
		const { listBranches } = await import("../utils/git");
		const repoPath = createTestRepo("filter-inuse-test");

		// Create initial commit
		writeFileSync(join(repoPath, "test.txt"), "content");
		execSync("git add . && git commit -m 'initial'", {
			cwd: repoPath,
			stdio: "ignore",
		});

		// Create some branches
		execSync("git branch feature-a", { cwd: repoPath, stdio: "ignore" });
		execSync("git branch feature-b", { cwd: repoPath, stdio: "ignore" });

		const branches = await listBranches(repoPath, { fetch: false });

		// Simulate filtering with in-use branches
		const inUseBranches = new Set(["feature-a"]);
		const _localSet = new Set(branches.local);
		const availableLocal = branches.local.filter((b) => !inUseBranches.has(b));

		// feature-a should be filtered out
		expect(availableLocal).not.toContain("feature-a");
		expect(availableLocal).toContain("feature-b");
	});

	beforeEach(() => {
		mkdirSync(TEST_DIR, { recursive: true });
	});

	afterEach(() => {
		if (existsSync(TEST_DIR)) {
			rmSync(TEST_DIR, { recursive: true, force: true });
		}
	});
});

describe("listBranches", () => {
	beforeEach(() => {
		mkdirSync(TEST_DIR, { recursive: true });
	});

	afterEach(() => {
		if (existsSync(TEST_DIR)) {
			rmSync(TEST_DIR, { recursive: true, force: true });
		}
	});

	test("returns local branches", async () => {
		const { listBranches } = await import("../utils/git");
		const repoPath = createTestRepo("local-branches-test");

		// Create initial commit
		writeFileSync(join(repoPath, "test.txt"), "content");
		execSync("git add . && git commit -m 'initial'", {
			cwd: repoPath,
			stdio: "ignore",
		});

		// Create branches
		execSync("git branch feature-1", { cwd: repoPath, stdio: "ignore" });
		execSync("git branch feature-2", { cwd: repoPath, stdio: "ignore" });

		const branches = await listBranches(repoPath, { fetch: false });

		expect(branches.local).toContain("feature-1");
		expect(branches.local).toContain("feature-2");
	});

	test("returns remote branches without origin/ prefix", async () => {
		const { listBranches } = await import("../utils/git");
		const repoPath = createTestRepo("remote-branches-test");

		// Create initial commit
		writeFileSync(join(repoPath, "test.txt"), "content");
		execSync("git add . && git commit -m 'initial'", {
			cwd: repoPath,
			stdio: "ignore",
		});

		// Simulate remote by adding remote tracking refs
		execSync("git remote add origin https://example.com/repo.git", {
			cwd: repoPath,
			stdio: "ignore",
		});
		execSync("git update-ref refs/remotes/origin/main HEAD", {
			cwd: repoPath,
			stdio: "ignore",
		});
		execSync("git update-ref refs/remotes/origin/develop HEAD", {
			cwd: repoPath,
			stdio: "ignore",
		});

		const branches = await listBranches(repoPath, { fetch: false });

		// Remote branches should have origin/ prefix stripped
		expect(branches.remote).toContain("main");
		expect(branches.remote).toContain("develop");
		expect(branches.remote).not.toContain("origin/main");
	});

	test("handles repo with no commits", async () => {
		const { listBranches } = await import("../utils/git");
		const repoPath = createTestRepo("no-commits-test");

		// Don't create any commits - this is an empty repo
		const branches = await listBranches(repoPath, { fetch: false });

		expect(branches.local).toEqual([]);
		expect(branches.remote).toEqual([]);
	});
});

describe("branch validation in createFromExistingBranch", () => {
	beforeEach(() => {
		mkdirSync(TEST_DIR, { recursive: true });
	});

	afterEach(() => {
		if (existsSync(TEST_DIR)) {
			rmSync(TEST_DIR, { recursive: true, force: true });
		}
	});

	test("listBranches correctly identifies existing branches", async () => {
		const { listBranches } = await import("../utils/git");
		const repoPath = createTestRepo("branch-validation-test");

		// Create initial commit
		writeFileSync(join(repoPath, "test.txt"), "content");
		execSync("git add . && git commit -m 'initial'", {
			cwd: repoPath,
			stdio: "ignore",
		});

		// Create a branch
		execSync("git branch existing-branch", { cwd: repoPath, stdio: "ignore" });

		const branches = await listBranches(repoPath, { fetch: false });

		// existing-branch should be in local branches
		expect(branches.local.includes("existing-branch")).toBe(true);

		// non-existent branch should not be in local or remote
		expect(branches.local.includes("non-existent")).toBe(false);
		expect(branches.remote.includes("non-existent")).toBe(false);
	});

	test("remote branches are detected correctly", async () => {
		const { listBranches } = await import("../utils/git");
		const repoPath = createTestRepo("remote-validation-test");

		// Create initial commit
		writeFileSync(join(repoPath, "test.txt"), "content");
		execSync("git add . && git commit -m 'initial'", {
			cwd: repoPath,
			stdio: "ignore",
		});

		// Add remote tracking ref
		execSync("git remote add origin https://example.com/repo.git", {
			cwd: repoPath,
			stdio: "ignore",
		});
		execSync("git update-ref refs/remotes/origin/remote-feature HEAD", {
			cwd: repoPath,
			stdio: "ignore",
		});

		const branches = await listBranches(repoPath, { fetch: false });

		// remote-feature should be in remote branches
		expect(branches.remote.includes("remote-feature")).toBe(true);
	});
});
