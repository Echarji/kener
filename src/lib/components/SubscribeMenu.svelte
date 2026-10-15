<script lang="ts">
  import * as Dialog from "$lib/components/ui/dialog/index.js";
  import * as InputOTP from "$lib/components/ui/input-otp/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import { Label } from "$lib/components/ui/label/index.js";
  import { onMount } from "svelte";
  import { resolve } from "$app/paths";
  import clientResolver from "$lib/client/resolver.js";

  import Mail from "@lucide/svelte/icons/mail";
  import ArrowLeft from "@lucide/svelte/icons/arrow-left";
  import LogOut from "@lucide/svelte/icons/log-out";
  import Loader2 from "@lucide/svelte/icons/loader-2";
  import Bell from "@lucide/svelte/icons/bell";
  import CircleCheck from "@lucide/svelte/icons/circle-check";
  import { t } from "$lib/stores/i18n";
  import trackEvent from "$lib/beacon";
  import ICONS from "$lib/icons";
  import Captcha from "./Captcha.svelte";
  import MonitorSelector from "./MonitorSelector.svelte";

  interface Props {
    compact?: boolean;
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
  // The persisted selection, and the working copy the user edits before saving.
  let subscribedMonitorTags = $state<string[]>([]);
  let selectedMonitorTags = $state<string[]>([]);
  let availableMonitors = $state<{ tag: string; name: string }[]>([]);
  let isLoadingPreferences = $state(false);
  let isSavingPreferences = $state(false);
  let successMessage = $state("");

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
      subscribedMonitorTags = data.monitors || [];
      selectedMonitorTags = [...subscribedMonitorTags];
      availableMonitors = data.availableMonitors || [];
      successMessage = "";
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

  async function handleSaveMonitors() {
    const token = localStorage.getItem(STORAGE_KEY);
    if (!token) {
      currentView = "login";
      return;
    }

    isSavingPreferences = true;
    errorMessage = "";
    successMessage = "";

    try {
      const response = await fetch(clientResolver(resolve, "/dashboard-apis/subscription"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "updatePreferences",
          token,
          monitorTags: selectedMonitorTags
        })
      });

      if (!response.ok) {
        const data = await response.json();
        errorMessage = data?.message || $t("Failed to update preferences");
        return;
      }

      const data = await response.json();
      subscribedMonitorTags = data.monitors || selectedMonitorTags;
      selectedMonitorTags = [...subscribedMonitorTags];
      successMessage = $t("Your monitor subscriptions have been saved.");
      trackEvent("subscribe_monitors_saved", {
        source: "subscribe_menu",
        count: subscribedMonitorTags.length
      });
    } catch (err) {
      errorMessage = $t("Network error. Please try again.");
    } finally {
      isSavingPreferences = false;
    }
  }

  function handleLogout() {
    localStorage.removeItem(STORAGE_KEY);
    email = "";
    otpValue = "";
    subscriberEmail = "";
    subscribedMonitorTags = [];
    selectedMonitorTags = [];
    availableMonitors = [];
    successMessage = "";
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
    successMessage = "";
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

  // True when the working selection differs from what is saved.
  let hasUnsavedChanges = $derived(
    selectedMonitorTags.length !== subscribedMonitorTags.length ||
      selectedMonitorTags.some((tag) => !subscribedMonitorTags.includes(tag))
  );
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
    class="flex max-h-[85vh] max-w-md flex-col overflow-hidden rounded-3xl"
    onInteractOutside={ignoreCaptchaIframeInteraction}
    onFocusOutside={ignoreCaptchaIframeInteraction}
  >
    <Dialog.Header class="shrink-0">
      <Dialog.Title class="flex items-center gap-2">
        <Bell class="h-5 w-5" />
        {$t("Subscribe to Updates")}
      </Dialog.Title>
      <Dialog.Description>
        {#if currentView === "login"}
          {$t("Get notified about the monitors you care about.")}
        {:else if currentView === "otp"}
          {$t("Enter the verification code sent to your email.")}
        {:else if currentView === "preferences"}
          {$t("Choose the monitors you want to be notified about.")}
        {:else if currentView === "loading"}
          {$t("Loading your preferences...")}
        {/if}
      </Dialog.Description>
    </Dialog.Header>

    <div class="min-h-0 flex-1 overflow-y-auto py-4">
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
        <!-- Preferences View: monitor-based subscriptions -->
        <div class="flex flex-col gap-4">
          <div class="flex items-center justify-between gap-2 rounded-lg border p-3">
            <div class="flex min-w-0 items-center gap-2">
              <Mail class="text-muted-foreground h-4 w-4 shrink-0" />
              <span class="truncate text-sm font-medium">{subscriberEmail}</span>
            </div>
            <Button
              variant="ghost"
              size="icon-sm"
              onclick={handleLogout}
              class="rounded-btn"
              aria-label={$t("Log out")}
            >
              <LogOut class="h-4 w-4" />
            </Button>
          </div>

          {#if isLoadingPreferences}
            <div class="flex items-center justify-center py-8">
              <Loader2 class="text-muted-foreground h-6 w-6 animate-spin" />
            </div>
          {:else}
            <MonitorSelector
              monitors={availableMonitors}
              bind:selected={selectedMonitorTags}
              loading={isLoadingPreferences}
              listClass="max-h-64 md:max-h-72"
              disabled={isSavingPreferences}
            />
          {/if}

          {#if errorMessage}
            <p class="text-destructive text-sm">{errorMessage}</p>
          {/if}

          {#if successMessage}
            <p class="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400">
              <CircleCheck class="h-4 w-4" />
              {successMessage}
            </p>
          {/if}

          <Button onclick={handleSaveMonitors} disabled={isSavingPreferences} class="w-full">
            {#if isSavingPreferences}
              <Loader2 class="mr-2 h-4 w-4 animate-spin" />
              {$t("Saving...")}
            {:else if hasUnsavedChanges}
              {$t("Save preferences")}
            {:else}
              {$t("Saved")}
            {/if}
          </Button>
        </div>
      {/if}
    </div>
  </Dialog.Content>
</Dialog.Root>
