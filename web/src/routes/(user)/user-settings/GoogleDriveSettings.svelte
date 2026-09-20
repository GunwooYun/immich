<script lang="ts">
  // This panel lives under Settings and is where a user manages their Google Drive connection:
  //   1. "Connect to Google Drive" kicks off the OAuth flow (the server handles the rest).
  //   2. Once connected, they can choose which Drive folder uploads should land in.
  //   3. "Disconnect" discards the stored Google credentials.
  //
  // The component hydrates its state from GET /google-drive/status on mount, so what's rendered
  // reflects the account's actual connection state rather than always starting from a blank,
  // "nobody is connected" form.
  import { goto } from '$app/navigation';
  import SettingInputField from '$lib/components/shared-components/settings/SettingInputField.svelte';
  import { SettingInputFieldType } from '$lib/constants';
  import { googleDriveUploadedManager } from '$lib/managers/google-drive-uploaded-manager.svelte';
  import { pickGoogleDriveFolder } from '$lib/utils/google-picker';
  import { handleError } from '$lib/utils/handle-error';
  // The generated client handles the base URL, auth headers, and throws on any non-2xx response —
  // this component originally used raw `fetch('/api/...')` with a hand-rolled `response.ok` check,
  // which worked but silently bypassed all of that (and would have broken on sub-path deployments).
  // Every SDK function is a top-level export named after the controller method it came from, so
  // GoogleDriveController deliberately uses long Drive-specific method names — otherwise this would
  // be importing a bare `getStatus`/`disconnect` and needing an alias on every single line.
  import {
    type GoogleDriveAlbumDto,
    type GoogleDriveFailureDto,
    disconnectGoogleDrive,
    getGoogleDriveAlbums,
    getGoogleDriveAuthUrl,
    getMyGoogleDriveFailures,
    getGoogleDrivePickerConfig,
    getGoogleDriveStatus,
    resumeGoogleDriveUploads,
    retryGoogleDriveFailures,
    setGoogleDriveFolder,
    subscribeGoogleDriveAlbum,
    unsubscribeGoogleDriveAlbum,
  } from '@immich/sdk';
  import { Alert, Button, Icon, LoadingSpinner, toastManager } from '@immich/ui';
  import { mdiFolderOutline, mdiOpenInNew } from '@mdi/js';
  import { onMount } from 'svelte';
  import { locale, t } from 'svelte-i18n';
  import { fade } from 'svelte/transition';

  let loading = $state(true);
  let connected = $state(false);
  let connectedAt = $state<string | null>(null);
  // Bound to the folder input. Kept as '' rather than null so the text input has a defined value;
  // it's translated back to "no folder chosen" server-side.
  let folderId = $state('');
  // Display name for the folder above, when we know it — only the picker can tell us. Not bound to
  // any input: it's derived from folderId and must never be sent independently of it.
  let folderName = $state<string | null>(null);
  // Guards the picker button. Opening the picker involves a round trip for an access token plus
  // loading ~100KB of Google's script, so without this a slow connection looks like a dead button
  // and invites repeated clicking.
  let pickerLoading = $state(false);
  // Failure visibility, fed by the same status call: how many uploads are currently failed, and
  // whether the whole account is blocked (Drive full / destination folder gone). blockedReason
  // drives the banner below; resuming is guarded like the picker so a slow round trip (it
  // re-queues the whole pending set) doesn't invite double-clicks.
  let failedCount = $state(0);
  // The failures themselves, loaded only when the user asks for them: the count above answers
  // "is anything wrong", and most of the time that is the whole question. Fetching a list nobody
  // opened would cost a query on every settings visit.
  let failures = $state<GoogleDriveFailureDto[]>([]);
  let failureTotal = $state(0);
  let failuresOpen = $state(false);
  let failuresLoading = $state(false);
  let retrying = $state(false);
  let blockedReason = $state<string | null>(null);
  let resuming = $state(false);
  // Whether the server has a Google API key, i.e. whether the picker can open at all. Without this
  // the button was drawn unconditionally and a deployment with no API key only found out by
  // clicking it and getting an error toast; now the manual folder-id field below is simply the
  // only way in. Starts false so the button can't flash in before the status call answers.
  let pickerAvailable = $state(false);
  // Which albums are backed up to *this* user's Drive. Uploads follow this list, not album
  // ownership — an album shared with you can be backed up by you, and one you own need not be.
  // Counts are per-viewer: "uploaded" means "already in your Drive".
  let albums = $state<GoogleDriveAlbumDto[]>([]);
  // Guards individual checkboxes so a slow round trip (subscribing also queues the album's
  // contents) can't be double-fired.
  let busyAlbumId = $state<string | null>(null);

  const loadStatus = async () => {
    const status = await getGoogleDriveStatus();
    connected = status.connected;
    connectedAt = status.connectedAt;
    folderId = status.folderId ?? '';
    folderName = status.folderName ?? null;
    failedCount = status.failedCount;
    blockedReason = status.blockedReason ?? null;
    pickerAvailable = status.pickerAvailable;
    albums = connected ? await getGoogleDriveAlbums() : [];
  };

  // Toggling is optimistic-free on purpose: subscribing queues the album's pending assets
  // server-side, so re-reading the list afterwards is what makes the counts honest immediately
  // rather than after the next visit.
  const handleToggleAlbum = async (album: GoogleDriveAlbumDto) => {
    busyAlbumId = album.albumId;
    try {
      await (album.subscribed
        ? unsubscribeGoogleDriveAlbum({ id: album.albumId })
        : subscribeGoogleDriveAlbum({ id: album.albumId }));
      albums = await getGoogleDriveAlbums();
    } catch (error) {
      handleError(error, $t('errors.unable_to_update_google_drive_albums'));
    } finally {
      busyAlbumId = null;
    }
  };

  onMount(async () => {
    // After the user finishes (or abandons) Google's consent screen, the server-side callback route
    // redirects the browser back to this settings page with a ?google-drive=connected|error flag
    // (alongside ?isOpen=google-drive-sync, which is what expands this section so this component
    // mounts at all). That flag is the only signal the user gets about whether linking worked.
    const params = new URLSearchParams(location.search);
    const result = params.get('google-drive');

    // Load status first. Doing this before the goto below matters: goto() replaces the whole query
    // string, and this component only stays mounted while `isOpen` still names this section — so
    // any work scheduled after it is at the mercy of a re-render.
    try {
      await loadStatus();
    } catch (error) {
      handleError(error, $t('errors.unable_to_load_google_drive_status'));
    } finally {
      loading = false;
    }

    if (result) {
      if (result === 'connected') {
        toastManager.primary($t('google_drive_connected'));
      } else {
        toastManager.danger($t('google_drive_connect_error'));
      }

      // Drop the one-shot flag so a refresh (or a copied URL) doesn't replay the toast. Everything
      // else in the query string is carried over untouched — in particular `isOpen`, which is what
      // keeps this section expanded (and which can name several sections at once, space-separated,
      // so rebuilding it by hand would silently collapse whatever else the user had open).
      //
      // Re-read the URL here rather than reusing the `params` captured at the top: the await above
      // means an arbitrary amount of time has passed, and if the user expanded or collapsed another
      // settings section meanwhile, writing back the stale snapshot would undo that.
      //
      // Filtered into a fresh instance rather than mutated in place: the lint rules here forbid
      // mutating a plain URLSearchParams (mutation is invisible to Svelte's reactivity), and a
      // rebuild-by-filter says the same thing without reaching for the reactive variant, which this
      // one-shot cleanup has no use for.
      const remaining = [...new URLSearchParams(location.search)].filter(([key]) => key !== 'google-drive');
      await goto(`?${new URLSearchParams(remaining).toString()}`, {
        replaceState: true,
        noScroll: true,
        keepFocus: true,
      });
    }
  });

  // Step 1 of connecting: ask the server for a Google OAuth consent URL (this also mints a signed,
  // short-lived "state" token server-side so the eventual callback can be verified — see
  // GoogleDriveService#getAuthUrl on the backend), then navigate the whole browser tab there. From
  // this point on the user is on Google's own consent screen, not on Immich.
  const connectGoogleDrive = async () => {
    try {
      const { url } = await getGoogleDriveAuthUrl();
      location.assign(url);
    } catch (error) {
      handleError(error, $t('errors.unable_to_connect_google_drive'));
    }
  };

  // Opens Google's own folder browser and saves whatever the user picks.
  //
  // Immich can't render its own folder tree: the OAuth scope this feature asks for is `drive.file`,
  // a per-file grant that deliberately doesn't allow listing a user's Drive. The Picker is Google's
  // answer to exactly that — it runs on Google's origin so it can show the real folder structure,
  // and choosing a folder there is what extends our grant to cover it.
  //
  // Saved immediately rather than only filling in the input, because picking a folder in a modal
  // dialog *is* the confirmation step; making the user then find and press "save" would be an easy
  // thing to forget and would silently discard their choice.
  const handlePickFolder = async () => {
    pickerLoading = true;
    try {
      const config = await getGoogleDrivePickerConfig();
      const folder = await pickGoogleDriveFolder(config, $t('google_drive_pick_folder'));
      // Undefined means the user closed the dialog without choosing — a normal outcome, so leave
      // the existing setting alone and say nothing.
      if (!folder) {
        return;
      }

      await setGoogleDriveFolder({
        googleDriveSetFolderDto: { folderId: folder.id, folderName: folder.name },
      });
      folderId = folder.id;
      folderName = folder.name ?? null;
      toastManager.primary($t('saved_settings'));
    } catch (error) {
      handleError(error, $t('errors.unable_to_open_google_drive_picker'));
    } finally {
      pickerLoading = false;
    }
  };

  // Manual fallback for when no Google API key is configured (the picker can't open without one),
  // or when someone would simply rather paste the id out of a Drive folder's URL. No name is sent:
  // we genuinely don't know it here, and inventing one would be worse than showing the raw id.
  const handleSaveFolder = async () => {
    try {
      await setGoogleDriveFolder({ googleDriveSetFolderDto: { folderId } });
      folderName = null;
      toastManager.primary($t('saved_settings'));
    } catch (error) {
      handleError(error, $t('errors.unable_to_update_settings'));
    }
  };

  // Clearing the folder is a real choice, not the absence of one: uploads then land in the root of
  // My Drive. It used to be expressed by emptying the id text field, which is fine when that field
  // is on screen and impossible when it is not — and the Google Picker has no "root" entry, so
  // hiding the field without this would quietly remove the only way back.
  const handleUseRoot = async () => {
    try {
      await setGoogleDriveFolder({ googleDriveSetFolderDto: { folderId: '' } });
      folderId = '';
      folderName = null;
      toastManager.primary($t('saved_settings'));
    } catch (error) {
      handleError(error, $t('errors.unable_to_update_settings'));
    }
  };

  // "Resume uploads" for the quota block: the server clears the block and immediately re-queues
  // everything pending, so by the time the toast shows, uploading has genuinely restarted (not
  // merely become possible again). Status is re-fetched afterwards because a re-block can happen
  // fast if space wasn't actually freed.
  const handleResume = async () => {
    resuming = true;
    try {
      await resumeGoogleDriveUploads();
      toastManager.primary($t('google_drive_resumed'));
      await loadStatus();
    } catch (error) {
      handleError(error, $t('errors.unable_to_resume_google_drive'));
    } finally {
      resuming = false;
    }
  };

  /**
   * Wording per failure class. The server sends a classification rather than a sentence so this
   * side can translate it — and so the two cases the user can actually fix say what to do.
   */
  const failureLabel = (error: string) => {
    switch (error) {
      case 'quota_exceeded': {
        return $t('google_drive_failure_quota');
      }
      case 'folder_missing': {
        return $t('google_drive_failure_folder');
      }
      case 'source_unreadable': {
        return $t('google_drive_failure_source');
      }
      case 'size_mismatch': {
        return $t('google_drive_failure_size');
      }
      case 'revoked': {
        // Reachable in the list even though retrying it is refused: the rows stay until a
        // reconnect, and "why is this here" deserves an answer.
        return $t('google_drive_failure_revoked');
      }
      default: {
        return $t('google_drive_failure_unknown');
      }
    }
  };

  const loadFailures = async () => {
    failuresLoading = true;
    try {
      const result = await getMyGoogleDriveFailures();
      failures = result.failures;
      failureTotal = result.total;
    } catch (error) {
      handleError(error, $t('errors.unable_to_load_google_drive_status'));
    } finally {
      failuresLoading = false;
    }
  };

  const toggleFailures = async () => {
    failuresOpen = !failuresOpen;
    if (failuresOpen) {
      await loadFailures();
    }
  };

  /**
   * Retry one asset, or everything when given nothing.
   *
   * The server clears the recorded failures and re-runs its own pending query, so an asset whose
   * album is no longer selected simply does not come back — which is why this cannot just queue
   * the ids on screen. Afterwards both the list and the count are re-read rather than adjusted
   * locally: the truth about what is still failing lives on the server.
   */
  const retryFailures = async (assetIds: string[]) => {
    retrying = true;
    try {
      const { queued } = await retryGoogleDriveFailures({ googleDriveRetryFailuresDto: { assetIds } });
      // Naming the number matters when it is zero: the failures are cleared, but the albums those
      // photos belong to are no longer selected for backup, so nothing was queued. A flat
      // "retrying" toast would promise work that is not going to happen (wave10a review N3).
      toastManager.info($t('google_drive_retry_started', { values: { count: queued } }));
      const status = await getGoogleDriveStatus();
      failedCount = status.failedCount;
      blockedReason = status.blockedReason ?? null;
      if (failuresOpen) {
        await loadFailures();
      }
    } catch (error) {
      handleError(error, $t('errors.unable_to_start_google_drive_sync'));
    } finally {
      retrying = false;
    }
  };

  const handleDisconnect = async () => {
    try {
      await disconnectGoogleDrive();
      // The badge cache is keyed to a connection, and disconnecting is an SPA state change: without
      // this the thumbnails keep their "in Drive" badges for the rest of the session while the
      // server has already started answering with nothing. (Re-connecting needs no such call — it
      // leaves the page for Google and comes back on a full load.)
      googleDriveUploadedManager.reset();
      // Reset locally rather than re-fetching: we already know the resulting state, and this keeps
      // the UI from flashing stale "connected" content while a round trip completes.
      connected = false;
      connectedAt = null;
      folderId = '';
      folderName = null;
      toastManager.primary($t('google_drive_disconnected'));
    } catch (error) {
      handleError(error, $t('errors.unable_to_disconnect_google_drive'));
    }
  };

  // Prevents the native browser form submission (which would trigger a full page reload) — the
  // "save" button's click is handled by handleSaveFolder above instead.
  const onsubmit = (event: Event) => {
    event.preventDefault();
  };
</script>

<section class="my-4">
  <div in:fade={{ duration: 500 }}>
    {#if loading}
      <div class="flex justify-center py-4"><LoadingSpinner /></div>
    {:else}
      <form autocomplete="off" {onsubmit}>
        <div class="flex flex-col gap-4 sm:ms-8">
          {#if blockedReason === 'quota_exceeded'}
            <!-- Account-level block: nothing uploads until the user acts, so this outranks the
                 per-field content below. The button is the fix, right next to the explanation. -->
            <Alert color="warning" title={$t('google_drive_uploads_blocked_quota')}>
              <div class="mt-2 flex justify-start">
                <Button
                  shape="round"
                  type="button"
                  size="small"
                  onclick={handleResume}
                  disabled={resuming}
                  loading={resuming}
                >
                  {$t('google_drive_resume_uploads')}
                </Button>
              </div>
            </Alert>
          {:else if blockedReason === 'folder_missing'}
            <!-- The fix for this one is picking a new folder (which clears the block server-side),
                 and the picker button is already on this page — the banner just explains. -->
            <Alert color="warning" title={$t('google_drive_uploads_blocked_folder')} />
          {:else if blockedReason === 'revoked'}
            <!-- Shown in the disconnected state: the server discarded the credentials after Google
                 rejected the grant, and without this the user just sees "not connected" with no
                 idea why. The Connect button right below is the fix; reconnecting clears the
                 underlying records server-side. -->
            <Alert color="warning" title={$t('google_drive_uploads_blocked_revoked')} />
          {/if}
          {#if failedCount > 0}
            <!-- Shown even when the account is blocked: the banner above says why everything
                 stopped, this says which photos are affected, and after a resume the two numbers
                 are the only way to tell "retried and fixed" from "retried and failed again". -->
            <div class="flex flex-wrap items-center gap-2">
              <p class="text-sm">{$t('google_drive_failed_count', { values: { count: failedCount } })}</p>
              <Button
                shape="round"
                type="button"
                size="small"
                color="secondary"
                aria-expanded={failuresOpen}
                onclick={toggleFailures}
              >
                {failuresOpen ? $t('google_drive_failures_hide') : $t('google_drive_failures_show')}
              </Button>
              {#if connected}
                <!-- Only while connected: with no connection the server refuses (it would queue
                     nothing and erase the explanation of why uploads stopped), so offering the
                     button would be offering a dead end. -->
                <Button
                  shape="round"
                  type="button"
                  size="small"
                  color="primary"
                  disabled={retrying}
                  loading={retrying}
                  onclick={() => retryFailures([])}
                >
                  {$t('google_drive_retry_all')}
                </Button>
              {/if}
            </div>

            {#if failuresOpen}
              {#if failuresLoading}
                <LoadingSpinner />
              {:else}
                <ul class="flex flex-col gap-1 text-sm">
                  {#each failures as failure (failure.assetId)}
                    <li
                      class="flex items-center justify-between gap-2 rounded-lg bg-gray-100 px-3 py-2 dark:bg-gray-800"
                    >
                      <div class="min-w-0">
                        <p class="truncate font-medium">{failure.fileName}</p>
                        <p class="text-xs text-gray-500">
                          {failureLabel(failure.error)}
                          · {$t('google_drive_failure_attempts', { values: { count: failure.attempts } })}
                          · {new Date(failure.lastFailedAt).toLocaleString($locale ?? undefined)}
                        </p>
                      </div>
                      {#if connected}
                        <Button
                          shape="round"
                          type="button"
                          size="small"
                          color="secondary"
                          disabled={retrying}
                          loading={retrying}
                          aria-label={$t('google_drive_retry_file', { values: { file: failure.fileName } })}
                          onclick={() => retryFailures([failure.assetId])}
                        >
                          {$t('google_drive_retry')}
                        </Button>
                      {/if}
                    </li>
                  {/each}
                </ul>
                {#if failureTotal > failures.length}
                  <!-- A thousand failures are one cause, not a thousand problems; the list is
                       capped and says so rather than pretending it is complete. -->
                  <p class="text-xs text-gray-500">
                    {$t('google_drive_failures_truncated', {
                      values: { shown: failures.length, total: failureTotal },
                    })}
                  </p>
                {/if}
              {/if}
            {/if}
          {/if}
          {#if connected}
            <p class="text-sm">
              <!-- toLocaleString() with no argument uses the *browser's* locale, which is not
                   necessarily the language the user picked in Immich. Passing $locale keeps the
                   date consistent with the rest of the UI; `?? undefined` because the store is
                   momentarily null before i18n initialises, and undefined is the documented way
                   to ask Intl for the default. -->
              {connectedAt
                ? $t('google_drive_connected_since', {
                    values: { date: new Date(connectedAt).toLocaleString($locale ?? undefined) },
                  })
                : $t('google_drive_connected')}
            </p>
            <!-- Two cards, because the two things on this page answer different questions and
                 were previously stacked as one undifferentiated column. The folder is set once and
                 forgotten; the album list is watched. Splitting them is also what makes the album
                 checkboxes stop reading as a duplicate of the per-album menu — with a boundary
                 drawn, one is "this album" and the other is "all of them at once", the way a file
                 manager has both a context menu and a list. -->
            <div class="rounded-2xl border bg-subtle p-4 dark:border-black dark:bg-black/30">
              <p class="text-sm font-medium">{$t('google_drive_location')}</p>
              <div class="mt-3 flex items-center gap-3">
                <Icon icon={mdiFolderOutline} size="24" class="shrink-0 text-gray-500 dark:text-gray-400" />
                <div class="min-w-0 flex-1">
                  {#if folderId}
                    <!-- The name links to the folder itself. A destination you cannot look at is a
                         destination you have to take on trust, and the album menu already offers
                         this — it belongs here more than there. -->
                    <a
                      class="flex items-center gap-1 text-sm hover:underline"
                      href={`https://drive.google.com/drive/folders/${folderId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={$t('google_drive_folder_open_hint')}
                    >
                      <span class="truncate">{folderName ?? $t('google_drive_folder_selected')}</span>
                      <Icon icon={mdiOpenInNew} size="14" class="shrink-0" />
                    </a>
                    {#if !folderName}
                      <!-- Only when the name could not be read (a folder outside what drive.file
                           granted, typically one pasted by id). The id is no use for acting on, but
                           it is the one thing that lets someone compare against Drive when the
                           name is missing precisely because something is wrong. -->
                      <p class="truncate text-xs text-gray-500 dark:text-gray-400">{folderId}</p>
                    {/if}
                  {:else}
                    <p class="text-sm">{$t('google_drive_folder_none')}</p>
                  {/if}
                </div>
                {#if pickerAvailable}
                  <Button
                    shape="round"
                    type="button"
                    size="small"
                    onclick={handlePickFolder}
                    disabled={pickerLoading}
                    loading={pickerLoading}
                  >
                    {folderId ? $t('google_drive_folder_change') : $t('google_drive_pick_folder')}
                  </Button>
                {/if}
              </div>
              {#if pickerAvailable}
                {#if folderId}
                  <div class="mt-3 flex justify-start">
                    <Button shape="round" type="button" size="small" color="secondary" onclick={handleUseRoot}>
                      {$t('google_drive_folder_use_root')}
                    </Button>
                  </div>
                {/if}
              {:else}
                <!-- No API key on this deployment means no picker, and then typing the id is the
                     only way to set a folder at all. Where the picker works the field is left out:
                     a 33-character opaque string in an editable box invites a paste that sends
                     uploads somewhere invisible, or blocks the account outright on FolderMissing. -->
                <div class="mt-3">
                  <SettingInputField
                    inputType={SettingInputFieldType.TEXT}
                    label={$t('google_drive_folder_id')}
                    description={$t('google_drive_folder_id_description')}
                    bind:value={folderId}
                  />
                  <div class="mt-3 flex justify-end">
                    <Button shape="round" type="submit" size="small" onclick={handleSaveFolder}>{$t('save')}</Button>
                  </div>
                </div>
              {/if}
            </div>

            <div class="flex flex-col gap-1 rounded-2xl border bg-subtle p-4 dark:border-black dark:bg-black/30">
              <p class="text-sm font-medium">{$t('google_drive_albums')}</p>
              <p class="text-xs text-gray-500 dark:text-gray-400">{$t('google_drive_albums_description')}</p>
              {#if albums.length === 0}
                <p class="text-sm">{$t('google_drive_albums_empty')}</p>
              {:else}
                <ul class="mt-1 flex flex-col gap-1">
                  {#each albums as album (album.albumId)}
                    <li class="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        id={`gd-album-${album.albumId}`}
                        checked={album.subscribed}
                        disabled={busyAlbumId === album.albumId}
                        onchange={() => handleToggleAlbum(album)}
                      />
                      <label for={`gd-album-${album.albumId}`} class="flex-1">
                        {album.albumName}
                        {#if !album.isOwner}
                          <span class="text-xs text-gray-500 dark:text-gray-400">
                            ({$t('google_drive_album_owned_by', { values: { name: album.ownerName } })})
                          </span>
                        {/if}
                        {#if album.accessLost}
                          <!-- Uploads have already stopped server-side; showing the row is what
                               keeps that from being a silent stall. Unchecking is the only cure
                               the user controls (the other is the owner re-sharing). -->
                          <span class="text-xs text-warning">— {$t('google_drive_album_access_lost')}</span>
                        {/if}
                      </label>
                      <span class="text-xs text-gray-500 dark:text-gray-400">
                        {album.uploadedCount} / {album.assetCount}
                      </span>
                    </li>
                  {/each}
                </ul>
              {/if}
            </div>
            <div class="flex justify-start">
              <Button shape="round" type="button" size="small" color="danger" onclick={handleDisconnect}>
                {$t('google_drive_disconnect')}
              </Button>
            </div>
          {:else}
            <p class="text-sm">{$t('google_drive_not_connected')}</p>
            <div class="flex justify-start">
              <Button shape="round" type="button" size="small" onclick={connectGoogleDrive}>
                {$t('google_drive_connect')}
              </Button>
            </div>
          {/if}
        </div>
      </form>
    {/if}
  </div>
</section>
