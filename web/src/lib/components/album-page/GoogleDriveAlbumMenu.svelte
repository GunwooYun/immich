<script lang="ts">
  // The contents of the album header's Google Drive dropdown.
  //
  // Why its own component instead of composing MenuOption rows: the user asked for a real toggle
  // switch (not clickable status text), a storage *bar* (not a number), dividers between rows, and
  // tighter spacing. MenuOption is shared by every menu in the app, so bending it to those needs
  // would change all of them. This owns the Drive-specific presentation; MenuOption is left alone.
  import { OpenQueryParam } from '$lib/constants';
  import { Route } from '$lib/route';
  import { getByteUnitString } from '$lib/utils/byte-units';
  import { Icon, Switch } from '@immich/ui';
  import { mdiChartArc, mdiCloudOffOutline, mdiCloudSyncOutline, mdiOpenInNew } from '@mdi/js';
  import { goto } from '$app/navigation';
  import { locale } from 'svelte-i18n';
  import { t } from 'svelte-i18n';

  interface Props {
    loading: boolean;
    connected: boolean;
    backedUp: boolean;
    togglePending: boolean;
    uploaded: number;
    total: number;
    storage: { limitBytes: number | null; usageBytes: number; usageInDriveTrashBytes: number } | null;
    folderId: string | null;
    onToggle: () => void;
    onSyncNow: () => void;
  }

  let { loading, connected, backedUp, togglePending, uploaded, total, storage, folderId, onToggle, onSyncNow }: Props =
    $props();

  // Pending for *this* album. Deliberately not the poller's user-wide number — that belongs to the
  // corner card. When a sync is genuinely moving we still show live movement, but scoped: the
  // smaller of "this album's own backlog" holds, since the poller can't tell us per-album.
  const pending = $derived(Math.max(total - uploaded, 0));

  const storageRatio = $derived(storage?.limitBytes ? storage.usageBytes / storage.limitBytes : null);
  // 80% warns, 95% alarms — the same thresholds the server's quota block uses, so the bar turns
  // red before uploads start failing rather than after.
  const storageBarColor = $derived(
    storageRatio === null
      ? 'bg-primary'
      : storageRatio >= 0.95
        ? 'bg-red-500'
        : storageRatio >= 0.8
          ? 'bg-yellow-500'
          : 'bg-primary',
  );

  const openFolder = () => {
    open(
      folderId ? `https://drive.google.com/drive/folders/${folderId}` : 'https://drive.google.com/drive/my-drive',
      '_blank',
      'noopener',
    );
  };

  // Rows share one divider treatment. `border-b` on all but the last keeps the separators faint
  // and even; py-2.5 (10px) replaces MenuOption's p-4 (16px) for the tighter spacing asked for.
  const rowClass = 'flex items-center gap-3 px-4 py-2.5 text-sm';
  const dividerClass = 'border-b border-gray-200 dark:border-gray-700';
</script>

{#if loading}
  <div class={rowClass}>
    <Icon icon={mdiCloudSyncOutline} size="18" />
    <span>{$t('loading')}</span>
  </div>
{:else if !connected}
  <!-- Every album member sees this menu, but only a connected one can act in it. The way to
       connect is the entire content in that state, rather than controls that all fail. -->
  <button
    type="button"
    class={`${rowClass} w-full text-start hover:bg-slate-100 dark:hover:bg-slate-700`}
    onclick={() => goto(Route.userSettings({ isOpen: OpenQueryParam.GOOGLE_DRIVE_SYNC }))}
  >
    <Icon icon={mdiCloudOffOutline} size="18" />
    <div>
      <div>{$t('google_drive_connect')}</div>
      <div class="text-xs text-gray-500">{$t('google_drive_not_connected_short')}</div>
    </div>
  </button>
{:else}
  <!-- Auto-backup toggle. A real switch, so on/off is legible at a glance and it reads as a
       control rather than a status line you happen to be able to click. -->
  <div class={`${rowClass} ${dividerClass} justify-between`}>
    <div class="min-w-0">
      <div>{$t('google_drive_backup')}</div>
      <div class="text-xs text-gray-500">{$t('google_drive_backup_auto_description')}</div>
    </div>
    <Switch
      checked={backedUp}
      disabled={togglePending}
      onCheckedChange={onToggle}
      aria-label={$t('google_drive_backup')}
    />
  </div>

  {#if backedUp}
    <!-- Sync now. Kept visible even at zero pending, but disabled and labelled "all synced" — so
         "pressed it, nothing happened" (idempotent re-queue) is simply unpressable, while the
         retry-failed / retry-after-unblock affordance stays. -->
    <button
      type="button"
      class={`${rowClass} ${dividerClass} w-full text-start hover:bg-slate-100 disabled:cursor-default disabled:opacity-60 disabled:hover:bg-transparent dark:hover:bg-slate-700`}
      disabled={pending === 0}
      onclick={onSyncNow}
    >
      <Icon icon={mdiCloudSyncOutline} size="18" />
      <div>
        <div>{$t('google_drive_sync_album')}</div>
        <div class="text-xs text-gray-500">
          {pending === 0
            ? $t('google_drive_all_synced')
            : $t('google_drive_pending_count', { values: { count: pending } })}
        </div>
      </div>
    </button>
  {/if}

  {#if storage}
    <!-- Storage as a bar, not a number: this deployment uses Drive as a buffer a Pixel drains, so
         "how full, clean it before it fills" is the signal — and a bar shows it without making the
         reader divide. -->
    <div class={`${rowClass} ${dividerClass}`}>
      <Icon icon={mdiChartArc} size="18" />
      <div class="min-w-0 flex-1">
        <div class="flex justify-between">
          <span>{$t('google_drive_storage')}</span>
          <span class="text-xs text-gray-500">
            {#if storage.limitBytes}
              {getByteUnitString(storage.usageBytes, $locale ?? undefined, 1)} / {getByteUnitString(
                storage.limitBytes,
                $locale ?? undefined,
                1,
              )}
            {:else}
              {getByteUnitString(storage.usageBytes, $locale ?? undefined, 1)}
            {/if}
          </span>
        </div>
        {#if storageRatio !== null}
          <div class="mt-1 h-1.5 w-full rounded-full bg-neutral-200 dark:bg-neutral-600">
            <div
              class={`h-1.5 rounded-full ${storageBarColor}`}
              style={`width: ${Math.min(Math.round(storageRatio * 100), 100)}%`}
            ></div>
          </div>
        {/if}
        {#if storage.usageInDriveTrashBytes > storage.usageBytes * 0.1}
          <div class="mt-1 text-xs text-gray-500">
            {$t('google_drive_storage_trash', {
              values: { size: getByteUnitString(storage.usageInDriveTrashBytes, $locale ?? undefined, 1) },
            })}
          </div>
        {/if}
      </div>
    </div>
  {/if}

  <button
    type="button"
    class={`${rowClass} w-full text-start hover:bg-slate-100 dark:hover:bg-slate-700`}
    onclick={openFolder}
  >
    <Icon icon={mdiOpenInNew} size="18" />
    <span>{$t('google_drive_open')}</span>
  </button>
{/if}
