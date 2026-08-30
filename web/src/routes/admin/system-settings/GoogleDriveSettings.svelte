<script lang="ts">
  // Admin-side configuration for the Google Drive album sync feature. Each Immich deployment needs
  // its own OAuth client (self-hosted apps can't ship a shared one — the secret would be public and
  // every install would share one API quota), but the *operator* of a deployment can supply theirs
  // once via IMMICH_GOOGLE_DRIVE_* in the environment. Where they have, these fields already carry
  // the value and nobody needs to type anything; a value entered here still wins, because the saved
  // config is merged over the defaults. The hints below say which fields came from the environment,
  // so an admin can tell "already set up" from "someone typed this".
  //
  // The redirect URL is different again: left empty it is derived from the External Domain setting,
  // since it is always <origin>/api/google-drive/callback.
  import SettingInputField from '$lib/components/shared-components/settings/SettingInputField.svelte';
  import SettingSwitch from '$lib/components/shared-components/settings/SettingSwitch.svelte';
  import SettingButtonsRow from '$lib/components/shared-components/settings/SystemConfigButtonRow.svelte';
  import { SettingInputFieldType } from '$lib/constants';
  import { featureFlagsManager } from '$lib/managers/feature-flags-manager.svelte';
  import { systemConfigManager } from '$lib/managers/system-config-manager.svelte';
  import { t } from 'svelte-i18n';
  import { fade } from 'svelte/transition';

  const disabled = $derived(featureFlagsManager.value.configFile);
  const config = $derived(systemConfigManager.value);
  // The server's *defaults*, which is where an environment-provided credential shows up: config.ts
  // reads IMMICH_GOOGLE_DRIVE_* into the default value, and the defaults endpoint hands that back.
  // A non-empty default therefore means "the environment supplies this", with no new API needed.
  const defaults = $derived(systemConfigManager.defaultValue.googleDrive);
  let configToEdit = $state(systemConfigManager.cloneValue());
</script>

<div>
  <div in:fade={{ duration: 500 }}>
    <form autocomplete="off" onsubmit={(event) => event.preventDefault()}>
      <div class="ms-4 mt-4 flex flex-col gap-4">
        <SettingSwitch
          title={$t('admin.google_drive_enabled')}
          subtitle={$t('admin.google_drive_enabled_description')}
          bind:checked={configToEdit.googleDrive.enabled}
          {disabled}
        />
        <SettingInputField
          inputType={SettingInputFieldType.TEXT}
          label={$t('admin.google_drive_client_id')}
          description={defaults.clientId ? $t('admin.google_drive_env_default_description') : ''}
          bind:value={configToEdit.googleDrive.clientId}
          isEdited={configToEdit.googleDrive.clientId !== config.googleDrive.clientId}
          {disabled}
        />
        <SettingInputField
          inputType={SettingInputFieldType.PASSWORD}
          label={$t('admin.google_drive_client_secret')}
          description={defaults.clientSecret ? $t('admin.google_drive_env_default_description') : ''}
          bind:value={configToEdit.googleDrive.clientSecret}
          isEdited={configToEdit.googleDrive.clientSecret !== config.googleDrive.clientSecret}
          {disabled}
        />
        <SettingInputField
          inputType={SettingInputFieldType.TEXT}
          label={$t('admin.google_drive_redirect_url')}
          description={$t('admin.google_drive_redirect_url_description')}
          bind:value={configToEdit.googleDrive.redirectUrl}
          isEdited={configToEdit.googleDrive.redirectUrl !== config.googleDrive.redirectUrl}
          {disabled}
        />
        <!-- Optional, unlike the two credentials above: without it everything still syncs, users
             just paste a folder id by hand instead of getting a folder picker (and the picker
             button is hidden rather than offered and failing). Kept as a TEXT (not PASSWORD) field
             because a Google API key is not a secret — it's sent to the browser and visible in the
             picker's own network requests; restrict it by HTTP referrer in Google Cloud Console
             rather than by hiding it. -->
        <SettingInputField
          inputType={SettingInputFieldType.TEXT}
          label={$t('admin.google_drive_api_key')}
          description={defaults.apiKey
            ? $t('admin.google_drive_env_default_description')
            : $t('admin.google_drive_api_key_description')}
          bind:value={configToEdit.googleDrive.apiKey}
          isEdited={configToEdit.googleDrive.apiKey !== config.googleDrive.apiKey}
          {disabled}
        />
        <SettingButtonsRow bind:configToEdit keys={['googleDrive']} {disabled} />
      </div>
    </form>
  </div>
</div>
