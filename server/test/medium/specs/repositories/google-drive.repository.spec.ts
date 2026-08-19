import { Kysely } from 'kysely';
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
});
