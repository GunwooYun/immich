import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { AlbumUserRole, JobName, JobStatus } from 'src/enum';
import { GoogleDriveService } from 'src/services/google-drive.service';
import { AlbumFactory } from 'test/factories/album.factory';
import { AuthFactory } from 'test/factories/auth.factory';
import { UserFactory } from 'test/factories/user.factory';
import { getForAlbum } from 'test/mappers';
import { newUuid } from 'test/small.factory';
import { newTestService, ServiceMocks } from 'test/utils';

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
    it('should skip when the user has not connected Google Drive', async () => {
      const userId = newUuid();
      mocks.googleDrive.getCredentials.mockResolvedValue(void 0);

      await expect(sut.uploadAsset(userId, newUuid())).resolves.toBe('skipped');

      // Bailing out before touching the asset row is the point: no work, no Google API call.
      expect(mocks.asset.getById).not.toHaveBeenCalled();
      expect(mocks.googleDrive.recordUpload).not.toHaveBeenCalled();
    });

    it('should skip an asset that is already in the upload ledger', async () => {
      const userId = newUuid();
      const assetId = newUuid();
      mocks.googleDrive.getCredentials.mockResolvedValue({
        userId,
        refreshToken: 'refresh-token',
        folderId: null,
        connectedAt: new Date(),
      });
      mocks.googleDrive.getUploadedAssetIds.mockResolvedValue(new Set([assetId]));

      await expect(sut.uploadAsset(userId, assetId)).resolves.toBe('skipped');

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

      expect(mocks.googleDrive.setFolderId).toHaveBeenCalledWith(userId, 'folder-id');
    });

    it('should translate a blank folder into null', async () => {
      const userId = newUuid();
      mocks.googleDrive.setFolderId.mockResolvedValue(1);

      await sut.setFolderId(userId, '');

      expect(mocks.googleDrive.setFolderId).toHaveBeenCalledWith(userId, null);
    });
  });

  describe('getStatus', () => {
    it('should report a disconnected user', async () => {
      mocks.googleDrive.getCredentials.mockResolvedValue(void 0);

      await expect(sut.getStatus(newUuid())).resolves.toEqual({
        connected: false,
        folderId: null,
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
        connectedAt,
      });

      const status = await sut.getStatus(userId);

      expect(status).toEqual({ connected: true, folderId: 'folder-id', connectedAt });
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
      const album = AlbumFactory.from().asset().asset().asset().build();
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
      const album = AlbumFactory.from().asset().asset().build();
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
