import { describe, expect, it } from 'vitest';
import {
  computeMenuPosition,
  MENU_VIEWPORT_MARGIN,
} from '$lib/components/shared-components/context-menu/context-menu-position';

describe('computeMenuPosition', () => {
  const viewport = { windowInnerWidth: 1000, windowInnerHeight: 800 };

  it('should place the menu at the anchor when it fits', () => {
    const { left, top } = computeMenuPosition({
      ...viewport,
      x: 300,
      y: 200,
      width: 200,
      height: 150,
      direction: 'right',
    });

    expect(left).toBe(300);
    expect(top).toBe(200);
  });

  it('should pull the menu back inside the right edge instead of letting it overflow', () => {
    // The reported bug: a menu opened near the right edge is clipped. The anchor alone cannot say
    // whether that happens — only the anchor *plus the menu's width* can, which is exactly what the
    // component failed to keep up to date while the menu was still growing.
    const { left } = computeMenuPosition({ ...viewport, x: 950, y: 100, width: 300, height: 150, direction: 'right' });

    expect(left).toBe(viewport.windowInnerWidth - 300 - MENU_VIEWPORT_MARGIN);
  });

  it('should widen its correction as the menu grows, which is the case that regressed', () => {
    // Same anchor, two sizes: the small "Loading" box and the loaded menu. If the position were
    // computed once against the small box and reused — the bug — these two would be equal.
    const anchor = { ...viewport, x: 900, y: 100, height: 150, direction: 'right' as const };

    const whileLoading = computeMenuPosition({ ...anchor, width: 120 });
    const afterLoading = computeMenuPosition({ ...anchor, width: 320 });

    expect(whileLoading.left).toBe(872);
    expect(afterLoading.left).toBe(672);
    expect(afterLoading.left).toBeLessThan(whileLoading.left);
  });

  it('should lift a tall menu up so its bottom stays on screen', () => {
    // Not the reported toolbar overlap — that came from the anchor, and `top` moves a taller menu
    // *up*, never down. What this pins is the lift itself: a menu tall enough to run off the bottom
    // is raised so its end stays on screen.
    const shortBox = computeMenuPosition({ ...viewport, x: 100, y: 700, width: 200, height: 40, direction: 'right' });
    const grown = computeMenuPosition({ ...viewport, x: 100, y: 700, width: 200, height: 400, direction: 'right' });

    expect(shortBox.top).toBe(700);
    expect(grown.top).toBe(400);
  });

  it('should never place the menu outside the top-left margin', () => {
    const { left, top } = computeMenuPosition({
      windowInnerWidth: 100,
      windowInnerHeight: 100,
      x: 0,
      y: 0,
      width: 400,
      height: 400,
      direction: 'right',
    });

    expect(left).toBe(MENU_VIEWPORT_MARGIN);
    expect(top).toBe(MENU_VIEWPORT_MARGIN);
  });

  it('should anchor the right edge to x when the direction is left', () => {
    const { left } = computeMenuPosition({ ...viewport, x: 500, y: 100, width: 200, height: 150, direction: 'left' });

    expect(left).toBe(300);
  });

  it('should ask for a scrollbar only when the menu is taller than the room below it', () => {
    const fits = computeMenuPosition({ ...viewport, x: 100, y: 100, width: 200, height: 300, direction: 'right' });
    const tooTall = computeMenuPosition({ ...viewport, x: 100, y: 700, width: 200, height: 795, direction: 'right' });

    expect(fits.needScrollBar).toBe(false);
    expect(tooTall.needScrollBar).toBe(true);
    // Non-vacuous: the tall case must really have been lifted to the top margin, so the assertion
    // is about the height/room relation rather than about an accidental y.
    expect(tooTall.top).toBe(MENU_VIEWPORT_MARGIN);
  });
});
