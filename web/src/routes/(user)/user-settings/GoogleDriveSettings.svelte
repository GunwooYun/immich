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
    disconnectGoogleDrive,
    getGoogleDriveAlbums,
    getGoogleDriveAuthUrl,
    getGoogleDrivePickerConfig,
    getGoogleDriveStatus,
    resumeGoogleDriveUploads,
    setGoogleDriveFolder,
    subscribeGoogleDriveAlbum,
    unsubscribeGoogleDriveAlbum,
  } from '@immich/sdk';
  import { Alert, Button, LoadingSpinner, toastManager } from '@immich/ui';
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

  const handleDisconnect = async () => {
    try {
      await disconnectGoogleDrive();
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
          {#if failedCount > 0 && !blockedReason}
            <p class="text-sm">{$t('google_drive_failed_count', { values: { count: failedCount } })}</p>
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
            <!-- The primary way to choose a folder — but only where it can actually work. The
                 picker is a Google-hosted widget that needs a server-configured API key, so on a
                 deployment without one the button is left out entirely rather than offered and
                 failing on click; the text field below is then the way to set a folder. -->
            <div class="flex flex-col gap-2">
              <!-- A Drive folder id is a 33-character opaque string. Showing it where the name
                   belongs told the user nothing they could act on, and it looked like an error.
                   The server fills the name in on load when it can (getStatus), so this falls back
                   to naming the *state* rather than the id — the id itself stays available in the
                   field below for anyone who actually wants it. -->
              <p class="text-sm">
                {folderName
                  ? $t('google_drive_folder_current', { values: { folder: folderName } })
                  : folderId
                    ? $t('google_drive_folder_unnamed')
                    : $t('google_drive_folder_none')}
              </p>
              {#if pickerAvailable}
                <div class="flex justify-start">
                  <Button
                    shape="round"
                    type="button"
                    size="small"
                    onclick={handlePickFolder}
                    disabled={pickerLoading}
                    loading={pickerLoading}
                  >
                    {$t('google_drive_pick_folder')}
                  </Button>
                </div>
              {/if}
            </div>
            <SettingInputField
              inputType={SettingInputFieldType.TEXT}
              label={$t('google_drive_folder_id')}
              description={$t('google_drive_folder_id_description')}
              bind:value={folderId}
            />
            <!-- The album list is the heart of the feature: it is what decides whose Drive gets
                 what. Shared albums name their owner, so backing up someone else's album is a
                 visible choice rather than an accident. -->
            <div class="flex flex-col gap-1">
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
            <div class="flex justify-between">
              <Button shape="round" type="button" size="small" color="danger" onclick={handleDisconnect}>
                {$t('google_drive_disconnect')}
              </Button>
              <Button shape="round" type="submit" size="small" onclick={handleSaveFolder}>{$t('save')}</Button>
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
