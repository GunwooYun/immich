<script lang="ts">
  // Test-only harness: the real GoogleDriveAlbumMenu inside the real ButtonContextMenu with
  // hideContent — the exact composition W1/W2/W3 all lived in. The split specs each test one half
  // against a stub; this drives both halves together with the real optionClickCallbackStore wiring
  // ButtonContextMenu registers, which a stub cannot exercise. Not shipped in the app.
  import ButtonContextMenu from '$lib/components/shared-components/context-menu/ButtonContextMenu.svelte';
  import GoogleDriveAlbumMenu from '../GoogleDriveAlbumMenu.svelte';
  import { mdiGoogleDrive } from '@mdi/js';

  interface Props {
    onToggle: () => void;
    onSyncNow: () => void;
  }
  let { onToggle, onSyncNow }: Props = $props();
</script>

<ButtonContextMenu icon={mdiGoogleDrive} title="drive" hideContent data-testid="ctx">
  <GoogleDriveAlbumMenu
    loading={false}
    connected={true}
    backedUp={true}
    togglePending={false}
    uploaded={3}
    total={10}
    storage={{ limitBytes: 100, usageBytes: 50, usageInDriveTrashBytes: 0 }}
    folderId="folder-1"
    {onToggle}
    {onSyncNow}
  />
</ButtonContextMenu>
