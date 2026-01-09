// ABOUTME: Mutation hook for creating a workspace from an existing branch.
// ABOUTME: Handles invalidation and terminal setup via WorkspaceInitEffects.

import { trpc } from "renderer/lib/trpc";
import { useWorkspaceInitStore } from "renderer/stores/workspace-init";

/**
 * Mutation hook for creating a workspace from an existing branch.
 * Similar to useCreateWorkspace but for existing branches.
 */
export function useCreateFromExistingBranch(
	options?: Parameters<
		typeof trpc.workspaces.createFromExistingBranch.useMutation
	>[0],
) {
	const utils = trpc.useUtils();
	const addPendingTerminalSetup = useWorkspaceInitStore(
		(s) => s.addPendingTerminalSetup,
	);

	return trpc.workspaces.createFromExistingBranch.useMutation({
		...options,
		onSuccess: async (data, ...rest) => {
			// Auto-invalidate all workspace queries
			await utils.workspaces.invalidate();

			// Add to global pending store (WorkspaceInitEffects will handle terminal creation)
			addPendingTerminalSetup({
				workspaceId: data.workspace.id,
				projectId: data.projectId,
				initialCommands: data.initialCommands,
			});

			// Call user's onSuccess if provided
			await options?.onSuccess?.(data, ...rest);
		},
	});
}
