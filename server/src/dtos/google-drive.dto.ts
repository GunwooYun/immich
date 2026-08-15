import { createZodDto } from 'nestjs-zod';
import { isoDatetimeToDate } from 'src/validation';
import z from 'zod';

/**
 * These two response shapes were originally just inline TS object types on the controller
 * methods (`Promise<{ url: string }>`, etc.). That compiles fine and looks correct in a code
 * review, but the OpenAPI generator can't introspect an inline type literal the way it can a
 * class — it needs an actual referenceable DTO. Without one, `GET /google-drive/status` and
 * `GET /google-drive/auth-url` were showing up in the generated spec with an empty response body
 * (`{ "200": { "description": "" } }`), and the generated TypeScript SDK client fell back to
 * `oazapfts.fetchText(...)` (untyped raw text) instead of `fetchJson<{ data: ... }>(...)` — the
 * frontend would have gotten no type information at all from `@immich/sdk` for either endpoint.
 * This was caught by actually running the OpenAPI generator locally and inspecting its output,
 * not by reading the controller code.
 */

const GoogleDriveAuthUrlResponseSchema = z
  .object({
    url: z.string().describe('Google OAuth consent URL to redirect the browser to'),
  })
  .meta({ id: 'GoogleDriveAuthUrlResponseDto' });

// The set-folder request body needs a DTO for the same generator-visibility reason as the
// responses above — but with a sharper consequence: the controller originally used
// `@Body('folderId') folderId: string` (property-level extraction), which Swagger cannot
// introspect at all. The endpoint worked when called with hand-written `fetch`, but the generated
// SDK function came out as `setFolderId(opts?)` — no body parameter whatsoever — so an SDK caller
// literally could not pass the folder id. Binding the whole body to a class via `@Body()` is what
// makes the request schema exist in the spec.
const GoogleDriveSetFolderSchema = z
  .object({
    folderId: z.string().describe('Drive folder id to upload into; empty string clears the setting'),
    // Sent by the Google Picker, which knows the folder's display name; omitted by the manual
    // paste-an-id path, which doesn't. Purely cosmetic — uploads are always addressed by id.
    folderName: z.string().optional().describe('Display name of the folder, if known'),
  })
  .meta({ id: 'GoogleDriveSetFolderDto' });

const GoogleDriveStatusResponseSchema = z
  .object({
    connected: z.boolean().describe('Whether this user has linked a Google Drive account'),
    folderId: z.string().nullable().describe('The configured upload destination folder, if any'),
    folderName: z.string().nullable().describe('Display name of that folder, if it was chosen via the picker'),
    connectedAt: isoDatetimeToDate.nullable().describe('When the account was linked, if connected'),
    // Failure visibility (see google_drive_upload_error): how many uploads are currently failed,
    // and whether the whole account is blocked. `blockedReason` drives the settings banner —
    // quota_exceeded pairs with the resume button, folder_missing with the folder picker.
    failedCount: z.int().describe('Number of uploads currently in a failed state'),
    // A plain nullable string rather than z.enum(...).nullable(): the OpenAPI generator renders a
    // nullable enum as an enum containing null, which the TypeScript SDK emits as an initializer-
    // less `Null` member — broken output. The two possible values are stable and documented here.
    blockedReason: z
      .string()
      .nullable()
      .describe(
        "Account-level condition currently stopping uploads, if any: 'quota_exceeded', 'folder_missing', or 'revoked' (access was revoked — also why the account shows as disconnected)",
      ),
  })
  .meta({ id: 'GoogleDriveStatusResponseDto' });

/**
 * Everything the browser needs to open Google's folder picker, in one round trip.
 *
 * The Picker is a Google-hosted widget that runs entirely in the user's browser, so it can't reach
 * into our server for credentials — it has to be handed an OAuth access token, the OAuth client id
 * and a Google API key up front. We hold the long-lived *refresh* token server-side and never let
 * it out; this endpoint exchanges it for a short-lived access token (typically ~1 hour) scoped to
 * `drive.file` only, which is the narrowest thing that lets the Picker work.
 *
 * What that access token can do if it leaked: create files in the user's Drive, and read or modify
 * the files this app itself created. It cannot read the rest of their Drive — `drive.file` is a
 * per-file grant, not a whole-account one — and it expires on its own. That's the tradeoff being
 * made in exchange for a real folder picker instead of asking people to paste folder ids out of a
 * URL bar.
 */
const GoogleDrivePickerConfigResponseSchema = z
  .object({
    accessToken: z.string().describe('Short-lived OAuth access token for the Picker to use'),
    clientId: z.string().describe('Google OAuth client id the Picker should identify as'),
    apiKey: z.string().describe('Google API key (developer key) the Picker requires'),
  })
  .meta({ id: 'GoogleDrivePickerConfigResponseDto' });

export class GoogleDriveAuthUrlResponseDto extends createZodDto(GoogleDriveAuthUrlResponseSchema) {}
export class GoogleDrivePickerConfigResponseDto extends createZodDto(GoogleDrivePickerConfigResponseSchema) {}
export class GoogleDriveSetFolderDto extends createZodDto(GoogleDriveSetFolderSchema) {}
export class GoogleDriveStatusResponseDto extends createZodDto(GoogleDriveStatusResponseSchema) {}
