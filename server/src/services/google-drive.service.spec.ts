import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { AlbumUserRole, JobName, JobStatus } from 'src/enum';
import { GoogleDriveService } from 'src/services/google-drive.service';
import { AlbumFactory } from 'test/factories/album.factory';
import { AuthFactory } from 'test/factories/auth.factory';
import { UserFactory } from 'test/factories/user.factory';
import { getForAlbum } from 'test/mappers';
import { newUuid } from 'test/small.factory';
import { newTestService, ServiceMocks } from 'test/utils';

/**
 * A fully configured, switched-on Google Drive system config.
 *
 * The default config has the feature *off*, which is the right default for the product but a trap
 * in tests: every path in this service checks `isEnabled()` first, so a test that forgets to stub
 * the config gets 'skipped' back for the wrong reason and passes while proving nothing. Tests that
 * care about behaviour past that first gate stub this in explicitly.
 */
const enabledConfig = {
  enabled: true,
  clientId: 'client-id',
  clientSecret: 'client-secret',
  redirectUrl: 'http://localhost:2283/api/google-drive/callback',
  apiKey: '',
};

describe(GoogleDriveService.name, () => {
  let sut: GoogleDriveService;
  let mocks: ServiceMocks;

  beforeEach(() => {
    ({ sut, mocks } = newTestService(GoogleDriveService));
  });

  it('should work', () => {
    expect(sut).toBeDefined();
  });

  describe('uploadAsset', () => {
    // These are the two "expected, everyday" no-op paths. They matter because uploadAsset runs from a
    // background job that fires on *every* add-to-album, for every user — throwing here instead of
    // skipping would bury the job queue in permanent failures for the majority of users who have
    // never connected Google Drive at all.
    it('should skip when the feature is disabled', async () => {
      // The default config has it off, so no stubbing needed here — this is the state a job queued
      // before an admin switched the feature off would run in.
      await expect(sut.uploadAsset(newUuid(), newUuid())).resolves.toBe('skipped');

      expect(mocks.googleDrive.getCredentials).not.toHaveBeenCalled();
    });

    it('should skip when the user has not connected Google Drive', async () => {
      const userId = newUuid();
      mocks.systemMetadata.get.mockResolvedValue({ googleDrive: enabledConfig });
      mocks.googleDrive.getCredentials.mockResolvedValue(void 0);

      await expect(sut.uploadAsset(userId, newUuid())).resolves.toBe('skipped');

      // Bailing out before touching the asset row is the point: no work, no Google API call.
      expect(mocks.asset.getById).not.toHaveBeenCalled();
      expect(mocks.googleDrive.recordUpload).not.toHaveBeenCalled();
    });

    it('should skip an asset that is already in the upload ledger', async () => {
      const userId = newUuid();
      const assetId = newUuid();
      mocks.systemMetadata.get.mockResolvedValue({ googleDrive: enabledConfig });
      mocks.googleDrive.getCredentials.mockResolvedValue({
        userId,
        refreshToken: 'refresh-token',
        folderId: null,
        folderName: null,
        connectedAt: new Date(),
      });
      mocks.googleDrive.hasUpload.mockResolvedValue(true);

      await expect(sut.uploadAsset(userId, assetId)).resolves.toBe('skipped');

      expect(mocks.googleDrive.hasUpload).toHaveBeenCalledWith(userId, assetId);
      // Bailing out before the asset row is loaded is what makes this cheap — asserting it also
      // stops this test from passing for the wrong reason, since an automocked getById returns
      // undefined and would produce a 'skipped' result all on its own.
      expect(mocks.asset.getById).not.toHaveBeenCalled();
      expect(mocks.googleDrive.recordUpload).not.toHaveBeenCalled();
    });
  });

  describe('handleGoogleDriveUpload', () => {
    // The job handler must distinguish "nothing needed doing" from "work happened", so the admin Jobs
    // panel doesn't report a pile of no-ops as successful uploads.
    it('should report a skipped upload as JobStatus.Skipped', async () => {
      mocks.googleDrive.getCredentials.mockResolvedValue(void 0);

      await expect(sut.handleGoogleDriveUpload({ userId: newUuid(), assetId: newUuid() })).resolves.toBe(
        JobStatus.Skipped,
      );
    });
  });

  describe('setFolderId', () => {
    it('should reject when the user has not connected Google Drive', async () => {
      // No credentials row means no row to attach the folder to. Failing loudly stops the setting
      // from silently evaporating and leaving the user wondering why uploads land elsewhere.
      mocks.googleDrive.setFolderId.mockResolvedValue(0);

      await expect(sut.setFolderId(newUuid(), 'folder-id')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('should save the folder for a connected user', async () => {
      const userId = newUuid();
      mocks.googleDrive.setFolderId.mockResolvedValue(1);

      await expect(sut.setFolderId(userId, 'folder-id')).resolves.toBeUndefined();

      // No name passed: the manual paste-an-id path genuinely doesn't know one.
      expect(mocks.googleDrive.setFolderId).toHaveBeenCalledWith(userId, 'folder-id', null);
    });

    it('should save the folder name when the picker supplies one', async () => {
      const userId = newUuid();
      mocks.googleDrive.setFolderId.mockResolvedValue(1);

      await sut.setFolderId(userId, 'folder-id', 'Holiday photos');

      expect(mocks.googleDrive.setFolderId).toHaveBeenCalledWith(userId, 'folder-id', 'Holiday photos');
    });

    it('should translate a blank folder into null', async () => {
      const userId = newUuid();
      mocks.googleDrive.setFolderId.mockResolvedValue(1);

      await sut.setFolderId(userId, '');

      expect(mocks.googleDrive.setFolderId).toHaveBeenCalledWith(userId, null, null);
    });

    it('should not keep a folder name when the folder itself is cleared', async () => {
      // Otherwise clearing the destination would leave the settings page confidently naming a
      // folder that nothing is being uploaded to any more.
      const userId = newUuid();
      mocks.googleDrive.setFolderId.mockResolvedValue(1);

      await sut.setFolderId(userId, '', 'Holiday photos');

      expect(mocks.googleDrive.setFolderId).toHaveBeenCalledWith(userId, null, null);
    });
  });

  describe('getPickerConfig', () => {
    // This endpoint hands a live Drive access token to the browser, so the guards in front of it
    // matter more than usual — each of these is a case where it must refuse rather than mint one.
    it('should reject when no API key is configured', async () => {
      // Without a developer key the Picker cannot open at all, so producing a token would be
      // handing out credentials for a dialog that is guaranteed to fail.
      mocks.systemMetadata.get.mockResolvedValue({ googleDrive: enabledConfig });

      await expect(sut.getPickerConfig(newUuid())).rejects.toBeInstanceOf(BadRequestException);
      expect(mocks.googleDrive.getCredentials).not.toHaveBeenCalled();
    });

    it('should reject when the user has not connected Google Drive', async () => {
      mocks.systemMetadata.get.mockResolvedValue({ googleDrive: { ...enabledConfig, apiKey: 'api-key' } });
      mocks.googleDrive.getCredentials.mockResolvedValue(void 0);

      await expect(sut.getPickerConfig(newUuid())).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('getStatus', () => {
    it('should report a disconnected user', async () => {
      mocks.googleDrive.getCredentials.mockResolvedValue(void 0);

      await expect(sut.getStatus(newUuid())).resolves.toEqual({
        connected: false,
        folderId: null,
        folderName: null,
        connectedAt: null,
      });
    });

    it('should report a connected user without leaking the refresh token', async () => {
      const userId = newUuid();
      const connectedAt = new Date();
      mocks.googleDrive.getCredentials.mockResolvedValue({
        userId,
        refreshToken: 'super-secret-refresh-token',
        folderId: 'folder-id',
        folderName: 'Folder name',
        connectedAt,
      });

      const status = await sut.getStatus(userId);

      expect(status).toEqual({ connected: true, folderId: 'folder-id', folderName: 'Folder name', connectedAt });
      // Guard against someone later "simplifying" this into a spread of the credentials row.
      expect(JSON.stringify(status)).not.toContain('super-secret-refresh-token');
    });
  });

  describe('disconnect', () => {
    it('should delete the credentials but keep the upload ledger', async () => {
      const userId = newUuid();

      await sut.disconnect(userId);

      // Only the credentials row is touched. The upload ledger has no deletion method at all on the
      // repository, which is the structural guarantee that a later re-link won't re-upload (and
      // duplicate) everything the user already has in Drive.
      expect(mocks.googleDrive.deleteCredentials).toHaveBeenCalledWith(userId);
    });
  });

  describe('syncAlbum', () => {
    it('should reject a non-owner even when they can read the album', async () => {
      const editor = UserFactory.create();
      const album = AlbumFactory.from().albumUser({ userId: editor.id, role: AlbumUserRole.Editor }).build();
      // AlbumRead is satisfied via shared access, not ownership — exactly the case this guard exists
      // for: the caller legitimately passes the permission check but still must not trigger a sync.
      mocks.access.album.checkSharedAlbumAccess.mockResolvedValue(new Set([album.id]));
      mocks.album.getById.mockResolvedValue(getForAlbum(album));

      // Uploads go to the *owner's* Drive, so anyone but the owner triggering this would be writing
      // into someone else's cloud storage on their behalf.
      await expect(sut.syncAlbum(AuthFactory.create(editor), album.id)).rejects.toBeInstanceOf(ForbiddenException);

      expect(mocks.job.queueAll).not.toHaveBeenCalled();
    });

    it('should queue only assets missing from the ledger, in one batch, for the owner', async () => {
      const album = AlbumFactory.from()
        .asset({}, (builder) => builder.exif())
        .asset({}, (builder) => builder.exif())
        .asset({}, (builder) => builder.exif())
        .build();
      const { user: owner } = album.albumUsers.find(({ role }) => role === AlbumUserRole.Owner)!;
      const [alreadySynced, pending1, pending2] = album.assets;

      mocks.access.album.checkOwnerAccess.mockResolvedValue(new Set([album.id]));
      mocks.album.getById.mockResolvedValue(getForAlbum(album));
      mocks.googleDrive.getUploadedAssetIds.mockResolvedValue(new Set([alreadySynced.id]));

      await sut.syncAlbum(AuthFactory.create(owner), album.id);

      // One queueAll call, not one queue() per asset — large albums shouldn't mean thousands of
      // round trips — and the already-uploaded asset is filtered out before anything is queued.
      expect(mocks.job.queueAll).toHaveBeenCalledTimes(1);
      expect(mocks.job.queueAll).toHaveBeenCalledWith([
        { name: JobName.GoogleDriveUpload, data: { userId: owner.id, assetId: pending1.id } },
        { name: JobName.GoogleDriveUpload, data: { userId: owner.id, assetId: pending2.id } },
      ]);
    });

    it('should not queue anything when every asset is already synced', async () => {
      const album = AlbumFactory.from()
        .asset({}, (builder) => builder.exif())
        .asset({}, (builder) => builder.exif())
        .build();
      const { user: owner } = album.albumUsers.find(({ role }) => role === AlbumUserRole.Owner)!;

      mocks.access.album.checkOwnerAccess.mockResolvedValue(new Set([album.id]));
      mocks.album.getById.mockResolvedValue(getForAlbum(album));
      mocks.googleDrive.getUploadedAssetIds.mockResolvedValue(new Set(album.assets.map(({ id }) => id)));

      await sut.syncAlbum(AuthFactory.create(owner), album.id);

      expect(mocks.job.queueAll).not.toHaveBeenCalled();
    });

    it('should not queue anything for an empty album', async () => {
      const album = AlbumFactory.from().build();
      const { user: owner } = album.albumUsers.find(({ role }) => role === AlbumUserRole.Owner)!;

      mocks.access.album.checkOwnerAccess.mockResolvedValue(new Set([album.id]));
      mocks.album.getById.mockResolvedValue(getForAlbum(album));

      await sut.syncAlbum(AuthFactory.create(owner), album.id);

      expect(mocks.googleDrive.getUploadedAssetIds).not.toHaveBeenCalled();
      expect(mocks.job.queueAll).not.toHaveBeenCalled();
    });
  });
});
