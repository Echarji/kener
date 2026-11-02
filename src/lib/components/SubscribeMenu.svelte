<script lang="ts">
  import * as Dialog from "$lib/components/ui/dialog/index.js";
  import * as InputOTP from "$lib/components/ui/input-otp/index.js";
  import * as InputGroup from "$lib/components/ui/input-group/index.js";
  import * as ButtonGroup from "$lib/components/ui/button-group/index.js";
  import * as Avatar from "$lib/components/ui/avatar/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import { Switch } from "$lib/components/ui/switch/index.js";
  import { Label } from "$lib/components/ui/label/index.js";
  import { Checkbox } from "$lib/components/ui/checkbox/index.js";
  import { Badge } from "$lib/components/ui/badge/index.js";
  import { Skeleton } from "$lib/components/ui/skeleton/index.js";
  import { onMount, untrack } from "svelte";
  import { resolve } from "$app/paths";
  import { page } from "$app/state";
  import clientResolver from "$lib/client/resolver.js";
  import {
    subscriber,
    ReadSubscriberToken,
    RegisterSubscribeDialog,
    SUBSCRIBER_TOKEN_KEY
  } from "$lib/client/subscriber.svelte";
  import { GetInitials } from "$lib/clientTools.js";

  import Mail from "@lucide/svelte/icons/mail";
  import ArrowLeft from "@lucide/svelte/icons/arrow-left";
  import LogOut from "@lucide/svelte/icons/log-out";
  import Loader2 from "@lucide/svelte/icons/loader-2";
  import Bell from "@lucide/svelte/icons/bell";
  import AlertTriangle from "@lucide/svelte/icons/alert-triangle";
  import Wrench from "@lucide/svelte/icons/wrench";
  import Activity from "@lucide/svelte/icons/activity";
  import Search from "@lucide/svelte/icons/search";
  import X from "@lucide/svelte/icons/x";
  import Plus from "@lucide/svelte/icons/plus";
  import CheckCircle from "@lucide/svelte/icons/circle-check";
  import { t } from "$lib/stores/i18n";
  import trackEvent from "$lib/beacon";
  import ICONS from "$lib/icons";
  import Captcha from "./Captcha.svelte";

  interface Props {
    compact?: boolean;
    // Both buttons, the compact one below the `sm` breakpoint, sharing one dialog.
    responsive?: boolean;
  }

  interface SubscribableMonitor {
    tag: string;
    name: string;
    description: string | null;
    image: string | null;
    monitor_type: string;
  }

  let { compact = false, responsive = false }: Props = $props();
  let open = $state(false);

  // UI States
  type View = "loading" | "login" | "otp" | "preferences" | "monitors" | "error";
  let currentView = $state<View>("loading");
  let isSubmitting = $state(false);
  let errorMessage = $state("");
  let successMessage = $state("");

  // Form data
  let email = $state("");
  let otpValue = $state("");
  let captchaRequired = $state(false);
  let captchaToken = $state<string | null>(null);
  let captchaRef: { reset: () => void } | undefined = $state();

  // Preferences data
  let subscriberEmail = $state("");
  let incidentsEnabled = $state(false);
  let maintenancesEnabled = $state(false);
  let availableSubscriptions = $state<{ incidents: boolean; maintenances: boolean; monitors: boolean }>({
    incidents: false,
    maintenances: false,
    monitors: false
  });

  // Monitor subscriptions
  let allMonitors = $state<SubscribableMonitor[]>([]);
  let monitorsLoadState = $state<"idle" | "loading" | "loaded" | "error">("idle");
  let subscribedTags = $state<string[]>([]);
  // Monitors chosen before the email is verified, subscribed to once it is.
  let pendingTags = $state<string[]>([]);
  let pickerSelection = $state<string[]>([]);
  let pickerQuery = $state("");
  let pickerReturnView = $state<"login" | "preferences">("preferences");
  let savingMonitors = $state(false);
  let removingTag = $state<string | null>(null);
  // A monitor whose subscribe button opened the dialog, selected once the dialog knows who is signed in.
  let requestedTag: string | null = null;

  // Signed-out visitors can pick monitors only when the site offers monitor subscriptions.
  let monitorsOfferedBeforeSignIn = $derived(page.data?.isMonitorSubsEnabled === true);
  let monitorByTag = $derived(new Map(allMonitors.map((m) => [m.tag, m])));
  let filteredMonitors = $derived.by(() => {
    const query = pickerQuery.trim().toLowerCase();
    if (!query) return allMonitors;
    return allMonitors.filter(
      (m) =>
        m.name.toLowerCase().includes(query) ||
        m.tag.toLowerCase().includes(query) ||
        (m.description || "").toLowerCase().includes(query)
    );
  });

  // Check token on mount, and let a monitor's subscribe button open this dialog
  onMount(() => {
    checkExistingToken();
    return RegisterSubscribeDialog(openForMonitor);
  });

  // Also check when dialog opens
  $effect(() => {
    if (open) {
      untrack(() => checkExistingToken());
    }
  });

  // Opens the dialog with `tag`'s monitor selected: in the picker when signed in, else for after sign-in.
  function openForMonitor(tag: string | null) {
    requestedTag = tag;
    errorMessage = "";
    successMessage = "";
    if (open) {
      checkExistingToken();
    } else {
      open = true;
    }
  }

  function monitorName(tag: string): string {
    return monitorByTag.get(tag)?.name ?? tag;
  }

  function setSubscribedTags(tags: string[]) {
    subscribedTags = tags;
    subscriber.monitorTags = tags;
  }

  async function postSubscription(body: Record<string, unknown>): Promise<Response> {
    return fetch(clientResolver(resolve, "/dashboard-apis/subscription"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
  }

  async function checkExistingToken() {
    const token = ReadSubscriberToken();
    if (!token) {
      setSubscribedTags([]);
      currentView = "login";
      applyRequestedTag();
      return;
    }

    currentView = "loading";
    try {
      const response = await postSubscription({ action: "getPreferences", token });

      if (!response.ok) {
        // Token invalid or expired
        localStorage.removeItem(SUBSCRIBER_TOKEN_KEY);
        setSubscribedTags([]);
        currentView = "login";
        applyRequestedTag();
        return;
      }

      const data = await response.json();
      subscriberEmail = data.email || "";
      incidentsEnabled = data.subscriptions?.incidents || false;
      maintenancesEnabled = data.subscriptions?.maintenances || false;
      availableSubscriptions = {
        incidents: data.availableSubscriptions?.incidents === true,
        maintenances: data.availableSubscriptions?.maintenances === true,
        monitors: data.availableSubscriptions?.monitors === true
      };
      setSubscribedTags(Array.isArray(data.monitors) ? data.monitors : []);
      currentView = "preferences";
      if (availableSubscriptions.monitors && subscribedTags.length > 0) {
        loadMonitors();
      }
      applyRequestedTag();
    } catch (err) {
      localStorage.removeItem(SUBSCRIBER_TOKEN_KEY);
      setSubscribedTags([]);
      currentView = "login";
      applyRequestedTag();
    }
  }

  function applyRequestedTag() {
    const tag = requestedTag;
    requestedTag = null;
    if (!tag) return;

    if (currentView === "preferences" && availableSubscriptions.monitors) {
      openPicker("preferences", [...new Set([...subscribedTags, tag])]);
    } else if (currentView === "login" && monitorsOfferedBeforeSignIn) {
      if (!pendingTags.includes(tag)) pendingTags = [...pendingTags, tag];
      loadMonitors();
    }
  }

  async function loadMonitors(force = false) {
    if (monitorsLoadState === "loading" || (monitorsLoadState === "loaded" && !force)) return;
    monitorsLoadState = "loading";
    try {
      const response = await postSubscription({ action: "getMonitors" });
      if (!response.ok) throw new Error("Failed to load monitors");
      const data = await response.json();
      allMonitors = Array.isArray(data.monitors) ? data.monitors : [];
      monitorsLoadState = "loaded";
    } catch (err) {
      monitorsLoadState = "error";
    }
  }

  function openPicker(returnView: "login" | "preferences", selection: string[]) {
    pickerReturnView = returnView;
    pickerSelection = [...selection];
    pickerQuery = "";
    errorMessage = "";
    successMessage = "";
    currentView = "monitors";
    loadMonitors();
  }

  function setPicked(tag: string, picked: boolean) {
    const without = pickerSelection.filter((t) => t !== tag);
    pickerSelection = picked ? [...without, tag] : without;
  }

  function cancelPicker() {
    errorMessage = "";
    currentView = pickerReturnView;
  }

  async function confirmPicker() {
    if (pickerReturnView === "login") {
      pendingTags = [...pickerSelection];
      currentView = "login";
      return;
    }

    const saved = await saveMonitorSubscriptions(pickerSelection);
    if (saved) {
      successMessage = subscribedMessage();
      currentView = "preferences";
    }
  }

  function subscribedMessage(): string {
    if (subscribedTags.length === 0) return $t("You are no longer subscribed to any monitor.");
    if (subscribedTags.length === 1) return $t("Subscribed to %name.", { name: monitorName(subscribedTags[0]) });
    return $t("Subscribed to %count monitors.", { count: String(subscribedTags.length) });
  }

  // Replaces the monitors the subscriber follows. Returns whether the server saved them.
  async function saveMonitorSubscriptions(tags: string[]): Promise<boolean> {
    const token = ReadSubscriberToken();
    if (!token) {
      currentView = "login";
      return false;
    }

    savingMonitors = true;
    errorMessage = "";
    try {
      const response = await postSubscription({ action: "updatePreferences", token, monitors: tags });
      if (!response.ok) {
        errorMessage = $t("Failed to update monitor subscriptions");
        return false;
      }
      const data = await response.json();
      setSubscribedTags(Array.isArray(data.monitors) ? data.monitors : tags);
      trackEvent("subscribe_monitors_saved", { source: "subscribe_menu", count: subscribedTags.length });
      return true;
    } catch (err) {
      errorMessage = $t("Network error. Please try again.");
      return false;
    } finally {
      savingMonitors = false;
    }
  }

  async function unsubscribeFromMonitor(tag: string) {
    removingTag = tag;
    successMessage = "";
    const saved = await saveMonitorSubscriptions(subscribedTags.filter((t) => t !== tag));
    if (saved) {
      successMessage = $t("Unsubscribed from %name.", { name: monitorName(tag) });
    }
    removingTag = null;
  }

  async function handleLogin() {
    if (!email.trim()) {
      errorMessage = $t("Please enter a valid email address");
      return;
    }

    isSubmitting = true;
    errorMessage = "";

    try {
      const response = await postSubscription({ action: "login", email: email.trim(), captchaToken });

      if (!response.ok) {
        const data = await response.json();
        errorMessage = data?.message || $t("Failed to send verification code");
        captchaToken = null;
        captchaRef?.reset();
        return;
      }

      trackEvent("subscribe_login_sent", { source: "subscribe_menu" });

      // The token is single-use and has now been consumed by the provider
      // regardless of which UI path sent it -- clear it so nothing can
      // accidentally resubmit it later.
      captchaToken = null;
      currentView = "otp";
      otpValue = "";
    } catch (err) {
      errorMessage = $t("Network error. Please try again.");
    } finally {
      isSubmitting = false;
    }
  }

  function handleResend() {
    if (captchaRequired) {
      // The OTP view has no captcha widget to produce a fresh token, and
      // the one from the original submission is already consumed -- send
      // the user back to solve a new challenge instead of silently
      // replaying a token the provider will reject.
      handleBackToEmail();
      return;
    }
    handleLogin();
  }

  async function handleVerifyOTP() {
    if (otpValue.length !== 6) {
      errorMessage = $t("Please enter the 6-digit verification code");
      return;
    }

    isSubmitting = true;
    errorMessage = "";

    try {
      const response = await postSubscription({ action: "verify", email: email.trim(), code: otpValue });

      if (!response.ok) {
        errorMessage = $t("Verification failed");
        return;
      }

      const data = await response.json();
      localStorage.setItem(SUBSCRIBER_TOKEN_KEY, data.token);
      trackEvent("subscribe_otp_verified", { source: "subscribe_menu" });
      const chosen = pendingTags;
      await checkExistingToken();

      // Subscribe to the monitors picked before verifying, keeping the ones already followed.
      if (chosen.length > 0 && currentView === "preferences" && availableSubscriptions.monitors) {
        const saved = await saveMonitorSubscriptions([...new Set([...subscribedTags, ...chosen])]);
        if (saved) {
          pendingTags = [];
          successMessage = subscribedMessage();
        }
      }
    } catch (err) {
      errorMessage = $t("Network error. Please try again.");
    } finally {
      isSubmitting = false;
    }
  }

  async function handlePreferenceChange(type: "incidents" | "maintenances", value: boolean) {
    const token = ReadSubscriberToken();
    if (!token) {
      currentView = "login";
      return;
    }

    try {
      const response = await postSubscription({ action: "updatePreferences", token, [type]: value });

      if (!response.ok) {
        errorMessage = $t("Failed to update preference");
        // Revert the toggle
        if (type === "incidents") {
          incidentsEnabled = !value;
        } else {
          maintenancesEnabled = !value;
        }
        return;
      }

      // Update local state
      if (type === "incidents") {
        incidentsEnabled = value;
      } else {
        maintenancesEnabled = value;
      }

      trackEvent("subscribe_pref_toggled", { source: "subscribe_menu", type, value });
    } catch (err) {
      errorMessage = $t("Network error. Please try again.");
      // Revert the toggle
      if (type === "incidents") {
        incidentsEnabled = !value;
      } else {
        maintenancesEnabled = !value;
      }
    }
  }

  function handleLogout() {
    localStorage.removeItem(SUBSCRIBER_TOKEN_KEY);
    email = "";
    otpValue = "";
    subscriberEmail = "";
    incidentsEnabled = false;
    maintenancesEnabled = false;
    setSubscribedTags([]);
    pendingTags = [];
    errorMessage = "";
    successMessage = "";
    currentView = "login";
    trackEvent("subscribe_logout", { source: "subscribe_menu" });
  }

  function handleBackToEmail() {
    currentView = "login";
    otpValue = "";
    errorMessage = "";
  }

  function openDialog() {
    errorMessage = "";
    successMessage = "";
    open = true;
    trackEvent("subscribe_opened", { source: "theme_plus" });
  }

  // Google reCAPTCHA's expanded image-challenge renders as a second iframe
  // appended outside this Dialog's own DOM subtree (unlike the basic
  // checkbox, which nests inside it). Bits UI's outside-interaction
  // detection sees clicks/focus landing on that iframe as "outside" and
  // dismisses the dialog, orphaning the still-open challenge. Any outside
  // interaction targeting an iframe is treated as captcha-challenge traffic
  // and kept open — nothing else in this dialog renders a bare iframe.
  function ignoreCaptchaIframeInteraction(event: PointerEvent | FocusEvent) {
    if (event.target instanceof HTMLIFrameElement) {
      event.preventDefault();
    }
  }
</script>

{#snippet compactTrigger()}
  <Button
    variant="outline"
    size="icon-sm"
    class="bg-background/80 dark:bg-background/70 border-foreground/10 rounded-full border shadow-none backdrop-blur-md"
    aria-label={$t("Subscribe")}
    onclick={openDialog}
  >
    <ICONS.Bell />
  </Button>
{/snippet}

{#snippet fullTrigger()}
  <Button
    variant="outline"
    size="sm"
    class="rounded-btn bg-background/80 dark:bg-background/70 border-foreground/10 border text-xs backdrop-blur-md"
    aria-label="Subscribe"
    onclick={openDialog}
  >
    <ICONS.Bell class="" />
    {$t("Subscribe")}
  </Button>
{/snippet}

{#snippet monitorAvatar(monitor: SubscribableMonitor | undefined, tag: string)}
  <Avatar.Root class="size-7 shrink-0">
    {#if monitor?.image}
      <Avatar.Image src={clientResolver(resolve, monitor.image)} alt="" />
    {/if}
    <Avatar.Fallback class="text-[10px]">{GetInitials(monitor?.name ?? tag)}</Avatar.Fallback>
  </Avatar.Root>
{/snippet}

{#if responsive}
  <ButtonGroup.Root class="hidden shrink-0 sm:flex">
    {@render fullTrigger()}
  </ButtonGroup.Root>
  <ButtonGroup.Root class="rounded-btn-grp shrink-0 sm:hidden">
    {@render compactTrigger()}
  </ButtonGroup.Root>
{:else if compact}
  {@render compactTrigger()}
{:else}
  {@render fullTrigger()}
{/if}

<Dialog.Root bind:open>
  <Dialog.Overlay class="backdrop-blur-[2px]" />
  <Dialog.Content
    class="max-w-[calc(100%-2rem)] rounded-3xl sm:max-w-md"
    onInteractOutside={ignoreCaptchaIframeInteraction}
    onFocusOutside={ignoreCaptchaIframeInteraction}
  >
    <Dialog.Header>
      <Dialog.Title class="flex items-center gap-2">
        <Bell class="h-5 w-5" />
        {$t("Subscribe to Updates")}
      </Dialog.Title>
      <Dialog.Description>
        {#if currentView === "login"}
          {$t("Get notified about incidents and scheduled maintenance.")}
        {:else if currentView === "otp"}
          {$t("Enter the verification code sent to your email.")}
        {:else if currentView === "preferences"}
          {$t("Manage your notification preferences.")}
        {:else if currentView === "monitors"}
          {$t("Choose the monitors you want updates for.")}
        {:else if currentView === "loading"}
          {$t("Loading your preferences...")}
        {/if}
      </Dialog.Description>
    </Dialog.Header>

    <div class="min-w-0 py-4">
      {#if currentView === "loading"}
        <div class="flex items-center justify-center py-8">
          <Loader2 class="text-muted-foreground h-8 w-8 animate-spin" />
        </div>
      {:else if currentView === "login"}
        <!-- Login View -->
        <div class="flex flex-col gap-4">
          <div class="flex flex-col gap-2">
            <Label for="email">{$t("Email address")}</Label>
            <div class="relative">
              <Mail class="text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
              <Input
                id="email"
                type="email"
                placeholder="you@example.com"
                class="pl-10"
                bind:value={email}
                disabled={isSubmitting}
                onkeydown={(e) => e.key === "Enter" && handleLogin()}
              />
            </div>
          </div>

          {#if monitorsOfferedBeforeSignIn}
            <div class="flex flex-col gap-2">
              <div class="flex items-center justify-between gap-2">
                <span class="text-sm font-medium">
                  {$t("Monitors")} <span class="text-muted-foreground font-normal">({$t("optional")})</span>
                </span>
                <Button
                  variant="link"
                  size="sm"
                  class="h-auto p-0 text-xs"
                  disabled={isSubmitting}
                  onclick={() => openPicker("login", pendingTags)}
                >
                  {pendingTags.length > 0 ? $t("Edit") : $t("Choose monitors")}
                </Button>
              </div>
              {#if pendingTags.length > 0}
                <ul class="flex flex-wrap gap-1.5" aria-label={$t("Monitors to subscribe to")}>
                  {#each pendingTags as tag (tag)}
                    <li>
                      <Badge variant="secondary" class="max-w-56 gap-1 pr-1">
                        <span class="truncate">{monitorName(tag)}</span>
                        <button
                          type="button"
                          class="hover:bg-foreground/10 rounded-full p-0.5"
                          aria-label={$t("Remove %name", { name: monitorName(tag) })}
                          onclick={() => (pendingTags = pendingTags.filter((t) => t !== tag))}
                        >
                          <X class="size-3" />
                        </button>
                      </Badge>
                    </li>
                  {/each}
                </ul>
              {:else}
                <p class="text-muted-foreground text-xs">
                  {$t("Get emails when the monitors you pick change status. You can also choose later.")}
                </p>
              {/if}
            </div>
          {/if}

          <Captcha
            bind:this={captchaRef}
            onReady={(required) => (captchaRequired = required)}
            onVerify={(token) => (captchaToken = token)}
          />

          {#if errorMessage}
            <p class="text-destructive text-sm">{errorMessage}</p>
          {/if}

          <Button onclick={handleLogin} disabled={isSubmitting || (captchaRequired && !captchaToken)} class="w-full">
            {#if isSubmitting}
              <Loader2 class="mr-2 h-4 w-4 animate-spin" />
              {$t("Sending...")}
            {:else}
              {$t("Continue")}
            {/if}
          </Button>
        </div>
      {:else if currentView === "otp"}
        <!-- OTP View -->
        <div class="flex flex-col gap-4">
          <div class="flex flex-col items-center gap-4">
            <p class="text-muted-foreground text-center text-sm">
              {$t("We sent a 6-digit code to")} <strong class="text-foreground">{email}</strong>
            </p>

            <InputOTP.Root maxlength={6} bind:value={otpValue}>
              {#snippet children({ cells })}
                <InputOTP.Group>
                  {#each cells as cell, i (i)}
                    <InputOTP.Slot {cell} />
                  {/each}
                </InputOTP.Group>
              {/snippet}
            </InputOTP.Root>
          </div>

          {#if errorMessage}
            <p class="text-destructive text-center text-sm">{errorMessage}</p>
          {/if}

          <div class="flex gap-2">
            <Button variant="outline" onclick={handleBackToEmail} disabled={isSubmitting} class="flex-1">
              <ArrowLeft class="mr-2 h-4 w-4" />
              {$t("Back")}
            </Button>
            <Button onclick={handleVerifyOTP} disabled={isSubmitting || otpValue.length !== 6} class="flex-1">
              {#if isSubmitting}
                <Loader2 class="mr-2 h-4 w-4 animate-spin" />
                {$t("Verifying")}...
              {:else}
                {$t("Verify")}
              {/if}
            </Button>
          </div>

          <Button variant="link" onclick={handleResend} disabled={isSubmitting} class="text-xs">
            {$t("Didn't receive the code? Resend")}
          </Button>
        </div>
      {:else if currentView === "preferences"}
        <!-- Preferences View -->
        <div class="flex flex-col gap-6">
          <div class="rounded-lg border p-4">
            <div class="flex items-center justify-between gap-2">
              <div class="flex min-w-0 gap-2">
                <Mail class="text-muted-foreground h-4 w-4 shrink-0" />
                <span class="truncate text-sm font-medium">{subscriberEmail}</span>
              </div>
              <Button
                variant="ghost"
                size="icon-sm"
                onclick={handleLogout}
                class="rounded-btn"
                aria-label={$t("Sign out")}
              >
                <LogOut class="h-4 w-4" />
              </Button>
            </div>
          </div>

          {#if successMessage}
            <p class="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400" role="status">
              <CheckCircle class="size-4 shrink-0" />
              {successMessage}
            </p>
          {/if}

          <div class="flex flex-col gap-4">
            {#if availableSubscriptions.incidents}
              <div class="flex items-center justify-between">
                <div class="flex items-center gap-3">
                  <AlertTriangle class="h-5 w-5 text-orange-500" />
                  <div>
                    <Label class="font-medium">{$t("Incident Updates")}</Label>
                    <p class="text-muted-foreground text-xs">{$t("Get notified about incidents updates")}</p>
                  </div>
                </div>
                <Switch
                  checked={incidentsEnabled}
                  onCheckedChange={(value) => handlePreferenceChange("incidents", value)}
                />
              </div>
            {/if}

            {#if availableSubscriptions.maintenances}
              <div class="flex items-center justify-between">
                <div class="flex items-center gap-3">
                  <Wrench class="h-5 w-5 text-blue-500" />
                  <div>
                    <Label class="font-medium">{$t("Maintenance Updates")}</Label>
                    <p class="text-muted-foreground text-xs">{$t("Get notified about scheduled maintenance")}</p>
                  </div>
                </div>
                <Switch
                  checked={maintenancesEnabled}
                  onCheckedChange={(value) => handlePreferenceChange("maintenances", value)}
                />
              </div>
            {/if}

            {#if availableSubscriptions.monitors}
              <div class="flex flex-col gap-3">
                <div class="flex items-center gap-3">
                  <Activity class="h-5 w-5 shrink-0 text-emerald-500" />
                  <div>
                    <p class="text-sm font-medium">{$t("Monitor Updates")}</p>
                    <p class="text-muted-foreground text-xs">
                      {$t("Status changes, incidents and maintenance for the monitors you choose")}
                    </p>
                  </div>
                </div>
                {#if subscribedTags.length === 0}
                  <p class="text-muted-foreground rounded-lg border border-dashed p-3 text-center text-xs">
                    {$t("You are not subscribed to any monitor yet.")}
                  </p>
                {:else}
                  <ul
                    class="max-h-48 divide-y overflow-y-auto rounded-lg border"
                    aria-label={$t("Subscribed monitors (%count)", { count: String(subscribedTags.length) })}
                  >
                    {#each subscribedTags as tag (tag)}
                      <li class="flex items-center gap-2 py-1.5 pr-1.5 pl-3">
                        {@render monitorAvatar(monitorByTag.get(tag), tag)}
                        <span class="min-w-0 flex-1 truncate text-sm">{monitorName(tag)}</span>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          class="rounded-full"
                          aria-label={$t("Unsubscribe from %name", { name: monitorName(tag) })}
                          title={$t("Unsubscribe")}
                          disabled={removingTag !== null || savingMonitors}
                          onclick={() => unsubscribeFromMonitor(tag)}
                        >
                          {#if removingTag === tag}
                            <Loader2 class="size-4 animate-spin" />
                          {:else}
                            <X class="size-4" />
                          {/if}
                        </Button>
                      </li>
                    {/each}
                  </ul>
                {/if}
                <Button
                  variant="outline"
                  size="sm"
                  disabled={savingMonitors}
                  onclick={() => openPicker("preferences", subscribedTags)}
                >
                  <Plus class="size-4" />
                  {subscribedTags.length > 0 ? $t("Manage monitors") : $t("Choose monitors")}
                </Button>
              </div>
            {/if}
          </div>

          {#if errorMessage}
            <p class="text-destructive text-sm">{errorMessage}</p>
          {/if}
        </div>
      {:else if currentView === "monitors"}
        <!-- Monitor Picker View -->
        <div class="flex min-w-0 flex-col gap-3">
          <InputGroup.Root>
            <InputGroup.Addon>
              <Search />
            </InputGroup.Addon>
            <InputGroup.Input
              type="search"
              placeholder={$t("Search monitors")}
              aria-label={$t("Search monitors")}
              bind:value={pickerQuery}
            />
          </InputGroup.Root>

          <div class="text-muted-foreground flex items-center justify-between text-xs">
            <span aria-live="polite">{$t("%count selected", { count: String(pickerSelection.length) })}</span>
            {#if pickerSelection.length > 0}
              <button
                type="button"
                class="hover:text-foreground hover:underline"
                onclick={() => (pickerSelection = [])}
              >
                {$t("Clear")}
              </button>
            {/if}
          </div>

          {#if monitorsLoadState === "error"}
            <div class="flex flex-col items-center gap-2 rounded-lg border border-dashed p-4 text-center">
              <p class="text-destructive text-sm">{$t("Failed to load monitors")}</p>
              <Button variant="outline" size="sm" onclick={() => loadMonitors(true)}>{$t("Retry")}</Button>
            </div>
          {:else if monitorsLoadState !== "loaded"}
            <div class="flex flex-col gap-2 rounded-lg border p-3" aria-busy="true">
              {#each Array(4) as _, i (i)}
                <div class="flex items-center gap-3">
                  <Skeleton class="size-4 rounded" />
                  <Skeleton class="size-7 rounded-full" />
                  <Skeleton class="h-4 flex-1" />
                </div>
              {/each}
            </div>
          {:else if filteredMonitors.length === 0}
            <p class="text-muted-foreground rounded-lg border border-dashed p-4 text-center text-sm">
              {allMonitors.length === 0 ? $t("No monitors available.") : $t("No monitors match your search.")}
            </p>
          {:else}
            <ul class="max-h-[min(18rem,45vh)] divide-y overflow-y-auto rounded-lg border">
              {#each filteredMonitors as monitor (monitor.tag)}
                <li>
                  <label class="hover:bg-accent/50 flex min-w-0 cursor-pointer items-center gap-3 px-3 py-2">
                    <Checkbox
                      checked={pickerSelection.includes(monitor.tag)}
                      onCheckedChange={(value) => setPicked(monitor.tag, value === true)}
                      aria-label={monitor.name}
                    />
                    {@render monitorAvatar(monitor, monitor.tag)}
                    <span class="flex min-w-0 flex-1 flex-col">
                      <span class="truncate text-sm font-medium">{monitor.name}</span>
                      {#if monitor.description}
                        <span class="text-muted-foreground truncate text-xs">{monitor.description}</span>
                      {/if}
                    </span>
                    {#if monitor.monitor_type === "GROUP"}
                      <Badge variant="outline" class="shrink-0">{$t("Group")}</Badge>
                    {/if}
                    {#if subscribedTags.includes(monitor.tag)}
                      <Badge variant="secondary" class="shrink-0">{$t("Subscribed")}</Badge>
                    {/if}
                  </label>
                </li>
              {/each}
            </ul>
          {/if}

          {#if errorMessage}
            <p class="text-destructive text-sm">{errorMessage}</p>
          {/if}

          <div class="flex gap-2">
            <Button variant="outline" class="flex-1" onclick={cancelPicker} disabled={savingMonitors}>
              {$t("Cancel")}
            </Button>
            <Button class="flex-1" onclick={confirmPicker} disabled={savingMonitors || monitorsLoadState !== "loaded"}>
              {#if savingMonitors}
                <Loader2 class="mr-2 h-4 w-4 animate-spin" />
                {$t("Saving...")}
              {:else if pickerReturnView === "login"}
                {$t("Done")}
              {:else}
                {$t("Save")}
              {/if}
            </Button>
          </div>
        </div>
      {/if}
    </div>
  </Dialog.Content>
</Dialog.Root>
