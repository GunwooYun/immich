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

  /// Disconnect the Google Drive account
  ///
  /// Note: This method returns the HTTP [Response].
  Future<Response> disconnectWithHttpInfo({ Future<void>? abortTrigger, }) async {
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

  /// Disconnect the Google Drive account
  Future<void> disconnect({ Future<void>? abortTrigger, }) async {
    final response = await disconnectWithHttpInfo(abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
  }

  /// Get Google Drive OAuth URL
  ///
  /// Note: This method returns the HTTP [Response].
  Future<Response> getAuthUrlWithHttpInfo({ Future<void>? abortTrigger, }) async {
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

  /// Get Google Drive OAuth URL
  Future<GoogleDriveAuthUrlResponseDto?> getAuthUrl({ Future<void>? abortTrigger, }) async {
    final response = await getAuthUrlWithHttpInfo(abortTrigger: abortTrigger,);
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

  /// Get the current Google Drive connection status
  ///
  /// Note: This method returns the HTTP [Response].
  Future<Response> getStatusWithHttpInfo({ Future<void>? abortTrigger, }) async {
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

  /// Get the current Google Drive connection status
  Future<GoogleDriveStatusResponseDto?> getStatus({ Future<void>? abortTrigger, }) async {
    final response = await getStatusWithHttpInfo(abortTrigger: abortTrigger,);
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

  /// OAuth callback for Google Drive linking
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
  Future<Response> handleCallbackWithHttpInfo({ String? code, String? error, String? state, Future<void>? abortTrigger, }) async {
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

  /// OAuth callback for Google Drive linking
  ///
  /// Parameters:
  ///
  /// * [String] code:
  ///
  /// * [String] error:
  ///
  /// * [String] state:
  Future<void> handleCallback({ String? code, String? error, String? state, Future<void>? abortTrigger, }) async {
    final response = await handleCallbackWithHttpInfo(code: code, error: error, state: state, abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
  }

  /// Set target Google Drive folder ID
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [GoogleDriveSetFolderDto] googleDriveSetFolderDto (required):
  Future<Response> setFolderIdWithHttpInfo(GoogleDriveSetFolderDto googleDriveSetFolderDto, { Future<void>? abortTrigger, }) async {
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

  /// Set target Google Drive folder ID
  ///
  /// Parameters:
  ///
  /// * [GoogleDriveSetFolderDto] googleDriveSetFolderDto (required):
  Future<void> setFolderId(GoogleDriveSetFolderDto googleDriveSetFolderDto, { Future<void>? abortTrigger, }) async {
    final response = await setFolderIdWithHttpInfo(googleDriveSetFolderDto, abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
  }

  /// Sync an album to the owner's Google Drive
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [String] id (required):
  Future<Response> syncAlbumWithHttpInfo(String id, { Future<void>? abortTrigger, }) async {
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
  /// Parameters:
  ///
  /// * [String] id (required):
  Future<void> syncAlbum(String id, { Future<void>? abortTrigger, }) async {
    final response = await syncAlbumWithHttpInfo(id, abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
  }
}
