<script lang="ts">
  // This panel lives under Settings and is where a user manages their Google Drive connection:
  //   1. "Connect to Google Drive" kicks off the OAuth flow (server side handles the rest).
  //   2. "Target Folder ID" lets them choose where uploaded photos should land in their Drive.
  //
  // Note: after Google redirects the user back here (server-side callback route
  // GET /google-drive/callback), the browser lands on this settings page with a
  // `?google-drive=connected` or `?google-drive=error` query flag. Reading that flag and showing
  // a corresponding toast is a follow-up (not implemented yet) — right now this component only
  // handles the "click connect" / "save folder" half of the flow, not the "coming back from
  // Google" half.
  import SettingInputField from '$lib/components/shared-components/settings/SettingInputField.svelte';
  import { SettingInputFieldType } from '$lib/constants';
  import { Button, toastManager } from '@immich/ui';
  import { t } from 'svelte-i18n';
  import { fade } from 'svelte/transition';
  import { handleError } from '$lib/utils/handle-error';

  // The Drive folder ID the user wants uploads to go into. Left blank by default (meaning
  // "upload to the root of My Drive") — this isn't pre-filled from the server on page load
  // because there's currently no "get my current Google Drive settings" endpoint to read it
  // from; see GET /google-drive/status in the implementation plan doc for that follow-up.
  let folderId = $state('');

  // Step 1 of connecting: ask the server for a Google OAuth consent URL (this also embeds a
  // signed, short-lived "state" token server-side so the eventual callback can be verified — see
  // GoogleDriveService#getAuthUrl on the backend), then navigate the whole browser tab there.
  // From this point on, the user is on Google's own consent screen, not on Immich.
  const connectGoogleDrive = async () => {
    try {
      const response = await fetch('/api/google-drive/auth-url');
      const data = await response.json();
      if (data.url) {
        window.location.href = data.url;
      }
    } catch (error) {
      handleError(error, 'Unable to connect to Google Drive');
    }
  };

  // Persists the chosen target folder ID on the user's account. This is a plain "set and forget"
  // preference — there's no folder picker UI yet (Google's `drive.file` OAuth scope means we
  // can't list the user's existing folders), so for now the user has to paste in a folder ID
  // manually (found in a Google Drive folder's URL).
  const handleSaveFolder = async () => {
    try {
      await fetch('/api/google-drive/folder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folderId }),
      });
      toastManager.primary($t('saved_settings'));
    } catch (error) {
      handleError(error, $t('errors.unable_to_update_settings'));
    }
  };

  // Prevents the native browser form submission (which would trigger a full page reload) — we
  // handle the "save" button's click ourselves via handleSaveFolder above instead.
  const onsubmit = (event: Event) => {
    event.preventDefault();
  };
</script>

<section class="my-4">
  <div in:fade={{ duration: 500 }}>
    <form autocomplete="off" {onsubmit}>
      <div class="flex flex-col gap-4 sm:ms-8">
        <div class="flex justify-start">
          <Button shape="round" type="button" size="small" onclick={connectGoogleDrive}>Connect to Google Drive</Button>
        </div>
        <SettingInputField
          inputType={SettingInputFieldType.TEXT}
          label="Target Folder ID"
          description="The Google Drive folder ID where photos will be uploaded."
          bind:value={folderId}
        />
        <div class="flex justify-end">
          <Button shape="round" type="submit" size="small" onclick={handleSaveFolder}>{$t('save')}</Button>
        </div>
      </div>
    </form>
  </div>
</section>
