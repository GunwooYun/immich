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
  import { handleError } from '$lib/utils/handle-error';
  import { Button, LoadingSpinner, toastManager } from '@immich/ui';
  import { onMount } from 'svelte';
  import { t } from 'svelte-i18n';
  import { fade } from 'svelte/transition';

  type GoogleDriveStatus = {
    connected: boolean;
    folderId: string | null;
    connectedAt: string | null;
  };

  let loading = $state(true);
  let connected = $state(false);
  let connectedAt = $state<string | null>(null);
  // Bound to the folder input. Kept as '' rather than null so the text input has a defined value;
  // it's translated back to "no folder chosen" server-side.
  let folderId = $state('');

  // `fetch` only rejects on network-level failures — an HTTP 4xx/5xx resolves normally — so every
  // call here goes through this wrapper. Without it, a 401/500 would fall straight through to the
  // success path and we'd show a "saved!" toast for a request that actually failed.
  const request = async (url: string, init?: RequestInit) => {
    const response = await fetch(url, init);
    if (!response.ok) {
      throw new Error(`Request to ${url} failed with status ${response.status}`);
    }
    return response;
  };

  const loadStatus = async () => {
    const response = await request('/api/google-drive/status');
    const status = (await response.json()) as GoogleDriveStatus;
    connected = status.connected;
    connectedAt = status.connectedAt;
    folderId = status.folderId ?? '';
  };

  onMount(async () => {
    // After the user finishes (or abandons) Google's consent screen, the server-side callback route
    // redirects the browser back to this settings page with a ?google-drive=connected|error flag
    // (alongside ?isOpen=google-drive-sync, which is what expands this section so this component
    // mounts at all). That flag is the only signal the user gets about whether linking worked.
    const params = new URLSearchParams(globalThis.location.search);
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
      params.delete('google-drive');
      await goto(`?${params.toString()}`, { replaceState: true, noScroll: true, keepFocus: true });
    }
  });

  // Step 1 of connecting: ask the server for a Google OAuth consent URL (this also mints a signed,
  // short-lived "state" token server-side so the eventual callback can be verified — see
  // GoogleDriveService#getAuthUrl on the backend), then navigate the whole browser tab there. From
  // this point on the user is on Google's own consent screen, not on Immich.
  const connectGoogleDrive = async () => {
    try {
      const response = await request('/api/google-drive/auth-url');
      const { url } = (await response.json()) as { url?: string };
      if (!url) {
        throw new Error('Server did not return a Google authorization URL');
      }
      globalThis.location.href = url;
    } catch (error) {
      handleError(error, $t('errors.unable_to_connect_google_drive'));
    }
  };

  // Persists the chosen target folder. There's no folder picker: Google's `drive.file` OAuth scope
  // only grants access to files this app itself created, so we can't enumerate the user's existing
  // folders. Pasting an ID (visible in a Drive folder's URL) is the workaround until we either
  // adopt the Google Picker API or auto-create a dedicated folder on link.
  const handleSaveFolder = async () => {
    try {
      await request('/api/google-drive/folder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folderId }),
      });
      toastManager.primary($t('saved_settings'));
    } catch (error) {
      handleError(error, $t('errors.unable_to_update_settings'));
    }
  };

  const handleDisconnect = async () => {
    try {
      await request('/api/google-drive/link', { method: 'DELETE' });
      // Reset locally rather than re-fetching: we already know the resulting state, and this keeps
      // the UI from flashing stale "connected" content while a round trip completes.
      connected = false;
      connectedAt = null;
      folderId = '';
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
          {#if connected}
            <p class="text-sm">
              {connectedAt
                ? $t('google_drive_connected_since', { values: { date: new Date(connectedAt).toLocaleString() } })
                : $t('google_drive_connected')}
            </p>
            <SettingInputField
              inputType={SettingInputFieldType.TEXT}
              label={$t('google_drive_folder_id')}
              description={$t('google_drive_folder_id_description')}
              bind:value={folderId}
            />
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
