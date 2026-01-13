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
import { useEffect, useRef, useState } from "react";
import { GoGitBranch } from "react-icons/go";
import { HiCheck, HiChevronUpDown } from "react-icons/hi2";
import { LuLoader, LuRefreshCw } from "react-icons/lu";
import { trpc } from "renderer/lib/trpc";

interface BranchPickerProps {
	projectId: string;
	value: string | null;
	onChange: (branch: string) => void;
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
	const hasFetchedRef = useRef(false);

	const {
		data: branches,
		isLoading,
		refetch,
	} = trpc.workspaces.getAvailableBranches.useQuery(
		{ projectId },
		{ enabled: !!projectId },
	);

	const fetchMutation = trpc.workspaces.fetchBranches.useMutation({
		onSuccess: () => {
			refetch();
		},
	});

	// Trigger background fetch once when component mounts or projectId changes
	useEffect(() => {
		if (projectId) {
			// Reset and fetch when projectId changes
			hasFetchedRef.current = true;
			fetchMutation.mutate({ projectId });
		}
		return () => {
			// Reset on cleanup so next projectId triggers a fresh fetch
			hasFetchedRef.current = false;
		};
	}, [projectId, fetchMutation.mutate]); // eslint-disable-line react-hooks/exhaustive-deps -- intentionally exclude fetchMutation to run once per projectId

	const filteredLocal = (branches?.local ?? []).filter((b) =>
		b.toLowerCase().includes(search.toLowerCase()),
	);
	const filteredRemote = (branches?.remote ?? []).filter((b) =>
		b.toLowerCase().includes(search.toLowerCase()),
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
							<LuLoader className="size-3 animate-spin text-muted-foreground" />
						)}
						<HiChevronUpDown className="size-4 shrink-0 text-muted-foreground" />
					</span>
				</Button>
			</PopoverTrigger>
			<PopoverContent
				className="w-[--radix-popover-trigger-width] p-0"
				align="start"
			>
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
											onChange(branch);
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
											onChange(branch);
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
