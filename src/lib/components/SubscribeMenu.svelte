<script lang="ts">
  import * as Dialog from "$lib/components/ui/dialog/index.js";
  import * as InputOTP from "$lib/components/ui/input-otp/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import { Checkbox } from "$lib/components/ui/checkbox/index.js";
  import { Label } from "$lib/components/ui/label/index.js";
  import { onMount } from "svelte";
  import { resolve } from "$app/paths";
  import clientResolver from "$lib/client/resolver.js";

  import Mail from "@lucide/svelte/icons/mail";
  import ArrowLeft from "@lucide/svelte/icons/arrow-left";
  import LogOut from "@lucide/svelte/icons/log-out";
  import Loader2 from "@lucide/svelte/icons/loader-2";
  import Bell from "@lucide/svelte/icons/bell";
  import Search from "@lucide/svelte/icons/search";
  import { t } from "$lib/stores/i18n";
  import trackEvent from "$lib/beacon";
  import ICONS from "$lib/icons";
  import Captcha from "./Captcha.svelte";

  interface Props {
    compact?: boolean;
  }

  interface MonitorOption {
    tag: string;
    name: string;
    description: string | null;
    category_name?: string | null;
  }

  let { compact = false }: Props = $props();
  let open = $state(false);

  const STORAGE_KEY = "subscriber_token";

  // UI States
  type View = "loading" | "login" | "otp" | "preferences" | "error";
  let currentView = $state<View>("loading");
  let isSubmitting = $state(false);
  let errorMessage = $state("");

  // Form data
  let email = $state("");
  let otpValue = $state("");
  let captchaRequired = $state(false);
  let captchaToken = $state<string | null>(null);
  let captchaRef: { reset: () => void } | undefined = $state();

  // Preferences data
  let subscriberEmail = $state("");
  let subscribedMonitors = $state<string[]>([]);
  let monitors = $state<MonitorOption[]>([]);
  let monitorSearch = $state("");
  let savingMonitors = $state(false);

  const filteredMonitors = $derived.by(() => {
    const term = monitorSearch.trim().toLowerCase();
    if (!term) return monitors;
    return monitors.filter(
      (monitor) =>
        monitor.name.toLowerCase().includes(term) ||
        monitor.tag.toLowerCase().includes(term) ||
        (monitor.category_name || "").toLowerCase().includes(term)
    );
  });

  // Check token on mount
  onMount(() => {
    checkExistingToken();
  });

  // Also check when dialog opens
  $effect(() => {
    if (open) {
      checkExistingToken();
    }
  });

  async function checkExistingToken() {
    const token = localStorage.getItem(STORAGE_KEY);
    if (!token) {
      currentView = "login";
      return;
    }

    currentView = "loading";
    try {
      const response = await fetch(clientResolver(resolve, "/dashboard-apis/subscription"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "getPreferences", token })
      });

      if (!response.ok) {
        // Token invalid or expired
        localStorage.removeItem(STORAGE_KEY);
        currentView = "login";
        return;
      }

      const data = await response.json();
      subscriberEmail = data.email || "";
      subscribedMonitors = data.subscriptions?.monitors || [];
      monitors = data.monitors || [];
      monitorSearch = "";
      currentView = "preferences";
    } catch (err) {
      localStorage.removeItem(STORAGE_KEY);
      currentView = "login";
    }
  }

  async function handleLogin() {
    if (!email.trim()) {
      errorMessage = $t("Please enter a valid email address");
      return;
    }

    isSubmitting = true;
    errorMessage = "";

    try {
      const response = await fetch(clientResolver(resolve, "/dashboard-apis/subscription"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "login", email: email.trim(), captchaToken })
      });

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
      const response = await fetch(clientResolver(resolve, "/dashboard-apis/subscription"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "verify", email: email.trim(), code: otpValue })
      });

      if (!response.ok) {
        const data = await response.json();
        errorMessage = $t("Verification failed");
        return;
      }

      const data = await response.json();
      localStorage.setItem(STORAGE_KEY, data.token);
      trackEvent("subscribe_otp_verified", { source: "subscribe_menu" });
      await checkExistingToken();
    } catch (err) {
      errorMessage = $t("Network error. Please try again.");
    } finally {
      isSubmitting = false;
    }
  }

  async function handleMonitorToggle(tag: string, checked: boolean) {
    const token = localStorage.getItem(STORAGE_KEY);
    if (!token) {
      currentView = "login";
      return;
    }

    const previous = subscribedMonitors;
    const next = checked ? [...new Set([...subscribedMonitors, tag])] : subscribedMonitors.filter((t) => t !== tag);
    subscribedMonitors = next;
    savingMonitors = true;
    errorMessage = "";

    try {
      const response = await fetch(clientResolver(resolve, "/dashboard-apis/subscription"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "updatePreferences",
          token,
          monitors: next
        })
      });

      if (!response.ok) {
        subscribedMonitors = previous;
        errorMessage = $t("Failed to update preference");
        return;
      }

      const data = await response.json();
      if (Array.isArray(data.monitors)) {
        subscribedMonitors = data.monitors;
      }
      trackEvent("subscribe_pref_toggled", { source: "subscribe_menu", type: "monitor", value: checked });
    } catch (err) {
      subscribedMonitors = previous;
      errorMessage = $t("Network error. Please try again.");
    } finally {
      savingMonitors = false;
    }
  }

  function handleLogout() {
    localStorage.removeItem(STORAGE_KEY);
    email = "";
    otpValue = "";
    subscriberEmail = "";
    subscribedMonitors = [];
    monitors = [];
    monitorSearch = "";
    errorMessage = "";
    currentView = "login";
    trackEvent("subscribe_logout", { source: "subscribe_menu" });
  }

  function handleBackToEmail() {
    currentView = "login";
    otpValue = "";
    errorMessage = "";
  }

  function handleClose() {
    open = false;
    errorMessage = "";
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

{#if compact}
  <Button
    variant="outline"
    size="icon-sm"
    class="bg-background/80 dark:bg-background/70 border-foreground/10 rounded-full border shadow-none backdrop-blur-md"
    aria-label={$t("Subscribe")}
    onclick={() => {
      open = true;
      trackEvent("subscribe_opened", { source: "theme_plus" });
    }}
  >
    <ICONS.Bell />
  </Button>
{:else}
  <Button
    variant="outline"
    size="sm"
    class="rounded-btn bg-background/80 dark:bg-background/70 border-foreground/10 border text-xs backdrop-blur-md"
    aria-label="Subscribe"
    onclick={() => {
      open = true;
      trackEvent("subscribe_opened", { source: "theme_plus" });
    }}
  >
    <ICONS.Bell class="" />
    {$t("Subscribe")}
  </Button>
{/if}

<Dialog.Root bind:open>
  <Dialog.Overlay class="backdrop-blur-[2px]" />
  <Dialog.Content
    class="max-h-[85vh] max-w-sm overflow-y-auto rounded-3xl"
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
          {$t("Get notified about the monitors you choose.")}
        {:else if currentView === "otp"}
          {$t("Enter the verification code sent to your email.")}
        {:else if currentView === "preferences"}
          {$t("Choose the monitors you want to be notified about.")}
        {:else if currentView === "loading"}
          {$t("Loading your preferences...")}
        {/if}
      </Dialog.Description>
    </Dialog.Header>

    <div class="py-4">
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
        <div class="flex flex-col gap-4">
          <div class="rounded-lg border p-3">
            <div class="flex items-center justify-between gap-2">
              <div class="flex min-w-0 gap-2">
                <Mail class="text-muted-foreground mt-0.5 h-4 w-4 shrink-0" />
                <span class="truncate text-sm font-medium">{subscriberEmail}</span>
              </div>
              <Button variant="ghost" size="icon-sm" onclick={handleLogout} class="rounded-btn shrink-0">
                <LogOut class="h-4 w-4" />
              </Button>
            </div>
          </div>

          <div class="flex flex-col gap-2">
            <div class="flex items-center justify-between gap-2">
              <Label class="font-medium">{$t("Monitors")}</Label>
              <span class="text-muted-foreground text-xs">
                {subscribedMonitors.length}
                {$t("selected")}
              </span>
            </div>

            <div class="relative">
              <Search class="text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
              <Input
                type="search"
                placeholder={$t("Search monitors...")}
                class="pl-9"
                bind:value={monitorSearch}
                disabled={savingMonitors}
              />
            </div>

            <div class="max-h-56 overflow-y-auto rounded-lg border">
              {#if monitors.length === 0}
                <p class="text-muted-foreground p-4 text-center text-sm">
                  {$t("No monitors are available to subscribe to.")}
                </p>
              {:else if filteredMonitors.length === 0}
                <p class="text-muted-foreground p-4 text-center text-sm">{$t("No monitors found.")}</p>
              {:else}
                <ul class="divide-y">
                  {#each filteredMonitors as monitor (monitor.tag)}
                    <li>
                      <label class="hover:bg-muted/60 flex cursor-pointer items-start gap-3 px-3 py-2.5">
                        <Checkbox
                          class="mt-0.5"
                          checked={subscribedMonitors.includes(monitor.tag)}
                          disabled={savingMonitors}
                          onCheckedChange={(value) => handleMonitorToggle(monitor.tag, value === true)}
                        />
                        <span class="min-w-0">
                          <span class="block truncate text-sm font-medium">{monitor.name}</span>
                          {#if monitor.description}
                            <span class="text-muted-foreground line-clamp-1 block text-xs">
                              {monitor.description}
                            </span>
                          {:else if monitor.category_name}
                            <span class="text-muted-foreground block text-xs">{monitor.category_name}</span>
                          {/if}
                        </span>
                      </label>
                    </li>
                  {/each}
                </ul>
              {/if}
            </div>

            {#if savingMonitors}
              <p class="text-muted-foreground flex items-center gap-1 text-xs">
                <Loader2 class="h-3 w-3 animate-spin" />
                {$t("Saving...")}
              </p>
            {/if}
          </div>

          {#if errorMessage}
            <p class="text-destructive text-sm">{errorMessage}</p>
          {/if}
        </div>
      {/if}
    </div>
  </Dialog.Content>
</Dialog.Root>
