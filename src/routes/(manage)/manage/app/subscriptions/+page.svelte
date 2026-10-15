<script lang="ts">
  import { onMount } from "svelte";
  import { Button } from "$lib/components/ui/button/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import { Spinner } from "$lib/components/ui/spinner/index.js";
  import { Label } from "$lib/components/ui/label/index.js";
  import { Switch } from "$lib/components/ui/switch/index.js";
  import * as Card from "$lib/components/ui/card/index.js";
  import * as Table from "$lib/components/ui/table/index.js";
  import * as Dialog from "$lib/components/ui/dialog/index.js";
  import * as Alert from "$lib/components/ui/alert/index.js";
  import { toast } from "svelte-sonner";
  import LocalTime from "$lib/components/LocalTime.svelte";
  import { resolve } from "$app/paths";
  import clientResolver from "$lib/client/resolver.js";
  import { page as pageData } from "$app/state";
  import Bell from "@lucide/svelte/icons/bell";
  import PlusIcon from "@lucide/svelte/icons/plus";
  import Trash2Icon from "@lucide/svelte/icons/trash-2";
  import ChevronLeftIcon from "@lucide/svelte/icons/chevron-left";
  import ChevronRightIcon from "@lucide/svelte/icons/chevron-right";
  import AlertTriangle from "@lucide/svelte/icons/alert-triangle";
  import Wrench from "@lucide/svelte/icons/wrench";
  import Mail from "@lucide/svelte/icons/mail";
  import Rss from "@lucide/svelte/icons/rss";
  import Pencil from "@lucide/svelte/icons/pencil";
  import MonitorSelector from "$lib/components/MonitorSelector.svelte";

  import type { SubscriptionsConfig } from "$lib/server/types/db.js";
  import AlertCircleIcon from "@lucide/svelte/icons/octagon-alert";

  // Config state
  let config = $state<SubscriptionsConfig>({
    enable: false,
    methods: {
      emails: {
        incidents: true,
        maintenances: true
      }
    }
  });
  let loadingConfig = $state(true);
  let savingConfig = $state(false);

  // RSS feed visibility — same site_data key as Site Configurations →
  // Sub Menu Options. Loaded/saved separately because it's independent of
  // the email-subscription toggles below.
  let subMenuOptions = $state<{
    showShareBadgeMonitor: boolean;
    showShareEmbedMonitor: boolean;
    showRssFeed: boolean;
  }>({
    showShareBadgeMonitor: true,
    showShareEmbedMonitor: true,
    showRssFeed: true
  });
  let savingRssToggle = $state(false);

  async function fetchSubMenuOptions() {
    try {
      const res = await fetch(clientResolver(resolve, "/manage/api"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "getSiteDataByKey", data: { key: "subMenuOptions" } })
      });
      const data = await res.json();
      if (data && !data.error) {
        subMenuOptions = {
          showShareBadgeMonitor: data.showShareBadgeMonitor ?? true,
          showShareEmbedMonitor: data.showShareEmbedMonitor ?? true,
          showRssFeed: data.showRssFeed ?? true
        };
      }
    } catch {
      // Defaults already in state; silently fall through.
    }
  }

  async function toggleRssFeed(value: boolean) {
    const previous = subMenuOptions.showRssFeed;
    subMenuOptions.showRssFeed = value;
    savingRssToggle = true;
    try {
      const res = await fetch(clientResolver(resolve, "/manage/api"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "storeSiteData",
          data: { subMenuOptions: JSON.stringify(subMenuOptions) }
        })
      });
      const result = await res.json();
      if (result.error) throw new Error(result.error);
      toast.success("RSS feed preference saved");
    } catch {
      subMenuOptions.showRssFeed = previous;
      toast.error("Failed to save RSS feed preference");
    } finally {
      savingRssToggle = false;
    }
  }

  // Subscribers state
  interface Subscriber {
    user_id: number;
    method_id: number;
    email: string;
    incidents_enabled: boolean;
    maintenances_enabled: boolean;
    incidents_subscription_id: number | null;
    maintenances_subscription_id: number | null;
    monitor_tags: string[];
    monitor_count: number;
    created_at: string;
  }

  let subscribers = $state<Subscriber[]>([]);
  let loadingSubscribers = $state(true);
  let page = $state(1);
  let limit = $state(10);
  let total = $state(0);
  let totalPages = $state(0);

  // The monitor catalog used by the add/manage pickers.
  let availableMonitors = $state<{ tag: string; name: string }[]>([]);
  let loadingMonitors = $state(true);

  // Add subscriber dialog
  let showAddDialog = $state(false);
  let addingSubscriber = $state(false);
  let newEmail = $state("");
  let newMonitorTags = $state<string[]>([]);
  let addError = $state("");

  // Manage monitors dialog
  let showManageDialog = $state(false);
  let managingSubscriber = $state<Subscriber | null>(null);
  let manageMonitorTags = $state<string[]>([]);
  let savingManage = $state(false);

  // Delete confirmation
  let showDeleteDialog = $state(false);
  let deletingSubscriber = $state<Subscriber | null>(null);
  let isDeleting = $state(false);

  // Fetch config
  async function fetchConfig() {
    loadingConfig = true;
    try {
      const res = await fetch(clientResolver(resolve, "/manage/api"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "getSubscriptionsConfig" })
      });
      config = await res.json();
    } catch (error) {
      toast.error("Failed to load configuration");
    } finally {
      loadingConfig = false;
    }
  }

  // Save config
  async function saveConfig() {
    savingConfig = true;
    try {
      await fetch(clientResolver(resolve, "/manage/api"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "updateSubscriptionsConfig",
          data: config
        })
      });
      toast.success("Configuration saved");
    } catch (error) {
      toast.error("Failed to save configuration");
    } finally {
      savingConfig = false;
    }
  }

  // Fetch subscribers
  async function fetchSubscribers() {
    loadingSubscribers = true;
    try {
      const res = await fetch(clientResolver(resolve, "/manage/api"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "getAdminSubscribers",
          data: { page, limit }
        })
      });
      const result = await res.json();
      if (!result.error) {
        subscribers = result.subscribers || [];
        total = result.total || 0;
        totalPages = result.totalPages || 0;
      }
    } catch (error) {
      toast.error("Failed to load subscribers");
    } finally {
      loadingSubscribers = false;
    }
  }

  // Fetch the monitor catalog available for subscription
  async function fetchAvailableMonitors() {
    loadingMonitors = true;
    try {
      const res = await fetch(clientResolver(resolve, "/manage/api"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "getAvailableMonitors" })
      });
      const result = await res.json();
      if (Array.isArray(result)) {
        availableMonitors = result;
      } else if (Array.isArray(result?.data)) {
        availableMonitors = result.data;
      }
    } catch (error) {
      toast.error("Failed to load monitors");
    } finally {
      loadingMonitors = false;
    }
  }

  // Add subscriber
  async function addSubscriber() {
    if (!newEmail.trim()) {
      addError = "Email is required";
      return;
    }

    addingSubscriber = true;
    addError = "";

    try {
      const res = await fetch(clientResolver(resolve, "/manage/api"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "adminAddSubscriber",
          data: {
            email: newEmail.trim(),
            monitorTags: newMonitorTags
          }
        })
      });
      const result = await res.json();
      if (result.error) {
        addError = result.error;
      } else {
        showAddDialog = false;
        resetAddForm();
        toast.success("Subscriber added successfully");
        await fetchSubscribers();
      }
    } catch (error) {
      addError = "Failed to add subscriber";
    } finally {
      addingSubscriber = false;
    }
  }

  function resetAddForm() {
    newEmail = "";
    newMonitorTags = [];
    addError = "";
  }

  // Open the manage-monitors dialog for a subscriber
  function openManageMonitors(subscriber: Subscriber) {
    managingSubscriber = subscriber;
    manageMonitorTags = [...(subscriber.monitor_tags || [])];
    showManageDialog = true;
  }

  // Save the monitor selection for the subscriber being managed
  async function saveManagedMonitors() {
    if (!managingSubscriber) return;

    savingManage = true;
    try {
      const res = await fetch(clientResolver(resolve, "/manage/api"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "adminSetSubscriberMonitors",
          data: {
            methodId: managingSubscriber.method_id,
            monitorTags: manageMonitorTags
          }
        })
      });
      const result = await res.json();
      if (result.error) {
        toast.error(result.error);
        return;
      }

      managingSubscriber.monitor_tags = [...manageMonitorTags];
      managingSubscriber.monitor_count = manageMonitorTags.length;
      showManageDialog = false;
      managingSubscriber = null;
      toast.success("Monitor subscriptions updated");
      await fetchSubscribers();
    } catch (error) {
      toast.error("Failed to update monitor subscriptions");
    } finally {
      savingManage = false;
    }
  }

  // Delete subscriber
  async function deleteSubscriber() {
    if (!deletingSubscriber) return;

    isDeleting = true;
    try {
      const res = await fetch(clientResolver(resolve, "/manage/api"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "adminDeleteSubscriber",
          data: { methodId: deletingSubscriber.method_id }
        })
      });
      const result = await res.json();
      if (result.error) {
        toast.error(result.error);
      } else {
        showDeleteDialog = false;
        deletingSubscriber = null;
        toast.success("Subscriber deleted");
        await fetchSubscribers();
      }
    } catch (error) {
      toast.error("Failed to delete subscriber");
    } finally {
      isDeleting = false;
    }
  }

  function confirmDelete(subscriber: Subscriber) {
    deletingSubscriber = subscriber;
    showDeleteDialog = true;
  }

  function goToPage(newPage: number) {
    page = newPage;
    fetchSubscribers();
  }

  function handleConfigChange() {
    saveConfig();
  }

  onMount(() => {
    fetchConfig();
    fetchSubMenuOptions();
    fetchSubscribers();
    fetchAvailableMonitors();
  });
</script>

<div class="container mx-auto space-y-6 py-6">
  <!-- Settings Card -->
  <Card.Root>
    <Card.Header>
      <Card.Title class="flex items-center gap-2">
        <Bell class="h-5 w-5" />
        Subscriptions Settings
      </Card.Title>
      <Card.Description>Configure subscription options for your status page</Card.Description>
    </Card.Header>
    <Card.Content class="space-y-4">
      {#if pageData.data.canSendEmail === false}
        <Alert.Root variant="destructive">
          <AlertCircleIcon />
          <Alert.Title>Email is not setup</Alert.Title>
          <Alert.Description>
            <p>
              Please visit the email set up documentation <a
                class="underline"
                href={clientResolver(resolve, "https://kener.ing/docs/v4/setup/email-setup")}>here</a
              >.
            </p>
          </Alert.Description>
        </Alert.Root>
      {/if}
      {#if loadingConfig}
        <div class="flex justify-center py-10">
          <Spinner />
        </div>
      {:else}
        <div class="space-y-6">
          <div class="flex items-center justify-between">
            <Label for="enable-subscriptions" class="mb-0">Enable Subscriptions</Label>
            <Switch
              id="enable-subscriptions"
              checked={config.enable}
              onCheckedChange={(e) => {
                config.enable = e;
                config.methods.emails.incidents = e;
                config.methods.emails.maintenances = e;
                handleConfigChange();
              }}
            />
          </div>

          {#if config.enable}
            <div class="space-y-4 border-l-2 pl-4">
              <p class="flex items-center gap-2 text-sm font-semibold">
                <Mail class="h-4 w-4" />
                Email Notifications
              </p>
              <div class="space-y-4 pl-4">
                <div class="flex items-center justify-between">
                  <div class="flex items-center gap-2">
                    <AlertTriangle class="h-4 w-4 text-orange-500" />
                    <Label for="enable-email-incidents" class="mb-0">Incident Updates</Label>
                  </div>
                  <Switch
                    id="enable-email-incidents"
                    checked={config.methods.emails.incidents}
                    onCheckedChange={(e) => {
                      config.methods.emails.incidents = e;
                      handleConfigChange();
                    }}
                  />
                </div>
                <div class="flex items-center justify-between">
                  <div class="flex items-center gap-2">
                    <Wrench class="h-4 w-4 text-blue-500" />
                    <Label for="enable-email-maintenances" class="mb-0">Maintenance Updates</Label>
                  </div>
                  <Switch
                    id="enable-email-maintenances"
                    checked={config.methods.emails.maintenances}
                    onCheckedChange={(e) => {
                      config.methods.emails.maintenances = e;
                      handleConfigChange();
                    }}
                  />
                </div>
              </div>
            </div>
          {/if}

          <!-- RSS feed visibility — independent of the email enable flag.
               Mirrors the same site_data key used in Site Configurations →
               Sub Menu Options, so toggling here updates both places. -->
          <div class="space-y-4 border-l-2 pl-4">
            <p class="flex items-center gap-2 text-sm font-semibold">
              <Rss class="h-4 w-4" />
              RSS Feed
            </p>
            <div class="space-y-4 pl-4">
              <div class="flex items-center justify-between">
                <div class="space-y-0.5">
                  <Label for="enable-rss-feed" class="mb-0">Show RSS feed link</Label>
                  <p class="text-muted-foreground text-xs">
                    Adds an RSS icon to the public page header. The feed routes (<code class="text-xs">/rss.xml</code>)
                    remain reachable either way.
                  </p>
                </div>
                <Switch
                  id="enable-rss-feed"
                  checked={subMenuOptions.showRssFeed}
                  disabled={savingRssToggle}
                  onCheckedChange={toggleRssFeed}
                />
              </div>
            </div>
          </div>
        </div>
      {/if}
    </Card.Content>
  </Card.Root>

  <!-- Subscribers Card -->
  <Card.Root>
    <Card.Header>
      <div class="flex items-center justify-between">
        <div>
          <Card.Title>Subscribers</Card.Title>
          <Card.Description>Manage email subscribers for notifications</Card.Description>
        </div>
        <div class="flex items-center gap-2">
          {#if loadingSubscribers}
            <Spinner class="size-5" />
          {/if}
          <Button onclick={() => (showAddDialog = true)}>
            <PlusIcon class="h-4 w-4" />
            Add Subscriber
          </Button>
        </div>
      </div>
    </Card.Header>
    <Card.Content>
      <div class="ktable rounded-xl border">
        <Table.Root>
          <Table.Header>
            <Table.Row>
              <Table.Head>Email</Table.Head>
              <Table.Head>Monitors</Table.Head>
              <Table.Head>Subscribed At</Table.Head>
              <Table.Head class="w-20 text-center">Actions</Table.Head>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {#if loadingSubscribers && subscribers.length === 0}
              <Table.Row>
                <Table.Cell colspan={4} class="py-8 text-center">
                  <div class="flex items-center justify-center gap-2">
                    <Spinner class="size-4" />
                    <span class="text-muted-foreground text-sm">Loading subscribers...</span>
                  </div>
                </Table.Cell>
              </Table.Row>
            {:else if subscribers.length === 0}
              <Table.Row>
                <Table.Cell colspan={4} class="text-muted-foreground py-8 text-center">
                  No subscribers yet. Add your first subscriber above.
                </Table.Cell>
              </Table.Row>
            {:else}
              {#each subscribers as subscriber (subscriber.method_id)}
                <Table.Row>
                  <Table.Cell class="font-medium">{subscriber.email}</Table.Cell>
                  <Table.Cell>
                    <div class="flex items-center gap-2">
                      <span class="text-muted-foreground text-sm">
                        {subscriber.monitor_count ?? subscriber.monitor_tags?.length ?? 0}
                        {(subscriber.monitor_count ?? subscriber.monitor_tags?.length ?? 0) === 1
                          ? "monitor"
                          : "monitors"}
                      </span>
                      <Button
                        variant="outline"
                        size="sm"
                        class="h-7 px-2 text-xs"
                        onclick={() => openManageMonitors(subscriber)}
                      >
                        <Pencil class="h-3 w-3" />
                        Manage
                      </Button>
                    </div>
                  </Table.Cell>
                  <Table.Cell>
                    <LocalTime value={subscriber.created_at} format="MMM d, yyyy" />
                  </Table.Cell>
                  <Table.Cell class="text-center">
                    <Button
                      variant="ghost"
                      size="icon"
                      class="text-destructive hover:bg-destructive/10 h-8 w-8"
                      onclick={() => confirmDelete(subscriber)}
                    >
                      <Trash2Icon class="h-4 w-4" />
                    </Button>
                  </Table.Cell>
                </Table.Row>
              {/each}
            {/if}
          </Table.Body>
        </Table.Root>
      </div>

      <!-- Pagination -->
      {#if total > 0}
        {@const startItem = (page - 1) * limit + 1}
        {@const endItem = Math.min(page * limit, total)}
        <div class="mt-4 flex items-center justify-between">
          <span class="text-muted-foreground text-sm">Showing {startItem}-{endItem} of {total}</span>
          {#if totalPages > 1}
            <div class="flex items-center gap-2">
              <Button variant="outline" size="icon" disabled={page === 1} onclick={() => goToPage(page - 1)}>
                <ChevronLeftIcon class="size-4" />
              </Button>
              <div class="flex items-center gap-1">
                {#each Array.from({ length: totalPages }, (_, i) => i + 1) as pageNum (pageNum)}
                  {#if pageNum === 1 || pageNum === totalPages || (pageNum >= page - 1 && pageNum <= page + 1)}
                    <Button
                      variant={pageNum === page ? "default" : "ghost"}
                      size="sm"
                      onclick={() => goToPage(pageNum)}
                    >
                      {pageNum}
                    </Button>
                  {:else if pageNum === page - 2 || pageNum === page + 2}
                    <span class="text-muted-foreground px-1">...</span>
                  {/if}
                {/each}
              </div>
              <Button variant="outline" size="icon" disabled={page === totalPages} onclick={() => goToPage(page + 1)}>
                <ChevronRightIcon class="size-4" />
              </Button>
            </div>
          {/if}
        </div>
      {/if}
    </Card.Content>
  </Card.Root>
</div>

<!-- Add Subscriber Dialog -->
<Dialog.Root bind:open={showAddDialog}>
  <Dialog.Content class="sm:max-w-md">
    <Dialog.Header>
      <Dialog.Title>Add Subscriber</Dialog.Title>
      <Dialog.Description>Add a new email subscriber for notifications</Dialog.Description>
    </Dialog.Header>
    <div class="space-y-4 py-4">
      <div class="space-y-2">
        <Label for="new-email">Email Address</Label>
        <Input
          id="new-email"
          type="email"
          placeholder="subscriber@example.com"
          bind:value={newEmail}
          disabled={addingSubscriber}
        />
      </div>
      <div class="space-y-2">
        <Label>Monitors</Label>
        <p class="text-muted-foreground text-xs">
          Choose the monitors this subscriber should be notified about. Leave empty to subscribe to nothing yet.
        </p>
        <MonitorSelector
          monitors={availableMonitors}
          bind:selected={newMonitorTags}
          loading={loadingMonitors}
          listClass="max-h-64"
          disabled={addingSubscriber}
        />
      </div>
      {#if addError}
        <Alert.Root variant="destructive">
          <Alert.Description>{addError}</Alert.Description>
        </Alert.Root>
      {/if}
    </div>
    <Dialog.Footer>
      <Button
        variant="outline"
        onclick={() => {
          showAddDialog = false;
          resetAddForm();
        }}
        disabled={addingSubscriber}
      >
        Cancel
      </Button>
      <Button onclick={addSubscriber} disabled={addingSubscriber}>
        {#if addingSubscriber}
          <Spinner class="size-4" />
          Adding...
        {:else}
          Add Subscriber
        {/if}
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>

<!-- Manage Monitors Dialog -->
<Dialog.Root bind:open={showManageDialog}>
  <Dialog.Content class="flex max-h-[85vh] flex-col overflow-hidden sm:max-w-md">
    <Dialog.Header class="shrink-0">
      <Dialog.Title>Manage Monitor Subscriptions</Dialog.Title>
      <Dialog.Description>
        {#if managingSubscriber}
          Choose the monitors <span class="font-medium">{managingSubscriber.email}</span> should be notified about.
        {/if}
      </Dialog.Description>
    </Dialog.Header>
    <div class="min-h-0 flex-1 overflow-y-auto py-4">
      <MonitorSelector
        monitors={availableMonitors}
        bind:selected={manageMonitorTags}
        loading={loadingMonitors}
        listClass="max-h-64"
        disabled={savingManage}
      />
    </div>
    <Dialog.Footer class="shrink-0">
      <Button
        variant="outline"
        onclick={() => {
          showManageDialog = false;
          managingSubscriber = null;
        }}
        disabled={savingManage}
      >
        Cancel
      </Button>
      <Button onclick={saveManagedMonitors} disabled={savingManage}>
        {#if savingManage}
          <Spinner class="size-4" />
          Saving...
        {:else}
          Save
        {/if}
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>

<!-- Delete Confirmation Dialog -->
<Dialog.Root bind:open={showDeleteDialog}>
  <Dialog.Content class="sm:max-w-md">
    <Dialog.Header>
      <Dialog.Title>Delete Subscriber</Dialog.Title>
      <Dialog.Description>
        Are you sure you want to delete this subscriber? This action cannot be undone.
      </Dialog.Description>
    </Dialog.Header>
    {#if deletingSubscriber}
      <div class="py-4">
        <p class="text-sm">
          <span class="text-muted-foreground">Email:</span>
          <span class="font-medium">{deletingSubscriber.email}</span>
        </p>
      </div>
    {/if}
    <Dialog.Footer>
      <Button
        variant="outline"
        onclick={() => {
          showDeleteDialog = false;
          deletingSubscriber = null;
        }}
        disabled={isDeleting}
      >
        Cancel
      </Button>
      <Button variant="destructive" onclick={deleteSubscriber} disabled={isDeleting}>
        {#if isDeleting}
          <Spinner class="size-4" />
          Deleting...
        {:else}
          Delete
        {/if}
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
