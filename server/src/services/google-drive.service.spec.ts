import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { AlbumUserRole, GoogleDriveUploadErrorClass, JobName, JobStatus } from 'src/enum';
import { GoogleDriveService } from 'src/services/google-drive.service';
import { AlbumFactory } from 'test/factories/album.factory';
import { AssetFactory } from 'test/factories/asset.factory';
import { AuthFactory } from 'test/factories/auth.factory';
import { UserFactory } from 'test/factories/user.factory';
import { getForAlbum, getForAsset } from 'test/mappers';
import { newUuid } from 'test/small.factory';
import { newTestService, ServiceMocks } from 'test/utils';

/**
 * Stand-in for the Google Drive API client.
 *
 * Mocked at the module level because the one behaviour worth testing here — refusing to record a
 * truncated upload — only exists on the far side of a real network call. Everything else in this
 * file bails out well before `drive.files.create` is reached, so nothing else is affected.
 */
const { driveFilesCreate, driveFilesDelete } = vi.hoisted(() => ({
  driveFilesCreate: vi.fn(),
  driveFilesDelete: vi.fn(),
}));

vi.mock('googleapis', () => ({
  google: {
    auth: {
      OAuth2: class {
        setCredentials() {}
        getAccessToken() {
          return { token: 'access-token' };
        }
      },
    },
    drive: () => ({ files: { create: driveFilesCreate, delete: driveFilesDelete } }),
  },
}));

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

// Drives every test below to the same point: connected user, asset present, nothing in the
// ledger, a readable 1024-byte original. Only the size Drive reports back then varies.
const arrangeReadyToUpload = (mocks: ServiceMocks, userId: string) => {
  const asset = AssetFactory.create();
  mocks.systemMetadata.get.mockResolvedValue({ googleDrive: enabledConfig });
  mocks.googleDrive.getCredentials.mockResolvedValue({
    userId,
    refreshToken: 'refresh-token',
    folderId: null,
    folderName: null,
    connectedAt: new Date(),
  });
  mocks.googleDrive.hasUpload.mockResolvedValue(false);
  mocks.asset.getById.mockResolvedValue(getForAsset(asset));
  mocks.storage.createReadStream.mockResolvedValue({
    stream: { destroy: vi.fn() } as never,
    length: 1024,
    type: 'image/jpeg',
  });
  return asset;
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

    it('should skip a blocked user without touching the asset or calling Drive', async () => {
      // Account-level block (Drive full / folder gone): every upload is doomed identically, so
      // the gate turns a queue full of this user's jobs into cheap skips. This is the difference
      // between 1 and N quota-discovery calls when quota hits mid-backfill (roadmap review, gap A).
      const userId = newUuid();
      mocks.systemMetadata.get.mockResolvedValue({ googleDrive: enabledConfig });
      mocks.googleDrive.getCredentials.mockResolvedValue({
        userId,
        refreshToken: 'refresh-token',
        folderId: null,
        folderName: null,
        connectedAt: new Date(),
      });
      mocks.googleDrive.getBlockingError.mockResolvedValue(GoogleDriveUploadErrorClass.QuotaExceeded);

      await expect(sut.uploadAsset(userId, newUuid())).resolves.toBe('skipped');

      expect(mocks.asset.getById).not.toHaveBeenCalled();
      expect(driveFilesCreate).not.toHaveBeenCalled();
      // No per-asset error row either: the skipped assets stay pending, which is what lets the
      // resume path re-queue them.
      expect(mocks.googleDrive.upsertError).not.toHaveBeenCalled();
    });

    it('should skip when the original file is missing from disk', async () => {
      // An asset row is not proof the bytes are still there — a half-restored backup or a failed
      // storage-template migration can leave the row pointing at nothing. This has to be a *skip*
      // rather than a failure: a failed job holds this asset's dedup jobId (see job.repository.ts),
      // which would stop the pair being retried even after the file was restored.
      const userId = newUuid();
      const asset = AssetFactory.create();
      mocks.systemMetadata.get.mockResolvedValue({ googleDrive: enabledConfig });
      mocks.googleDrive.getCredentials.mockResolvedValue({
        userId,
        refreshToken: 'refresh-token',
        folderId: null,
        folderName: null,
        connectedAt: new Date(),
      });
      mocks.googleDrive.hasUpload.mockResolvedValue(false);
      mocks.asset.getById.mockResolvedValue(getForAsset(asset));
      mocks.storage.createReadStream.mockRejectedValue(
        Object.assign(new Error('ENOENT: no such file or directory'), { code: 'ENOENT' }),
      );

      await expect(sut.uploadAsset(userId, asset.id)).resolves.toBe('skipped');

      expect(mocks.googleDrive.recordUpload).not.toHaveBeenCalled();
      // A skip, but a *recorded* one — this path never reaches the failure catch, so without an
      // explicit write the settings page would show nothing (the seam review #2 caught).
      expect(mocks.googleDrive.upsertError).toHaveBeenCalledWith(
        userId,
        asset.id,
        GoogleDriveUploadErrorClass.SourceUnreadable,
        expect.any(String),
      );
    });

    /**
     * The upload body is a live fs.ReadStream and the request retries on 403/429/5xx. A stream that
     * has already been partially consumed cannot rewind, so a retry can leave Drive holding a short
     * file while still answering 200. That is the one failure the ledger cannot survive: record it
     * and every future run skips the asset, leaving a truncated photo in Drive forever with nothing
     * to indicate anything went wrong. Comparing byte counts turns it into an ordinary loud error.
     */
    describe('upload verification', () => {
      beforeEach(() => {
        driveFilesCreate.mockReset();
        driveFilesDelete.mockReset();
        driveFilesDelete.mockResolvedValue({});
      });

      it('should record the upload when the stored size matches', async () => {
        const userId = newUuid();
        const asset = arrangeReadyToUpload(mocks, userId);
        driveFilesCreate.mockResolvedValue({ data: { id: 'drive-file-id', size: '1024' } });

        await expect(sut.uploadAsset(userId, asset.id)).resolves.toBe('uploaded');

        expect(mocks.googleDrive.recordUpload).toHaveBeenCalledWith(userId, asset.id, 'drive-file-id');
        expect(driveFilesDelete).not.toHaveBeenCalled();
      });

      it('should refuse to record a truncated upload, and remove the partial file', async () => {
        const userId = newUuid();
        const asset = arrangeReadyToUpload(mocks, userId);
        driveFilesCreate.mockResolvedValue({ data: { id: 'drive-file-id', size: '512' } });

        await expect(sut.uploadAsset(userId, asset.id)).rejects.toThrow(/512.*expected 1024/);

        // Not recording is the critical half — the ledger must never claim a partial file is done.
        expect(mocks.googleDrive.recordUpload).not.toHaveBeenCalled();
        // But the *failure* is recorded, with the right classification, before the job dies —
        // removeOnFail drops the job the moment it fails, so this row is the only durable trace.
        expect(mocks.googleDrive.upsertError).toHaveBeenCalledWith(
          userId,
          asset.id,
          GoogleDriveUploadErrorClass.SizeMismatch,
          expect.stringContaining('512'),
        );
        // Removing the partial file is the courteous half: it is unambiguously ours, and leaving it
        // behind means the user finds a corrupt photo they have to identify and delete by hand.
        expect(driveFilesDelete).toHaveBeenCalledWith({ fileId: 'drive-file-id' });
      });

      it('should classify a quota failure, record it, and notify exactly once', async () => {
        const userId = newUuid();
        const asset = arrangeReadyToUpload(mocks, userId);
        const quotaError = Object.assign(new Error('quota'), {
          response: { status: 403, data: { error: { errors: [{ reason: 'storageQuotaExceeded' }] } } },
        });
        driveFilesCreate.mockRejectedValue(quotaError);
        mocks.googleDrive.upsertError.mockResolvedValue({ firstOfClass: true });
        mocks.notification.create.mockResolvedValue({} as never);

        await expect(sut.uploadAsset(userId, asset.id)).rejects.toThrow();

        expect(mocks.googleDrive.upsertError).toHaveBeenCalledWith(
          userId,
          asset.id,
          GoogleDriveUploadErrorClass.QuotaExceeded,
          expect.any(String),
        );
        // First appearance of the class → one notification.
        expect(mocks.notification.create).toHaveBeenCalledTimes(1);
      });

      it('should not notify again for subsequent failures of the same class', async () => {
        const userId = newUuid();
        const asset = arrangeReadyToUpload(mocks, userId);
        driveFilesCreate.mockRejectedValue(
          Object.assign(new Error('quota'), {
            response: { status: 403, data: { error: { errors: [{ reason: 'storageQuotaExceeded' }] } } },
          }),
        );
        // Not the first row of this class for the user — the storm after the first failure.
        mocks.googleDrive.upsertError.mockResolvedValue({ firstOfClass: false });

        await expect(sut.uploadAsset(userId, asset.id)).rejects.toThrow();

        expect(mocks.notification.create).not.toHaveBeenCalled();
      });

      it('should record a revoked grant, notify, and clear the credentials', async () => {
        const userId = newUuid();
        const asset = arrangeReadyToUpload(mocks, userId);
        driveFilesCreate.mockRejectedValue(
          Object.assign(new Error('x'), { response: { data: { error: 'invalid_grant' } } }),
        );
        mocks.googleDrive.upsertError.mockResolvedValue({ firstOfClass: true });
        mocks.notification.create.mockResolvedValue({} as never);

        // A skip, not a failure: retrying can never succeed, and the queued follow-ups for this
        // user will skip at the not-connected check once the credentials are gone.
        await expect(sut.uploadAsset(userId, asset.id)).resolves.toBe('skipped');

        expect(mocks.googleDrive.upsertError).toHaveBeenCalledWith(
          userId,
          asset.id,
          GoogleDriveUploadErrorClass.Revoked,
          expect.any(String),
        );
        expect(mocks.notification.create).toHaveBeenCalledTimes(1);
        expect(mocks.googleDrive.deleteCredentials).toHaveBeenCalledWith(userId);
      });

      it('should treat a missing size as unverifiable rather than assume success', async () => {
        // Drive omits `size` only for Google-native document types, which this never creates. If it
        // is absent, something is wrong with an assumption — refuse rather than guess.
        const userId = newUuid();
        const asset = arrangeReadyToUpload(mocks, userId);
        driveFilesCreate.mockResolvedValue({ data: { id: 'drive-file-id' } });

        await expect(sut.uploadAsset(userId, asset.id)).rejects.toThrow();

        expect(mocks.googleDrive.recordUpload).not.toHaveBeenCalled();
      });
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
      // Picking a folder is the fix for the folder-gone block, so it clears it in the same act.
      expect(mocks.googleDrive.clearErrors).toHaveBeenCalledWith(userId, [GoogleDriveUploadErrorClass.FolderMissing]);
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

  describe('resumeUploads', () => {
    it('should reject when the feature is disabled', async () => {
      await expect(sut.resumeUploads(AuthFactory.create(UserFactory.create()))).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(mocks.googleDrive.clearErrors).not.toHaveBeenCalled();
    });

    it('should clear the block and immediately re-queue the pending set', async () => {
      // Clearing alone is not resuming — without the re-queue the user waits for some future
      // trigger that may be days away (roadmap review, gap C).
      const user = UserFactory.create();
      const assetIds = [newUuid(), newUuid()];
      mocks.systemMetadata.get.mockResolvedValue({ googleDrive: enabledConfig });
      // eslint-disable-next-line @typescript-eslint/require-await
      mocks.googleDrive.streamPendingUploads.mockImplementation(async function* () {
        for (const assetId of assetIds) {
          yield { userId: user.id, assetId };
        }
      } as never);

      await sut.resumeUploads(AuthFactory.create(user));

      expect(mocks.googleDrive.clearErrors).toHaveBeenCalledWith(user.id, [
        GoogleDriveUploadErrorClass.QuotaExceeded,
        GoogleDriveUploadErrorClass.FolderMissing,
      ]);
      // Scoped to this user, not the global backfill.
      expect(mocks.googleDrive.streamPendingUploads).toHaveBeenCalledWith(user.id);
      expect(mocks.job.queueAll).toHaveBeenCalledWith(
        assetIds.map((assetId) => ({ name: JobName.GoogleDriveUpload, data: { userId: user.id, assetId } })),
      );
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
        failedCount: 0,
        blockedReason: null,
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

      expect(status).toEqual({
        connected: true,
        folderId: 'folder-id',
        folderName: 'Folder name',
        connectedAt,
        failedCount: 0,
        blockedReason: null,
      });
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
    // Every test here is about what happens *past* the enabled gate, so they all need the feature
    // switched on. The gate itself gets its own test below.
    beforeEach(() => {
      mocks.systemMetadata.get.mockResolvedValue({ googleDrive: enabledConfig });
    });

    it('should reject when the feature is disabled', async () => {
      // Deliberately different from the background paths, which skip in silence. This one is
      // user-initiated, so a success toast for jobs that can never run would be a lie.
      mocks.systemMetadata.get.mockResolvedValue({ googleDrive: { ...enabledConfig, enabled: false } });

      await expect(sut.syncAlbum(AuthFactory.create(UserFactory.create()), newUuid())).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(mocks.job.queueAll).not.toHaveBeenCalled();
    });

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
