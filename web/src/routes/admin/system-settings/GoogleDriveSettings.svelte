<script lang="ts">
  // Admin-side configuration for the Google Drive album sync feature. Each Immich deployment needs
  // its own OAuth client (self-hosted apps can't ship a shared one — the secret would be public and
  // every install would share one API quota), so these values can't have useful defaults and have
  // to be entered here.
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
          bind:value={configToEdit.googleDrive.clientId}
          isEdited={configToEdit.googleDrive.clientId !== config.googleDrive.clientId}
          {disabled}
        />
        <SettingInputField
          inputType={SettingInputFieldType.PASSWORD}
          label={$t('admin.google_drive_client_secret')}
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
        <SettingButtonsRow bind:configToEdit keys={['googleDrive']} {disabled} />
      </div>
    </form>
  </div>
</div>
