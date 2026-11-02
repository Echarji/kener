<script lang="ts">
  import { Button } from "$lib/components/ui/button/index.js";
  import { page } from "$app/state";
  import { t } from "$lib/stores/i18n";
  import trackEvent from "$lib/beacon";
  import { subscriber, RequestSubscribe } from "$lib/client/subscriber.svelte";
  import Bell from "@lucide/svelte/icons/bell";
  import BellRing from "@lucide/svelte/icons/bell-ring";

  interface Props {
    tag: string;
    name: string;
    // Show "Subscribe" / "Subscribed" next to the icon.
    labeled?: boolean;
    class?: string;
  }

  let { tag, name, labeled = false, class: className = "" }: Props = $props();

  // The page's subscribe dialog exists only where subscriptions are on and email can be sent.
  let available = $derived(
    page.data?.isSubsEnabled === true && page.data?.canSendEmail === true && page.data?.isMonitorSubsEnabled === true
  );
  let subscribed = $derived(subscriber.monitorTags.includes(tag));
  let label = $derived(subscribed ? $t("Manage subscription to %name", { name }) : $t("Subscribe to %name", { name }));

  function handleClick(event: MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    RequestSubscribe(tag);
    trackEvent("subscribe_monitor_clicked", { source: "monitor", subscribed });
  }
</script>

{#if available}
  {#if labeled}
    <Button
      variant="outline"
      size="sm"
      class="rounded-btn shrink-0 text-xs {className}"
      aria-label={label}
      title={label}
      onclick={handleClick}
    >
      {#if subscribed}
        <BellRing class="text-primary" />
        {$t("Subscribed")}
      {:else}
        <Bell />
        {$t("Subscribe")}
      {/if}
    </Button>
  {:else}
    <Button
      variant="ghost"
      size="icon-sm"
      class="text-muted-foreground hover:text-foreground size-7 shrink-0 rounded-full {subscribed
        ? 'text-primary'
        : ''} {className}"
      aria-label={label}
      title={label}
      onclick={handleClick}
    >
      {#if subscribed}
        <BellRing class="size-3.5" />
      {:else}
        <Bell class="size-3.5" />
      {/if}
    </Button>
  {/if}
{/if}
