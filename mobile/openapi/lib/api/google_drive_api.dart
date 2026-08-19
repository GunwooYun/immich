//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;


class GoogleDriveApi {
  GoogleDriveApi([ApiClient? apiClient]) : apiClient = apiClient ?? defaultApiClient;

  final ApiClient apiClient;

  /// \"Disconnect\" button in settings — discards the stored Google credentials for this user.  Does not touch anything already uploaded to their Drive (this is a one-way sync; deleting the user's own cloud files because they unlinked an integration would be a destructive surprise), and keeps the upload ledger so that reconnecting later doesn't re-upload everything as duplicates.
  ///
  /// Discard the stored Google credentials for this user. Files already in their Drive are left alone, and the upload ledger is kept so that reconnecting later does not re-upload everything as duplicates.
  ///
  /// Note: This method returns the HTTP [Response].
  Future<Response> disconnectGoogleDriveWithHttpInfo({ Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final apiPath = r'/google-drive/link';

    // ignore: prefer_final_locals
    Object? postBody;

    final queryParams = <QueryParam>[];
    final headerParams = <String, String>{};
    final formParams = <String, String>{};

    const contentTypes = <String>[];


    return apiClient.invokeAPI(
      apiPath,
      'DELETE',
      queryParams,
      postBody,
      headerParams,
      formParams,
      contentTypes.isEmpty ? null : contentTypes.first,
      abortTrigger: abortTrigger,
    );
  }

  /// \"Disconnect\" button in settings — discards the stored Google credentials for this user.  Does not touch anything already uploaded to their Drive (this is a one-way sync; deleting the user's own cloud files because they unlinked an integration would be a destructive surprise), and keeps the upload ledger so that reconnecting later doesn't re-upload everything as duplicates.
  ///
  /// Discard the stored Google credentials for this user. Files already in their Drive are left alone, and the upload ledger is kept so that reconnecting later does not re-upload everything as duplicates.
  Future<void> disconnectGoogleDrive({ Future<void>? abortTrigger, }) async {
    final response = await disconnectGoogleDriveWithHttpInfo(abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
  }

  /// The album-selection list for Settings: everything the user can back up, whether they do, and how far along each one is *for them*.
  ///
  /// Return every album the authenticated user can see, with whether it is currently backed up to their Drive and how many of its assets have already been uploaded to it. Counts are per-viewer, not per-owner.
  ///
  /// Note: This method returns the HTTP [Response].
  Future<Response> getGoogleDriveAlbumsWithHttpInfo({ Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final apiPath = r'/google-drive/albums';

    // ignore: prefer_final_locals
    Object? postBody;

    final queryParams = <QueryParam>[];
    final headerParams = <String, String>{};
    final formParams = <String, String>{};

    const contentTypes = <String>[];


    return apiClient.invokeAPI(
      apiPath,
      'GET',
      queryParams,
      postBody,
      headerParams,
      formParams,
      contentTypes.isEmpty ? null : contentTypes.first,
      abortTrigger: abortTrigger,
    );
  }

  /// The album-selection list for Settings: everything the user can back up, whether they do, and how far along each one is *for them*.
  ///
  /// Return every album the authenticated user can see, with whether it is currently backed up to their Drive and how many of its assets have already been uploaded to it. Counts are per-viewer, not per-owner.
  Future<List<GoogleDriveAlbumDto>?> getGoogleDriveAlbums({ Future<void>? abortTrigger, }) async {
    final response = await getGoogleDriveAlbumsWithHttpInfo(abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      final responseBody = await _decodeBodyBytes(response);
      return (await apiClient.deserializeAsync(responseBody, 'List<GoogleDriveAlbumDto>') as List)
        .cast<GoogleDriveAlbumDto>()
        .toList(growable: false);

    }
    return null;
  }

  /// Called by the frontend when the user clicks \"Connect Google Drive\" in Settings. Requires an authenticated Immich session (@Authenticated()) because we need to know which Immich user is asking, so we can embed their userId into the signed `state` token that Google will hand back to us in the callback below.  The frontend simply navigates the browser to the returned `url` — from that point on, the user is interacting with Google's own consent screen, not Immich.
  ///
  /// Return the Google consent-screen URL the browser should navigate to. Also sets a short-lived HttpOnly cookie holding the OAuth `state`, which the callback requires in order to prove the browser finishing the flow is the one that started it.
  ///
  /// Note: This method returns the HTTP [Response].
  Future<Response> getGoogleDriveAuthUrlWithHttpInfo({ Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final apiPath = r'/google-drive/auth-url';

    // ignore: prefer_final_locals
    Object? postBody;

    final queryParams = <QueryParam>[];
    final headerParams = <String, String>{};
    final formParams = <String, String>{};

    const contentTypes = <String>[];


    return apiClient.invokeAPI(
      apiPath,
      'GET',
      queryParams,
      postBody,
      headerParams,
      formParams,
      contentTypes.isEmpty ? null : contentTypes.first,
      abortTrigger: abortTrigger,
    );
  }

  /// Called by the frontend when the user clicks \"Connect Google Drive\" in Settings. Requires an authenticated Immich session (@Authenticated()) because we need to know which Immich user is asking, so we can embed their userId into the signed `state` token that Google will hand back to us in the callback below.  The frontend simply navigates the browser to the returned `url` — from that point on, the user is interacting with Google's own consent screen, not Immich.
  ///
  /// Return the Google consent-screen URL the browser should navigate to. Also sets a short-lived HttpOnly cookie holding the OAuth `state`, which the callback requires in order to prove the browser finishing the flow is the one that started it.
  Future<GoogleDriveAuthUrlResponseDto?> getGoogleDriveAuthUrl({ Future<void>? abortTrigger, }) async {
    final response = await getGoogleDriveAuthUrlWithHttpInfo(abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      return await apiClient.deserializeAsync(await _decodeBodyBytes(response), 'GoogleDriveAuthUrlResponseDto',) as GoogleDriveAuthUrlResponseDto;
    
    }
    return null;
  }

  /// Get configuration for the Google Drive folder picker
  ///
  /// Return a short-lived `drive.file`-scoped access token plus the OAuth client id and Google API key, which the browser-side Google Picker widget needs in order to open. Fails if the user has not connected an account or no API key is configured.
  ///
  /// Note: This method returns the HTTP [Response].
  Future<Response> getGoogleDrivePickerConfigWithHttpInfo({ Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final apiPath = r'/google-drive/picker-config';

    // ignore: prefer_final_locals
    Object? postBody;

    final queryParams = <QueryParam>[];
    final headerParams = <String, String>{};
    final formParams = <String, String>{};

    const contentTypes = <String>[];


    return apiClient.invokeAPI(
      apiPath,
      'GET',
      queryParams,
      postBody,
      headerParams,
      formParams,
      contentTypes.isEmpty ? null : contentTypes.first,
      abortTrigger: abortTrigger,
    );
  }

  /// Get configuration for the Google Drive folder picker
  ///
  /// Return a short-lived `drive.file`-scoped access token plus the OAuth client id and Google API key, which the browser-side Google Picker widget needs in order to open. Fails if the user has not connected an account or no API key is configured.
  Future<GoogleDrivePickerConfigResponseDto?> getGoogleDrivePickerConfig({ Future<void>? abortTrigger, }) async {
    final response = await getGoogleDrivePickerConfigWithHttpInfo(abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      return await apiClient.deserializeAsync(await _decodeBodyBytes(response), 'GoogleDrivePickerConfigResponseDto',) as GoogleDrivePickerConfigResponseDto;
    
    }
    return null;
  }

  /// Tells the settings page whether this user has Google Drive connected, and if so which folder they picked and when they linked it. Without this the settings form had no way to show current state — it always rendered as if nobody was connected and with an empty folder field.  Never includes the refresh token; the frontend has no use for it.
  ///
  /// Report whether the authenticated user has linked a Google Drive account, when they linked it, and which target folder they selected. Never includes the refresh token.
  ///
  /// Note: This method returns the HTTP [Response].
  Future<Response> getGoogleDriveStatusWithHttpInfo({ Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final apiPath = r'/google-drive/status';

    // ignore: prefer_final_locals
    Object? postBody;

    final queryParams = <QueryParam>[];
    final headerParams = <String, String>{};
    final formParams = <String, String>{};

    const contentTypes = <String>[];


    return apiClient.invokeAPI(
      apiPath,
      'GET',
      queryParams,
      postBody,
      headerParams,
      formParams,
      contentTypes.isEmpty ? null : contentTypes.first,
      abortTrigger: abortTrigger,
    );
  }

  /// Tells the settings page whether this user has Google Drive connected, and if so which folder they picked and when they linked it. Without this the settings form had no way to show current state — it always rendered as if nobody was connected and with an empty folder field.  Never includes the refresh token; the frontend has no use for it.
  ///
  /// Report whether the authenticated user has linked a Google Drive account, when they linked it, and which target folder they selected. Never includes the refresh token.
  Future<GoogleDriveStatusResponseDto?> getGoogleDriveStatus({ Future<void>? abortTrigger, }) async {
    final response = await getGoogleDriveStatusWithHttpInfo(abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      return await apiClient.deserializeAsync(await _decodeBodyBytes(response), 'GoogleDriveStatusResponseDto',) as GoogleDriveStatusResponseDto;
    
    }
    return null;
  }

  /// Manual \"sync this album to Google Drive now\" trigger — the fallback button shown on an album's page for assets that weren't auto-uploaded (e.g. the album existed before Drive was connected, or an earlier automatic upload failed).  Note there's no request body here beyond the `:id` in the URL — unlike the old prototype version of this endpoint, we don't accept a free-form `albumId` in the JSON body. Using the URL path parameter means normal Immich route-level access checks and Swagger typing apply, and it matches the REST convention used by the rest of the album-related endpoints (`/albums/:id/...`).  All the actual permission enforcement (must the caller be the album owner? has this asset already been uploaded?) happens inside GoogleDriveService#syncAlbum — this controller method just authenticates the caller and forwards the album id.
  ///
  /// Report how full the authenticated user Google Drive is, including how much is held by trash. Requires a connected account; a revoked grant is reported as disconnected rather than as a server error.
  ///
  /// Note: This method returns the HTTP [Response].
  Future<Response> getGoogleDriveStorageWithHttpInfo({ Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final apiPath = r'/google-drive/storage';

    // ignore: prefer_final_locals
    Object? postBody;

    final queryParams = <QueryParam>[];
    final headerParams = <String, String>{};
    final formParams = <String, String>{};

    const contentTypes = <String>[];


    return apiClient.invokeAPI(
      apiPath,
      'GET',
      queryParams,
      postBody,
      headerParams,
      formParams,
      contentTypes.isEmpty ? null : contentTypes.first,
      abortTrigger: abortTrigger,
    );
  }

  /// Manual \"sync this album to Google Drive now\" trigger — the fallback button shown on an album's page for assets that weren't auto-uploaded (e.g. the album existed before Drive was connected, or an earlier automatic upload failed).  Note there's no request body here beyond the `:id` in the URL — unlike the old prototype version of this endpoint, we don't accept a free-form `albumId` in the JSON body. Using the URL path parameter means normal Immich route-level access checks and Swagger typing apply, and it matches the REST convention used by the rest of the album-related endpoints (`/albums/:id/...`).  All the actual permission enforcement (must the caller be the album owner? has this asset already been uploaded?) happens inside GoogleDriveService#syncAlbum — this controller method just authenticates the caller and forwards the album id.
  ///
  /// Report how full the authenticated user Google Drive is, including how much is held by trash. Requires a connected account; a revoked grant is reported as disconnected rather than as a server error.
  Future<GoogleDriveStorageDto?> getGoogleDriveStorage({ Future<void>? abortTrigger, }) async {
    final response = await getGoogleDriveStorageWithHttpInfo(abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      return await apiClient.deserializeAsync(await _decodeBodyBytes(response), 'GoogleDriveStorageDto',) as GoogleDriveStorageDto;
    
    }
    return null;
  }

  /// Per-user backup progress, for the progress display. Deliberately not album-scoped: uploads are queued per (user, asset), so any album-scoped figure would be unable to describe work that spans albums.
  ///
  /// Return how many assets are still waiting to be uploaded to this user Drive, and how many have failed. Not scoped to an album.
  ///
  /// Note: This method returns the HTTP [Response].
  Future<Response> getMyGoogleDriveStatusWithHttpInfo({ Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final apiPath = r'/google-drive/me/status';

    // ignore: prefer_final_locals
    Object? postBody;

    final queryParams = <QueryParam>[];
    final headerParams = <String, String>{};
    final formParams = <String, String>{};

    const contentTypes = <String>[];


    return apiClient.invokeAPI(
      apiPath,
      'GET',
      queryParams,
      postBody,
      headerParams,
      formParams,
      contentTypes.isEmpty ? null : contentTypes.first,
      abortTrigger: abortTrigger,
    );
  }

  /// Per-user backup progress, for the progress display. Deliberately not album-scoped: uploads are queued per (user, asset), so any album-scoped figure would be unable to describe work that spans albums.
  ///
  /// Return how many assets are still waiting to be uploaded to this user Drive, and how many have failed. Not scoped to an album.
  Future<GoogleDriveMyStatusDto?> getMyGoogleDriveStatus({ Future<void>? abortTrigger, }) async {
    final response = await getMyGoogleDriveStatusWithHttpInfo(abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      return await apiClient.deserializeAsync(await _decodeBodyBytes(response), 'GoogleDriveMyStatusDto',) as GoogleDriveMyStatusDto;
    
    }
    return null;
  }

  /// Reached via browser redirect from Google once the user approves (or declines).  This route now requires an authenticated session, and the flow is additionally bound to the browser through an HttpOnly cookie set by getAuthUrl. It used to be fully public, trusting the signed `state` alone — see GoogleDriveService#handleCallback for the account-takeover that made possible, and why signing by itself was not enough.  Requiring auth here is safe because Google's redirect is a top-level GET navigation, which SameSite=Lax cookies (Immich's default, see utils/response.ts) are sent on. It also matches Immich's own OIDC link endpoint, which is `@Authenticated()`.  We always respond with a redirect back into the Immich web app's settings page, with a `google-drive` query flag so the frontend can show a \"connected!\" or \"something went wrong\" toast to the user — whether things succeeded or failed, the user ends up looking at a normal Immich page rather than a raw JSON error or a blank screen.  The `isOpen=google-drive-sync` part is load-bearing, not cosmetic: settings sections are accordions that only render their contents while expanded (see SettingAccordion.svelte's `{#if isOpen}`), and expansion is driven by that query parameter. Without it the Google Drive panel stays collapsed, never mounts, and so never reads the `google-drive` flag — meaning the user would land on a settings page with no indication whatsoever of whether linking worked.
  ///
  /// Redirect target for Google after the user approves or declines consent. Exchanges the authorization code for a refresh token and always responds with a 302 back into the Immich settings page — never JSON, so this is not meaningfully callable from an SDK.
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [String] code:
  ///
  /// * [String] error:
  ///
  /// * [String] state:
  Future<Response> handleGoogleDriveCallbackWithHttpInfo({ String? code, String? error, String? state, Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final apiPath = r'/google-drive/callback';

    // ignore: prefer_final_locals
    Object? postBody;

    final queryParams = <QueryParam>[];
    final headerParams = <String, String>{};
    final formParams = <String, String>{};

    if (code != null) {
      queryParams.addAll(_queryParams('', 'code', code));
    }
    if (error != null) {
      queryParams.addAll(_queryParams('', 'error', error));
    }
    if (state != null) {
      queryParams.addAll(_queryParams('', 'state', state));
    }

    const contentTypes = <String>[];


    return apiClient.invokeAPI(
      apiPath,
      'GET',
      queryParams,
      postBody,
      headerParams,
      formParams,
      contentTypes.isEmpty ? null : contentTypes.first,
      abortTrigger: abortTrigger,
    );
  }

  /// Reached via browser redirect from Google once the user approves (or declines).  This route now requires an authenticated session, and the flow is additionally bound to the browser through an HttpOnly cookie set by getAuthUrl. It used to be fully public, trusting the signed `state` alone — see GoogleDriveService#handleCallback for the account-takeover that made possible, and why signing by itself was not enough.  Requiring auth here is safe because Google's redirect is a top-level GET navigation, which SameSite=Lax cookies (Immich's default, see utils/response.ts) are sent on. It also matches Immich's own OIDC link endpoint, which is `@Authenticated()`.  We always respond with a redirect back into the Immich web app's settings page, with a `google-drive` query flag so the frontend can show a \"connected!\" or \"something went wrong\" toast to the user — whether things succeeded or failed, the user ends up looking at a normal Immich page rather than a raw JSON error or a blank screen.  The `isOpen=google-drive-sync` part is load-bearing, not cosmetic: settings sections are accordions that only render their contents while expanded (see SettingAccordion.svelte's `{#if isOpen}`), and expansion is driven by that query parameter. Without it the Google Drive panel stays collapsed, never mounts, and so never reads the `google-drive` flag — meaning the user would land on a settings page with no indication whatsoever of whether linking worked.
  ///
  /// Redirect target for Google after the user approves or declines consent. Exchanges the authorization code for a refresh token and always responds with a 302 back into the Immich settings page — never JSON, so this is not meaningfully callable from an SDK.
  ///
  /// Parameters:
  ///
  /// * [String] code:
  ///
  /// * [String] error:
  ///
  /// * [String] state:
  Future<void> handleGoogleDriveCallback({ String? code, String? error, String? state, Future<void>? abortTrigger, }) async {
    final response = await handleGoogleDriveCallbackWithHttpInfo(code: code, error: error, state: state, abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
  }

  /// The \"resume uploads\" button in Settings — shown when the account is blocked (Drive full). Clears the block *and* immediately re-queues this user's pending set; see GoogleDriveService#resumeUploads for why the re-queue half is not optional.
  ///
  /// Clear the account-level block (e.g. after freeing Drive storage) and immediately re-queue the user's pending uploads.
  ///
  /// Note: This method returns the HTTP [Response].
  Future<Response> resumeGoogleDriveUploadsWithHttpInfo({ Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final apiPath = r'/google-drive/resume';

    // ignore: prefer_final_locals
    Object? postBody;

    final queryParams = <QueryParam>[];
    final headerParams = <String, String>{};
    final formParams = <String, String>{};

    const contentTypes = <String>[];


    return apiClient.invokeAPI(
      apiPath,
      'POST',
      queryParams,
      postBody,
      headerParams,
      formParams,
      contentTypes.isEmpty ? null : contentTypes.first,
      abortTrigger: abortTrigger,
    );
  }

  /// The \"resume uploads\" button in Settings — shown when the account is blocked (Drive full). Clears the block *and* immediately re-queues this user's pending set; see GoogleDriveService#resumeUploads for why the re-queue half is not optional.
  ///
  /// Clear the account-level block (e.g. after freeing Drive storage) and immediately re-queue the user's pending uploads.
  Future<void> resumeGoogleDriveUploads({ Future<void>? abortTrigger, }) async {
    final response = await resumeGoogleDriveUploadsWithHttpInfo(abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
  }

  /// Lets a connected user choose which Google Drive folder new uploads should go into. This is a simple \"set and forget\" preference — see GoogleDriveSettings.svelte on the frontend for the (currently very basic) folder-ID text input that calls this.
  ///
  /// Choose which Drive folder subsequent uploads land in. An empty value clears the preference, which puts uploads in the root of the Drive.
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [GoogleDriveSetFolderDto] googleDriveSetFolderDto (required):
  Future<Response> setGoogleDriveFolderWithHttpInfo(GoogleDriveSetFolderDto googleDriveSetFolderDto, { Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final apiPath = r'/google-drive/folder';

    // ignore: prefer_final_locals
    Object? postBody = googleDriveSetFolderDto;

    final queryParams = <QueryParam>[];
    final headerParams = <String, String>{};
    final formParams = <String, String>{};

    const contentTypes = <String>['application/json'];


    return apiClient.invokeAPI(
      apiPath,
      'POST',
      queryParams,
      postBody,
      headerParams,
      formParams,
      contentTypes.isEmpty ? null : contentTypes.first,
      abortTrigger: abortTrigger,
    );
  }

  /// Lets a connected user choose which Google Drive folder new uploads should go into. This is a simple \"set and forget\" preference — see GoogleDriveSettings.svelte on the frontend for the (currently very basic) folder-ID text input that calls this.
  ///
  /// Choose which Drive folder subsequent uploads land in. An empty value clears the preference, which puts uploads in the root of the Drive.
  ///
  /// Parameters:
  ///
  /// * [GoogleDriveSetFolderDto] googleDriveSetFolderDto (required):
  Future<void> setGoogleDriveFolder(GoogleDriveSetFolderDto googleDriveSetFolderDto, { Future<void>? abortTrigger, }) async {
    final response = await setGoogleDriveFolderWithHttpInfo(googleDriveSetFolderDto, abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
  }

  /// Start backing an album up to *the caller's* Drive — not the album owner's. Requires download access, since copying a shared album into your own Google account is egress.
  ///
  /// Add an album to the authenticated user Google Drive backups and immediately queue everything in it that is not already uploaded. Requires download access to the album.
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [String] id (required):
  Future<Response> subscribeGoogleDriveAlbumWithHttpInfo(String id, { Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final apiPath = r'/google-drive/albums/{id}'
      .replaceAll('{id}', id);

    // ignore: prefer_final_locals
    Object? postBody;

    final queryParams = <QueryParam>[];
    final headerParams = <String, String>{};
    final formParams = <String, String>{};

    const contentTypes = <String>[];


    return apiClient.invokeAPI(
      apiPath,
      'PUT',
      queryParams,
      postBody,
      headerParams,
      formParams,
      contentTypes.isEmpty ? null : contentTypes.first,
      abortTrigger: abortTrigger,
    );
  }

  /// Start backing an album up to *the caller's* Drive — not the album owner's. Requires download access, since copying a shared album into your own Google account is egress.
  ///
  /// Add an album to the authenticated user Google Drive backups and immediately queue everything in it that is not already uploaded. Requires download access to the album.
  ///
  /// Parameters:
  ///
  /// * [String] id (required):
  Future<void> subscribeGoogleDriveAlbum(String id, { Future<void>? abortTrigger, }) async {
    final response = await subscribeGoogleDriveAlbumWithHttpInfo(id, abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
  }

  /// Sync an album to the owner's Google Drive
  ///
  /// Queue every not-yet-uploaded asset in the album for upload. Only the album owner may call this, and assets already recorded in the upload ledger are skipped rather than duplicated.
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [String] id (required):
  Future<Response> syncAlbumToGoogleDriveWithHttpInfo(String id, { Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final apiPath = r'/google-drive/albums/{id}/sync'
      .replaceAll('{id}', id);

    // ignore: prefer_final_locals
    Object? postBody;

    final queryParams = <QueryParam>[];
    final headerParams = <String, String>{};
    final formParams = <String, String>{};

    const contentTypes = <String>[];


    return apiClient.invokeAPI(
      apiPath,
      'POST',
      queryParams,
      postBody,
      headerParams,
      formParams,
      contentTypes.isEmpty ? null : contentTypes.first,
      abortTrigger: abortTrigger,
    );
  }

  /// Sync an album to the owner's Google Drive
  ///
  /// Queue every not-yet-uploaded asset in the album for upload. Only the album owner may call this, and assets already recorded in the upload ledger are skipped rather than duplicated.
  ///
  /// Parameters:
  ///
  /// * [String] id (required):
  Future<void> syncAlbumToGoogleDrive(String id, { Future<void>? abortTrigger, }) async {
    final response = await syncAlbumToGoogleDriveWithHttpInfo(id, abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
  }

  /// Stop backing an album up. Files already in Drive are left alone, and the upload ledger is kept so re-selecting later does not duplicate them.
  ///
  /// Remove an album from the authenticated user Google Drive backups. Files already uploaded stay in Drive and stay recorded, so re-adding the album later does not re-upload them.
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [String] id (required):
  Future<Response> unsubscribeGoogleDriveAlbumWithHttpInfo(String id, { Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final apiPath = r'/google-drive/albums/{id}'
      .replaceAll('{id}', id);

    // ignore: prefer_final_locals
    Object? postBody;

    final queryParams = <QueryParam>[];
    final headerParams = <String, String>{};
    final formParams = <String, String>{};

    const contentTypes = <String>[];


    return apiClient.invokeAPI(
      apiPath,
      'DELETE',
      queryParams,
      postBody,
      headerParams,
      formParams,
      contentTypes.isEmpty ? null : contentTypes.first,
      abortTrigger: abortTrigger,
    );
  }

  /// Stop backing an album up. Files already in Drive are left alone, and the upload ledger is kept so re-selecting later does not duplicate them.
  ///
  /// Remove an album from the authenticated user Google Drive backups. Files already uploaded stay in Drive and stay recorded, so re-adding the album later does not re-upload them.
  ///
  /// Parameters:
  ///
  /// * [String] id (required):
  Future<void> unsubscribeGoogleDriveAlbum(String id, { Future<void>? abortTrigger, }) async {
    final response = await unsubscribeGoogleDriveAlbumWithHttpInfo(id, abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
  }
}
