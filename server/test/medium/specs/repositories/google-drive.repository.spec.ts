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
      await ledger(ctx, user.id, both.id, '');
      await ledger(ctx, user.id, both.id, 'account-x');
      await ledger(ctx, user.id, onlyUnstamped.id, '');
      await ledger(ctx, other.id, otherUsers.id, '');

      await sut.adoptUnstampedUploads(user.id, 'account-x');

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
});
