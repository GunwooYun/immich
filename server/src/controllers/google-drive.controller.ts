import { Body, Controller, Delete, Get, HttpStatus, Param, Post, Query, Req, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { AuthDto } from 'src/dtos/auth.dto';
import {
  GoogleDriveAuthUrlResponseDto,
  GoogleDriveSetFolderDto,
  GoogleDriveStatusResponseDto,
} from 'src/dtos/google-drive.dto';
import { ImmichCookie } from 'src/enum';
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
 *   4. POST   /google-drive/folder        - user optionally picks a target Drive folder.
 *   5. POST   /google-drive/albums/:id/sync - manual "sync this album now" button on an album page.
 *   6. DELETE /google-drive/link          - "Disconnect" button discards the stored credentials.
 */
@ApiTags('Google Drive')
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
  @ApiOperation({ summary: 'Get the current Google Drive connection status' })
  async getStatus(@Auth() auth: AuthDto): Promise<GoogleDriveStatusResponseDto> {
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
  @ApiOperation({ summary: 'Get Google Drive OAuth URL' })
  async getAuthUrl(
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
  @ApiOperation({ summary: 'OAuth callback for Google Drive linking' })
  async handleCallback(
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
    const redirect = (result: 'connected' | 'error') =>
      res.redirect(HttpStatus.FOUND, `/user-settings?isOpen=google-drive-sync&google-drive=${result}`);

    // The state cookie is single-use: clear it no matter how this attempt ends, so a replay of the
    // same callback URL can't find it waiting.
    const cookieState = (request.cookies as Record<string, string> | undefined)?.[ImmichCookie.GoogleDriveOAuthState];
    res.clearCookie(ImmichCookie.GoogleDriveOAuthState);

    // Google sets `error` (e.g. "access_denied") instead of `code` if the user declines consent
    // on the Google side, or omits `code`/`state` entirely for other failure modes. Either way,
    // there's nothing for us to do except send the user back with a friendly failure flag.
    if (error || !code || !state) {
      redirect('error');
      return;
    }

    try {
      // This is where the real work happens: verify the state (signature, cookie binding, and that
      // it was issued for this same user), exchange the code for a refresh token, and persist it.
      await this.googleDriveService.handleCallback(code, state, cookieState, auth.user.id);
      redirect('connected');
    } catch {
      // Covers bad/expired/unbound state, or Google rejecting the code exchange (e.g. it was
      // already used, or too much time passed). We don't leak the underlying error to the browser
      // URL — just a generic "error" flag; the real error is already logged server-side.
      redirect('error');
    }
  }

  /**
   * Lets a connected user choose which Google Drive folder new uploads should go into. This is a
   * simple "set and forget" preference — see GoogleDriveSettings.svelte on the frontend for the
   * (currently very basic) folder-ID text input that calls this.
   */
  @Post('folder')
  @Authenticated()
  @ApiOperation({ summary: 'Set target Google Drive folder ID' })
  async setFolderId(@Auth() auth: AuthDto, @Body() dto: GoogleDriveSetFolderDto): Promise<void> {
    await this.googleDriveService.setFolderId(auth.user.id, dto.folderId);
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
  @Post('albums/:id/sync')
  @Authenticated()
  @ApiOperation({ summary: "Sync an album to the owner's Google Drive" })
  async syncAlbum(@Auth() auth: AuthDto, @Param() { id }: UUIDParamDto): Promise<void> {
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
  @ApiOperation({ summary: 'Disconnect the Google Drive account' })
  async disconnect(@Auth() auth: AuthDto): Promise<void> {
    await this.googleDriveService.disconnect(auth.user.id);
  }
}
