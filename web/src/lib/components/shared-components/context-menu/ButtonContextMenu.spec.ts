import '@testing-library/jest-dom';
import { fireEvent } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { init, register, waitLocale } from 'svelte-i18n';
import { renderWithTooltips } from '$tests/helpers';
import ContextMenuHarness from './__tests__/ContextMenuHarness.svelte';

// Regression tests for the Wave 5 fixes round on the shared ButtonContextMenu:
//   W1 — a MenuOption click closes the menu; a non-MenuOption body click does NOT.
//   W3 — hideContent removes the menu body (and its tab stops) while closed.
//   F1 — with hideContent, focus lands on the <ul role=menu> after open, not the trigger.
//   F2 — onOpen fires once per genuine open, not on every arrow keypress.
// None of these were covered before; all four can silently regress on an upstream merge that
// touches ButtonContextMenu or MenuOption.

const openMenu = async (user: ReturnType<typeof userEvent.setup>, getByLabelText: (t: string) => HTMLElement) => {
  await user.click(getByLabelText('menu'));
};

describe('ButtonContextMenu', () => {
  beforeAll(async () => {
    await init({ fallbackLocale: 'en-US' });
    register('en-US', () => import('$i18n/en.json'));
    await waitLocale('en-US');
  });

  it('W1: a MenuOption click closes the menu', async () => {
    const user = userEvent.setup();
    const { getByLabelText, getByText, queryByRole } = renderWithTooltips(ContextMenuHarness, {
      mode: 'menuoption' as const,
      hideContent: true,
    });
    await openMenu(user, getByLabelText);
    expect(queryByRole('menu')).toBeInTheDocument();

    await user.click(getByText('Option'));
    expect(queryByRole('menu')).not.toBeInTheDocument(); // closed via optionClickCallbackStore
  });

  it('W1: a non-MenuOption body click leaves the menu open (the guard)', async () => {
    // This is the assertion that would FAIL before the handleDocumentClick guard: the document
    // click handler would close the menu on any in-body click that is not the trigger.
    const user = userEvent.setup();
    const onPlainClick = vi.fn<() => void>();
    const { getByLabelText, getByTestId, queryByRole } = renderWithTooltips(ContextMenuHarness, {
      mode: 'plain' as const,
      hideContent: true,
      onPlainClick,
    });
    await openMenu(user, getByLabelText);
    expect(queryByRole('menu')).toBeInTheDocument();

    await user.click(getByTestId('plain-btn'));
    expect(onPlainClick).toHaveBeenCalledTimes(1);
    expect(queryByRole('menu')).toBeInTheDocument(); // still open — the whole point of W1
  });

  it('W1: an outside click still closes the menu', async () => {
    const user = userEvent.setup();
    const { getByLabelText, queryByRole } = renderWithTooltips(ContextMenuHarness, {
      mode: 'plain' as const,
      hideContent: true,
    });
    await openMenu(user, getByLabelText);
    expect(queryByRole('menu')).toBeInTheDocument();

    await user.click(document.body);
    expect(queryByRole('menu')).not.toBeInTheDocument();
  });

  it('W3: hideContent keeps the menu body (and its tab stops) out of the DOM while closed', async () => {
    const user = userEvent.setup();
    const { getByLabelText, queryByRole } = renderWithTooltips(ContextMenuHarness, {
      mode: 'menuoption' as const,
      hideContent: true,
    });
    // Closed: no menu at all.
    expect(queryByRole('menu')).not.toBeInTheDocument();
    expect(queryByRole('menuitem')).not.toBeInTheDocument();

    await openMenu(user, getByLabelText);
    expect(queryByRole('menu')).toBeInTheDocument();
    expect(queryByRole('menuitem')).toBeInTheDocument();
  });

  it('F1: with hideContent, focus lands on the menu after opening (not the trigger)', async () => {
    const user = userEvent.setup();
    const { getByLabelText, findByRole } = renderWithTooltips(ContextMenuHarness, {
      mode: 'menuoption' as const,
      hideContent: true,
    });
    await openMenu(user, getByLabelText);
    const menu = await findByRole('menu');
    // openDropdown defers focus via tick() because the <ul> is not mounted synchronously under
    // hideContent; without that fix activeElement would be the trigger button.
    await vi.waitFor(() => expect(menu).toHaveFocus());
  });

  it('R1: a close before the deferred focus fires does not strand focus on the menu (no hideContent)', async () => {
    // Without hideContent the <ul> stays mounted (max-height:0) when closed, so a deferred focus
    // that runs after closeDropdown would land on the invisible menu. Open then close synchronously
    // — the tick()-deferred focus is still pending — and assert the guard skips it.
    const { getByLabelText, queryByRole } = renderWithTooltips(ContextMenuHarness, {
      mode: 'menuoption' as const,
      hideContent: false,
    });
    const trigger = getByLabelText('menu');
    trigger.click(); // open  (schedules the deferred focus)
    trigger.click(); // close (focusButton runs; isOpen is now false)
    await new Promise((resolve) => setTimeout(resolve, 0)); // drain the microtask

    const menu = queryByRole('menu'); // present-but-collapsed under hideContent:false
    expect(menu).not.toBeNull();
    // Pin why the negative passes (CLAUDE.md §4): not just "focus isn't on the menu" — focus went
    // back to the trigger, where closeDropdown's focusButton() put it. Without that, a broken
    // focusButton() dropping focus to <body> would also satisfy `not.toHaveFocus()`.
    expect(menu).not.toHaveFocus();
    expect(trigger).toHaveFocus();
    // The menu being closed is self-correcting here: if a regression left it open, the deferred
    // focus would legitimately fire and this test would fail on the assertion above.
  });

  it('F2: onOpen fires once per open, not on every arrow keypress', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn<() => void>();
    const { getByLabelText, getByTestId, findByRole } = renderWithTooltips(ContextMenuHarness, {
      mode: 'menuoption' as const,
      hideContent: true,
      onOpen,
    });
    await openMenu(user, getByLabelText);
    expect(onOpen).toHaveBeenCalledTimes(1);

    // contextMenuNavigation opens-then-moves on every arrow; before the wasOpen guard this re-ran
    // onOpen (for the Drive menu: three HTTP requests, one to Google) on each keystroke.
    const wrapper = getByTestId('ctx');
    for (let i = 0; i < 5; i++) {
      await fireEvent.keyDown(wrapper, { key: 'ArrowDown' });
    }
    expect(onOpen).toHaveBeenCalledTimes(1);

    // R5: pin the negative assertion so it cannot pass for the wrong reason. If the arrow presses
    // ever stopped reaching moveSelection, "onOpen still 1" would pass vacuously — so prove the
    // navigation genuinely ran by checking the selection actually advanced (CLAUDE.md §4).
    const menu = await findByRole('menu');
    expect(menu.getAttribute('aria-activedescendant')).toMatch(/.+/);
  });
});
