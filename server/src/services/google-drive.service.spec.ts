import { BadRequestException } from '@nestjs/common';
import { AlbumUserRole, GoogleDriveUploadErrorClass, JobName, JobStatus, SystemMetadataKey } from 'src/enum';
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
const { driveFilesCreate, driveFilesDelete, driveAboutGet, oauth2Constructed, oauth2GetToken, oauth2SetCredentials } =
  vi.hoisted(() => ({
    driveFilesCreate: vi.fn(),
    driveFilesDelete: vi.fn(),
    driveAboutGet: vi.fn(),
    // The link flow's token exchange. Mocked because nothing exercised linkAccount before, and the
    // account-change reset below cannot be reached without getting a token first.
    oauth2GetToken: vi.fn(),
    // Records which refresh token each client was handed. The drain has to probe with the
    // *outgoing* one, and without this the tests could not tell — swapping it for a literal left
    // every one of them passing.
    oauth2SetCredentials: vi.fn(),
    // Records the (clientId, clientSecret, redirectUrl) triple every OAuth2 client is built with.
    // The redirect URL is the one value Google matches byte-for-byte and it is now usually *derived*
    // rather than typed, so "which URL did we actually hand to Google" needs to be observable.
    oauth2Constructed: vi.fn(),
  }));

vi.mock('googleapis', () => ({
  google: {
    auth: {
      OAuth2: class {
        constructor(clientId: string, clientSecret: string, redirectUrl: string) {
          oauth2Constructed({ clientId, clientSecret, redirectUrl });
        }
        setCredentials(credentials: { refresh_token?: string }) {
          oauth2SetCredentials(credentials?.refresh_token);
        }
        getAccessToken() {
          return { token: 'access-token' };
        }
        getToken(code: string) {
          return oauth2GetToken(code);
        }
        generateAuthUrl() {
          return 'https://accounts.google.com/o/oauth2/v2/auth?mocked=true';
        }
      },
    },
    drive: () => ({
      files: { create: driveFilesCreate, delete: driveFilesDelete },
      about: { get: driveAboutGet },
    }),
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
// A plausible about.get(storageQuota) response — the real numbers from the live account, so the
// string-to-number conversion is exercised at realistic magnitudes.
const quota = (over: Record<string, string> = {}) => ({
  data: {
    storageQuota: {
      limit: '5499705622528',
      usage: '128243802559',
      usageInDrive: '123498526848',
      usageInDriveTrash: '115171945473',
      ...over,
    },
  },
});

// A connected-Drive credentials row, for tests that only need "this user is linked".
const connected = (userId: string) => ({
  userId,
  refreshToken: 'refresh-token',
  driveAccountId: null,
  folderId: null,
  folderName: null,
  connectedAt: new Date(),
});

const arrangeReadyToUpload = (mocks: ServiceMocks, userId: string) => {
  const asset = AssetFactory.create();
  mocks.systemMetadata.get.mockResolvedValue({ googleDrive: enabledConfig });
  mocks.googleDrive.getCredentials.mockResolvedValue({
    userId,
    refreshToken: 'refresh-token',
    driveAccountId: null,
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

/**
 * Arranges a callback that will pass the state checks, so the link tests can be about what linking
 * *does* rather than about JWT plumbing. Defined out here because the lint rule that keeps helpers
 * out of describe bodies is right: this one is reusable and has no business closing over a suite.
 */
const arrangeLink =
  (mocks: ServiceMocks, sut: GoogleDriveService) =>
  ({ newAccountId }: { newAccountId: string | null }) => {
    const userId = newUuid();

    mocks.systemMetadata.get.mockImplementation((key: string) =>
      Promise.resolve(
        key === SystemMetadataKey.GoogleDriveState ? { secret: 'state-secret' } : { googleDrive: enabledConfig },
      ),
    );
    mocks.crypto.verifyJwt.mockReturnValue({ userId });
    oauth2GetToken.mockResolvedValue({ tokens: { refresh_token: 'new-refresh-token' } });
    driveAboutGet.mockResolvedValue({ data: { user: { permissionId: newAccountId } } });

    return { userId, run: () => sut.handleCallback('auth-code', 'state', 'state', userId) };
  };

/** A connection that exists but has never had its Google account identified. */
const unidentified = (userId: string) => ({
  userId,
  refreshToken: 'refresh-token',
  driveAccountId: null,
  folderId: null,
  folderName: null,
  connectedAt: new Date(),
});

// The shape streamPendingUploads returns. Module scope and the `await` are the house style for
// these (see trash.service.spec.ts): ESLint rejects a nested generator that never awaits.
async function* pendingUploads(
  userId: string,
  count: number,
): AsyncIterableIterator<{ userId: string; assetId: string }> {
  for (let i = 0; i < count; i++) {
    await Promise.resolve();
    yield { userId, assetId: `asset-${i}` };
  }
}

describe(GoogleDriveService.name, () => {
  let sut: GoogleDriveService;
  let mocks: ServiceMocks;

  beforeEach(() => {
    ({ sut, mocks } = newTestService(GoogleDriveService));
  });

  it('should work', () => {
    expect(sut).toBeDefined();
  });

  /**
   * The redirect URL Google is told about. Wave 6 made it derivable from the External Domain
   * setting so that a deployment with credentials in its environment needs no configuration at all
   * — which means the derivation itself is now load-bearing for whether the feature works.
   */
  describe('getAuthUrl (redirect URL)', () => {
    beforeEach(() => {
      oauth2Constructed.mockClear();
      mocks.crypto.randomBytesAsText.mockReturnValue('state-secret');
    });

    it('should derive the redirect URL from the external domain when none is configured', async () => {
      mocks.systemMetadata.get.mockResolvedValue({
        googleDrive: { ...enabledConfig, redirectUrl: '' },
        server: { externalDomain: 'https://immich.example.com' },
      });

      await sut.getAuthUrl(newUuid());

      expect(oauth2Constructed).toHaveBeenCalledWith(
        expect.objectContaining({ redirectUrl: 'https://immich.example.com/api/google-drive/callback' }),
      );
    });

    it('should prefer an explicitly configured redirect URL over the external domain', async () => {
      // The override is what makes a dev container work, where the API origin (:2283) is not the
      // address the browser knows the instance by.
      mocks.systemMetadata.get.mockResolvedValue({
        googleDrive: { ...enabledConfig, redirectUrl: 'http://localhost:2283/api/google-drive/callback' },
        server: { externalDomain: 'https://immich.example.com' },
      });

      await sut.getAuthUrl(newUuid());

      expect(oauth2Constructed).toHaveBeenCalledWith(
        expect.objectContaining({ redirectUrl: 'http://localhost:2283/api/google-drive/callback' }),
      );
    });

    it('should refuse with an actionable message when there is no redirect URL and none can be derived', async () => {
      mocks.systemMetadata.get.mockResolvedValue({
        googleDrive: { ...enabledConfig, redirectUrl: '' },
        server: { externalDomain: '' },
      });

      // Not merely "it threw": the message has to name the two settings that would fix it, because
      // a wrong redirect URL otherwise surfaces only as an opaque error from Google.
      await expect(sut.getAuthUrl(newUuid())).rejects.toThrow(/redirect URL.*External Domain/i);
      // And it must fail *before* building a client with an empty redirect URL.
      expect(oauth2Constructed).not.toHaveBeenCalled();
    });
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
        driveAccountId: null,
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
        driveAccountId: null,
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

    it('should skip an asset no longer in any selected album, before calling Drive', async () => {
      // The deselect gate. A job can outlive its selection: unsubscribing deletes the row but not
      // jobs already queued, and those would otherwise write real files into the user's Drive. The
      // worker stops them at execution.
      const userId = newUuid();
      mocks.systemMetadata.get.mockResolvedValue({ googleDrive: enabledConfig });
      mocks.googleDrive.getCredentials.mockResolvedValue({
        userId,
        refreshToken: 'refresh-token',
        driveAccountId: null,
        folderId: null,
        folderName: null,
        connectedAt: new Date(),
      });
      mocks.googleDrive.hasUpload.mockResolvedValue(false);
      mocks.googleDrive.isAssetInSubscribedAlbum.mockResolvedValue(false);

      await expect(sut.uploadAsset(userId, newUuid())).resolves.toBe('skipped');

      expect(mocks.asset.getById).not.toHaveBeenCalled();
      expect(driveFilesCreate).not.toHaveBeenCalled();
      // A no-op skip, not a failure: nothing recorded, so a re-select re-queues cleanly.
      expect(mocks.googleDrive.upsertError).not.toHaveBeenCalled();
    });

    it('should check the ledger before the selection join', async () => {
      // Gate order (review Q2): already-uploaded is the highest-hit-rate reject via idempotent
      // re-queueing and is a PK lookup, so it must bail before the more expensive membership join
      // even runs.
      const userId = newUuid();
      mocks.systemMetadata.get.mockResolvedValue({ googleDrive: enabledConfig });
      mocks.googleDrive.getCredentials.mockResolvedValue({
        userId,
        refreshToken: 'refresh-token',
        driveAccountId: null,
        folderId: null,
        folderName: null,
        connectedAt: new Date(),
      });
      mocks.googleDrive.hasUpload.mockResolvedValue(true);

      await expect(sut.uploadAsset(userId, newUuid())).resolves.toBe('skipped');

      expect(mocks.googleDrive.isAssetInSubscribedAlbum).not.toHaveBeenCalled();
      expect(mocks.googleDrive.getBlockingError).not.toHaveBeenCalled();
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
        driveAccountId: null,
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

        // The fourth argument is the account the file went to. '' here because this fixture's
        // connection has never been identified, which is the same bucket the pre-column rows live
        // in — see the medium specs for what that buys on a deploy.
        expect(mocks.googleDrive.recordUpload).toHaveBeenCalledWith(userId, asset.id, 'drive-file-id', '');
        expect(driveFilesDelete).not.toHaveBeenCalled();
      });

      it('should file an Unknown failure and close the file when the connection drops mid-upload', async () => {
        // What the user described: the network goes away while a photo is in flight. googleapis
        // rejects with a bare Error carrying no status, which classifies as Unknown — deliberately
        // not a blocking class, so the account is not halted for something transient.
        //
        // The assertion that matters most is the last one. The upload body is a live fs.ReadStream
        // holding a descriptor, and on failure googleapis abandons the pipe without closing the
        // source. A persistent failure at queue concurrency 5 would then leak one descriptor per
        // job until the microservices process hits EMFILE and unrelated I/O starts failing. Only
        // the `finally` closes it, and nothing covered that before.
        const userId = newUuid();
        const asset = arrangeReadyToUpload(mocks, userId);
        const destroy = vi.fn();
        mocks.storage.createReadStream.mockResolvedValue({
          stream: { destroy } as never,
          length: 1024,
          type: 'image/jpeg',
        });
        driveFilesCreate.mockRejectedValue(new Error('socket hang up'));
        mocks.googleDrive.upsertError.mockResolvedValue({ firstOfClass: true });

        await expect(sut.uploadAsset(userId, asset.id)).rejects.toThrow('socket hang up');

        expect(mocks.googleDrive.upsertError).toHaveBeenCalledWith(
          userId,
          asset.id,
          GoogleDriveUploadErrorClass.Unknown,
          'socket hang up',
        );
        // The asset stays pending — no ledger row — which is what lets the resume path pick it up
        // again once the network is back.
        expect(mocks.googleDrive.recordUpload).not.toHaveBeenCalled();
        // firstOfClass is true above, so a notification here would be the code deciding Unknown is
        // worth waking the user for. It is not: a dropped connection retries.
        expect(mocks.notification.create).not.toHaveBeenCalled();
        expect(destroy).toHaveBeenCalled();
      });

      it('should stamp the ledger row with the account the file went to', async () => {
        // Without this the row lands in the '' bucket and a later account switch reads it as
        // "already uploaded" — the original bug, one level down.
        const userId = newUuid();
        const asset = arrangeReadyToUpload(mocks, userId);
        mocks.googleDrive.getCredentials.mockResolvedValue({
          userId,
          refreshToken: 'refresh-token',
          driveAccountId: 'account-x',
          folderId: null,
          folderName: null,
          connectedAt: new Date(),
        });
        driveFilesCreate.mockResolvedValue({ data: { id: 'drive-file-id', size: '1024' } });

        await expect(sut.uploadAsset(userId, asset.id)).resolves.toBe('uploaded');

        expect(mocks.googleDrive.recordUpload).toHaveBeenCalledWith(userId, asset.id, 'drive-file-id', 'account-x');
      });

      it('should tag the created file with the asset id', async () => {
        // Not read by anything today. It is the only thing that would let a future reconciliation
        // find an already-uploaded file instead of sending a second copy, which is the sole cure
        // if a ledger is ever lost or mis-stamped.
        const userId = newUuid();
        const asset = arrangeReadyToUpload(mocks, userId);
        driveFilesCreate.mockResolvedValue({ data: { id: 'drive-file-id', size: '1024' } });

        await sut.uploadAsset(userId, asset.id);

        expect(driveFilesCreate).toHaveBeenCalledWith(
          expect.objectContaining({
            requestBody: expect.objectContaining({ appProperties: { immichAssetId: asset.id } }),
          }),
          expect.anything(),
        );
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

      it('should block on a notFound 404 when a folder is configured, and notify', async () => {
        const userId = newUuid();
        const asset = arrangeReadyToUpload(mocks, userId);
        // Override: this user uploads into a configured folder — the precondition for 404s
        // meaning anything folder-related at all.
        mocks.googleDrive.getCredentials.mockResolvedValue({
          userId,
          refreshToken: 'refresh-token',
          driveAccountId: null,
          folderId: 'folder-1',
          folderName: 'Photos',
          connectedAt: new Date(),
        });
        driveFilesCreate.mockRejectedValue(
          Object.assign(new Error('File not found: folder-1'), {
            response: { status: 404, data: { error: { errors: [{ reason: 'notFound' }] } } },
          }),
        );
        mocks.googleDrive.upsertError.mockResolvedValue({ firstOfClass: true });
        mocks.notification.create.mockResolvedValue({} as never);

        await expect(sut.uploadAsset(userId, asset.id)).rejects.toThrow();

        expect(mocks.googleDrive.upsertError).toHaveBeenCalledWith(
          userId,
          asset.id,
          GoogleDriveUploadErrorClass.FolderMissing,
          expect.any(String),
        );
        // A vanished destination folder halts the account as hard as quota — same one-time
        // notification (Wave 1 review note).
        expect(mocks.notification.create).toHaveBeenCalledTimes(1);
      });

      it('should record a bare 404 (expired resumable session) as unknown, not an account block', async () => {
        // The review's one real correctness risk: a transient session 404 must not masquerade as
        // "the folder is gone" and freeze every upload for the user.
        const userId = newUuid();
        const asset = arrangeReadyToUpload(mocks, userId);
        mocks.googleDrive.getCredentials.mockResolvedValue({
          userId,
          refreshToken: 'refresh-token',
          driveAccountId: null,
          folderId: 'folder-1',
          folderName: 'Photos',
          connectedAt: new Date(),
        });
        driveFilesCreate.mockRejectedValue(Object.assign(new Error('Not Found'), { response: { status: 404 } }));

        await expect(sut.uploadAsset(userId, asset.id)).rejects.toThrow();

        expect(mocks.googleDrive.upsertError).toHaveBeenCalledWith(
          userId,
          asset.id,
          GoogleDriveUploadErrorClass.Unknown,
          expect.any(String),
        );
        expect(mocks.notification.create).not.toHaveBeenCalled();
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

  describe('getStatus (disconnected)', () => {
    it('should report revoked as the reason after an automatic disconnect', async () => {
      // The credentials row is gone (deleted when the grant died); the revoked error rows are the
      // only remaining evidence of *why*. Without surfacing them the settings page shows a bare
      // "not connected" — the review caught that the summary alone can never say 'revoked'.
      mocks.googleDrive.getCredentials.mockResolvedValue(void 0);
      mocks.googleDrive.getErrorSummary.mockResolvedValue({ failedCount: 3, blockedReason: null });
      mocks.googleDrive.hasErrorOfClass.mockResolvedValue(true);

      await expect(sut.getStatus(newUuid())).resolves.toEqual({
        connected: false,
        folderId: null,
        folderName: null,
        connectedAt: null,
        failedCount: 3,
        blockedReason: GoogleDriveUploadErrorClass.Revoked,
        pickerAvailable: false,
      });
    });
  });

  describe('album subscriptions', () => {
    it('should refuse to subscribe when Drive is not connected', async () => {
      // Selecting albums before connecting would silently accumulate work with nowhere to send it.
      const user = UserFactory.create();
      mocks.systemMetadata.get.mockResolvedValue({ googleDrive: enabledConfig });
      mocks.access.album.checkOwnerAccess.mockResolvedValue(new Set(['album-1']));
      mocks.googleDrive.getCredentials.mockResolvedValue(void 0);

      await expect(sut.subscribeAlbum(AuthFactory.create(user), 'album-1')).rejects.toBeInstanceOf(BadRequestException);
      expect(mocks.googleDrive.subscribe).not.toHaveBeenCalled();
    });

    it('should subscribe and immediately queue the album contents', async () => {
      // Turning a switch on and having nothing happen until some unrelated later trigger is not
      // what the switch appears to promise — same reasoning as the resume button.
      const user = UserFactory.create();
      const album = AlbumFactory.from()
        .asset({}, (builder) => builder.exif())
        .asset({}, (builder) => builder.exif())
        .build();
      mocks.systemMetadata.get.mockResolvedValue({ googleDrive: enabledConfig });
      mocks.access.album.checkOwnerAccess.mockResolvedValue(new Set([album.id]));
      mocks.googleDrive.getCredentials.mockResolvedValue(connected(user.id));
      mocks.album.getById.mockResolvedValue(getForAlbum(album));

      await sut.subscribeAlbum(AuthFactory.create(user), album.id);

      expect(mocks.googleDrive.subscribe).toHaveBeenCalledWith(user.id, album.id);
      expect(mocks.job.queueAll).toHaveBeenCalledWith(
        album.assets.map((asset) => ({
          name: JobName.GoogleDriveUpload,
          data: { userId: user.id, assetId: asset.id },
        })),
      );
    });

    it('should record the selection before queueing anything for it', async () => {
      // Order, not effect. The queued jobs re-check selection at execution (uploadAsset gate 3),
      // so a job that reaches the worker before `subscribe` has committed is skipped and the
      // album silently backs up nothing. The union with an auto-backup toggle flipped at the same
      // moment is safe on its own — the job ids dedup — but only if the selection is already
      // there when the first job lands.
      const user = UserFactory.create();
      const album = AlbumFactory.from()
        .asset({}, (builder) => builder.exif())
        .build();
      mocks.systemMetadata.get.mockResolvedValue({ googleDrive: enabledConfig });
      mocks.access.album.checkOwnerAccess.mockResolvedValue(new Set([album.id]));
      mocks.googleDrive.getCredentials.mockResolvedValue(connected(user.id));
      mocks.album.getById.mockResolvedValue(getForAlbum(album));

      await sut.subscribeAlbum(AuthFactory.create(user), album.id);

      const [subscribedAt] = mocks.googleDrive.subscribe.mock.invocationCallOrder;
      const [queuedAt] = mocks.job.queueAll.mock.invocationCallOrder;
      expect(subscribedAt).toBeLessThan(queuedAt);
    });

    it('should gate subscribing on download access, not merely read access', async () => {
      // Copying a shared album into your own Google account is egress; if a share is ever
      // restricted to viewing, backing it up must be refused for the same reason downloading is.
      const user = UserFactory.create();
      mocks.systemMetadata.get.mockResolvedValue({ googleDrive: enabledConfig });
      // No access grant stubbed → requireAccess rejects.
      await expect(sut.subscribeAlbum(AuthFactory.create(user), 'album-1')).rejects.toBeDefined();
      expect(mocks.googleDrive.subscribe).not.toHaveBeenCalled();
    });

    it('should unsubscribe without touching the ledger', async () => {
      // What is already in the user's Drive stays there and stays recorded, so re-selecting the
      // album later does not re-upload it.
      const user = UserFactory.create();
      mocks.access.album.checkOwnerAccess.mockResolvedValue(new Set(['album-1']));

      await sut.unsubscribeAlbum(AuthFactory.create(user), 'album-1');

      expect(mocks.googleDrive.unsubscribe).toHaveBeenCalledWith(user.id, 'album-1');
      expect(mocks.googleDrive.recordUpload).not.toHaveBeenCalled();
    });

    it('should let a user remove a selection for an album they can no longer see', async () => {
      // The one moment you most need to turn a backup off is after losing access to what it
      // pointed at. An access check here would throw exactly then, leaving a row that is both
      // invisible in the listing and unremovable through the API.
      const user = UserFactory.create();

      await sut.unsubscribeAlbum(AuthFactory.create(user), 'album-gone');

      expect(mocks.googleDrive.unsubscribe).toHaveBeenCalledWith(user.id, 'album-gone');
      expect(mocks.access.album.checkOwnerAccess).not.toHaveBeenCalled();
      expect(mocks.access.album.checkSharedAlbumAccess).not.toHaveBeenCalled();
    });

    it('should surface a selection whose album is no longer shared, rather than dropping it', async () => {
      // Uploads stop correctly on unshare (the membership join), but if the listing also hid the
      // row the backup would end with nothing anywhere saying so — the silent stall this wave
      // exists to eliminate, recreated at the unshare boundary.
      const user = UserFactory.create();
      mocks.googleDrive.getSubscribableAlbums.mockResolvedValue([
        {
          albumId: 'a1',
          albumName: 'Shared album',
          ownerName: 'Someone',
          isOwner: false as never,
          subscribed: true as never,
          accessLost: true as never,
          assetCount: 20,
          uploadedCount: 5,
        },
      ]);

      const [album] = await sut.getSubscribableAlbums(AuthFactory.create(user));

      expect(album.accessLost).toBe(true);
      expect(album.subscribed).toBe(true);
    });

    it('should normalise SQL booleans when listing albums', async () => {
      // Kysely types SQL booleans as number | boolean because drivers disagree; the DTO promises
      // a real boolean.
      const user = UserFactory.create();
      mocks.googleDrive.getSubscribableAlbums.mockResolvedValue([
        {
          albumId: 'a1',
          albumName: 'Album',
          ownerName: 'Owner',
          isOwner: 1 as never,
          subscribed: 0 as never,
          accessLost: 0 as never,
          assetCount: 10,
          uploadedCount: 4,
        },
      ]);

      await expect(sut.getSubscribableAlbums(AuthFactory.create(user))).resolves.toEqual([
        {
          albumId: 'a1',
          albumName: 'Album',
          ownerName: 'Owner',
          isOwner: true,
          subscribed: false,
          accessLost: false,
          assetCount: 10,
          uploadedCount: 4,
        },
      ]);
    });
  });

  describe('getStorage', () => {
    beforeEach(() => {
      // No cache clearing needed: it's an instance field, and newTestService builds a fresh
      // service per test.
      driveAboutGet.mockReset();
    });

    it('should convert Google string byte counts to numbers', async () => {
      // Google returns these as strings because they can exceed 2^53 on large accounts; every
      // real quota is comfortably inside Number's safe range.
      const userId = newUuid();
      mocks.systemMetadata.get.mockResolvedValue({ googleDrive: enabledConfig });
      mocks.googleDrive.getCredentials.mockResolvedValue(connected(userId));
      driveAboutGet.mockResolvedValue(quota());

      await expect(sut.getStorage(userId)).resolves.toEqual({
        limitBytes: 5_499_705_622_528,
        usageBytes: 128_243_802_559,
        usageInDriveBytes: 123_498_526_848,
        usageInDriveTrashBytes: 115_171_945_473,
      });
    });

    it('should report an unlimited account as a null limit rather than failing', async () => {
      const userId = newUuid();
      mocks.systemMetadata.get.mockResolvedValue({ googleDrive: enabledConfig });
      mocks.googleDrive.getCredentials.mockResolvedValue(connected(userId));
      driveAboutGet.mockResolvedValue({ data: { storageQuota: { usage: '1', usageInDrive: '1' } } });

      await expect(sut.getStorage(userId)).resolves.toMatchObject({ limitBytes: null, usageBytes: 1 });
    });

    it('should serve a second call from cache rather than calling Google again', async () => {
      const userId = newUuid();
      mocks.systemMetadata.get.mockResolvedValue({ googleDrive: enabledConfig });
      mocks.googleDrive.getCredentials.mockResolvedValue(connected(userId));
      driveAboutGet.mockResolvedValue(quota());

      await sut.getStorage(userId);
      await sut.getStorage(userId);

      expect(driveAboutGet).toHaveBeenCalledTimes(1);
    });

    it('should not serve one user cached values belonging to another', async () => {
      const [a, b] = [newUuid(), newUuid()];
      mocks.systemMetadata.get.mockResolvedValue({ googleDrive: enabledConfig });
      mocks.googleDrive.getCredentials.mockImplementation((id: string) => Promise.resolve(connected(id)) as never);
      driveAboutGet.mockResolvedValueOnce(quota()).mockResolvedValueOnce(quota({ usage: '42' }));

      await expect(sut.getStorage(a)).resolves.toMatchObject({ usageBytes: 128_243_802_559 });
      await expect(sut.getStorage(b)).resolves.toMatchObject({ usageBytes: 42 });
    });

    it('should stop serving cached numbers once the account is disconnected', async () => {
      // Credentials are checked before the cache. The other order would keep reporting storage for
      // up to a minute after a disconnect — numbers for an account that is no longer linked.
      const userId = newUuid();
      mocks.systemMetadata.get.mockResolvedValue({ googleDrive: enabledConfig });
      mocks.googleDrive.getCredentials.mockResolvedValue(connected(userId));
      driveAboutGet.mockResolvedValue(quota());

      await sut.getStorage(userId);

      mocks.googleDrive.getCredentials.mockResolvedValue(void 0);
      await expect(sut.getStorage(userId)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('should report a revoked grant as disconnected, not as a server error', async () => {
      // The settings page reads this; a 500 there would look like the feature is broken rather
      // than merely unlinked.
      const userId = newUuid();
      mocks.systemMetadata.get.mockResolvedValue({ googleDrive: enabledConfig });
      mocks.googleDrive.getCredentials.mockResolvedValue(connected(userId));
      driveAboutGet.mockRejectedValue(
        Object.assign(new Error('x'), { response: { data: { error: 'invalid_grant' } } }),
      );

      await expect(sut.getStorage(userId)).rejects.toBeInstanceOf(BadRequestException);
      // And it reaches the same conclusion the upload path does. Without this, a user whose grant
      // expired — the seven-day clock on a Testing-mode app — kept seeing "Connected" while every
      // gauge on the page errored, because nothing had ever queued an upload to notice.
      expect(mocks.googleDrive.deleteCredentials).toHaveBeenCalledWith(userId);
      // Witness: the call was actually made, so the assertion above is about the revoked branch
      // rather than about bailing out earlier.
      expect(driveAboutGet).toHaveBeenCalled();
    });
  });

  describe('getMyStatus', () => {
    it('should combine the pending count with the failure summary', async () => {
      const userId = newUuid();
      mocks.googleDrive.countPendingUploads.mockResolvedValue(17);
      mocks.googleDrive.getErrorSummary.mockResolvedValue({ failedCount: 3, blockedReason: null });

      await expect(sut.getMyStatus(userId)).resolves.toEqual({ pending: 17, failed: 3, blockedReason: null });
    });

    it('should carry the block alongside the count, not in a separate endpoint', async () => {
      // Pending deliberately counts a blocked account's outstanding work — reporting zero would
      // read as "done". But a progress display polling only the number would show it ticking
      // nowhere and look stalled rather than paused, so the reason travels with it.
      const userId = newUuid();
      mocks.googleDrive.countPendingUploads.mockResolvedValue(1800);
      mocks.googleDrive.getErrorSummary.mockResolvedValue({
        failedCount: 1,
        blockedReason: GoogleDriveUploadErrorClass.QuotaExceeded,
      });

      await expect(sut.getMyStatus(userId)).resolves.toEqual({
        pending: 1800,
        failed: 1,
        blockedReason: GoogleDriveUploadErrorClass.QuotaExceeded,
      });
    });
  });

  describe('getAlbumBackupStatus', () => {
    it('should report a single album without fetching every album the user can see', async () => {
      const user = UserFactory.create();
      mocks.access.album.checkOwnerAccess.mockResolvedValue(new Set(['a1']));
      mocks.googleDrive.getAlbumBackupStatus.mockResolvedValue({
        subscribed: 1 as never,
        accessLost: 0 as never,
        assetCount: 40,
        uploadedCount: 12,
      });

      await expect(sut.getAlbumBackupStatus(AuthFactory.create(user), 'a1')).resolves.toEqual({
        subscribed: true,
        accessLost: false,
        assetCount: 40,
        uploadedCount: 12,
      });
      expect(mocks.googleDrive.getSubscribableAlbums).not.toHaveBeenCalled();
    });

    it('should return zeroes rather than throwing for an album with no row', async () => {
      const user = UserFactory.create();
      mocks.access.album.checkOwnerAccess.mockResolvedValue(new Set(['a1']));
      mocks.googleDrive.getAlbumBackupStatus.mockResolvedValue(void 0);

      await expect(sut.getAlbumBackupStatus(AuthFactory.create(user), 'a1')).resolves.toEqual({
        subscribed: false,
        accessLost: false,
        assetCount: 0,
        uploadedCount: 0,
      });
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
        pickerAvailable: false,
      });
    });

    it('should report a connected user without leaking the refresh token', async () => {
      const userId = newUuid();
      const connectedAt = new Date();
      mocks.googleDrive.getCredentials.mockResolvedValue({
        userId,
        refreshToken: 'super-secret-refresh-token',
        driveAccountId: null,
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
        pickerAvailable: false,
      });
      // Guard against someone later "simplifying" this into a spread of the credentials row.
      expect(JSON.stringify(status)).not.toContain('super-secret-refresh-token');
    });

    // The settings page uses this to decide whether to draw the "choose folder" button at all.
    // Before it existed the button was always drawn, and a deployment with no API key only found
    // out by clicking it and getting an error toast.
    it.each([
      { apiKey: 'picker-api-key', pickerAvailable: true },
      { apiKey: '', pickerAvailable: false },
    ])(
      'should report pickerAvailable=$pickerAvailable when the API key is "$apiKey"',
      async ({ apiKey, pickerAvailable }) => {
        mocks.systemMetadata.get.mockResolvedValue({ googleDrive: { ...enabledConfig, apiKey } });
        mocks.googleDrive.getCredentials.mockResolvedValue(void 0);

        await expect(sut.getStatus(newUuid())).resolves.toMatchObject({ pickerAvailable });
      },
    );
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

    it('should reject an album the caller has not chosen to back up', async () => {
      // Ownership is no longer the gate — subscription is. Syncing an album you can see but do not
      // back up would be asking for work with nowhere to put it.
      const user = UserFactory.create();
      const album = AlbumFactory.from().build();
      mocks.access.album.checkOwnerAccess.mockResolvedValue(new Set([album.id]));
      mocks.album.getById.mockResolvedValue(getForAlbum(album));
      mocks.googleDrive.isSubscribed.mockResolvedValue(false);

      await expect(sut.syncAlbum(AuthFactory.create(user), album.id)).rejects.toBeInstanceOf(BadRequestException);

      expect(mocks.job.queueAll).not.toHaveBeenCalled();
    });

    it('should let a non-owner sync a shared album they back up, into their own Drive', async () => {
      // The case the old owner-only rule made impossible, and the reason this wave exists: the
      // album's owner may have no Drive at all. Note the queued userId is the *editor's* — uploads
      // can now only ever reach the caller's own Drive, which is what made relaxing the rule safe.
      const editor = UserFactory.create();
      const album = AlbumFactory.from()
        .albumUser({ userId: editor.id, role: AlbumUserRole.Editor })
        .asset({}, (builder) => builder.exif())
        .build();
      mocks.access.album.checkSharedAlbumAccess.mockResolvedValue(new Set([album.id]));
      mocks.album.getById.mockResolvedValue(getForAlbum(album));
      mocks.googleDrive.isSubscribed.mockResolvedValue(true);

      await sut.syncAlbum(AuthFactory.create(editor), album.id);

      expect(mocks.job.queueAll).toHaveBeenCalledWith([
        { name: JobName.GoogleDriveUpload, data: { userId: editor.id, assetId: album.assets[0].id } },
      ]);
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
      mocks.googleDrive.isSubscribed.mockResolvedValue(true);
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
      mocks.googleDrive.isSubscribed.mockResolvedValue(true);
      mocks.googleDrive.getUploadedAssetIds.mockResolvedValue(new Set(album.assets.map(({ id }) => id)));

      await sut.syncAlbum(AuthFactory.create(owner), album.id);

      expect(mocks.job.queueAll).not.toHaveBeenCalled();
    });

    it('should not queue anything for an empty album', async () => {
      const album = AlbumFactory.from().build();
      const { user: owner } = album.albumUsers.find(({ role }) => role === AlbumUserRole.Owner)!;

      mocks.access.album.checkOwnerAccess.mockResolvedValue(new Set([album.id]));
      mocks.album.getById.mockResolvedValue(getForAlbum(album));
      mocks.googleDrive.isSubscribed.mockResolvedValue(true);

      await sut.syncAlbum(AuthFactory.create(owner), album.id);

      expect(mocks.googleDrive.getUploadedAssetIds).not.toHaveBeenCalled();
      expect(mocks.job.queueAll).not.toHaveBeenCalled();
    });
  });

  describe('handleCallback', () => {
    it('should record which account the token belongs to', async () => {
      // This is what scopes the ledger. Without it every row falls into the '' bucket and a
      // different account reads as "already uploaded" — the original bug.
      const { userId, run } = arrangeLink(mocks, sut)({ newAccountId: 'account-b' });

      await run();

      expect(mocks.googleDrive.upsertCredentials).toHaveBeenCalledWith(userId, 'new-refresh-token', 'account-b');
    });

    it('should never adopt unstamped uploads while linking', async () => {
      // The safety property of the whole design. At link time the token is brand new and may
      // belong to a *different* account than the one those rows were written for; adopting here
      // would stamp another account's uploads with this one and recreate the original bug.
      const { run } = arrangeLink(mocks, sut)({ newAccountId: 'account-b' });

      await run();

      expect(mocks.googleDrive.adoptUnstampedUploads).not.toHaveBeenCalled();
      // Witness: the link itself went through, so the negative above cannot pass by bailing early.
      expect(mocks.googleDrive.upsertCredentials).toHaveBeenCalled();
    });

    it('should clear every failure class, not only the revoked ones', async () => {
      // A quota block or a missing folder described whichever account was connected a moment ago.
      // If the condition still holds for the account connected now, the next upload re-blocks
      // after one attempt; leaving the rows would instead block a fresh connection with nothing
      // in the flow saying to press Resume.
      const { userId, run } = arrangeLink(mocks, sut)({ newAccountId: 'account-b' });

      await run();

      expect(mocks.googleDrive.clearErrors).toHaveBeenCalledWith(
        userId,
        expect.arrayContaining([
          GoogleDriveUploadErrorClass.QuotaExceeded,
          GoogleDriveUploadErrorClass.FolderMissing,
          GoogleDriveUploadErrorClass.Revoked,
        ]),
      );
    });

    it('should link successfully when Drive will not say which account it is', async () => {
      // Best effort: failing a working connection over an identity probe would be a worse trade.
      // The user keeps reading and writing the '' bucket, which is the same place their existing
      // rows live, so nothing re-uploads.
      const { userId, run } = arrangeLink(mocks, sut)({ newAccountId: null });

      await run();

      expect(mocks.googleDrive.upsertCredentials).toHaveBeenCalledWith(userId, 'new-refresh-token', null);
    });
  });

  describe('adoption of pre-column uploads', () => {
    it('should identify the account and adopt its rows when the settings page loads', async () => {
      // getStatus, not getStorage: the settings page calls this one and never calls that one, so
      // this is the hook the documented post-deploy step actually reaches.
      const userId = newUuid();
      mocks.systemMetadata.get.mockResolvedValue({ googleDrive: enabledConfig });
      mocks.googleDrive.getCredentials.mockResolvedValue(unidentified(userId));
      mocks.googleDrive.getErrorSummary.mockResolvedValue({ failedCount: 0, blockedReason: null });
      driveAboutGet.mockResolvedValue({ data: { user: { permissionId: 'account-x' } } });

      await sut.getStatus(userId);

      // The token is part of the call because the update is conditional on it: a re-link landing
      // while the probe is in flight must not leave account A's id beside account B's token.
      expect(mocks.googleDrive.setDriveAccountId).toHaveBeenCalledWith(userId, 'refresh-token', 'account-x');
      expect(mocks.googleDrive.adoptUnstampedUploads).toHaveBeenCalledWith(userId, 'refresh-token', 'account-x');
    });

    it('should record an upload that triggered adoption under the identified account', async () => {
      // The bug this pins: adoption wrote the id to the database but the caller was still holding
      // the credentials it read a moment earlier, so the very upload that triggered adoption filed
      // itself under '' — re-uploading later, and leaving the deploy gate unable to reach zero.
      const userId = newUuid();
      const asset = arrangeReadyToUpload(mocks, userId);
      mocks.googleDrive.getCredentials.mockResolvedValue(unidentified(userId));
      driveAboutGet.mockResolvedValue({ data: { user: { permissionId: 'account-x' } } });
      driveFilesCreate.mockResolvedValue({ data: { id: 'drive-file-id', size: '1024' } });

      await expect(sut.uploadAsset(userId, asset.id)).resolves.toBe('uploaded');

      expect(mocks.googleDrive.recordUpload).toHaveBeenCalledWith(userId, asset.id, 'drive-file-id', 'account-x');
    });

    it('should record under the account another job already stamped', async () => {
      // The upload queue runs five jobs at a time. Four of them lose the race to fill in the blank,
      // and an earlier version treated losing that race as "the account is unknown" and filed the
      // upload under ''. What matters is what the connection now holds, not who wrote it.
      const userId = newUuid();
      const asset = arrangeReadyToUpload(mocks, userId);
      mocks.googleDrive.getCredentials.mockResolvedValue(unidentified(userId));
      // Already stamped by a sibling job: the update matched nothing, and the read returns the id.
      mocks.googleDrive.setDriveAccountId.mockResolvedValue('account-x');
      driveAboutGet.mockResolvedValue({ data: { user: { permissionId: 'account-x' } } });
      driveFilesCreate.mockResolvedValue({ data: { id: 'drive-file-id', size: '1024' } });

      await expect(sut.uploadAsset(userId, asset.id)).resolves.toBe('uploaded');

      expect(mocks.googleDrive.recordUpload).toHaveBeenCalledWith(userId, asset.id, 'drive-file-id', 'account-x');
    });

    it('should not adopt when the connection changed while the probe was in flight', async () => {
      // setDriveAccountId is conditional on the token still being the one we probed with, and
      // returns whether it actually updated. False means somebody re-linked underneath us, and
      // whatever those unstamped rows belong to, it is no longer safe to call it this account.
      const userId = newUuid();
      const asset = arrangeReadyToUpload(mocks, userId);
      mocks.googleDrive.getCredentials.mockResolvedValue(unidentified(userId));
      mocks.googleDrive.setDriveAccountId.mockResolvedValue(null);
      driveAboutGet.mockResolvedValue({ data: { user: { permissionId: 'account-x' } } });
      driveFilesCreate.mockResolvedValue({ data: { id: 'drive-file-id', size: '1024' } });

      await expect(sut.uploadAsset(userId, asset.id)).resolves.toBe('uploaded');

      expect(mocks.googleDrive.adoptUnstampedUploads).not.toHaveBeenCalled();
      // And the upload files itself in the unidentified bucket rather than under an account it
      // cannot vouch for. Witness that the probe really ran, so the negative above is not vacuous.
      expect(mocks.googleDrive.recordUpload).toHaveBeenCalledWith(userId, asset.id, 'drive-file-id', '');
      expect(mocks.googleDrive.setDriveAccountId).toHaveBeenCalled();
    });

    it('should still record under the empty bucket when Drive will not identify the account', async () => {
      // The deliberate fallback: an unidentifiable connection keeps reading and writing the same
      // bucket its existing rows live in, so nothing re-uploads because of a failed probe.
      const userId = newUuid();
      const asset = arrangeReadyToUpload(mocks, userId);
      mocks.googleDrive.getCredentials.mockResolvedValue(unidentified(userId));
      driveAboutGet.mockResolvedValue({ data: { user: {} } });
      driveFilesCreate.mockResolvedValue({ data: { id: 'drive-file-id', size: '1024' } });

      await expect(sut.uploadAsset(userId, asset.id)).resolves.toBe('uploaded');

      expect(mocks.googleDrive.recordUpload).toHaveBeenCalledWith(userId, asset.id, 'drive-file-id', '');
      expect(mocks.googleDrive.adoptUnstampedUploads).not.toHaveBeenCalled();
      // The state is accepted, not silent. An unidentified connection shares the '' bucket with any
      // other unidentified connection this user has had, so if uploads ever stop after a reconnect
      // these lines are the only thing that says why.
      expect(mocks.logger.warn).toHaveBeenCalledWith(expect.stringContaining('did not report a permissionId'));
      expect(mocks.logger.warn).toHaveBeenCalledWith(expect.stringContaining('still unidentified'));
    });
  });

  describe('draining the unstamped bucket', () => {
    it('should hand an unidentified outgoing connection its rows before a re-link replaces it', async () => {
      // The hazard needs no probe failure and no second account: reconnect first, and the
      // pre-column rows are orphaned for good, because adoption early-returns once the new
      // connection carries an id. The next backfill then re-uploads them.
      const { userId, run } = arrangeLink(mocks, sut)({ newAccountId: 'account-b' });
      mocks.googleDrive.getCredentials.mockResolvedValue(unidentified(userId));
      oauth2SetCredentials.mockClear();

      await run();

      // Probed with the *outgoing* token, and adopted into what that probe found. The token
      // assertion is what makes this a test of the drain rather than of adoption in general: the
      // incoming token is 'new-refresh-token', and before this the tests could not tell them apart.
      expect(oauth2SetCredentials).toHaveBeenCalledWith('refresh-token');
      expect(mocks.googleDrive.adoptUnstampedUploads).toHaveBeenCalledWith(userId, 'refresh-token', 'account-b');
      // Order is the point: after the upsert the row carries the new id and the rows would go to
      // the wrong owner, or to none.
      expect(mocks.googleDrive.adoptUnstampedUploads.mock.invocationCallOrder[0]).toBeLessThan(
        mocks.googleDrive.upsertCredentials.mock.invocationCallOrder[0],
      );
    });

    it('should leave the bucket alone when the outgoing connection is already identified', async () => {
      // An identified connection's own uploads are stamped, so anything still unstamped was
      // written by some *earlier* connection. Claiming it here would attribute one account's
      // uploads to another, permanently — the exact failure the drain exists to prevent, and what
      // the first version of it did by reaching for the stored id instead of the token.
      const { userId, run } = arrangeLink(mocks, sut)({ newAccountId: 'account-b' });
      mocks.googleDrive.getCredentials.mockResolvedValue({
        userId,
        refreshToken: 'old-refresh-token',
        driveAccountId: 'account-a',
        folderId: null,
        folderName: null,
        connectedAt: new Date(),
      });

      await run();

      expect(mocks.googleDrive.adoptUnstampedUploads).not.toHaveBeenCalled();
      // Witness: the link itself went through, so the negative cannot pass by bailing out early.
      expect(mocks.googleDrive.upsertCredentials).toHaveBeenCalled();
    });

    it('should drain on disconnect', async () => {
      const userId = newUuid();
      mocks.systemMetadata.get.mockResolvedValue({ googleDrive: enabledConfig });
      mocks.googleDrive.getCredentials.mockResolvedValue(unidentified(userId));
      driveAboutGet.mockResolvedValue({ data: { user: { permissionId: 'account-a' } } });

      await sut.disconnect(userId);

      expect(mocks.googleDrive.adoptUnstampedUploads).toHaveBeenCalledWith(userId, 'refresh-token', 'account-a');
      expect(mocks.googleDrive.adoptUnstampedUploads.mock.invocationCallOrder[0]).toBeLessThan(
        mocks.googleDrive.deleteCredentials.mock.invocationCallOrder[0],
      );
    });

    it('should disconnect even when the outgoing account cannot be identified', async () => {
      // A revoked grant makes the probe fail exactly here. Unlinking an integration must not be
      // something Google can hold up, so the drain is allowed to give up — the rows stay unstamped,
      // which the ledger predicate still treats as uploaded.
      const userId = newUuid();
      mocks.systemMetadata.get.mockResolvedValue({ googleDrive: enabledConfig });
      mocks.googleDrive.getCredentials.mockResolvedValue(unidentified(userId));
      driveAboutGet.mockRejectedValue(new Error('invalid_grant'));

      await sut.disconnect(userId);

      expect(mocks.googleDrive.adoptUnstampedUploads).not.toHaveBeenCalled();
      // The witness that makes the negative mean something: the disconnect still happened.
      expect(mocks.googleDrive.deleteCredentials).toHaveBeenCalledWith(userId);
    });
  });

  describe('handleGoogleDriveUploadQueueAll', () => {
    // The manual backup's entry point, and the only producer of this job — the admin Jobs page.
    // It had no test at all, which matters because it is also the recovery path: when uploads
    // stall, this is the button that restarts them.
    it('should not touch the stream when the feature is off', async () => {
      // The default config has it off. Reaching the repository here would mean the job holds a
      // database cursor open across the whole backlog for a feature nobody enabled.
      await expect(sut.handleGoogleDriveUploadQueueAll()).resolves.toBe(JobStatus.Skipped);

      expect(mocks.googleDrive.streamPendingUploads).not.toHaveBeenCalled();
      expect(mocks.job.queueAll).not.toHaveBeenCalled();
    });

    it('should queue the backlog in batches at the pagination boundary', async () => {
      // 1001 is the interesting number: one full batch plus the remainder, which is where an
      // off-by-one either drops the tail or flushes an empty batch.
      const userId = newUuid();
      mocks.systemMetadata.get.mockResolvedValue({ googleDrive: enabledConfig });
      mocks.googleDrive.streamPendingUploads.mockReturnValue(pendingUploads(userId, 1001));

      await expect(sut.handleGoogleDriveUploadQueueAll()).resolves.toBe(JobStatus.Success);

      expect(mocks.job.queueAll).toHaveBeenCalledTimes(2);
      expect(mocks.job.queueAll.mock.calls[0][0]).toHaveLength(1000);
      expect(mocks.job.queueAll.mock.calls[1][0]).toHaveLength(1);
      // The shape matters as much as the count: the worker keys its dedup on exactly this pair.
      expect(mocks.job.queueAll.mock.calls[1][0][0]).toEqual({
        name: JobName.GoogleDriveUpload,
        data: { userId, assetId: 'asset-1000' },
      });
    });

    it('should still flush the final partial batch when the backlog is small', async () => {
      const userId = newUuid();
      mocks.systemMetadata.get.mockResolvedValue({ googleDrive: enabledConfig });
      mocks.googleDrive.streamPendingUploads.mockReturnValue(pendingUploads(userId, 3));

      await sut.handleGoogleDriveUploadQueueAll();

      expect(mocks.job.queueAll).toHaveBeenCalledTimes(1);
      expect(mocks.job.queueAll.mock.calls[0][0]).toHaveLength(3);
    });
  });

  describe('trashed assets', () => {
    it('should skip an asset that is in the trash', async () => {
      // A photo can be trashed between the job being queued and the worker reaching it. Uploading
      // it anyway would put something in the user's Drive that they had just deleted here.
      const userId = newUuid();
      const asset = arrangeReadyToUpload(mocks, userId);
      mocks.asset.getById.mockResolvedValue({ ...getForAsset(asset), deletedAt: new Date() });
      // driveFilesCreate is hoisted at module scope, so it carries calls from earlier tests in
      // this file; the assertion below is about this test only.
      driveFilesCreate.mockClear();

      await expect(sut.uploadAsset(userId, asset.id)).resolves.toBe('skipped');

      expect(driveFilesCreate).not.toHaveBeenCalled();
      // Not an error either: a trashed asset is an ordinary outcome, and recording it would put a
      // permanent failure in the settings page for something the user did on purpose.
      expect(mocks.googleDrive.upsertError).not.toHaveBeenCalled();
      // The witness that places the skip at this gate rather than an earlier one: nothing ever
      // opened the file. Without it the assertions above would also pass if the feature were off,
      // or the credentials missing, or the ledger already satisfied.
      expect(mocks.storage.createReadStream).not.toHaveBeenCalled();
      expect(mocks.asset.getById).toHaveBeenCalled();
    });
  });
});
