<script lang="ts">
  import { clickOutside } from '$lib/actions/click-outside';
  import { computeMenuPosition } from '$lib/components/shared-components/context-menu/context-menu-position';
  import { languageManager } from '$lib/managers/language-manager.svelte';
  import type { Snippet } from 'svelte';

  interface Props {
    isVisible?: boolean;
    direction?: 'left' | 'right';
    x?: number;
    y?: number;
    id?: string | undefined;
    ariaLabel?: string | undefined;
    ariaLabelledBy?: string | undefined;
    ariaActiveDescendant?: string | undefined;
    menuScrollView?: HTMLDivElement | undefined;
    menuElement?: HTMLUListElement | undefined;
    onClose?: (() => void) | undefined;
    children?: Snippet;
  }

  let {
    isVisible = false,
    direction = 'right',
    x = 0,
    y = 0,
    id = undefined,
    ariaLabel = undefined,
    ariaLabelledBy = undefined,
    ariaActiveDescendant = undefined,
    menuScrollView = $bindable(),
    menuElement = $bindable(),
    onClose = undefined,
    children,
  }: Props = $props();

  const swap = (direction: string) => (direction === 'left' ? 'right' : 'left');

  const layoutDirection = $derived(languageManager.rtl ? swap(direction) : direction);
  // Annotated because the two branches differ: before the element refs bind there is nothing to
  // measure, and that branch deliberately leaves maxHeight/needScrollBar unset so the template
  // applies no height constraint for that one frame — the behaviour this component already had.
  // Without the annotation the union makes both properties unreadable in the markup.
  const position: { left: number; top: number; maxHeight?: number; needScrollBar?: boolean } = $derived.by(() => {
    if (!menuScrollView || !menuElement) {
      return { left: 0, top: 0 };
    }

    // The observed size is preferred over reading the DOM here, and the reason is the bug this
    // fixes: a `$derived` re-runs when something *reactive* changes — x, y, the window size, the
    // element refs — and element geometry is none of those. A menu whose contents arrive
    // asynchronously kept the coordinates computed for its first frame. The Google Drive album
    // menu opens as a one-row "Loading" box and then grows to five rows plus a footer, so it was
    // placed as if it were still that small box: overflowing the right edge, and its top riding up
    // over the toolbar. The direct reads remain as the fallback for the very first frame, before
    // the observer has reported.
    return computeMenuPosition({
      x,
      y,
      width: observedWidth || menuScrollView.getBoundingClientRect().width,
      height: observedHeight || menuElement.clientHeight,
      windowInnerWidth,
      windowInnerHeight,
      direction: layoutDirection,
    });
  });

  // Bound below with Svelte's own size bindings rather than a hand-rolled ResizeObserver. Svelte
  // routes every such binding through one shared ResizeObserverSingleton, so this costs one
  // observer for the whole app instead of one per menu — and there are many menus mounted at once.
  // offsetWidth, not clientWidth: it includes the scrollbar, matching the getBoundingClientRect()
  // width this used to read.
  let observedWidth: number = $state(0);
  let observedHeight: number = $state(0);

  let windowInnerHeight: number = $state(0);
  let windowInnerWidth: number = $state(0);
</script>

<svelte:window bind:innerWidth={windowInnerWidth} bind:innerHeight={windowInnerHeight} />

<div
  bind:this={menuScrollView}
  bind:offsetWidth={observedWidth}
  class={[
    'fixed z-70 w-max max-w-75 min-w-50 immich-scrollbar rounded-lg bg-slate-100 shadow-lg duration-250 ease-in-out',
    position.needScrollBar ? 'overflow-auto' : 'overflow-hidden',
  ]}
  style:left="{position.left}px"
  style:top="{position.top}px"
  style:max-height={isVisible ? `${position.maxHeight}px` : '0px'}
  style:transition-property="max-height"
  style:scrollbar-color="rgba(85, 86, 87, 0.408) transparent"
  use:clickOutside={{ onOutclick: onClose }}
  tabindex="-1"
>
  <ul
    {id}
    aria-activedescendant={ariaActiveDescendant ?? ''}
    aria-label={ariaLabel}
    aria-labelledby={ariaLabelledBy}
    bind:this={menuElement}
    bind:clientHeight={observedHeight}
    class="flex flex-col outline-none"
    role="menu"
    tabindex="-1"
  >
    {@render children?.()}
  </ul>
</div>
