import { Body, Controller, Get, HttpStatus, Param, Post, Query, Redirect } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthDto } from 'src/dtos/auth.dto';
import { Auth, Authenticated } from 'src/middleware/auth.guard';
import { GoogleDriveService } from 'src/services/google-drive.service';
import { UUIDParamDto } from 'src/validation';

/**
 * HTTP surface for the "sync album to Google Drive" feature. All the actual business logic
 * (OAuth handling, upload deduplication, permission checks) lives in GoogleDriveService — this
 * controller is intentionally thin, its only job is translating HTTP requests into service
 * calls and turning results into HTTP responses.
 *
 * Routes on this controller, in the order a user would normally hit them:
 *   1. GET  /google-drive/auth-url      - "Connect Google Drive" button asks for a Google login URL.
 *   2. GET  /google-drive/callback      - Google redirects the browser back here after the user approves.
 *   3. POST /google-drive/folder        - user optionally picks a target Drive folder.
 *   4. POST /google-drive/albums/:id/sync - manual "sync this album now" button on an album page.
 */
@ApiTags('Google Drive')
@Controller('google-drive')
export class GoogleDriveController {
  constructor(private googleDriveService: GoogleDriveService) {}

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
  async getAuthUrl(@Auth() auth: AuthDto): Promise<{ url: string }> {
    const url = await this.googleDriveService.getAuthUrl(auth.user.id);
    return { url };
  }

  /**
   * Public: reached via browser redirect from Google, not an authenticated Immich session request.
   * Security relies on the signed, short-lived `state` token minted by getAuthUrl (see
   * GoogleDriveService.handleCallback), not on session auth.
   *
   * Important: this route deliberately has NO @Authenticated() decorator. Google's redirect is a
   * plain top-level browser navigation — there's no Immich session cookie/header we can rely on
   * to authenticate it (and even if there were, cross-site cookie behavior for this kind of
   * redirect can be unreliable across browsers). Instead, trust is established purely by the
   * cryptographically signed `state` value, which only our own server could have produced (see
   * getAuthUrl above) and which GoogleDriveService#handleCallback verifies before doing anything.
   *
   * We always respond with a redirect back into the Immich web app's settings page, with a
   * `google-drive` query flag so the frontend can show a "connected!" or "something went wrong"
   * toast to the user — whether things succeeded or failed, the user ends up looking at a normal
   * Immich page rather than a raw JSON error or a blank screen.
   */
  @Get('callback')
  @Redirect()
  @ApiOperation({ summary: 'OAuth callback for Google Drive linking' })
  async handleCallback(@Query('code') code?: string, @Query('state') state?: string, @Query('error') error?: string) {
    // Google sets `error` (e.g. "access_denied") instead of `code` if the user declines consent
    // on the Google side, or omits `code`/`state` entirely for other failure modes. Either way,
    // there's nothing for us to do except send the user back with a friendly failure flag.
    if (error || !code || !state) {
      return { url: '/user-settings?google-drive=error', statusCode: HttpStatus.FOUND };
    }

    try {
      // This is where the real work happens: verify the signed state, exchange the code for a
      // refresh token, and persist it against the right user. See GoogleDriveService for details.
      await this.googleDriveService.handleCallback(code, state);
      return { url: '/user-settings?google-drive=connected', statusCode: HttpStatus.FOUND };
    } catch {
      // Covers bad/expired state, or Google rejecting the code exchange (e.g. it was already
      // used, or too much time passed). We don't leak the underlying error to the browser URL —
      // just a generic "error" flag; the real error is already logged server-side.
      return { url: '/user-settings?google-drive=error', statusCode: HttpStatus.FOUND };
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
  async setFolderId(@Auth() auth: AuthDto, @Body('folderId') folderId: string): Promise<void> {
    await this.googleDriveService.setFolderId(auth.user.id, folderId);
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
}
