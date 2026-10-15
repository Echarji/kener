<script lang="ts">
  import { Input } from "$lib/components/ui/input/index.js";
  import { t } from "$lib/stores/i18n";
  import Search from "@lucide/svelte/icons/search";
  import Check from "@lucide/svelte/icons/check";
  import Loader2 from "@lucide/svelte/icons/loader-2";

  interface MonitorOption {
    tag: string;
    name: string;
  }

  interface Props {
    monitors?: MonitorOption[];
    /** Currently selected monitor tags. Two-way bindable. */
    selected?: string[];
    loading?: boolean;
    /** Tailwind max-height/scroll classes for the list viewport. */
    listClass?: string;
    disabled?: boolean;
  }

  let {
    monitors = [],
    selected = $bindable<string[]>([]),
    loading = false,
    listClass = "max-h-64",
    disabled = false
  }: Props = $props();

  let search = $state("");

  // Filter by monitor name or tag, case-insensitive.
  let filtered = $derived.by(() => {
    const term = search.trim().toLowerCase();
    if (!term) return monitors;
    return monitors.filter(
      (m) => (m.name || "").toLowerCase().includes(term) || (m.tag || "").toLowerCase().includes(term)
    );
  });

  function toggle(tag: string) {
    if (disabled) return;
    if (selected.includes(tag)) {
      selected = selected.filter((value) => value !== tag);
    } else {
      selected = [...selected, tag];
    }
  }

  function selectAllFiltered() {
    if (disabled) return;
    const merged = new Set([...selected, ...filtered.map((m) => m.tag)]);
    selected = [...merged];
  }

  function clearAll() {
    if (disabled) return;
    selected = [];
  }
</script>

<div class="flex flex-col gap-3">
  <div class="relative">
    <Search class="text-muted-foreground pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
    <Input
      class="pl-10"
      placeholder={$t("Search monitors...")}
      bind:value={search}
      {disabled}
      aria-label={$t("Search monitors")}
    />
  </div>

  <div class="overflow-y-auto overscroll-contain rounded-lg border {listClass}">
    {#if loading}
      <div class="flex items-center justify-center py-8">
        <Loader2 class="text-muted-foreground h-6 w-6 animate-spin" />
      </div>
    {:else if filtered.length === 0}
      <p class="text-muted-foreground px-3 py-6 text-center text-sm">{$t("No monitors found")}</p>
    {:else}
      <ul class="divide-y">
        {#each filtered as monitor (monitor.tag)}
          {@const isSelected = selected.includes(monitor.tag)}
          <li>
            <button
              type="button"
              class="hover:bg-accent flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm transition-colors disabled:opacity-50"
              onclick={() => toggle(monitor.tag)}
              aria-pressed={isSelected}
              {disabled}
            >
              <span class="flex min-w-0 flex-col">
                <span class="truncate font-medium">{monitor.name || monitor.tag}</span>
                <span class="text-muted-foreground truncate text-xs">{monitor.tag}</span>
              </span>
              <span
                class="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border {isSelected
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'border-muted-foreground/40'}"
              >
                {#if isSelected}
                  <Check class="h-3.5 w-3.5" />
                {/if}
              </span>
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </div>

  <div class="text-muted-foreground flex items-center justify-between text-xs">
    <span>{selected.length} {$t("selected")}</span>
    <div class="flex items-center gap-3">
      <button type="button" class="hover:text-foreground disabled:opacity-50" onclick={selectAllFiltered} {disabled}>
        {$t("Select all")}
      </button>
      <button type="button" class="hover:text-foreground disabled:opacity-50" onclick={clearAll} {disabled}>
        {$t("Clear")}
      </button>
    </div>
  </div>
</div>
