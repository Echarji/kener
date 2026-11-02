<script lang="ts">
  import { browser } from "$app/environment";
  import MonitorBar from "$lib/components/MonitorBar.svelte";
  import MonitorGroupCard from "$lib/components/MonitorGroupCard.svelte";
  import { requestMonitorBar } from "$lib/client/monitor-bar-client";
  import type { MonitorBarResponse } from "$lib/server/api-server/monitor-bar/get";
  import type { PageMonitorLayoutStyle } from "$lib/types/api";
  import type { GroupDisplay } from "$lib/monitorGroups";

  interface Props {
    monitorTags: string[];
    // The members of each group monitor on the page that the viewer can see.
    monitorGroupMembersByTag?: Record<string, string[]>;
    // How each group monitor lays out its members.
    monitorGroupDisplayByTag?: Record<string, GroupDisplay>;
    layoutStyle?: PageMonitorLayoutStyle;
    days: number;
    endOfDayTodayAtTz: number;
  }

  let {
    monitorTags,
    monitorGroupMembersByTag = {},
    monitorGroupDisplayByTag = {},
    layoutStyle,
    days,
    endOfDayTodayAtTz
  }: Props = $props();

  let viewType = $derived<PageMonitorLayoutStyle>(layoutStyle ?? "default-list");
  let isCompact = $derived(viewType === "compact-list" || viewType === "compact-grid");
  let isGrid = $derived(viewType === "compact-grid" || viewType === "default-grid");

  let monitorBarDataByTag = $state<Record<string, MonitorBarResponse>>({});
  let monitorBarErrorByTag = $state<Record<string, string>>({});
  let requestVersion = 0;

  // The page's monitors and the members of its groups, each fetched once.
  let barTags = $derived([...new Set([...monitorTags, ...Object.values(monitorGroupMembersByTag).flat()])]);

  function getGridItemSpanClass(index: number, total: number, type: PageMonitorLayoutStyle): string {
    if (type === "default-grid") {
      const mdLastRowCount = total % 2 || 2;
      const mdLastRowStart = total - mdLastRowCount;
      const isInMdLastRow = index >= mdLastRowStart;
      const mdSpan = isInMdLastRow && mdLastRowCount === 1 ? "md:col-span-4" : "md:col-span-2";

      const lgLastRowCount = total % 2 || 2;
      const lgLastRowStart = total - lgLastRowCount;
      const isInLgLastRow = index >= lgLastRowStart;
      const lgSpan = isInLgLastRow && lgLastRowCount === 1 ? "lg:col-span-4" : "lg:col-span-2";

      return `${mdSpan} ${lgSpan}`;
    }

    const smLastRowCount = total % 2 || 2;
    const smLastRowStart = total - smLastRowCount;
    const isInSmLastRow = index >= smLastRowStart;
    const smSpan = isInSmLastRow && smLastRowCount === 1 ? "sm:col-span-4" : "sm:col-span-2";

    const lgLastRowCount = total % 3 || 3;
    const lgLastRowStart = total - lgLastRowCount;
    const isInLgLastRow = index >= lgLastRowStart;
    const lgSpan = isInLgLastRow
      ? lgLastRowCount === 1
        ? "lg:col-span-6"
        : lgLastRowCount === 2
          ? "lg:col-span-3"
          : "lg:col-span-2"
      : "lg:col-span-2";

    return `${smSpan} ${lgSpan}`;
  }

  function getGridContainerClass(type: PageMonitorLayoutStyle): string {
    if (type === "compact-grid") return "bg-border gap-px sm:grid-cols-4 lg:grid-cols-6";
    if (type === "default-grid") return "bg-border gap-px md:grid-cols-4 lg:grid-cols-4";
    return "";
  }

  $effect(() => {
    const tags = barTags;
    const barDays = days;
    const endOfDay = endOfDayTodayAtTz;
    const currentRequestVersion = ++requestVersion;

    monitorBarDataByTag = {};
    monitorBarErrorByTag = {};

    if (!browser || !tags.length) return;

    void Promise.all(
      tags.map(async (tag) => {
        try {
          const monitorBarData = await requestMonitorBar(tag, barDays, endOfDay);
          return { tag, ok: true as const, monitorBarData };
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : "Unknown error";
          return { tag, ok: false as const, errorMessage };
        }
      })
    ).then((results) => {
      if (currentRequestVersion !== requestVersion) return;

      const nextDataByTag: Record<string, MonitorBarResponse> = {};
      const nextErrorByTag: Record<string, string> = {};

      for (const result of results) {
        if (result.ok) {
          nextDataByTag[result.tag] = result.monitorBarData;
        } else {
          nextErrorByTag[result.tag] = result.errorMessage;
        }
      }

      monitorBarDataByTag = nextDataByTag;
      monitorBarErrorByTag = nextErrorByTag;
    });
  });
</script>

<div class="overflow-hidden rounded-3xl border">
  <div class={`grid grid-cols-1 ${getGridContainerClass(viewType)}`}>
    {#each monitorTags as tag, i (tag)}
      {@const memberTags = monitorGroupMembersByTag[tag] || []}
      <div
        class="{isGrid
          ? `${getGridItemSpanClass(i, monitorTags.length, viewType)} bg-background`
          : i < monitorTags.length - 1
            ? 'border-b'
            : ''} px-2 py-2 sm:px-0"
      >
        {#if memberTags.length > 0}
          <MonitorGroupCard
            {tag}
            data={monitorBarDataByTag[tag]}
            error={monitorBarErrorByTag[tag]}
            {memberTags}
            memberDataByTag={monitorBarDataByTag}
            memberErrorByTag={monitorBarErrorByTag}
            {days}
            {endOfDayTodayAtTz}
            display={monitorGroupDisplayByTag[tag]}
            compact={isCompact}
            grid={isGrid}
          />
        {:else}
          <MonitorBar
            {tag}
            prefetchedData={monitorBarDataByTag[tag]}
            prefetchedError={monitorBarErrorByTag[tag]}
            {days}
            {endOfDayTodayAtTz}
            compact={isCompact}
            grid={isGrid}
            subscribable={true}
          />
        {/if}
      </div>
    {/each}
  </div>
</div>
