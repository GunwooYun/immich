import { Kysely } from 'kysely';
import { GoogleDriveUploadErrorClass } from 'src/enum';
import { GoogleDriveRepository } from 'src/repositories/google-drive.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { DB } from 'src/schema';
import { BaseService } from 'src/services/base.service';
import { newMediumService } from 'test/medium.factory';
import { getKyselyDB } from 'test/utils';

let defaultDatabase: Kysely<DB>;

const setup = (db?: Kysely<DB>) => {
  const { ctx } = newMediumService(BaseService, {
    database: db || defaultDatabase,
    real: [GoogleDriveRepository],
    mock: [LoggingRepository],
  });
  return { ctx, sut: ctx.get(GoogleDriveRepository) };
};

const drain = <T>(stream: AsyncIterableIterator<T>): Promise<T[]> => Array.fromAsync(stream);

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

/**
 * These exercise the join that decides who receives copies of what, against a real database.
 *
 * The unit tests can only assert that the query builder was called; the property that actually
 * matters — a selection row alone must never produce an upload — lives in the SQL. It is a
 * correctness boundary (feeding someone copies of an album they lost access to), so it is worth
 * proving against Postgres rather than a mock.
 */
const connect = (ctx: any, userId: string, driveAccountId: string | null) =>
  ctx.database.insertInto('user_google_drive').values({ userId, refreshToken: 'token', driveAccountId }).execute();

const ledger = (ctx: any, userId: string, assetId: string, driveAccountId: string) =>
  ctx.database
    .insertInto('google_drive_upload')
    .values({ userId, assetId, driveFileId: `file-${driveAccountId}`, driveAccountId })
    .execute();

describe(`${GoogleDriveRepository.name} (medium)`, () => {
  describe('streamPendingUploads', () => {
    it('should stream assets of an album the user selected and can still see', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      const { album } = await ctx.newAlbum({ ownerId: user.id }, [asset.id]);
      await ctx.database.insertInto('user_google_drive').values({ userId: user.id, refreshToken: 'token' }).execute();
      await ctx.database.insertInto('google_drive_album').values({ userId: user.id, albumId: album.id }).execute();

      const rows = await drain(sut.streamPendingUploads());

      expect(rows).toEqual([{ userId: user.id, assetId: asset.id }]);
    });

    it('should stop streaming once the album is no longer shared with the selector', async () => {
      // The whole point of the membership join. The selection row deliberately survives an
      // unshare (so a re-share resumes it), which is exactly why the row on its own must not be
      // enough to keep feeding someone's Drive.
      const { ctx, sut } = setup();
      const { user: owner } = await ctx.newUser();
      const { user: guest } = await ctx.newUser();
      const { asset } = await ctx.newAsset({ ownerId: owner.id });
      const { album } = await ctx.newAlbum({ ownerId: owner.id }, [asset.id]);
      const { albumUser } = await ctx.newAlbumUser({ albumId: album.id, userId: guest.id });
      await ctx.database.insertInto('user_google_drive').values({ userId: guest.id, refreshToken: 'token' }).execute();
      await ctx.database.insertInto('google_drive_album').values({ userId: guest.id, albumId: album.id }).execute();

      await expect(drain(sut.streamPendingUploads(guest.id))).resolves.toHaveLength(1);

      // Revoke the share; the selection row stays behind.
      await ctx.database
        .deleteFrom('album_user')
        .where('albumId', '=', albumUser.albumId)
        .where('userId', '=', guest.id)
        .execute();

      await expect(drain(sut.streamPendingUploads(guest.id))).resolves.toEqual([]);
      // …and the selection itself survives, so re-sharing resumes without the user re-picking.
      await expect(sut.isSubscribed(guest.id, album.id)).resolves.toBe(true);
    });

    it('should not stream for a selector who has not connected Drive', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      const { album } = await ctx.newAlbum({ ownerId: user.id }, [asset.id]);
      await ctx.database.insertInto('google_drive_album').values({ userId: user.id, albumId: album.id }).execute();

      await expect(drain(sut.streamPendingUploads(user.id))).resolves.toEqual([]);
    });
  });

  describe('getSubscribableAlbums', () => {
    it('should surface a selection whose album is no longer shared, flagged accessLost', async () => {
      // Uploads stopping is correct; disappearing from the list would make the stop invisible,
      // which is the failure pattern this feature keeps working to eliminate.
      const { ctx, sut } = setup();
      const { user: owner } = await ctx.newUser();
      const { user: guest } = await ctx.newUser();
      const { album } = await ctx.newAlbum({ ownerId: owner.id });
      await ctx.newAlbumUser({ albumId: album.id, userId: guest.id });
      await ctx.database.insertInto('google_drive_album').values({ userId: guest.id, albumId: album.id }).execute();

      const before = await sut.getSubscribableAlbums(guest.id);
      expect(before.find((row) => row.albumId === album.id)).toMatchObject({ subscribed: true, accessLost: false });

      await ctx.database
        .deleteFrom('album_user')
        .where('albumId', '=', album.id)
        .where('userId', '=', guest.id)
        .execute();

      const after = await sut.getSubscribableAlbums(guest.id);
      expect(after.find((row) => row.albumId === album.id)).toMatchObject({ subscribed: true, accessLost: true });
    });
  });

  describe('isAssetInSubscribedAlbum', () => {
    // The worker's deselect gate. This is the one join the feature keeps getting subtly wrong, and
    // a mocked unit test can only assert it was called — the filtering itself has to be proven on
    // real Postgres.
    it('should be true for an asset in an album the user selected and can see', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      const { album } = await ctx.newAlbum({ ownerId: user.id }, [asset.id]);
      await ctx.database.insertInto('google_drive_album').values({ userId: user.id, albumId: album.id }).execute();

      await expect(sut.isAssetInSubscribedAlbum(user.id, asset.id)).resolves.toBe(true);
    });

    it('should be false once the album is deselected, even with the asset still in it', async () => {
      // Deselect deletes the selection row; the gate must then reject the asset's queued jobs.
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      const { album } = await ctx.newAlbum({ ownerId: user.id }, [asset.id]);
      await ctx.database.insertInto('google_drive_album').values({ userId: user.id, albumId: album.id }).execute();
      await expect(sut.isAssetInSubscribedAlbum(user.id, asset.id)).resolves.toBe(true);

      await sut.unsubscribe(user.id, album.id);

      await expect(sut.isAssetInSubscribedAlbum(user.id, asset.id)).resolves.toBe(false);
    });

    it('should stay true when the asset is in another still-selected album', async () => {
      // "Any selected album", not "this one": deselecting A must not stop uploads owed to B.
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      const { album: a } = await ctx.newAlbum({ ownerId: user.id }, [asset.id]);
      const { album: b } = await ctx.newAlbum({ ownerId: user.id }, [asset.id]);
      await ctx.database
        .insertInto('google_drive_album')
        .values([
          { userId: user.id, albumId: a.id },
          { userId: user.id, albumId: b.id },
        ])
        .execute();

      await sut.unsubscribe(user.id, a.id);

      await expect(sut.isAssetInSubscribedAlbum(user.id, asset.id)).resolves.toBe(true);
    });

    it('should be false once the album is unshared, even with the selection row surviving', async () => {
      // Second live-access enforcement point: the selection row outlives an unshare so a re-share
      // resumes, but the gate must stop uploads to an album the user can no longer open.
      const { ctx, sut } = setup();
      const { user: owner } = await ctx.newUser();
      const { user: guest } = await ctx.newUser();
      const { asset } = await ctx.newAsset({ ownerId: owner.id });
      const { album } = await ctx.newAlbum({ ownerId: owner.id }, [asset.id]);
      await ctx.newAlbumUser({ albumId: album.id, userId: guest.id });
      await ctx.database.insertInto('google_drive_album').values({ userId: guest.id, albumId: album.id }).execute();
      await expect(sut.isAssetInSubscribedAlbum(guest.id, asset.id)).resolves.toBe(true);

      await ctx.database
        .deleteFrom('album_user')
        .where('albumId', '=', album.id)
        .where('userId', '=', guest.id)
        .execute();

      await expect(sut.isAssetInSubscribedAlbum(guest.id, asset.id)).resolves.toBe(false);
      // …and the selection row is still there, so a re-share resumes without re-picking.
      await expect(sut.isSubscribed(guest.id, album.id)).resolves.toBe(true);
    });

    it('should be false once the album is soft-deleted, matching the stream predicate', async () => {
      // The gap S1 closed: deleting a user (UserAdminService#delete → albumRepository.softDeleteAll)
      // soft-deletes every album they own, but does not cascade to album_asset, album_user, or
      // google_drive_album. A guest's selection and membership survive, so without the album join +
      // deletedAt filter the gate would still say "true" and drain the guest's queued backlog into
      // their Drive — an album the card (countPendingUploads) already reports as empty and the
      // settings list (getSubscribableAlbums) no longer shows. Prove the gate now agrees with them.
      const { ctx, sut } = setup();
      const { user: owner } = await ctx.newUser();
      const { user: guest } = await ctx.newUser();
      const { asset } = await ctx.newAsset({ ownerId: owner.id });
      const { album } = await ctx.newAlbum({ ownerId: owner.id }, [asset.id]);
      await ctx.newAlbumUser({ albumId: album.id, userId: guest.id });
      await ctx.database.insertInto('google_drive_album').values({ userId: guest.id, albumId: album.id }).execute();
      await expect(sut.isAssetInSubscribedAlbum(guest.id, asset.id)).resolves.toBe(true);

      // Exactly what softDeleteAll does: stamp album.deletedAt, nothing else.
      await ctx.database.updateTable('album').set({ deletedAt: new Date() }).where('id', '=', album.id).execute();

      await expect(sut.isAssetInSubscribedAlbum(guest.id, asset.id)).resolves.toBe(false);
      // The selection row still exists — the leak was that the gate ignored the album's deletion,
      // not that the row was cleaned up.
      await expect(sut.isSubscribed(guest.id, album.id)).resolves.toBe(true);
    });

    it('should stay true when the asset is also in a live selected album, not over-drop', async () => {
      // The counterpart of "still true via a second selected album", at album-lifetime
      // granularity: the S1 filter must reject only the soft-deleted album, not the whole asset.
      // This is the assertion that fails if someone later "simplifies" the album join away or
      // widens the deletedAt filter — same "any selected album" rule as deselect.
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      const { album: live } = await ctx.newAlbum({ ownerId: user.id }, [asset.id]);
      const { album: dead } = await ctx.newAlbum({ ownerId: user.id }, [asset.id]);
      await ctx.database
        .insertInto('google_drive_album')
        .values([
          { userId: user.id, albumId: live.id },
          { userId: user.id, albumId: dead.id },
        ])
        .execute();

      await ctx.database.updateTable('album').set({ deletedAt: new Date() }).where('id', '=', dead.id).execute();

      // The live album still owes the upload, so the gate must not drop the asset.
      await expect(sut.isAssetInSubscribedAlbum(user.id, asset.id)).resolves.toBe(true);
    });
  });

  /**
   * The automatic path's entry point. Every asset added to an album goes through this, and it was
   * the only one of the three access queries missing the soft-delete and blocking filters — so it
   * queued jobs the worker would always skip, and a blocked user's flood made the shared queue
   * look active enough that the admin "queue all" button refused to start.
   */
  describe('getSubscribers', () => {
    it('should return the user who selected an album they can still see', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { album } = await ctx.newAlbum({ ownerId: user.id });
      await ctx.database.insertInto('user_google_drive').values({ userId: user.id, refreshToken: 'token' }).execute();
      await ctx.database.insertInto('google_drive_album').values({ userId: user.id, albumId: album.id }).execute();

      await expect(sut.getSubscribers([album.id])).resolves.toEqual([{ albumId: album.id, userId: user.id }]);
    });

    it('should not return a user whose album has been soft-deleted', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { album } = await ctx.newAlbum({ ownerId: user.id });
      await ctx.database.insertInto('user_google_drive').values({ userId: user.id, refreshToken: 'token' }).execute();
      await ctx.database.insertInto('google_drive_album').values({ userId: user.id, albumId: album.id }).execute();

      // Witness first: without this the empty result below could come from a broken fixture rather
      // than from the filter under test.
      await expect(sut.getSubscribers([album.id])).resolves.toHaveLength(1);

      await ctx.database.updateTable('album').set({ deletedAt: new Date() }).where('id', '=', album.id).execute();

      await expect(sut.getSubscribers([album.id])).resolves.toEqual([]);
    });

    it('should not return a user blocked by a quota or a missing folder', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      const { album } = await ctx.newAlbum({ ownerId: user.id }, [asset.id]);
      await ctx.database.insertInto('user_google_drive').values({ userId: user.id, refreshToken: 'token' }).execute();
      await ctx.database.insertInto('google_drive_album').values({ userId: user.id, albumId: album.id }).execute();

      await expect(sut.getSubscribers([album.id])).resolves.toHaveLength(1);

      await ctx.database
        .insertInto('google_drive_upload_error')
        .values({
          userId: user.id,
          assetId: asset.id,
          error: GoogleDriveUploadErrorClass.QuotaExceeded,
          detail: null,
          attempts: 1,
          lastFailedAt: new Date(),
        })
        .execute();

      await expect(sut.getSubscribers([album.id])).resolves.toEqual([]);
    });

    it('should still return a user whose only failures are ordinary ones', async () => {
      // Only the account-level classes gate the whole user. A single unreadable file must not stop
      // every other asset in every album from being queued.
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      const { album } = await ctx.newAlbum({ ownerId: user.id }, [asset.id]);
      await ctx.database.insertInto('user_google_drive').values({ userId: user.id, refreshToken: 'token' }).execute();
      await ctx.database.insertInto('google_drive_album').values({ userId: user.id, albumId: album.id }).execute();
      await ctx.database
        .insertInto('google_drive_upload_error')
        .values({
          userId: user.id,
          assetId: asset.id,
          error: GoogleDriveUploadErrorClass.SourceUnreadable,
          detail: null,
          attempts: 1,
          lastFailedAt: new Date(),
        })
        .execute();

      await expect(sut.getSubscribers([album.id])).resolves.toEqual([{ albumId: album.id, userId: user.id }]);
    });

    it('should not return a user who has not connected Drive', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { album } = await ctx.newAlbum({ ownerId: user.id });
      await ctx.database.insertInto('google_drive_album').values({ userId: user.id, albumId: album.id }).execute();

      await expect(sut.getSubscribers([album.id])).resolves.toEqual([]);
    });
  });

  /**
   * The account-scoped ledger. These are the tests that prove the design rather than the code:
   * "already uploaded" must mean "already uploaded *to the account currently connected*", and it
   * must keep meaning that across a disconnect, a switch, and a switch back.
   */
  describe('account-scoped ledger', () => {
    it('should hide a row written for another account', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      await connect(ctx, user.id, 'account-x');
      await ledger(ctx, user.id, asset.id, 'account-x');

      // Witness first: under the account it was written for, it is visible. Without this the
      // negative below could come from a fixture that never inserted anything.
      await expect(sut.hasUpload(user.id, asset.id)).resolves.toBe(true);

      await ctx.database
        .updateTable('user_google_drive')
        .set({ driveAccountId: 'account-y' })
        .where('userId', '=', user.id)
        .execute();

      await expect(sut.hasUpload(user.id, asset.id)).resolves.toBe(false);
      await expect(sut.getUploadedAssetIds(user.id, [asset.id])).resolves.toEqual(new Set());
    });

    it('should show it again after switching back', async () => {
      // The property that makes this design better than resetting the ledger: switching back to a
      // previous account re-uploads nothing. A reset would have destroyed these rows.
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      await connect(ctx, user.id, 'account-y');
      await ledger(ctx, user.id, asset.id, 'account-x');

      await expect(sut.hasUpload(user.id, asset.id)).resolves.toBe(false);

      await ctx.database
        .updateTable('user_google_drive')
        .set({ driveAccountId: 'account-x' })
        .where('userId', '=', user.id)
        .execute();

      await expect(sut.hasUpload(user.id, asset.id)).resolves.toBe(true);
    });

    it('should move the pending count with the connected account', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      const { album } = await ctx.newAlbum({ ownerId: user.id }, [asset.id]);
      await connect(ctx, user.id, 'account-x');
      await ctx.database.insertInto('google_drive_album').values({ userId: user.id, albumId: album.id }).execute();
      await ledger(ctx, user.id, asset.id, 'account-x');

      await expect(sut.countPendingUploads(user.id)).resolves.toBe(0);
      await expect(drain(sut.streamPendingUploads(user.id))).resolves.toEqual([]);

      await ctx.database
        .updateTable('user_google_drive')
        .set({ driveAccountId: 'account-y' })
        .where('userId', '=', user.id)
        .execute();

      await expect(sut.countPendingUploads(user.id)).resolves.toBe(1);
      await expect(drain(sut.streamPendingUploads(user.id))).resolves.toEqual([{ userId: user.id, assetId: asset.id }]);
    });

    it('should still treat pre-column rows as uploaded while the account is unidentified', async () => {
      // The deploy-safety test. Existing rows carry '' and a connection that has not been probed
      // yet carries null; they have to match, or the first deploy re-uploads everyone's library.
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      await connect(ctx, user.id, null);
      await ledger(ctx, user.id, asset.id, '');

      await expect(sut.hasUpload(user.id, asset.id)).resolves.toBe(true);
    });

    it('should refuse to stamp an account onto a connection whose token has changed', async () => {
      // The guard that keeps a probe from attaching account A's id to account B's token. Without
      // matching on the token, a re-link landing while the probe is in flight leaves the row
      // permanently mismatched — and mismatched in the direction that silently stops uploads.
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      await ctx.database
        .insertInto('user_google_drive')
        .values({ userId: user.id, refreshToken: 'token-b', driveAccountId: null })
        .execute();

      await expect(sut.setDriveAccountId(user.id, 'token-a', 'account-x')).resolves.toBeNull();

      const row = await ctx.database
        .selectFrom('user_google_drive')
        .select('driveAccountId')
        .where('userId', '=', user.id)
        .executeTakeFirst();
      expect(row?.driveAccountId).toBeNull();

      // Witness: with the right token it does settle, so the null above is the guard and not a
      // broken fixture.
      await expect(sut.setDriveAccountId(user.id, 'token-b', 'account-x')).resolves.toBe('account-x');
    });

    it('should report the account a concurrent stamp already settled on', async () => {
      // Losing the race to fill the blank is not failure: the caller needs to know what the
      // connection holds, or its upload lands in the '' bucket.
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      await ctx.database
        .insertInto('user_google_drive')
        .values({ userId: user.id, refreshToken: 'token-a', driveAccountId: 'account-x' })
        .execute();

      await expect(sut.setDriveAccountId(user.id, 'token-a', 'account-x')).resolves.toBe('account-x');
    });

    it('should keep treating unstamped rows as uploaded even once the account is known', async () => {
      // The safety net (R3). A drain can fail — a revoked grant, a network blip — and the
      // alternative to matching these rows is calling thousands of already-uploaded files pending.
      // files.create has no idempotency check, so that means duplicates nobody can take back.
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { asset: legacy } = await ctx.newAsset({ ownerId: user.id });
      const { asset: elsewhere } = await ctx.newAsset({ ownerId: user.id });
      await connect(ctx, user.id, 'account-x');
      await ledger(ctx, user.id, legacy.id, '');
      await ledger(ctx, user.id, elsewhere.id, 'account-y');

      await expect(sut.hasUpload(user.id, legacy.id)).resolves.toBe(true);
      // The other half, and what stops this from being degenerately true: a row belonging to a
      // *different* named account still does not match.
      await expect(sut.hasUpload(user.id, elsewhere.id)).resolves.toBe(false);
    });

    it('should not claim unstamped rows written before this connection existed', async () => {
      // The mis-attribution this design keeps circling back to: account A uploads while
      // unidentified and goes away, B connects and is also unidentified at first, and B's later
      // probe would stamp A's rows as B's. A reconnecting then finds its own uploads recorded
      // against somebody else and sends every one of them again.
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      // Explicit timestamps rather than two defaulted now() calls: the point of the test is that
      // the upload is older than the connection, and leaving that to clock resolution would make
      // it pass or fail for reasons unrelated to the code.
      await ctx.database
        .insertInto('google_drive_upload')
        .values({
          userId: user.id,
          assetId: asset.id,
          driveFileId: 'file-old',
          driveAccountId: '',
          uploadedAt: new Date('2026-01-01T00:00:00Z'),
        })
        .execute();
      await ctx.database
        .insertInto('user_google_drive')
        .values({
          userId: user.id,
          refreshToken: 'token-b',
          driveAccountId: null,
          connectedAt: new Date('2026-06-01T00:00:00Z'),
        })
        .execute();

      await expect(sut.adoptUnstampedUploads(user.id, 'token-b', 'account-b')).resolves.toBe(true);

      const row = await ctx.database
        .selectFrom('google_drive_upload')
        .select('driveAccountId')
        .where('userId', '=', user.id)
        .where('assetId', '=', asset.id)
        .executeTakeFirst();
      // Left unstamped — and still counted as uploaded by the ledger predicate, so nothing
      // re-uploads because of it.
      expect(row?.driveAccountId).toBe('');
      await expect(sut.hasUpload(user.id, asset.id)).resolves.toBe(true);
    });

    it('should refuse to adopt when the connection moved during the probe', async () => {
      // Compare-and-set under a row lock, not a re-read: the probe is a network round trip and a
      // re-link can land inside it.
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      await ctx.database
        .insertInto('user_google_drive')
        .values({ userId: user.id, refreshToken: 'token-b', driveAccountId: null })
        .execute();

      await expect(sut.adoptUnstampedUploads(user.id, 'token-a', 'account-a')).resolves.toBe(false);
    });

    it('should adopt pre-column rows without colliding with rows already stamped', async () => {
      // An asset can already have a stamped row — uploaded again after the column shipped — and
      // the '' row for it cannot simply be updated onto that primary key.
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { user: other } = await ctx.newUser();
      const { asset: both } = await ctx.newAsset({ ownerId: user.id });
      const { asset: onlyUnstamped } = await ctx.newAsset({ ownerId: user.id });
      const { asset: otherUsers } = await ctx.newAsset({ ownerId: other.id });
      await connect(ctx, user.id, 'account-x');
      // The connection is created first on purpose: adoption only claims rows written after it,
      // so a fixture that seeds the ledger first would prove nothing.
      await ledger(ctx, user.id, both.id, '');
      await ledger(ctx, user.id, both.id, 'account-x');
      await ledger(ctx, user.id, onlyUnstamped.id, '');
      await ledger(ctx, other.id, otherUsers.id, '');

      await sut.adoptUnstampedUploads(user.id, 'token', 'account-x');

      // Scoped to these two users: the medium suite shares one database, so an unscoped count
      // would include rows other tests in this file left behind.
      const rows = await ctx.database
        .selectFrom('google_drive_upload')
        .select(['userId', 'assetId', 'driveAccountId'])
        .where('userId', 'in', [user.id, other.id])
        .orderBy('userId')
        .execute();

      // The colliding '' row is gone, the lone one is stamped, and the other user is untouched.
      expect(rows).toEqual(
        expect.arrayContaining([
          { userId: user.id, assetId: both.id, driveAccountId: 'account-x' },
          { userId: user.id, assetId: onlyUnstamped.id, driveAccountId: 'account-x' },
          { userId: other.id, assetId: otherUsers.id, driveAccountId: '' },
        ]),
      );
      expect(rows).toHaveLength(3);
    });
  });

  /**
   * The bespoke SQL. `upsertError` is a hand-written CTE, `getErrorSummary` is an anti-join, and
   * `recordUpload` clears the error row inside the same transaction — none of which a mocked unit
   * test can say anything about, and all of which decide what the settings page reports.
   */
  describe('failure bookkeeping', () => {
    it('should call only the first failure of a class first, and count attempts after that', async () => {
      // firstOfClass gates the notification. Wrong in one direction it spams on every retry; wrong
      // in the other the user is never told their backups stopped.
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { asset: first } = await ctx.newAsset({ ownerId: user.id });
      const { asset: second } = await ctx.newAsset({ ownerId: user.id });

      await expect(
        sut.upsertError(user.id, first.id, GoogleDriveUploadErrorClass.QuotaExceeded, 'full'),
      ).resolves.toEqual({ firstOfClass: true });

      // A second asset, same class: no longer the first.
      await expect(
        sut.upsertError(user.id, second.id, GoogleDriveUploadErrorClass.QuotaExceeded, 'full'),
      ).resolves.toEqual({ firstOfClass: false });

      // The same asset again: still not first, and the attempt counter moves.
      await expect(
        sut.upsertError(user.id, first.id, GoogleDriveUploadErrorClass.QuotaExceeded, 'full'),
      ).resolves.toEqual({ firstOfClass: false });

      const row = await ctx.database
        .selectFrom('google_drive_upload_error')
        .select('attempts')
        .where('userId', '=', user.id)
        .where('assetId', '=', first.id)
        .executeTakeFirst();
      expect(row?.attempts).toBe(2);
    });

    it('should treat a different class as first again', async () => {
      // Per class, not per user: a folder going missing after a quota problem is news.
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { asset } = await ctx.newAsset({ ownerId: user.id });

      await sut.upsertError(user.id, asset.id, GoogleDriveUploadErrorClass.QuotaExceeded, 'full');

      await expect(
        sut.upsertError(user.id, asset.id, GoogleDriveUploadErrorClass.FolderMissing, 'gone'),
      ).resolves.toEqual({ firstOfClass: true });
    });

    it('should clear the failure row when the upload finally succeeds', async () => {
      // The only path that clears a failure, and it runs in the same transaction as the ledger
      // write so an asset can never be both uploaded and failed.
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      await connect(ctx, user.id, 'account-x');
      await sut.upsertError(user.id, asset.id, GoogleDriveUploadErrorClass.Unknown, 'boom');

      await expect(sut.getErrorSummary(user.id)).resolves.toEqual({ failedCount: 1, blockedReason: null });

      await sut.recordUpload(user.id, asset.id, 'drive-file-id', 'account-x');

      // The row itself has to be gone, not merely hidden: getErrorSummary's anti-join would report
      // zero either way once the ledger row exists, so asking it proves nothing about the delete.
      const remaining = await ctx.database
        .selectFrom('google_drive_upload_error')
        .select('assetId')
        .where('userId', '=', user.id)
        .execute();
      expect(remaining).toEqual([]);
    });

    it('should not count a failure whose asset has since been uploaded', async () => {
      // The anti-join. A stale error row beside a ledger row must read as zero, or the settings
      // page reports failures for photos that are already in Drive.
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      await connect(ctx, user.id, 'account-x');
      await sut.upsertError(user.id, asset.id, GoogleDriveUploadErrorClass.Unknown, 'boom');
      await ledger(ctx, user.id, asset.id, 'account-x');

      await expect(sut.getErrorSummary(user.id)).resolves.toEqual({ failedCount: 0, blockedReason: null });

      // Witness: without the ledger row the same fixture counts one, so the zero above is the
      // anti-join and not an empty table.
      const { asset: other } = await ctx.newAsset({ ownerId: user.id });
      await sut.upsertError(user.id, other.id, GoogleDriveUploadErrorClass.Unknown, 'boom');
      await expect(sut.getErrorSummary(user.id)).resolves.toEqual({ failedCount: 1, blockedReason: null });
    });

    it('should report quota ahead of a missing folder when both are recorded', async () => {
      // Both block the account; the tie-break decides which message the user gets.
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { asset: a } = await ctx.newAsset({ ownerId: user.id });
      const { asset: b } = await ctx.newAsset({ ownerId: user.id });
      await sut.upsertError(user.id, a.id, GoogleDriveUploadErrorClass.FolderMissing, 'gone');
      await sut.upsertError(user.id, b.id, GoogleDriveUploadErrorClass.QuotaExceeded, 'full');

      await expect(sut.getBlockingError(user.id)).resolves.toBe(GoogleDriveUploadErrorClass.QuotaExceeded);
    });
  });
});
