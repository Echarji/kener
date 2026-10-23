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
  import Mail from "@lucide/svelte/icons/mail";
  import Rss from "@lucide/svelte/icons/rss";
  import Search from "@lucide/svelte/icons/search";
  import PencilIcon from "@lucide/svelte/icons/pencil";
  import { Checkbox } from "$lib/components/ui/checkbox/index.js";

  import type { SubscriptionsConfig } from "$lib/server/types/db.js";
  import AlertCircleIcon from "@lucide/svelte/icons/octagon-alert";

  // Config state
  let config = $state<SubscriptionsConfig>({
    enable: false,
    methods: {
      emails: {
        enabled: true
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
    monitors: string[];
    monitor_names: string[];
    subscription_count: number;
    created_at: string;
  }

  interface MonitorOption {
    tag: string;
    name: string;
    description?: string | null;
  }

  let subscribers = $state<Subscriber[]>([]);
  let loadingSubscribers = $state(true);
  let page = $state(1);
  let limit = $state(10);
  let total = $state(0);
  let totalPages = $state(0);

  let availableMonitors = $state<MonitorOption[]>([]);

  // Add subscriber dialog
  let showAddDialog = $state(false);
  let addingSubscriber = $state(false);
  let newEmail = $state("");
  let newMonitors = $state<string[]>([]);
  let newMonitorSearch = $state("");
  let addError = $state("");

  // Edit monitors dialog
  let showMonitorsDialog = $state(false);
  let editingSubscriber = $state<Subscriber | null>(null);
  let editingMonitors = $state<string[]>([]);
  let editingMonitorSearch = $state("");
  let savingMonitors = $state(false);

  // Delete confirmation
  let showDeleteDialog = $state(false);
  let deletingSubscriber = $state<Subscriber | null>(null);
  let isDeleting = $state(false);

  function filterMonitors(search: string): MonitorOption[] {
    const term = search.trim().toLowerCase();
    if (!term) return availableMonitors;
    return availableMonitors.filter(
      (monitor) =>
        monitor.name.toLowerCase().includes(term) ||
        monitor.tag.toLowerCase().includes(term) ||
        (monitor.description || "").toLowerCase().includes(term)
    );
  }

  function toggleMonitor(list: string[], tag: string, checked: boolean): string[] {
    if (checked) {
      return [...new Set([...list, tag])];
    }
    return list.filter((item) => item !== tag);
  }

  // Fetch config
  async function fetchConfig() {
    loadingConfig = true;
    try {
      const res = await fetch(clientResolver(resolve, "/manage/api"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "getSubscriptionsConfig" })
      });
      const loaded = await res.json();
      if (loaded && !loaded.error) {
        const emails = loaded.methods?.emails || {};
        config = {
          enable: loaded.enable ?? false,
          methods: {
            emails: {
              // Older configurations used per-event flags instead of `enabled`.
              enabled: emails.enabled ?? (emails.incidents === true || emails.maintenances === true)
            }
          }
        };
      }
    } catch (error) {
      toast.error("Failed to load configuration");
    } finally {
      loadingConfig = false;
    }
  }

  async function fetchMonitors() {
    try {
      const res = await fetch(clientResolver(resolve, "/manage/api"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "getMonitors",
          data: { status: "ACTIVE", is_hidden: "NO" }
        })
      });
      const result = await res.json();
      if (!result.error && Array.isArray(result)) {
        availableMonitors = result.map((monitor: MonitorOption) => ({
          tag: monitor.tag,
          name: monitor.name,
          description: monitor.description
        }));
      }
    } catch {
      // The picker simply shows no monitors; adding an email still works.
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

  function openMonitorsDialog(subscriber: Subscriber) {
    editingSubscriber = subscriber;
    editingMonitors = [...subscriber.monitors];
    editingMonitorSearch = "";
    showMonitorsDialog = true;
  }

  async function saveMonitors() {
    if (!editingSubscriber) return;

    savingMonitors = true;
    try {
      const res = await fetch(clientResolver(resolve, "/manage/api"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "adminSetSubscriberMonitors",
          data: {
            methodId: editingSubscriber.method_id,
            monitors: editingMonitors
          }
        })
      });
      const result = await res.json();
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Subscriptions updated");
      showMonitorsDialog = false;
      editingSubscriber = null;
      await fetchSubscribers();
    } catch {
      toast.error("Failed to update subscriptions");
    } finally {
      savingMonitors = false;
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
            monitors: newMonitors
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
    newMonitors = [];
    newMonitorSearch = "";
    addError = "";
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
    fetchMonitors();
    fetchSubscribers();
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
            <div class="space-y-0.5">
              <Label for="enable-subscriptions" class="mb-0">Enable Subscriptions</Label>
              <p class="text-muted-foreground text-xs">Visitors choose the monitors they want email updates about.</p>
            </div>
            <Switch
              id="enable-subscriptions"
              checked={config.enable}
              onCheckedChange={(e) => {
                config.enable = e;
                config.methods.emails.enabled = e;
                handleConfigChange();
              }}
            />
          </div>

          {#if config.enable}
            <div class="space-y-2 border-l-2 pl-4">
              <p class="flex items-center gap-2 text-sm font-semibold">
                <Mail class="h-4 w-4" />
                Email Notifications
              </p>
              <p class="text-muted-foreground text-sm">
                Subscribers are emailed only for status changes, incidents, and maintenances affecting the monitors they
                follow.
              </p>
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
          <Card.Description>Manage email subscribers and the monitors they follow</Card.Description>
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
              <Table.Head class="w-24 text-center">Actions</Table.Head>
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
                    {#if subscriber.monitor_names.length === 0}
                      <span class="text-muted-foreground text-sm">None</span>
                    {:else}
                      <div class="flex flex-wrap gap-1">
                        {#each subscriber.monitor_names as monitorName (monitorName)}
                          <span class="bg-muted rounded-full px-2 py-0.5 text-xs">{monitorName}</span>
                        {/each}
                      </div>
                    {/if}
                  </Table.Cell>
                  <Table.Cell>
                    <LocalTime value={subscriber.created_at} format="MMM d, yyyy" />
                  </Table.Cell>
                  <Table.Cell class="text-center">
                    <div class="flex items-center justify-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        class="h-8 w-8"
                        title="Edit monitors"
                        onclick={() => openMonitorsDialog(subscriber)}
                      >
                        <PencilIcon class="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        class="text-destructive hover:bg-destructive/10 h-8 w-8"
                        title="Delete subscriber"
                        onclick={() => confirmDelete(subscriber)}
                      >
                        <Trash2Icon class="h-4 w-4" />
                      </Button>
                    </div>
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
        <div class="flex items-center justify-between">
          <Label>Monitors</Label>
          <span class="text-muted-foreground text-xs">{newMonitors.length} selected</span>
        </div>
        <div class="relative">
          <Search class="text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
          <Input
            type="search"
            placeholder="Search monitors..."
            class="pl-9"
            bind:value={newMonitorSearch}
            disabled={addingSubscriber}
          />
        </div>
        <div class="max-h-48 overflow-y-auto rounded-lg border">
          {#if availableMonitors.length === 0}
            <p class="text-muted-foreground p-4 text-center text-sm">No monitors available.</p>
          {:else if filterMonitors(newMonitorSearch).length === 0}
            <p class="text-muted-foreground p-4 text-center text-sm">No monitors found.</p>
          {:else}
            <ul class="divide-y">
              {#each filterMonitors(newMonitorSearch) as monitor (monitor.tag)}
                <li>
                  <label class="hover:bg-muted/60 flex cursor-pointer items-start gap-3 px-3 py-2">
                    <Checkbox
                      class="mt-0.5"
                      checked={newMonitors.includes(monitor.tag)}
                      disabled={addingSubscriber}
                      onCheckedChange={(value) => {
                        newMonitors = toggleMonitor(newMonitors, monitor.tag, value === true);
                      }}
                    />
                    <span class="min-w-0">
                      <span class="block truncate text-sm font-medium">{monitor.name}</span>
                      {#if monitor.description}
                        <span class="text-muted-foreground line-clamp-1 block text-xs">{monitor.description}</span>
                      {/if}
                    </span>
                  </label>
                </li>
              {/each}
            </ul>
          {/if}
        </div>
        <p class="text-muted-foreground text-xs">
          The subscriber is emailed only for these monitors. They can change the selection later.
        </p>
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

<!-- Edit Monitors Dialog -->
<Dialog.Root bind:open={showMonitorsDialog}>
  <Dialog.Content class="sm:max-w-md">
    <Dialog.Header>
      <Dialog.Title>Edit Monitors</Dialog.Title>
      <Dialog.Description>
        Choose the monitors {editingSubscriber?.email ?? "this subscriber"} receives email updates about.
      </Dialog.Description>
    </Dialog.Header>
    <div class="space-y-2 py-4">
      <div class="flex items-center justify-between">
        <Label>Monitors</Label>
        <span class="text-muted-foreground text-xs">{editingMonitors.length} selected</span>
      </div>
      <div class="relative">
        <Search class="text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
        <Input
          type="search"
          placeholder="Search monitors..."
          class="pl-9"
          bind:value={editingMonitorSearch}
          disabled={savingMonitors}
        />
      </div>
      <div class="max-h-56 overflow-y-auto rounded-lg border">
        {#if availableMonitors.length === 0}
          <p class="text-muted-foreground p-4 text-center text-sm">No monitors available.</p>
        {:else if filterMonitors(editingMonitorSearch).length === 0}
          <p class="text-muted-foreground p-4 text-center text-sm">No monitors found.</p>
        {:else}
          <ul class="divide-y">
            {#each filterMonitors(editingMonitorSearch) as monitor (monitor.tag)}
              <li>
                <label class="hover:bg-muted/60 flex cursor-pointer items-start gap-3 px-3 py-2">
                  <Checkbox
                    class="mt-0.5"
                    checked={editingMonitors.includes(monitor.tag)}
                    disabled={savingMonitors}
                    onCheckedChange={(value) => {
                      editingMonitors = toggleMonitor(editingMonitors, monitor.tag, value === true);
                    }}
                  />
                  <span class="min-w-0">
                    <span class="block truncate text-sm font-medium">{monitor.name}</span>
                    {#if monitor.description}
                      <span class="text-muted-foreground line-clamp-1 block text-xs">{monitor.description}</span>
                    {/if}
                  </span>
                </label>
              </li>
            {/each}
          </ul>
        {/if}
      </div>
    </div>
    <Dialog.Footer>
      <Button
        variant="outline"
        onclick={() => {
          showMonitorsDialog = false;
          editingSubscriber = null;
        }}
        disabled={savingMonitors}
      >
        Cancel
      </Button>
      <Button onclick={saveMonitors} disabled={savingMonitors}>
        {#if savingMonitors}
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
