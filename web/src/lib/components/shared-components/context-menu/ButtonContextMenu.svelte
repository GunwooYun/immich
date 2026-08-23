<script lang="ts">
  import { contextMenuNavigation } from '$lib/actions/context-menu-navigation';
  import { shortcuts } from '$lib/actions/shortcut';
  import ContextMenu from '$lib/components/shared-components/context-menu/ContextMenu.svelte';
  import { languageManager } from '$lib/managers/language-manager.svelte';
  import { optionClickCallbackStore, selectedIdStore } from '$lib/stores/context-menu.store';
  import {
    getContextMenuPositionFromBoundingRect,
    getContextMenuPositionFromEvent,
    type Align,
  } from '$lib/utils/context-menu';
  import { generateId } from '$lib/utils/generate-id';
  import { IconButton, type Color, type Size, type Variants } from '@immich/ui';
  import { tick, type Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';

  type Props = {
    icon: string;
    title: string;
    /**
     * The alignment of the context menu relative to the button.
     */
    align?: Align;
    /**
     * The direction in which the context menu should open.
     */
    // TODO change to start vs end
    direction?: 'left' | 'right';
    color?: Color;
    size?: Size | undefined;
    variant?: Variants | undefined;
    /**
     * Additional classes to apply to the button.
     */
    buttonClass?: string | undefined;
    hideContent?: boolean;
    /**
     * Called when the menu opens. Lets a caller defer loading whatever the menu displays until
     * someone actually looks at it, instead of paying for it on every page render.
     */
    onOpen?: () => void;
    children?: Snippet;
    offset?: {
      x: number;
      y: number;
    };
  } & HTMLAttributes<HTMLDivElement>;

  let {
    icon,
    title,
    align = 'top-left',
    direction = 'right',
    color = 'secondary',
    size = undefined,
    variant = 'ghost',
    buttonClass = undefined,
    hideContent = false,
    onOpen,
    children,
    offset,
    ...restProps
  }: Props = $props();

  let isOpen = $state(false);
  let contextMenuPosition = $state({ x: 0, y: 0 });
  let menuContainer: HTMLUListElement | undefined = $state();
  let buttonContainer: HTMLDivElement | undefined = $state();

  const id = generateId();
  const buttonId = `context-menu-button-${id}`;
  const menuId = `context-menu-${id}`;

  const openDropdown = (event: KeyboardEvent | MouseEvent) => {
    let layoutAlign = align;
    if (languageManager.rtl) {
      if (align.includes('left')) {
        layoutAlign = align.replace('left', 'right') as Align;
      } else if (align.includes('right')) {
        layoutAlign = align.replace('right', 'left') as Align;
      }
    }
    contextMenuPosition = getContextMenuPositionFromEvent(event, layoutAlign);

    // F2: only announce a genuine closed->open transition. contextMenuNavigation calls this on
    // every ArrowUp/Down (it opens-then-moves), so firing onOpen unconditionally re-ran the
    // caller's load on every keystroke — for the Drive menu that meant three HTTP requests per
    // arrow, one of them a live Google Drive API call. The prop's contract is "called when the
    // menu opens", not "per keypress".
    const wasOpen = isOpen;
    isOpen = true;

    // F1: focus the menu *after* it has rendered. With hideContent the <ul> that carries
    // aria-activedescendant is mounted by the {#if isOpen || !hideContent} block below, so at this
    // synchronous point menuContainer is still undefined and a bare focus() call is a no-op —
    // leaving focus on the trigger, where assistive tech never sees the keyboard highlight. tick()
    // lets the block render first. Harmless without hideContent (the element already exists).
    if (!wasOpen) {
      onOpen?.();
    }
    void tick().then(() => menuContainer?.focus());
  };

  const handleClick = (event: MouseEvent) => {
    if (isOpen) {
      closeDropdown();
      return;
    }
    openDropdown(event);
  };

  const onEscape = (event: KeyboardEvent) => {
    if (isOpen) {
      // if the dropdown is open, stop the event from propagating
      event.stopPropagation();
    }
    closeDropdown();
  };

  const onResize = () => {
    if (!isOpen || !buttonContainer) {
      return;
    }

    contextMenuPosition = getContextMenuPositionFromBoundingRect(buttonContainer.getBoundingClientRect(), align);
  };

  const closeDropdown = () => {
    if (!isOpen) {
      return;
    }
    focusButton();
    isOpen = false;
    $selectedIdStore = undefined;
  };

  const handleOptionClick = () => {
    closeDropdown();
  };

  const handleDocumentClick = (event: MouseEvent) => {
    if (!isOpen) {
      return;
    }

    const target = event.target as Node | null;
    if (buttonContainer?.contains(target)) {
      return;
    }

    // Clicks *inside* the menu body must not close it here. MenuOption already closes the menu
    // itself, via optionClickCallbackStore in its own onclick — so this document-level handler was
    // never what closed a normal menu item, and skipping it for in-menu clicks leaves that path
    // untouched. What it does fix: menu bodies that aren't made of MenuOptions (e.g. a toggle
    // switch, an inline control) no longer vanish the instant you interact with them, which
    // destroyed the very feedback the control exists to give. Outside clicks still close.
    //
    // OBLIGATION this creates for future menus: closing is now "the menu closes because MenuOption
    // closes it", not "the menu closes on any click". A menu body that is NOT built from
    // MenuOption must therefore call optionClickCallbackStore?.() itself on the rows that should
    // dismiss it, or those rows will silently leave the menu open. Every ButtonContextMenu body in
    // the app complies today (18 are MenuOption-based; GoogleDriveAlbumMenu calls the callback
    // directly); number nineteen must too.
    if (menuContainer?.contains(target)) {
      return;
    }

    closeDropdown();
  };

  const focusButton = () => {
    const button = buttonContainer?.querySelector(`#${buttonId}`) as HTMLButtonElement | null;
    button?.focus();
  };

  $effect(() => {
    if (isOpen) {
      $optionClickCallbackStore = handleOptionClick;
    }
  });
</script>

<svelte:window onresize={onResize} />
<svelte:document onclick={handleDocumentClick} />

<div
  use:contextMenuNavigation={{
    closeDropdown,
    container: menuContainer,
    isOpen,
    onEscape,
    openDropdown,
    selectedId: $selectedIdStore,
    selectionChanged: (id) => ($selectedIdStore = id),
  }}
  onresize={onResize}
  {...restProps}
>
  <div bind:this={buttonContainer}>
    <IconButton
      {color}
      {icon}
      {size}
      shape="round"
      {variant}
      aria-label={title}
      aria-controls={menuId}
      aria-expanded={isOpen}
      aria-haspopup={true}
      class={buttonClass}
      id={buttonId}
      onclick={handleClick}
    />
  </div>
  {#if isOpen || !hideContent}
    <div
      use:shortcuts={[
        {
          shortcut: { key: 'Tab' },
          onShortcut: closeDropdown,
          preventDefault: false,
        },
        {
          shortcut: { key: 'Tab', shift: true },
          onShortcut: closeDropdown,
          preventDefault: false,
        },
      ]}
    >
      <ContextMenu
        {direction}
        ariaActiveDescendant={$selectedIdStore}
        ariaLabelledBy={buttonId}
        bind:menuElement={menuContainer}
        id={menuId}
        isVisible={isOpen}
        x={contextMenuPosition.x - (offset?.x ?? 0)}
        y={contextMenuPosition.y + (offset?.y ?? 0)}
      >
        {@render children?.()}
      </ContextMenu>
    </div>
  {/if}
</div>
