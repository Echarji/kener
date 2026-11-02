<script lang="ts">
  import { onMount } from "svelte";
  import { Skeleton } from "$lib/components/ui/skeleton/index.js";
  import * as ToggleGroup from "$lib/components/ui/toggle-group/index.js";
  import MonitorBar from "$lib/components/MonitorBar.svelte";
  import GroupMonitorPopover from "$lib/components/GroupMonitorPopover.svelte";
  import MonitorSubscribeButton from "$lib/components/MonitorSubscribeButton.svelte";
  import type { MonitorBarResponse } from "$lib/server/api-server/monitor-bar/get";
  import {
    CountMemberStatuses,
    SummarizeMemberStatuses,
    STATUS_LABEL_KEY,
    MEMBER_SUMMARY_KEY,
    DEFAULT_GROUP_DISPLAY,
    GROUP_MEMBERS_LAYOUTS,
    GROUP_VIEW_STORAGE_KEY,
    ParseStoredGroupViews,
    type GroupDisplay,
    type GroupMembersLayout
  } from "$lib/monitorGroups";
  import { resolve } from "$app/paths";
  import clientResolver from "$lib/client/resolver.js";
  import { t } from "$lib/stores/i18n";
  import trackEvent from "$lib/beacon";
  import ICONS from "$lib/icons";
  import Layers from "@lucide/svelte/icons/layers";
  import LayoutGrid from "@lucide/svelte/icons/layout-grid";
  import List from "@lucide/svelte/icons/list";

  interface Props {
    tag: string;
    data?: MonitorBarResponse;
    error?: string;
    // The members the viewer can see, in the group's order.
    memberTags: string[];
    memberDataByTag: Record<string, MonitorBarResponse>;
    memberErrorByTag: Record<string, string>;
    days: number;
    endOfDayTodayAtTz: number;
    // How the group lays out its members, set on the group monitor.
    display?: GroupDisplay;
    // The page's layout, for the group's own bar.
    compact?: boolean;
    grid?: boolean;
  }

  let {
    tag,
    data,
    error,
    memberTags,
    memberDataByTag,
    memberErrorByTag,
    days,
    endOfDayTodayAtTz,
    display = DEFAULT_GROUP_DISPLAY,
    compact = false,
    grid = false
  }: Props = $props();

  const STATUS_TEXT = {
    UP: "text-up",
    DOWN: "text-down",
    DEGRADED: "text-degraded",
    MAINTENANCE: "text-maintenance",
    NO_DATA: "text-muted-foreground"
  } as const;

  const STATUS_DOT = {
    UP: "bg-up",
    DOWN: "bg-down",
    DEGRADED: "bg-degraded",
    MAINTENANCE: "bg-maintenance",
    NO_DATA: "bg-no-data"
  } as const;

  const STATUS_STROKE = {
    UP: "stroke-up",
    DOWN: "stroke-down",
    DEGRADED: "stroke-degraded",
    MAINTENANCE: "stroke-maintenance",
    NO_DATA: "stroke-muted-foreground"
  } as const;

  // The layout the visitor picked for this group, kept in their browser; until then, the group's own.
  let chosenLayout = $state<GroupMembersLayout | null>(null);
  let layout = $derived(chosenLayout ?? display.layout);
  let isCompact = $derived(display.style === "compact");

  // Members that failed to load are left out of the list rather than shown as broken rows.
  let shownMemberTags = $derived(memberTags.filter((memberTag) => !memberErrorByTag[memberTag]));
  let summary = $derived(
    SummarizeMemberStatuses(
      CountMemberStatuses(memberTags.map((memberTag) => memberDataByTag[memberTag]?.currentStatus))
    )
  );

  onMount(() => {
    try {
      chosenLayout = ParseStoredGroupViews(localStorage.getItem(GROUP_VIEW_STORAGE_KEY))[tag] ?? null;
    } catch {
      // Storage blocked: the group's own layout stays.
    }
  });

  function chooseLayout(next: string) {
    // A single toggle group clears its value when the pressed item is pressed again; keep the layout.
    if (!GROUP_MEMBERS_LAYOUTS.includes(next as GroupMembersLayout) || next === layout) return;
    chosenLayout = next as GroupMembersLayout;
    try {
      const stored = ParseStoredGroupViews(localStorage.getItem(GROUP_VIEW_STORAGE_KEY));
      localStorage.setItem(GROUP_VIEW_STORAGE_KEY, JSON.stringify({ ...stored, [tag]: chosenLayout }));
    } catch {
      // Storage blocked: the choice lasts until the page reloads.
    }
    trackEvent("group_layout_changed", { layout: chosenLayout });
  }
</script>

<section class="flex flex-col" aria-label={data ? $t("%name group", { name: data.name }) : undefined}>
  <div class="flex min-w-0 items-center justify-between gap-2 px-4 pt-3">
    <span class="text-muted-foreground inline-flex min-w-0 items-center gap-1.5 text-xs font-medium">
      <Layers class="size-3.5 shrink-0" aria-hidden="true" />
      <span class="truncate">
        {$t("Group")} ·
        {memberTags.length === 1 ? $t("1 monitor") : $t("%count monitors", { count: String(memberTags.length) })}
      </span>
    </span>
    {#if data}
      <span
        class="bg-background inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium {STATUS_TEXT[
          data.currentStatus
        ]}"
      >
        <span class="size-2 rounded-full {STATUS_DOT[data.currentStatus]}" aria-hidden="true"></span>
        {$t(STATUS_LABEL_KEY[data.currentStatus])}
      </span>
    {:else if !error}
      <Skeleton class="h-5 w-24 rounded-full" />
    {/if}
  </div>

  <MonitorBar
    {tag}
    prefetchedData={data}
    prefetchedError={error}
    {days}
    {endOfDayTodayAtTz}
    {compact}
    {grid}
    subscribable={true}
  />

  {#if memberTags.length > 0}
    <div
      class="@container flex flex-col gap-2 px-4 pt-2 pb-3"
      data-members-layout={layout}
      data-members-style={display.style}
    >
      <div class="flex min-w-0 items-center justify-between gap-2">
        <p class="text-muted-foreground min-w-0 text-xs">
          {#each summary as item, i (item.status)}
            {#if i > 0}<span class="mx-1" aria-hidden="true">·</span>{/if}
            <span class={item.status === "UP" ? "" : STATUS_TEXT[item.status]}>
              {$t(MEMBER_SUMMARY_KEY[item.status], { count: String(item.count) })}
            </span>
          {/each}
        </p>
        <ToggleGroup.Root
          type="single"
          variant="outline"
          size="sm"
          class="bg-background shrink-0"
          aria-label={$t("Group layout")}
          bind:value={() => layout, (next) => chooseLayout(next)}
        >
          <ToggleGroup.Item value="list" aria-label={$t("List view")} title={$t("List view")} class="h-7 px-2">
            <List class="size-3.5" />
          </ToggleGroup.Item>
          <ToggleGroup.Item value="grid" aria-label={$t("Grid view")} title={$t("Grid view")} class="h-7 px-2">
            <LayoutGrid class="size-3.5" />
          </ToggleGroup.Item>
        </ToggleGroup.Root>
      </div>

      {#if isCompact}
        <!-- Compact: one line per member -->
        <ul
          class="grid grid-cols-1 gap-1.5 {layout === 'grid' ? '@md:grid-cols-2 @3xl:grid-cols-3' : ''}"
          aria-label={$t("Monitors in this group")}
        >
          {#each shownMemberTags as memberTag (memberTag)}
            {@const member = memberDataByTag[memberTag]}
            <li class="bg-secondary/50 flex min-w-0 items-center gap-2 rounded-lg py-1 pr-1 pl-2.5">
              {#if member}
                {@const StatusIcon = ICONS[member.currentStatus]}
                <StatusIcon class="size-4 shrink-0 {STATUS_STROKE[member.currentStatus]}" aria-hidden="true" />
                <span class="sr-only">{$t(STATUS_LABEL_KEY[member.currentStatus])}:</span>
                <a
                  class="min-w-0 flex-1 truncate text-sm hover:underline"
                  href={clientResolver(resolve, `/monitors/${memberTag}`)}
                >
                  {member.name}
                </a>
                {#if member.monitorType !== "SSL"}
                  <span class="text-muted-foreground shrink-0 text-xs tabular-nums" title={$t("Uptime")}>
                    {member.uptime}%
                  </span>
                {/if}
                <MonitorSubscribeButton tag={memberTag} name={member.name} />
              {:else}
                <Skeleton class="size-4 shrink-0 rounded-full" />
                <Skeleton class="h-4 flex-1" />
                <Skeleton class="my-1.5 h-4 w-10 shrink-0" />
              {/if}
            </li>
          {/each}
        </ul>

        <GroupMonitorPopover tags={memberTags} {days} {endOfDayTodayAtTz}>
          {$t("Included Monitors (%count)", { count: String(memberTags.length) })}
        </GroupMonitorPopover>
      {:else}
        <!-- Simple: each member with its status history -->
        <ul
          class={layout === "grid"
            ? "grid grid-cols-1 gap-2 @2xl:grid-cols-2"
            : "divide-y overflow-hidden rounded-xl border"}
          aria-label={$t("Monitors in this group")}
        >
          {#each shownMemberTags as memberTag (memberTag)}
            <li class="min-w-0 py-1 {layout === 'grid' ? 'rounded-xl border' : ''}">
              <MonitorBar
                tag={memberTag}
                prefetchedData={memberDataByTag[memberTag]}
                {days}
                {endOfDayTodayAtTz}
                grid={layout === "grid"}
                subscribable={true}
              />
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  {/if}
</section>
