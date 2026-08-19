<script lang="ts">
  // Corner card showing Google Drive backup progress, deliberately modelled on DownloadPanel so
  // it reads as the same kind of thing rather than a new invention.
  //
  // It appears only for work the user started in this tab (see the manager's `userInitiated`).
  // Background uploads triggered by adding photos to an album are the common case and would mean
  // a card popping up unbidden; those are visible in the album menu instead, where someone has
  // gone looking. Known edge: reloading mid-sync loses the flag, so the card won't come back — the
  // progress itself is still in the album menu, and the alternative (show whenever anything is
  // pending) trades a small surprise for a constant one.
  import { goto } from '$app/navigation';
  import { OpenQueryParam } from '$lib/constants';
  import { googleDriveProgressManager } from '$lib/managers/google-drive-progress-manager.svelte';
  import { Route } from '$lib/route';
  import { Heading, IconButton } from '@immich/ui';
  import { mdiClose } from '@mdi/js';
  import { onMount } from 'svelte';
  import { t } from 'svelte-i18n';
  import { fly } from 'svelte/transition';

  let dismissed = $state(false);

  onMount(() => googleDriveProgressManager.watch());

  const manager = googleDriveProgressManager;

  // Total is only known while work is outstanding, so the bar is drawn from what's left rather
  // than a percentage of a total the client never learns. Peak pending is remembered for the
  // session so the bar fills rather than jumping around as the denominator shrinks.
  let peak = $state(0);
  $effect(() => {
    if (manager.pending > peak) {
      peak = manager.pending;
    }
    if (manager.pending === 0) {
      peak = 0;
    }
  });

  const done = $derived(peak > 0 ? peak - manager.pending : 0);
  const percentage = $derived(peak > 0 ? Math.min(Math.floor((done / peak) * 100), 100) : 0);

  const visible = $derived(
    !dismissed && manager.userInitiated && manager.loaded && (manager.pending > 0 || !!manager.blockedReason),
  );

  // Re-arm the dismiss for the next batch, so closing this one doesn't silence the feature.
  $effect(() => {
    if (!manager.userInitiated) {
      dismissed = false;
    }
  });
</script>

{#if visible}
  <div
    transition:fly={{ x: -100, duration: 350 }}
    class="fixed inset-s-2 bottom-10 z-60 w-79 rounded-2xl border bg-subtle p-4 shadow-lg dark:border-white/10"
  >
    <div class="flex place-items-center justify-between">
      <Heading size="tiny">{$t('google_drive_syncing')}</Heading>
      <IconButton
        shape="round"
        variant="ghost"
        color="secondary"
        size="small"
        icon={mdiClose}
        aria-label={$t('close')}
        onclick={() => (dismissed = true)}
      />
    </div>

    {#if manager.blockedReason}
      <!-- Paused, not progressing. Showing a bar creeping nowhere would be worse than saying so. -->
      <p class="mt-2 text-xs text-warning">
        {manager.blockedReason === 'quota_exceeded'
          ? $t('google_drive_uploads_blocked_quota')
          : $t('google_drive_uploads_blocked_folder')}
      </p>
      <button
        type="button"
        class="mt-2 text-xs underline"
        onclick={() => goto(Route.userSettings({ isOpen: OpenQueryParam.GOOGLE_DRIVE_SYNC }))}
      >
        {$t('go_to_settings')}
      </button>
    {:else}
      <div class="mt-2 flex place-items-center gap-2 text-sm">
        <div class="h-2.5 w-full rounded-full bg-neutral-200 dark:bg-neutral-600">
          <div class="h-2.5 rounded-full bg-primary" style={`width: ${percentage}%`}></div>
        </div>
        <p class="min-w-20 text-right text-xs whitespace-nowrap">{done} / {peak}</p>
      </div>
      {#if manager.failed > 0}
        <p class="mt-2 text-xs text-warning">
          {$t('google_drive_failed_count', { values: { count: manager.failed } })}
        </p>
      {/if}
    {/if}
  </div>
{/if}
