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
  })
  .meta({ id: 'GoogleDriveSetFolderDto' });

const GoogleDriveStatusResponseSchema = z
  .object({
    connected: z.boolean().describe('Whether this user has linked a Google Drive account'),
    folderId: z.string().nullable().describe('The configured upload destination folder, if any'),
    connectedAt: isoDatetimeToDate.nullable().describe('When the account was linked, if connected'),
  })
  .meta({ id: 'GoogleDriveStatusResponseDto' });

export class GoogleDriveAuthUrlResponseDto extends createZodDto(GoogleDriveAuthUrlResponseSchema) {}
export class GoogleDriveSetFolderDto extends createZodDto(GoogleDriveSetFolderSchema) {}
export class GoogleDriveStatusResponseDto extends createZodDto(GoogleDriveStatusResponseSchema) {}
