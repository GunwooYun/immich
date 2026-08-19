import { Body, Controller, Delete, Get, HttpStatus, Param, Post, Put, Query, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { Endpoint, HistoryBuilder } from 'src/decorators';
import { AuthDto } from 'src/dtos/auth.dto';
import {
  GoogleDriveAlbumDto,
  GoogleDriveAlbumStatusDto,
  GoogleDriveAuthUrlResponseDto,
  GoogleDriveMyStatusDto,
  GoogleDrivePickerConfigResponseDto,
  GoogleDriveSetFolderDto,
  GoogleDriveStatusResponseDto,
  GoogleDriveStorageDto,
} from 'src/dtos/google-drive.dto';
import { ApiTag, ImmichCookie } from 'src/enum';
import { Auth, Authenticated } from 'src/middleware/auth.guard';
import { GoogleDriveService } from 'src/services/google-drive.service';
import { respondWithCookie } from 'src/utils/response';
import { UUIDParamDto } from 'src/validation';

/**
 * HTTP surface for the "sync album to Google Drive" feature. All the actual business logic
 * (OAuth handling, upload deduplication, permission checks) lives in GoogleDriveService — this
 * controller is intentionally thin, its only job is translating HTTP requests into service
 * calls and turning results into HTTP responses.
 *
 * Routes on this controller, in the order a user would normally hit them:
 *   1. GET    /google-drive/status        - settings page asks "is this user connected, and to which folder?"
 *   2. GET    /google-drive/auth-url      - "Connect Google Drive" button asks for a Google login URL.
 *   3. GET    /google-drive/callback      - Google redirects the browser back here after the user approves.
 *   4. GET    /google-drive/picker-config - hands the browser what Google's folder picker needs.
 *   5. POST   /google-drive/folder        - stores whichever folder the picker (or the manual
 *                                           fallback input) produced.
 *   6. POST   /google-drive/resume        - clears an account-level block and re-queues pending uploads.
 *   7. POST   /google-drive/albums/:id/sync - manual "sync this album now" button on an album page.
 *   8. DELETE /google-drive/link          - "Disconnect" button discards the stored credentials.
 *
 * Two conventions worth knowing before editing this file:
 *
 * - Every method carries `@Endpoint(...)` rather than a bare `@ApiOperation(...)`. `@Endpoint` is
 *   Immich's own wrapper (src/decorators.ts): it forwards the summary/description to Swagger but
 *   *also* attaches the API-history extension that the generated docs use to show when an endpoint
 *   was added and how stable it is. Using plain `@ApiOperation` skips that and prints a
 *   "Missing history for endpoint" warning during the OpenAPI build.
 *
 * - The method names are deliberately long and Drive-specific. The OpenAPI generator derives each
 *   operationId straight from the method name (`operationIdFactory` in src/utils/misc.ts), and the
 *   TypeScript SDK turns every operationId into a *top-level* exported function. Naming a method
 *   `getStatus` would therefore export a bare `getStatus()` from `@immich/sdk`, which says nothing
 *   about Drive and collides with every other feature's idea of "status" — callers were already
 *   having to write `import { getStatus as getGoogleDriveStatus }`. Keeping the noun in the method
 *   name makes the SDK read correctly at the call site.
 */
@ApiTags(ApiTag.GoogleDrive)
@Controller('google-drive')
export class GoogleDriveController {
  constructor(private googleDriveService: GoogleDriveService) {}

  /**
   * Tells the settings page whether this user has Google Drive connected, and if so which folder
   * they picked and when they linked it. Without this the settings form had no way to show current
   * state — it always rendered as if nobody was connected and with an empty folder field.
   *
   * Never includes the refresh token; the frontend has no use for it.
   */
  @Get('status')
  @Authenticated()
  @Endpoint({
    summary: 'Get Google Drive connection status',
    description:
      'Report whether the authenticated user has linked a Google Drive account, when they linked it, and which target folder they selected. Never includes the refresh token.',
    history: new HistoryBuilder().added('v3.0.0').alpha('v3.0.0'),
  })
  async getGoogleDriveStatus(@Auth() auth: AuthDto): Promise<GoogleDriveStatusResponseDto> {
    return this.googleDriveService.getStatus(auth.user.id);
  }

  /**
   * Called by the frontend when the user clicks "Connect Google Drive" in Settings.
   * Requires an authenticated Immich session (@Authenticated()) because we need to know which
   * Immich user is asking, so we can embed their userId into the signed `state` token that
   * Google will hand back to us in the callback below.
   *
   * The frontend simply navigates the browser to the returned `url` — from that point on, the
   * user is interacting with Google's own consent screen, not Immich.
   */
  @Get('auth-url')
  @Authenticated()
  @Endpoint({
    summary: 'Start the Google Drive link flow',
    description:
      'Return the Google consent-screen URL the browser should navigate to. Also sets a short-lived HttpOnly cookie holding the OAuth `state`, which the callback requires in order to prove the browser finishing the flow is the one that started it.',
    history: new HistoryBuilder().added('v3.0.0').alpha('v3.0.0'),
  })
  async getGoogleDriveAuthUrl(
    @Auth() auth: AuthDto,
    @Req() request: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<GoogleDriveAuthUrlResponseDto> {
    const { url, state } = await this.googleDriveService.getAuthUrl(auth.user.id);

    // Stash the state in an HttpOnly cookie as well as putting it in the URL. The callback
    // requires the two to match, which is what proves the browser completing the flow is the one
    // that started it — see GoogleDriveService#handleCallback for the attack this prevents.
    return respondWithCookie(
      res,
      { url },
      {
        isSecure: request.secure,
        values: [{ key: ImmichCookie.GoogleDriveOAuthState, value: state }],
      },
    );
  }

  /**
   * Reached via browser redirect from Google once the user approves (or declines).
   *
   * This route now requires an authenticated session, and the flow is additionally bound to the
   * browser through an HttpOnly cookie set by getAuthUrl. It used to be fully public, trusting the
   * signed `state` alone — see GoogleDriveService#handleCallback for the account-takeover that
   * made possible, and why signing by itself was not enough.
   *
   * Requiring auth here is safe because Google's redirect is a top-level GET navigation, which
   * SameSite=Lax cookies (Immich's default, see utils/response.ts) are sent on. It also matches
   * Immich's own OIDC link endpoint, which is `@Authenticated()`.
   *
   * We always respond with a redirect back into the Immich web app's settings page, with a
   * `google-drive` query flag so the frontend can show a "connected!" or "something went wrong"
   * toast to the user — whether things succeeded or failed, the user ends up looking at a normal
   * Immich page rather than a raw JSON error or a blank screen.
   *
   * The `isOpen=google-drive-sync` part is load-bearing, not cosmetic: settings sections are
   * accordions that only render their contents while expanded (see SettingAccordion.svelte's
   * `{#if isOpen}`), and expansion is driven by that query parameter. Without it the Google Drive
   * panel stays collapsed, never mounts, and so never reads the `google-drive` flag — meaning the
   * user would land on a settings page with no indication whatsoever of whether linking worked.
   */
  @Get('callback')
  @Authenticated()
  @Endpoint({
    summary: 'Complete the Google Drive link flow',
    description:
      'Redirect target for Google after the user approves or declines consent. Exchanges the authorization code for a refresh token and always responds with a 302 back into the Immich settings page — never JSON, so this is not meaningfully callable from an SDK.',
    history: new HistoryBuilder().added('v3.0.0').alpha('v3.0.0'),
  })
  async handleGoogleDriveCallback(
    @Auth() auth: AuthDto,
    @Req() request: Request,
    @Res() res: Response,
    @Query('code') code?: string,
    @Query('state') state?: string,
    @Query('error') error?: string,
  ): Promise<void> {
    // Redirects are issued directly rather than via Nest's `@Redirect()` decorator, because this
    // handler also needs `@Res` to clear the state cookie and no other controller in the repo
    // combines the two — so there's no established behaviour here to rely on. Taking full control
    // of the response (plain `@Res()`, no passthrough) keeps it unambiguous.
    const redirect = async (result: 'connected' | 'error') =>
      res.redirect(HttpStatus.FOUND, await this.googleDriveService.getCallbackRedirectUrl(result));

    // The state cookie is single-use: clear it no matter how this attempt ends, so a replay of the
    // same callback URL can't find it waiting.
    const cookieState = (request.cookies as Record<string, string> | undefined)?.[ImmichCookie.GoogleDriveOAuthState];
    res.clearCookie(ImmichCookie.GoogleDriveOAuthState);

    // Google sets `error` (e.g. "access_denied") instead of `code` if the user declines consent
    // on the Google side, or omits `code`/`state` entirely for other failure modes. Either way,
    // there's nothing for us to do except send the user back with a friendly failure flag.
    if (error || !code || !state) {
      await redirect('error');
      return;
    }

    try {
      // This is where the real work happens: verify the state (signature, cookie binding, and that
      // it was issued for this same user), exchange the code for a refresh token, and persist it.
      await this.googleDriveService.handleCallback(code, state, cookieState, auth.user.id);
      await redirect('connected');
    } catch {
      // Covers bad/expired/unbound state, or Google rejecting the code exchange (e.g. it was
      // already used, or too much time passed). We don't leak the underlying error to the browser
      // URL — just a generic "error" flag; the real error is already logged server-side.
      await redirect('error');
    }
  }

  /**
   * Lets a connected user choose which Google Drive folder new uploads should go into. This is a
   * simple "set and forget" preference — see GoogleDriveSettings.svelte on the frontend for the
   * (currently very basic) folder-ID text input that calls this.
   */
  @Post('folder')
  @Authenticated()
  @Endpoint({
    summary: 'Set the target Google Drive folder',
    description:
      'Choose which Drive folder subsequent uploads land in. An empty value clears the preference, which puts uploads in the root of the Drive.',
    history: new HistoryBuilder().added('v3.0.0').alpha('v3.0.0'),
  })
  async setGoogleDriveFolder(@Auth() auth: AuthDto, @Body() dto: GoogleDriveSetFolderDto): Promise<void> {
    await this.googleDriveService.setFolderId(auth.user.id, dto.folderId, dto.folderName);
  }

  /**
   * Manual "sync this album to Google Drive now" trigger — the fallback button shown on an
   * album's page for assets that weren't auto-uploaded (e.g. the album existed before Drive was
   * connected, or an earlier automatic upload failed).
   *
   * Note there's no request body here beyond the `:id` in the URL — unlike the old prototype
   * version of this endpoint, we don't accept a free-form `albumId` in the JSON body. Using the
   * URL path parameter means normal Immich route-level access checks and Swagger typing apply,
   * and it matches the REST convention used by the rest of the album-related endpoints
   * (`/albums/:id/...`).
   *
   * All the actual permission enforcement (must the caller be the album owner? has this asset
   * already been uploaded?) happens inside GoogleDriveService#syncAlbum — this controller method
   * just authenticates the caller and forwards the album id.
   */
  /**
   * Feeds the browser-side Google folder picker. Separate from `status` on purpose: `status` is
   * fetched on every settings-page render, and minting an OAuth access token on each of those would
   * mean a needless round trip to Google every time someone opens their settings. This is only
   * called at the moment the user actually clicks "choose a folder".
   *
   * Returns a live (if short-lived) Drive access token, so it is authenticated and per-user like
   * everything else here — see GoogleDrivePickerConfigResponseDto for what that token can and
   * cannot do.
   */
  /**
   * Drive storage for the gauge. Cached briefly server-side — the menu can be opened repeatedly
   * and each open should not cost a round trip to Google.
   */
  @Get('storage')
  @Authenticated()
  @Endpoint({
    summary: 'Get Google Drive storage usage',
    description:
      'Report how full the authenticated user Google Drive is, including how much is held by trash. Requires a connected account; a revoked grant is reported as disconnected rather than as a server error.',
    history: new HistoryBuilder().added('v3.0.0').alpha('v3.0.0'),
  })
  async getGoogleDriveStorage(@Auth() auth: AuthDto): Promise<GoogleDriveStorageDto> {
    return this.googleDriveService.getStorage(auth.user.id);
  }

  /**
   * Per-user backup progress, for the progress display. Deliberately not album-scoped: uploads
   * are queued per (user, asset), so any album-scoped figure would be unable to describe work
   * that spans albums.
   */
  @Get('me/status')
  @Authenticated()
  @Endpoint({
    summary: 'Get the authenticated user Google Drive backup progress',
    description:
      'Return how many assets are still waiting to be uploaded to this user Drive, and how many have failed. Not scoped to an album.',
    history: new HistoryBuilder().added('v3.0.0').alpha('v3.0.0'),
  })
  async getMyGoogleDriveStatus(@Auth() auth: AuthDto): Promise<GoogleDriveMyStatusDto> {
    return this.googleDriveService.getMyStatus(auth.user.id);
  }

  @Get('picker-config')
  @Authenticated()
  @Endpoint({
    summary: 'Get configuration for the Google Drive folder picker',
    description:
      'Return a short-lived `drive.file`-scoped access token plus the OAuth client id and Google API key, which the browser-side Google Picker widget needs in order to open. Fails if the user has not connected an account or no API key is configured.',
    history: new HistoryBuilder().added('v3.0.0').alpha('v3.0.0'),
  })
  async getGoogleDrivePickerConfig(@Auth() auth: AuthDto): Promise<GoogleDrivePickerConfigResponseDto> {
    return this.googleDriveService.getPickerConfig(auth.user.id);
  }

  /**
   * The "resume uploads" button in Settings — shown when the account is blocked (Drive full).
   * Clears the block *and* immediately re-queues this user's pending set; see
   * GoogleDriveService#resumeUploads for why the re-queue half is not optional.
   */
  @Post('resume')
  @Authenticated()
  @Endpoint({
    summary: 'Resume Google Drive uploads',
    description:
      "Clear the account-level block (e.g. after freeing Drive storage) and immediately re-queue the user's pending uploads.",
    history: new HistoryBuilder().added('v3.0.0').alpha('v3.0.0'),
  })
  async resumeGoogleDriveUploads(@Auth() auth: AuthDto): Promise<void> {
    await this.googleDriveService.resumeUploads(auth);
  }

  /**
   * The album-selection list for Settings: everything the user can back up, whether they do, and
   * how far along each one is *for them*.
   */
  @Get('albums')
  @Authenticated()
  @Endpoint({
    summary: 'List albums available for Google Drive backup',
    description:
      'Return every album the authenticated user can see, with whether it is currently backed up to their Drive and how many of its assets have already been uploaded to it. Counts are per-viewer, not per-owner.',
    history: new HistoryBuilder().added('v3.0.0').alpha('v3.0.0'),
  })
  async getGoogleDriveAlbums(@Auth() auth: AuthDto): Promise<GoogleDriveAlbumDto[]> {
    return this.googleDriveService.getSubscribableAlbums(auth);
  }

  /**
   * One album's backup state, for the album menu and the progress display. Read access is enough —
   * unlike selecting, reading a count is not egress.
   */
  @Get('albums/:id/status')
  @Authenticated()
  @Endpoint({
    summary: 'Get one album Google Drive backup status',
    description:
      'Return whether this album is backed up to the authenticated user Drive, how many of its assets are already there, and whether access to it has been lost.',
    history: new HistoryBuilder().added('v3.0.0').alpha('v3.0.0'),
  })
  async getGoogleDriveAlbumStatus(
    @Auth() auth: AuthDto,
    @Param() { id }: UUIDParamDto,
  ): Promise<GoogleDriveAlbumStatusDto> {
    return this.googleDriveService.getAlbumBackupStatus(auth, id);
  }

  /**
   * Start backing an album up to *the caller's* Drive — not the album owner's. Requires download
   * access, since copying a shared album into your own Google account is egress.
   */
  @Put('albums/:id')
  @Authenticated()
  @Endpoint({
    summary: 'Back up an album to Google Drive',
    description:
      'Add an album to the authenticated user Google Drive backups and immediately queue everything in it that is not already uploaded. Requires download access to the album.',
    history: new HistoryBuilder().added('v3.0.0').alpha('v3.0.0'),
  })
  async subscribeGoogleDriveAlbum(@Auth() auth: AuthDto, @Param() { id }: UUIDParamDto): Promise<void> {
    await this.googleDriveService.subscribeAlbum(auth, id);
  }

  /**
   * Stop backing an album up. Files already in Drive are left alone, and the upload ledger is
   * kept so re-selecting later does not duplicate them.
   */
  @Delete('albums/:id')
  @Authenticated()
  @Endpoint({
    summary: 'Stop backing up an album to Google Drive',
    description:
      'Remove an album from the authenticated user Google Drive backups. Files already uploaded stay in Drive and stay recorded, so re-adding the album later does not re-upload them.',
    history: new HistoryBuilder().added('v3.0.0').alpha('v3.0.0'),
  })
  async unsubscribeGoogleDriveAlbum(@Auth() auth: AuthDto, @Param() { id }: UUIDParamDto): Promise<void> {
    await this.googleDriveService.unsubscribeAlbum(auth, id);
  }

  @Post('albums/:id/sync')
  @Authenticated()
  @Endpoint({
    summary: "Sync an album to the owner's Google Drive",
    description:
      'Queue every not-yet-uploaded asset in the album for upload. Only the album owner may call this, and assets already recorded in the upload ledger are skipped rather than duplicated.',
    history: new HistoryBuilder().added('v3.0.0').alpha('v3.0.0'),
  })
  async syncAlbumToGoogleDrive(@Auth() auth: AuthDto, @Param() { id }: UUIDParamDto): Promise<void> {
    await this.googleDriveService.syncAlbum(auth, id);
  }

  /**
   * "Disconnect" button in settings — discards the stored Google credentials for this user.
   *
   * Does not touch anything already uploaded to their Drive (this is a one-way sync; deleting the
   * user's own cloud files because they unlinked an integration would be a destructive surprise),
   * and keeps the upload ledger so that reconnecting later doesn't re-upload everything as
   * duplicates.
   */
  @Delete('link')
  @Authenticated()
  @Endpoint({
    summary: 'Disconnect the Google Drive account',
    description:
      'Discard the stored Google credentials for this user. Files already in their Drive are left alone, and the upload ledger is kept so that reconnecting later does not re-upload everything as duplicates.',
    history: new HistoryBuilder().added('v3.0.0').alpha('v3.0.0'),
  })
  async disconnectGoogleDrive(@Auth() auth: AuthDto): Promise<void> {
    await this.googleDriveService.disconnect(auth.user.id);
  }
}
