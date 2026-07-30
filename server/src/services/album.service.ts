import { BadRequestException, Injectable } from '@nestjs/common';
import {
  AddUsersDto,
  AlbumResponseDto,
  AlbumsAddAssetsDto,
  AlbumsAddAssetsResponseDto,
  AlbumStatisticsResponseDto,
  CreateAlbumDto,
  GetAlbumsDto,
  mapAlbum,
  UpdateAlbumDto,
  UpdateAlbumUserDto,
} from 'src/dtos/album.dto';
import { BulkIdErrorReason, BulkIdResponseDto, BulkIdsDto } from 'src/dtos/asset-ids.response.dto';
import { AuthDto } from 'src/dtos/auth.dto';
import { MapMarkerResponseDto } from 'src/dtos/map.dto';
import { AlbumUserRole, JobName, Permission } from 'src/enum';
import { AlbumAssetCount, AlbumInfoOptions } from 'src/repositories/album.repository';
import { BaseService } from 'src/services/base.service';
import { addAssets, removeAssets } from 'src/utils/asset.util';
import { asDateTimeString } from 'src/utils/date';
import { getPreferences } from 'src/utils/preferences';

@Injectable()
export class AlbumService extends BaseService {
  async getStatistics(auth: AuthDto): Promise<AlbumStatisticsResponseDto> {
    const [owned, shared, notShared] = await Promise.all([
      this.albumRepository.getAll(auth.user.id, { isOwned: true }),
      this.albumRepository.getAll(auth.user.id, { isShared: true }),
      this.albumRepository.getAll(auth.user.id, { isOwned: true, isShared: false }),
    ]);

    return {
      owned: owned.length,
      shared: shared.length,
      notShared: notShared.length,
    };
  }

  async getAll({ user: { id: ownerId } }: AuthDto, { assetId, ...rest }: GetAlbumsDto): Promise<AlbumResponseDto[]> {
    await this.albumRepository.updateThumbnails();

    const albums = assetId
      ? await this.albumRepository.getByAssetId(ownerId, assetId)
      : await this.albumRepository.getAll(ownerId, rest);

    if (albums.length === 0) {
      return [];
    }

    // Get asset count for each album. Then map the result to an object:
    // { [albumId]: assetCount }
    const results = await this.albumRepository.getMetadataForIds(albums.map((album) => album.id));
    const albumMetadata: Record<string, AlbumAssetCount> = {};
    for (const metadata of results) {
      albumMetadata[metadata.albumId] = metadata;
    }

    return albums.map((album) => ({
      ...mapAlbum(album),
      sharedLinks: undefined,
      startDate: asDateTimeString(albumMetadata[album.id]?.startDate ?? undefined),
      endDate: asDateTimeString(albumMetadata[album.id]?.endDate ?? undefined),
      assetCount: albumMetadata[album.id]?.assetCount ?? 0,
      // lastModifiedAssetTimestamp is only used in mobile app, please remove if not need
      lastModifiedAssetTimestamp: asDateTimeString(albumMetadata[album.id]?.lastModifiedAssetTimestamp ?? undefined),
    }));
  }

  async get(auth: AuthDto, id: string): Promise<AlbumResponseDto> {
    await this.requireAccess({ auth, permission: Permission.AlbumRead, ids: [id] });
    await this.albumRepository.updateThumbnails();
    const album = await this.findOrFail(id, auth.user.id, { withAssets: false });
    const [albumMetadataForIds] = await this.albumRepository.getMetadataForIds([album.id]);

    const hasSharedUsers = album.albumUsers && album.albumUsers.length > 1;
    const hasSharedLink = album.sharedLinks && album.sharedLinks.length > 0;
    const isShared = hasSharedUsers || hasSharedLink;

    return {
      ...mapAlbum(album),
      startDate: asDateTimeString(albumMetadataForIds?.startDate ?? undefined),
      endDate: asDateTimeString(albumMetadataForIds?.endDate ?? undefined),
      assetCount: albumMetadataForIds?.assetCount ?? 0,
      lastModifiedAssetTimestamp: asDateTimeString(albumMetadataForIds?.lastModifiedAssetTimestamp ?? undefined),
      contributorCounts: isShared ? await this.albumRepository.getContributorCounts(album.id) : undefined,
    };
  }

  async getMapMarkers(auth: AuthDto, id: string): Promise<MapMarkerResponseDto[]> {
    await this.requireAccess({ auth, permission: Permission.AlbumRead, ids: [id] });

    if (auth.sharedLink && !auth.sharedLink.showExif) {
      return [];
    }

    return this.mapRepository.getAlbumMapMarkers(id);
  }

  async create(auth: AuthDto, dto: CreateAlbumDto): Promise<AlbumResponseDto> {
    const albumUsers = (dto.albumUsers || []).filter(({ userId }) => userId !== auth.user.id);

    for (const { userId } of albumUsers) {
      const exists = await this.userRepository.get(userId, {});
      if (!exists) {
        this.logger.debug('Album creation failed: user not found');
        throw new BadRequestException('Invalid user');
      }
    }

    const allowedAssetIdsSet = await this.checkAccess({
      auth,
      permission: Permission.AssetShare,
      ids: dto.assetIds || [],
    });
    const assetIds = [...allowedAssetIdsSet].map((id) => id);

    const userMetadata = await this.userRepository.getMetadata(auth.user.id);

    const album = await this.albumRepository.create(
      {
        albumName: dto.albumName,
        description: dto.description,
        albumThumbnailAssetId: assetIds[0] || null,
        order: getPreferences(userMetadata).albums.defaultAssetOrder,
      },
      assetIds,
      [{ userId: auth.user.id, role: AlbumUserRole.Owner }, ...albumUsers],
      auth.user.id,
    );

    for (const { userId } of albumUsers) {
      await this.eventRepository.emit('AlbumInvite', { id: album.id, userId, senderName: auth.user.name });
    }

    return mapAlbum(album);
  }

  async update(auth: AuthDto, id: string, dto: UpdateAlbumDto): Promise<AlbumResponseDto> {
    await this.requireAccess({ auth, permission: Permission.AlbumUpdate, ids: [id] });

    const album = await this.findOrFail(id, auth.user.id, { withAssets: true });

    if (dto.albumThumbnailAssetId) {
      const results = await this.albumRepository.getAssetIds(id, [dto.albumThumbnailAssetId]);
      if (results.size === 0) {
        throw new BadRequestException('Invalid album thumbnail');
      }
    }
    const updatedAlbum = await this.albumRepository.update(
      album.id,
      {
        id: album.id,
        albumName: dto.albumName,
        description: dto.description,
        albumThumbnailAssetId: dto.albumThumbnailAssetId,
        isActivityEnabled: dto.isActivityEnabled,
        order: dto.order,
      },
      auth.user.id,
    );

    return mapAlbum({ ...updatedAlbum, assets: album.assets });
  }

  async delete(auth: AuthDto, id: string): Promise<void> {
    await this.requireAccess({ auth, permission: Permission.AlbumDelete, ids: [id] });
    await this.albumRepository.delete(id);
  }

  async addAssets(auth: AuthDto, id: string, dto: BulkIdsDto): Promise<BulkIdResponseDto[]> {
    const album = await this.findOrFail(id, auth.user.id, { withAssets: false });
    await this.requireAccess({ auth, permission: Permission.AlbumAssetCreate, ids: [id] });

    const results = await addAssets(
      auth,
      { access: this.accessRepository, bulk: this.albumRepository },
      { parentId: id, assetIds: dto.ids },
    );

    // Google Drive integration: whenever assets are successfully added to an album, queue a
    // background job to mirror each one to the album *owner's* Google Drive (not the acting
    // user's — see queueGoogleDriveUploads/getAlbumOwnerId below for why). This runs after
    // addAssets() has already committed the album_asset rows, so we only ever queue uploads for
    // assets that actually made it into the album.
    await this.queueGoogleDriveUploads(this.getAlbumOwnerId(album), results.filter((r) => r.success).map((r) => r.id));

    const { id: firstNewAssetId } = results.find(({ success }) => success) || {};
    if (firstNewAssetId) {
      await this.albumRepository.update(
        id,
        {
          id,
          updatedAt: new Date(),
          albumThumbnailAssetId: album.albumThumbnailAssetId ?? firstNewAssetId,
        },
        auth.user.id,
      );

      const allUsersExceptUs = album.albumUsers.map(({ user }) => user.id).filter((userId) => userId !== auth.user.id);

      for (const recipientId of allUsersExceptUs) {
        await this.eventRepository.emit('AlbumUpdate', { id, recipientId });
      }
    }

    return results;
  }

  async addAssetsToAlbums(auth: AuthDto, dto: AlbumsAddAssetsDto): Promise<AlbumsAddAssetsResponseDto> {
    const results: AlbumsAddAssetsResponseDto = {
      success: false,
      error: BulkIdErrorReason.DUPLICATE,
    };

    const allowedAlbumIds = await this.checkAccess({
      auth,
      permission: Permission.AlbumAssetCreate,
      ids: dto.albumIds,
    });
    if (allowedAlbumIds.size === 0) {
      results.error = BulkIdErrorReason.NO_PERMISSION;
      return results;
    }

    const allowedAssetIds = await this.checkAccess({ auth, permission: Permission.AssetShare, ids: dto.assetIds });
    if (allowedAssetIds.size === 0) {
      results.error = BulkIdErrorReason.NO_PERMISSION;
      return results;
    }

    const albumAssetValues: { albumId: string; assetId: string }[] = [];
    const events: { id: string; recipients: string[] }[] = [];
    // Google Drive integration: this endpoint can add assets to *multiple* albums (possibly
    // owned by different people) in one call, so we can't just queue upload jobs as we go the
    // way addAssets() above does — different albums here can have different owners, and we want
    // to batch all the upload jobs for a given owner into a single queueAll() call at the end
    // (see the loop right after addAssetIdsToAlbums below) rather than one queue() call per
    // asset. This map accumulates "which assets need uploading, grouped by whose Drive they go
    // to" as we walk through each album.
    const pendingUploadsByOwner = new Map<string, Set<string>>();
    for (const albumId of allowedAlbumIds) {
      const existingAssetIds = await this.albumRepository.getAssetIds(albumId, [...allowedAssetIds]);
      const notPresentAssetIds = [...allowedAssetIds].filter((id) => !existingAssetIds.has(id));
      if (notPresentAssetIds.length === 0) {
        continue;
      }
      const album = await this.findOrFail(albumId, auth.user.id, { withAssets: false });
      results.error = undefined;
      results.success = true;

      for (const assetId of notPresentAssetIds) {
        albumAssetValues.push({ albumId, assetId });
      }

      // Record these assets against the *album's owner* (not necessarily the person making this
      // request — someone with edit access to a shared album can add assets too). We only decide
      // whether to actually queue an upload job later, after checking the dedup ledger.
      const ownerId = this.getAlbumOwnerId(album);
      const pending = pendingUploadsByOwner.get(ownerId) ?? new Set<string>();
      for (const assetId of notPresentAssetIds) {
        pending.add(assetId);
      }
      pendingUploadsByOwner.set(ownerId, pending);

      await this.albumRepository.update(
        albumId,
        {
          id: albumId,
          updatedAt: new Date(),
          albumThumbnailAssetId: album.albumThumbnailAssetId ?? notPresentAssetIds[0],
        },
        auth.user.id,
      );
      const allUsersExceptUs = album.albumUsers.map(({ user }) => user.id).filter((userId) => userId !== auth.user.id);
      events.push({ id: albumId, recipients: allUsersExceptUs });
    }

    // Persist the actual album_asset rows for every album we touched, in one bulk write.
    await this.albumRepository.addAssetIdsToAlbums(albumAssetValues);

    // Only *after* the album_asset rows are safely committed do we queue the Google Drive upload
    // jobs (one queueAll() call per distinct owner, batching all of that owner's pending assets
    // together). Queuing before the insert would risk uploading assets that never actually made
    // it into the album if the insert below failed.
    for (const [ownerId, assetIds] of pendingUploadsByOwner) {
      await this.queueGoogleDriveUploads(ownerId, [...assetIds]);
    }

    for (const event of events) {
      for (const recipientId of event.recipients) {
        await this.eventRepository.emit('AlbumUpdate', { id: event.id, recipientId });
      }
    }

    return results;
  }

  /**
   * Small helper used by the Google Drive integration above: figures out who "owns" an album,
   * given its list of albumUsers. Album ownership in Immich isn't a plain column on the album
   * table — it's expressed as a row in `album_user` with role = 'owner' — so we have to search
   * for it rather than just reading `album.ownerId`. Throws if somehow no owner is found, which
   * should never happen in practice (every album always has exactly one owner), but we'd rather
   * fail loudly here than silently queue a Google Drive upload job with an invalid/undefined
   * userId.
   */
  private getAlbumOwnerId(album: { albumUsers: { role: AlbumUserRole; user: { id: string } }[] }): string {
    const owner = album.albumUsers.find((albumUser) => albumUser.role === AlbumUserRole.Owner);
    if (!owner) {
      throw new BadRequestException('Album has no owner');
    }
    return owner.user.id;
  }

  /**
   * Shared helper for both addAssets() and addAssetsToAlbums() above: given a set of assets that
   * just got added to some album(s) owned by `ownerId`, queue a background GoogleDriveUpload job
   * for each one that hasn't already been uploaded before.
   *
   * The dedup check against the ledger (via googleDriveRepository.getUploadedAssetIds) happens
   * here, *before* anything is queued — this keeps the job queue itself lean by never enqueuing
   * jobs we already know are no-ops, rather than relying solely on the job handler
   * (GoogleDriveService#uploadAsset) to discover that at execution time.
   *
   * Uses jobRepository.queueAll() (a single bulk insert) instead of calling queue() in a loop, so
   * adding hundreds/thousands of photos to an album doesn't turn into that many individual round
   * trips to the job queue's backing store.
   */
  private async queueGoogleDriveUploads(ownerId: string, assetIds: string[]): Promise<void> {
    if (assetIds.length === 0) {
      return;
    }

    const alreadyUploaded = await this.googleDriveRepository.getUploadedAssetIds(ownerId, assetIds);
    const pending = assetIds.filter((assetId) => !alreadyUploaded.has(assetId));
    if (pending.length === 0) {
      return;
    }

    await this.jobRepository.queueAll(
      pending.map((assetId) => ({ name: JobName.GoogleDriveUpload, data: { userId: ownerId, assetId } })),
    );
  }

  async removeAssets(auth: AuthDto, id: string, dto: BulkIdsDto): Promise<BulkIdResponseDto[]> {
    await this.requireAccess({ auth, permission: Permission.AlbumAssetDelete, ids: [id] });

    const album = await this.findOrFail(id, auth.user.id, { withAssets: false });
    const results = await removeAssets(
      auth,
      { access: this.accessRepository, bulk: this.albumRepository },
      { parentId: id, assetIds: dto.ids, canAlwaysRemove: Permission.AlbumDelete },
    );

    const removedIds = results.filter(({ success }) => success).map(({ id }) => id);
    if (removedIds.length > 0 && album.albumThumbnailAssetId && removedIds.includes(album.albumThumbnailAssetId)) {
      await this.albumRepository.updateThumbnails();
    }

    return results;
  }

  async addUsers(auth: AuthDto, id: string, { albumUsers }: AddUsersDto): Promise<AlbumResponseDto> {
    await this.requireAccess({ auth, permission: Permission.AlbumShare, ids: [id] });

    const album = await this.findOrFail(id, auth.user.id, { withAssets: false });

    for (const { userId, role } of albumUsers) {
      if (role === AlbumUserRole.Owner) {
        throw new BadRequestException('Cannot add another owner');
      }

      const exists = album.albumUsers.find(({ user: { id } }) => id === userId);
      if (exists) {
        continue;
      }

      const user = await this.userRepository.get(userId, {});
      if (!user) {
        this.logger.debug('Adding user to album failed: user not found');
        throw new BadRequestException('Invalid user');
      }

      await this.albumUserRepository.create({ userId, albumId: id, role });
      await this.eventRepository.emit('AlbumInvite', { id, userId, senderName: auth.user.name });
    }

    return this.findOrFail(id, auth.user.id, { withAssets: true }).then(mapAlbum);
  }

  async removeUser(auth: AuthDto, id: string, userId: string | 'me'): Promise<void> {
    if (userId === 'me') {
      userId = auth.user.id;
    }

    const album = await this.findOrFail(id, auth.user.id, { withAssets: false });

    const exists = album.albumUsers.find(({ user: { id } }) => id === userId);
    if (!exists) {
      throw new BadRequestException('Album not shared with user');
    }

    if (
      exists.role === AlbumUserRole.Owner &&
      album.albumUsers.filter(({ role }) => role === AlbumUserRole.Owner).length === 1
    ) {
      throw new BadRequestException('Cannot remove the last album owner');
    }

    // non-admin can remove themselves
    if (auth.user.id !== userId) {
      await this.requireAccess({ auth, permission: Permission.AlbumShare, ids: [id] });
    }

    await this.albumUserRepository.delete({ albumId: id, userId });
  }

  async updateUser(auth: AuthDto, id: string, userId: string, dto: UpdateAlbumUserDto): Promise<void> {
    await this.requireAccess({ auth, permission: Permission.AlbumShare, ids: [id] });

    const album = await this.findOrFail(id, userId, { withAssets: false });
    const owner = album.albumUsers[0];

    if (owner.user.id === userId) {
      throw new BadRequestException('User is owner');
    }

    await this.albumUserRepository.update({ albumId: id, userId }, { role: dto.role });
  }

  private async findOrFail(id: string, authUserId: string, options: AlbumInfoOptions) {
    const album = await this.albumRepository.getById(id, options, authUserId);
    if (!album) {
      throw new BadRequestException('Album not found');
    }
    return album;
  }
}
