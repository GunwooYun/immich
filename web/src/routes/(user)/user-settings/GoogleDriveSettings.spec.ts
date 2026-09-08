import '@testing-library/jest-dom';
import { render, screen, waitFor } from '@testing-library/svelte';
import { init, register, waitLocale } from 'svelte-i18n';
import GoogleDriveSettings from './GoogleDriveSettings.svelte';

// The settings panel's folder card. What it renders is a four-way branch — named folder, folder
// whose name could not be read, no folder, and a deployment without the Google Picker — and each
// branch was chosen for a reason that is easy to undo by accident:
//
//   - showing a 33-character Drive id where a name belongs tells the user nothing they can act on,
//     which is what it did for three weeks;
//   - but when the name genuinely cannot be read, the id is the only thing that lets them compare
//     against Drive, and the name is missing precisely because something is wrong;
//   - and the editable id field must disappear where the picker works (a mistyped id sends uploads
//     somewhere invisible or blocks the account) while remaining the only way to set a folder where
//     the picker cannot open at all.
//
// None of that is expressible in a server test, and all of it is one careless edit away.

const status = vi.hoisted(() => vi.fn());
const albums = vi.hoisted(() => vi.fn());

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('@immich/sdk', () => ({
  getGoogleDriveStatus: () => status(),
  getGoogleDriveAlbums: () => albums(),
  disconnectGoogleDrive: vi.fn(),
  getGoogleDriveAuthUrl: vi.fn(),
  getGoogleDrivePickerConfig: vi.fn(),
  resumeGoogleDriveUploads: vi.fn(),
  setGoogleDriveFolder: vi.fn(),
  subscribeGoogleDriveAlbum: vi.fn(),
  unsubscribeGoogleDriveAlbum: vi.fn(),
}));

const connected = (overrides: Record<string, unknown> = {}) => ({
  connected: true,
  connectedAt: new Date('2026-09-01T00:00:00Z').toISOString(),
  folderId: 'folder-abc123',
  folderName: 'ToPixel',
  failedCount: 0,
  blockedReason: null,
  pickerAvailable: true,
  ...overrides,
});

describe('GoogleDriveSettings', () => {
  beforeAll(async () => {
    await init({ fallbackLocale: 'en-US' });
    register('en-US', () => import('$i18n/en.json'));
    await waitLocale('en-US');
  });

  beforeEach(() => {
    status.mockReset();
    albums.mockReset();
    albums.mockResolvedValue([]);
  });

  it('should show the folder name and not its id', async () => {
    status.mockResolvedValue(connected());

    render(GoogleDriveSettings);

    expect(await screen.findByText('ToPixel')).toBeInTheDocument();
    expect(screen.queryByText('folder-abc123')).not.toBeInTheDocument();
  });

  it('should link the folder to Google Drive', async () => {
    // A destination you cannot look at is one you have to take on trust.
    status.mockResolvedValue(connected());

    render(GoogleDriveSettings);

    const link = await screen.findByRole('link', { name: /ToPixel/ });
    expect(link).toHaveAttribute('href', 'https://drive.google.com/drive/folders/folder-abc123');
  });

  it('should fall back to the id only when the name could not be read', async () => {
    status.mockResolvedValue(connected({ folderName: null }));

    render(GoogleDriveSettings);

    expect(await screen.findByText('Selected folder')).toBeInTheDocument();
    // Here the id earns its place: the name is absent because something is wrong, and this is the
    // only handle the user has for comparing against Drive.
    expect(screen.getByText('folder-abc123')).toBeInTheDocument();
  });

  it('should say uploads go to the root when no folder is set', async () => {
    status.mockResolvedValue(connected({ folderId: '', folderName: null }));

    render(GoogleDriveSettings);

    expect(await screen.findByText(/root of My Drive/)).toBeInTheDocument();
  });

  it('should not offer an editable folder id where the picker works', async () => {
    // The field is a paste target for a string nobody can verify by eye. Where the picker exists it
    // is strictly worse than the picker, and its failure mode is a blocked account.
    status.mockResolvedValue(connected());

    render(GoogleDriveSettings);

    await screen.findByText('ToPixel');
    // Queried by the visible label text rather than by label association: SettingInputField does
    // not associate its <label> with its <input>, so getByLabelText throws and queryByLabelText
    // returns null whether or not the field is on screen — an absence assertion written that way
    // passes for the wrong reason. The test below proves this query can see the field.
    expect(screen.queryByText('Target folder ID')).not.toBeInTheDocument();
  });

  it('should keep the folder id field where the picker cannot open', async () => {
    // No API key on the deployment means no picker, and then this is the only way to set a folder
    // at all — removing it outright would strand those installs.
    status.mockResolvedValue(connected({ pickerAvailable: false }));

    render(GoogleDriveSettings);

    await waitFor(() => expect(screen.getByText('Target folder ID')).toBeInTheDocument());
  });
});
