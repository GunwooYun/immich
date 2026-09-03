/**
 * Where a context menu should sit, given its own size and the viewport.
 *
 * Extracted from ContextMenu.svelte so it can be tested. The component used to compute this inline
 * inside a `$derived`, reading `getBoundingClientRect()` and `clientHeight` directly — and element
 * geometry is not reactive, so the block never re-ran when a menu's *contents* changed size. A menu
 * that loads asynchronously (the Google Drive album menu opens as a one-row "Loading" box and then
 * grows) kept the coordinates computed for the small box, so it overflowed the right edge. The
 * component now feeds observed sizes in here instead.
 *
 * The toolbar overlap that was reported alongside the clipping is NOT this: `top` is monotonically
 * non-increasing in height, so a more accurate height moves a menu up, never down. That symptom
 * came from the anchor — ButtonContextMenu's default align="top-left" anchors at the button's top
 * edge — and was fixed at the call site.
 */
export type MenuPositionInput = {
  /** Anchor point, viewport coordinates. */
  x: number;
  y: number;
  /** The menu's own size. */
  width: number;
  height: number;
  windowInnerWidth: number;
  windowInnerHeight: number;
  /** 'left' anchors the menu's right edge to `x`, matching the existing prop. */
  direction: 'left' | 'right';
};

export type MenuPosition = {
  left: number;
  top: number;
  maxHeight: number;
  needScrollBar: boolean;
};

/** Distance kept from the viewport edges. */
export const MENU_VIEWPORT_MARGIN = 8;

export const computeMenuPosition = ({
  x,
  y,
  width,
  height,
  windowInnerWidth,
  windowInnerHeight,
  direction,
}: MenuPositionInput): MenuPosition => {
  const margin = MENU_VIEWPORT_MARGIN;
  const directionWidth = direction === 'left' ? width : 0;

  const left = Math.max(margin, Math.min(windowInnerWidth - width - margin, x - directionWidth));
  const top = Math.max(margin, Math.min(windowInnerHeight - height, y));
  const maxHeight = windowInnerHeight - top - margin;

  return { left, top, maxHeight, needScrollBar: height > maxHeight };
};
