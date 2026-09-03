<script lang="ts">
  // The contents of the album header's Google Drive dropdown.
  //
  // Why its own component instead of composing MenuOption rows: the user asked for a real toggle
  // switch (not clickable status text), a storage *bar* (not a number), dividers between rows, and
  // tighter spacing. MenuOption is shared by every menu in the app, so bending it to those needs
  // would change all of them. This owns the Drive-specific *presentation*; MenuOption is left alone.
  //
  // What it must NOT drop is MenuOption's *structural contract*, because ButtonContextMenu's
  // keyboard navigation depends on it: every row is a direct `<li>` child of the `<ul role="menu">`
  // with a unique id, a role, and it keeps `$selectedIdStore` in sync on hover — that is what makes
  // ArrowUp/Down move a highlight, `aria-activedescendant` point somewhere, and Enter/Space activate
  // the highlighted row (contextMenuNavigation resolves the selection by `#id` and calls `.click()`).
  // An earlier version rendered bare <div>/<button> with no ids; keyboard operation was dead and the
  // menu shipped invalid <ul> children. The styling is ours; the skeleton is MenuOption's.
  import { OpenQueryParam } from '$lib/constants';
  import { Route } from '$lib/route';
  import { optionClickCallbackStore, selectedIdStore } from '$lib/stores/context-menu.store';
  import { generateId } from '$lib/utils/generate-id';
  import { getByteUnitString } from '$lib/utils/byte-units';
  import { Icon, Switch } from '@immich/ui';
  import { mdiAlertCircleOutline, mdiChartArc, mdiCloudOffOutline, mdiCloudSyncOutline, mdiOpenInNew } from '@mdi/js';
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
    /**
     * Account-level pause — 'quota_exceeded' or 'folder_missing' — or null.
     *
     * The corner card's own comment says blocked states belong in this menu, and until now they
     * were nowhere in it: an album could sit there showing a backup toggle switched on while
     * every upload was being skipped at the worker's entrance, with nothing here saying why.
     */
    blockedReason: string | null;
    onToggle: () => void;
    onSyncNow: () => void;
  }

  let {
    loading,
    connected,
    backedUp,
    togglePending,
    uploaded,
    total,
    storage,
    folderId,
    blockedReason,
    onToggle,
    onSyncNow,
  }: Props = $props();

  // One stable id per possible row, generated once. contextMenuNavigation resolves the current
  // selection with `container.querySelector('#' + id)`, so these must be valid, stable ids.
  const loadingRowId = generateId();
  const connectRowId = generateId();
  const toggleRowId = generateId();
  const syncRowId = generateId();
  const blockedRowId = generateId();
  const storageRowId = generateId();
  const openRowId = generateId();

  // Pending for *this* album. Deliberately not the poller's user-wide number — that belongs to the
  // corner card. When a sync is genuinely moving we still show live movement, but scoped: the
  // smaller of "this album's own backlog" holds, since the poller can't tell us per-album.
  const pending = $derived(Math.max(total - uploaded, 0));

  const storageRatio = $derived(storage?.limitBytes ? storage.usageBytes / storage.limitBytes : null);
  // Presentational thresholds, and the *only* place they exist. There is no matching threshold on
  // the server: its quota block is purely reactive — it learns Drive is full only when Google
  // itself returns a quota-exceeded 403. These colours warn the user *before* that happens (amber
  // at 80%, red at 95%), so the bar reddens ahead of uploads starting to fail rather than after.
  // Nothing to share with the server; a "shared constant" would imply a server behaviour that does
  // not exist.
  const storageBarColor = $derived(
    storageRatio === null
      ? 'bg-primary'
      : storageRatio >= 0.95
        ? 'bg-red-500'
        : storageRatio >= 0.8
          ? 'bg-yellow-500'
          : 'bg-primary',
  );

  // Action rows (sync, open, connect) should dismiss the menu the way a MenuOption does — by
  // calling the shared close callback ButtonContextMenu registers while open. The *toggle* row
  // deliberately does not: flipping a switch must leave the menu open so its new state is visible.
  const closeMenu = () => {
    // eslint-disable-next-line unicorn/no-optional-chaining-on-undeclared-variable
    $optionClickCallbackStore?.();
  };

  const openFolder = () => {
    open(
      folderId ? `https://drive.google.com/drive/folders/${folderId}` : 'https://drive.google.com/drive/my-drive',
      '_blank',
      'noopener',
    );
    closeMenu();
  };

  const goConnect = () => {
    closeMenu();
    void goto(Route.userSettings({ isOpen: OpenQueryParam.GOOGLE_DRIVE_SYNC }));
  };

  const syncNow = () => {
    if (pending === 0) {
      return;
    }
    onSyncNow();
    closeMenu();
  };

  const toggle = () => {
    if (togglePending) {
      return;
    }
    // Not optimistic on purpose. The Switch reflects `backedUp`, a value the parent only updates
    // after the server round-trip succeeds (loadGoogleDriveMenu). On failure `backedUp` never
    // changes, so the switch stays put — no revert logic to get wrong, no "did it or didn't it"
    // ambiguity from an unbound optimistic flip.
    onToggle();
  };

  // Rows share one divider treatment. `border-b` on all but the last keeps the separators faint
  // and even; py-2.5 (10px) replaces MenuOption's p-4 (16px) for the tighter spacing asked for.
  const rowClass = 'flex items-center gap-3 px-4 py-2.5 text-sm';
  const dividerClass = 'border-b border-gray-200 dark:border-gray-700';
  const hoverClass = 'hover:bg-slate-100 dark:hover:bg-slate-700';
  const activeClass = 'bg-slate-300 dark:bg-slate-600';
</script>

{#if loading}
  <li id={loadingRowId} role="menuitem" class={rowClass}>
    <Icon icon={mdiCloudSyncOutline} size="18" />
    <span>{$t('loading')}</span>
  </li>
{:else if !connected}
  <!-- Every album member sees this menu, but only a connected one can act in it. The way to
       connect is the entire content in that state, rather than controls that all fail. -->
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_mouse_events_have_key_events -->
  <li
    id={connectRowId}
    role="menuitem"
    class={`${rowClass} ${hoverClass} cursor-pointer ${$selectedIdStore === connectRowId ? activeClass : ''}`}
    onclick={goConnect}
    onmouseover={() => ($selectedIdStore = connectRowId)}
    onmouseleave={() => ($selectedIdStore = undefined)}
  >
    <Icon icon={mdiCloudOffOutline} size="18" />
    <div>
      <div>{$t('google_drive_connect')}</div>
      <div class="text-xs text-gray-500">{$t('google_drive_not_connected_short')}</div>
    </div>
  </li>
{:else}
  <!-- Auto-backup toggle. A real switch, so on/off is legible at a glance and it reads as a control
       rather than a status line you happen to be able to click. The whole row is the click target
       (Enter/Space activates it via contextMenuNavigation's `.click()`); the Switch is display-only
       (pointer-events-none) so a mouse click always lands on the row exactly once, never doubling
       with the Switch's own change handler. -->
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_mouse_events_have_key_events -->
  <!-- svelte-ignore a11y_no_noninteractive_element_to_interactive_role -->
  <!-- The <li> must be a direct child of <ul role="menu"> for contextMenuNavigation, and this row
       must carry checkbox semantics; menuitemcheckbox on a list item is the correct role. Changing
       the element or the role to appease the rule would re-break keyboard nav (W2). -->
  <li
    id={toggleRowId}
    role="menuitemcheckbox"
    aria-checked={backedUp}
    aria-disabled={togglePending}
    class={`${rowClass} ${dividerClass} justify-between ${togglePending ? 'opacity-60' : `${hoverClass} cursor-pointer`} ${$selectedIdStore === toggleRowId ? activeClass : ''}`}
    onclick={toggle}
    onmouseover={() => ($selectedIdStore = toggleRowId)}
    onmouseleave={() => ($selectedIdStore = undefined)}
  >
    <div class="min-w-0">
      <div>{$t('google_drive_backup')}</div>
      <div class="text-xs text-gray-500">{$t('google_drive_backup_auto_description')}</div>
    </div>
    <div class="pointer-events-none">
      <Switch checked={backedUp} disabled={togglePending} aria-hidden="true" tabindex={-1} />
    </div>
  </li>

  {#if backedUp}
    <!-- Sync now. Kept visible even at zero pending, but disabled and labelled "all synced" — so
         "pressed it, nothing happened" (idempotent re-queue) is simply unpressable, while the
         retry-failed / retry-after-unblock affordance stays. -->
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_mouse_events_have_key_events -->
    <li
      id={syncRowId}
      role="menuitem"
      aria-disabled={pending === 0}
      class={`${rowClass} ${dividerClass} ${pending === 0 ? 'cursor-default opacity-60' : `${hoverClass} cursor-pointer`} ${pending > 0 && $selectedIdStore === syncRowId ? activeClass : ''}`}
      onclick={syncNow}
      onmouseover={() => ($selectedIdStore = syncRowId)}
      onmouseleave={() => ($selectedIdStore = undefined)}
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
    </li>
  {/if}

  {#if blockedReason}
    <!-- Same wording as the corner card (GoogleDriveProgressPanel) on purpose: one fact should not
         be phrased two ways depending on where you happen to read it. Informational row, so it
         carries an id for the same load-bearing reason the storage row does. -->
    <li id={blockedRowId} role="menuitem" class={`${rowClass} ${dividerClass} text-amber-600 dark:text-amber-500`}>
      <Icon icon={mdiAlertCircleOutline} size="18" />
      <span class="min-w-0 flex-1">
        {blockedReason === 'quota_exceeded'
          ? $t('google_drive_uploads_blocked_quota')
          : $t('google_drive_uploads_blocked_folder')}
      </span>
    </li>
  {/if}

  {#if storage}
    <!-- Storage as a bar, not a number: this deployment uses Drive as a buffer a Pixel drains, so
         "how full, clean it before it fills" is the signal — and a bar shows it without making the
         reader divide. Informational row: it has no click action, but it MUST still carry an id.
         contextMenuNavigation resolves the selection with querySelector('#' + id); an id-less row
         would push '' back through selectionChanged, and the next getCurrentElement() would call
         querySelector('#') — an invalid selector that throws. The id here is load-bearing, not
         decorative; role="menuitem" (rather than presentation) keeps it navigable-but-inert, which
         is what that action expects of every direct <ul> child. Don't "clean up" either. -->
    <li id={storageRowId} role="menuitem" class={`${rowClass} ${dividerClass}`}>
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
    </li>
  {/if}

  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_mouse_events_have_key_events -->
  <li
    id={openRowId}
    role="menuitem"
    class={`${rowClass} ${hoverClass} cursor-pointer ${$selectedIdStore === openRowId ? activeClass : ''}`}
    onclick={openFolder}
    onmouseover={() => ($selectedIdStore = openRowId)}
    onmouseleave={() => ($selectedIdStore = undefined)}
  >
    <Icon icon={mdiOpenInNew} size="18" />
    <span>{$t('google_drive_open')}</span>
  </li>
{/if}
