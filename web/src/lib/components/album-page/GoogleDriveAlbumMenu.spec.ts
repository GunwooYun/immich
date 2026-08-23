import '@testing-library/jest-dom';
import { optionClickCallbackStore } from '$lib/stores/context-menu.store';
import { fireEvent, render } from '@testing-library/svelte';
import { renderWithTooltips } from '$tests/helpers';
import userEvent from '@testing-library/user-event';
import { init, register, waitLocale } from 'svelte-i18n';
import GoogleDriveAlbumMenu from './GoogleDriveAlbumMenu.svelte';
import DriveMenuHarness from './__tests__/DriveMenuHarness.svelte';

// Regression tests for the Wave 5 review (W1/W2/W4) and its fixes round. These render the menu's
// own rows and assert the contract it must satisfy to live inside ButtonContextMenu's <ul role=menu>
// keyboard navigation: every row is an <li> with an id and a menu role; the toggle keeps the menu
// open (does NOT invoke the close callback) while action rows close it; the guards actually guard.
// The end-to-end "menu stays open / keyboard walks the rows" behaviour is covered against the real
// ButtonContextMenu in ButtonContextMenu.spec.ts — this file pins the component's half of it.

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

const baseProps = {
  loading: false,
  connected: true,
  backedUp: true,
  togglePending: false,
  uploaded: 3,
  total: 10,
  storage: { limitBytes: 100, usageBytes: 96, usageInDriveTrashBytes: 0 },
  folderId: 'folder-1',
  onToggle: vi.fn(),
  onSyncNow: vi.fn(),
};

const renderMenu = (overrides: Partial<typeof baseProps> = {}) =>
  render(GoogleDriveAlbumMenu, { ...baseProps, ...overrides, onToggle: vi.fn(), onSyncNow: vi.fn() });

describe('GoogleDriveAlbumMenu', () => {
  let closeCallback: ReturnType<typeof vi.fn<() => void>>;

  beforeAll(async () => {
    await init({ fallbackLocale: 'en-US' });
    register('en-US', () => import('$i18n/en.json'));
    await waitLocale('en-US');
  });

  beforeEach(() => {
    // ButtonContextMenu registers this while open; MenuOption-style rows dismiss the menu by
    // calling it. Stub it so we can assert *which* rows close the menu and which stay open.
    closeCallback = vi.fn<() => void>();
    optionClickCallbackStore.set(closeCallback);
    vi.stubGlobal('open', vi.fn());
  });

  afterEach(() => {
    optionClickCallbackStore.set(undefined);
    vi.unstubAllGlobals();
  });

  it('renders every row as an <li> with an id and a menu role (the nav contract)', () => {
    const { getByRole, getAllByRole } = renderMenu();
    // toggle + sync + storage + open = 1 checkbox + 3 menuitem
    const rows = [getByRole('menuitemcheckbox'), ...getAllByRole('menuitem')];
    expect(rows).toHaveLength(4);
    for (const row of rows) {
      expect(row.tagName).toBe('LI');
      expect(row.id).toBeTruthy();
    }
    expect(getByRole('menuitemcheckbox')).toHaveAttribute('aria-checked', 'true');
  });

  it('fires onToggle exactly once per click — the Switch is display-only, no double-fire', async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    const { getByRole } = render(GoogleDriveAlbumMenu, { ...baseProps, onToggle, onSyncNow: vi.fn() });
    await user.click(getByRole('menuitemcheckbox'));
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(closeCallback).not.toHaveBeenCalled(); // W1: toggle must NOT close the menu
  });

  it('does not toggle while a toggle is pending', async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    const { getByRole } = render(GoogleDriveAlbumMenu, {
      ...baseProps,
      togglePending: true,
      onToggle,
      onSyncNow: vi.fn(),
    });
    await user.click(getByRole('menuitemcheckbox'));
    expect(onToggle).not.toHaveBeenCalled();
  });

  it('syncs and closes the menu when there is pending work', async () => {
    const user = userEvent.setup();
    const onSyncNow = vi.fn();
    const { getByText, getAllByRole } = render(GoogleDriveAlbumMenu, {
      ...baseProps,
      uploaded: 3,
      total: 10,
      onToggle: vi.fn(),
      onSyncNow,
    });
    expect(getByText('Sync to Google Drive')).toBeInTheDocument();
    // menuitem order after the checkbox: [sync, storage, open]
    await user.click(getAllByRole('menuitem')[0]);
    expect(onSyncNow).toHaveBeenCalledTimes(1);
    expect(closeCallback).toHaveBeenCalledTimes(1); // action rows close, MenuOption-style
  });

  it('does not sync when nothing is pending (disabled row)', async () => {
    const user = userEvent.setup();
    const onSyncNow = vi.fn();
    const { getByText, getAllByRole } = render(GoogleDriveAlbumMenu, {
      ...baseProps,
      uploaded: 10,
      total: 10,
      onToggle: vi.fn(),
      onSyncNow,
    });
    // "all synced" copy is shown, and the row does nothing.
    expect(getByText('All synced')).toBeInTheDocument();
    await user.click(getAllByRole('menuitem')[0]);
    expect(onSyncNow).not.toHaveBeenCalled();
    expect(closeCallback).not.toHaveBeenCalled();
  });

  it('leaves the storage row inert (no callback on click)', async () => {
    const user = userEvent.setup();
    const { getByText, getAllByRole } = renderMenu();
    expect(getByText('Drive storage')).toBeInTheDocument();
    await user.click(getAllByRole('menuitem')[1]); // storage row
    expect(closeCallback).not.toHaveBeenCalled();
  });

  it.each([
    { usageBytes: 96, limitBytes: 100, cls: 'bg-red-500' },
    { usageBytes: 95, limitBytes: 100, cls: 'bg-red-500' }, // boundary: >= 0.95
    { usageBytes: 85, limitBytes: 100, cls: 'bg-yellow-500' },
    { usageBytes: 80, limitBytes: 100, cls: 'bg-yellow-500' }, // boundary: >= 0.80
    { usageBytes: 50, limitBytes: 100, cls: 'bg-primary' },
  ])('colours the storage bar $cls at usage $usageBytes/$limitBytes', ({ usageBytes, limitBytes, cls }) => {
    const { container } = render(GoogleDriveAlbumMenu, {
      ...baseProps,
      storage: { limitBytes, usageBytes, usageInDriveTrashBytes: 0 },
      onToggle: vi.fn(),
      onSyncNow: vi.fn(),
    });
    expect(container.querySelector(`.${cls}`)).not.toBeNull();
  });

  it('shows the connect row (not the controls) for a member who has not connected Drive', () => {
    const { getByText, queryByRole } = render(GoogleDriveAlbumMenu, {
      ...baseProps,
      connected: false,
      onToggle: vi.fn(),
      onSyncNow: vi.fn(),
    });
    expect(getByText('Connect to Google Drive')).toBeInTheDocument();
    expect(queryByRole('menuitemcheckbox')).toBeNull();
  });

  it('shows only a loading row while loading', () => {
    const { getByText, queryByRole } = render(GoogleDriveAlbumMenu, {
      ...baseProps,
      loading: true,
      onToggle: vi.fn(),
      onSyncNow: vi.fn(),
    });
    expect(getByText('Loading')).toBeInTheDocument();
    expect(queryByRole('menuitemcheckbox')).toBeNull();
  });

  // R4: the two split specs each test one half against a stub. W1/W2/W3 were all found in the
  // composition — the real menu inside the real ButtonContextMenu with hideContent — so drive that
  // composition end-to-end with the real optionClickCallbackStore wiring (no stub).
  describe('inside the real ButtonContextMenu (composition)', () => {
    const open = async (user: ReturnType<typeof userEvent.setup>, getByLabelText: (t: string) => HTMLElement) => {
      await user.click(getByLabelText('drive'));
    };

    it('focuses the menu, navigates by keyboard, keeps open on toggle, closes on sync', async () => {
      const user = userEvent.setup();
      const onToggle = vi.fn<() => void>();
      const onSyncNow = vi.fn<() => void>();
      const { getByLabelText, getByRole, getByText, findByRole, queryByRole } = renderWithTooltips(DriveMenuHarness, {
        onToggle,
        onSyncNow,
      });

      await open(user, getByLabelText);
      const menu = await findByRole('menu');
      // F1 end-to-end: focus lands on the <ul>, not the trigger.
      await vi.waitFor(() => expect(menu).toHaveFocus());

      // W2 end-to-end: ArrowDown advances aria-activedescendant through real rows.
      await fireEvent.keyDown(getByLabelText('drive').closest('[data-testid="ctx"]') as HTMLElement, {
        key: 'ArrowDown',
      });
      await vi.waitFor(() => expect(menu.getAttribute('aria-activedescendant')).toMatch(/.+/));

      // W1 end-to-end: flipping the toggle fires onToggle and leaves the menu open (real callback).
      await user.click(getByRole('menuitemcheckbox'));
      expect(onToggle).toHaveBeenCalledTimes(1);
      expect(queryByRole('menu')).toBeInTheDocument();

      // Sync row closes the menu via the real optionClickCallbackStore.
      await user.click(getByText('Sync to Google Drive'));
      expect(onSyncNow).toHaveBeenCalledTimes(1);
      expect(queryByRole('menu')).not.toBeInTheDocument();
    });
  });
});
