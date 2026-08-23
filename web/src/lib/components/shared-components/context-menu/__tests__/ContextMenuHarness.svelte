<script lang="ts">
  // Test-only harness: wraps the real ButtonContextMenu around a chosen body so specs can drive the
  // real close/open/focus/onOpen behaviour end-to-end. Not a component the app ships.
  import ButtonContextMenu from '../ButtonContextMenu.svelte';
  import MenuOption from '../MenuOption.svelte';
  import { mdiDotsVertical } from '@mdi/js';

  interface Props {
    mode: 'menuoption' | 'plain';
    hideContent?: boolean;
    onOpen?: () => void;
    onOptionClick?: () => void;
    onPlainClick?: () => void;
  }

  let { mode, hideContent = false, onOpen, onOptionClick, onPlainClick }: Props = $props();
</script>

<ButtonContextMenu icon={mdiDotsVertical} title="menu" {hideContent} {onOpen} data-testid="ctx">
  {#if mode === 'menuoption'}
    <MenuOption text="Option" onClick={() => onOptionClick?.()} />
  {:else}
    <!-- A non-MenuOption body: it does NOT call optionClickCallbackStore, so the W1 guard is what
         keeps the menu open when it is clicked. -->
    <li>
      <button type="button" data-testid="plain-btn" onclick={() => onPlainClick?.()}>Plain</button>
    </li>
  {/if}
</ButtonContextMenu>
