//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class GoogleDriveAlbumDto {
  /// Returns a new [GoogleDriveAlbumDto] instance.
  GoogleDriveAlbumDto({
    required this.accessLost,
    required this.albumId,
    required this.albumName,
    required this.assetCount,
    required this.isOwner,
    required this.ownerName,
    required this.subscribed,
    required this.uploadedCount,
  });

  /// Selected for backup but the album is no longer shared with this user: uploads have stopped and the selection can only be removed
  bool accessLost;

  /// Album id
  String albumId;

  /// Album name
  String albumName;

  /// Number of assets in the album, excluding trashed
  ///
  /// Minimum value: -9007199254740991
  /// Maximum value: 9007199254740991
  int assetCount;

  /// Whether the authenticated user owns this album
  bool isOwner;

  /// Name of the album owner
  String ownerName;

  /// Whether this album is backed up to the authenticated user Drive
  bool subscribed;

  /// Assets already uploaded to the authenticated user Drive
  ///
  /// Minimum value: -9007199254740991
  /// Maximum value: 9007199254740991
  int uploadedCount;

  @override
  bool operator ==(Object other) => identical(this, other) || other is GoogleDriveAlbumDto &&
    other.accessLost == accessLost &&
    other.albumId == albumId &&
    other.albumName == albumName &&
    other.assetCount == assetCount &&
    other.isOwner == isOwner &&
    other.ownerName == ownerName &&
    other.subscribed == subscribed &&
    other.uploadedCount == uploadedCount;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (accessLost.hashCode) +
    (albumId.hashCode) +
    (albumName.hashCode) +
    (assetCount.hashCode) +
    (isOwner.hashCode) +
    (ownerName.hashCode) +
    (subscribed.hashCode) +
    (uploadedCount.hashCode);

  @override
  String toString() => 'GoogleDriveAlbumDto[accessLost=$accessLost, albumId=$albumId, albumName=$albumName, assetCount=$assetCount, isOwner=$isOwner, ownerName=$ownerName, subscribed=$subscribed, uploadedCount=$uploadedCount]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'accessLost'] = this.accessLost;
      json[r'albumId'] = this.albumId;
      json[r'albumName'] = this.albumName;
      json[r'assetCount'] = this.assetCount;
      json[r'isOwner'] = this.isOwner;
      json[r'ownerName'] = this.ownerName;
      json[r'subscribed'] = this.subscribed;
      json[r'uploadedCount'] = this.uploadedCount;
    return json;
  }

  /// Returns a new [GoogleDriveAlbumDto] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static GoogleDriveAlbumDto? fromJson(dynamic value) {
    upgradeDto(value, "GoogleDriveAlbumDto");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return GoogleDriveAlbumDto(
        accessLost: mapValueOfType<bool>(json, r'accessLost')!,
        albumId: mapValueOfType<String>(json, r'albumId')!,
        albumName: mapValueOfType<String>(json, r'albumName')!,
        assetCount: mapValueOfType<int>(json, r'assetCount')!,
        isOwner: mapValueOfType<bool>(json, r'isOwner')!,
        ownerName: mapValueOfType<String>(json, r'ownerName')!,
        subscribed: mapValueOfType<bool>(json, r'subscribed')!,
        uploadedCount: mapValueOfType<int>(json, r'uploadedCount')!,
      );
    }
    return null;
  }

  static List<GoogleDriveAlbumDto> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <GoogleDriveAlbumDto>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = GoogleDriveAlbumDto.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, GoogleDriveAlbumDto> mapFromJson(dynamic json) {
    final map = <String, GoogleDriveAlbumDto>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = GoogleDriveAlbumDto.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of GoogleDriveAlbumDto-objects as value to a dart map
  static Map<String, List<GoogleDriveAlbumDto>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<GoogleDriveAlbumDto>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = GoogleDriveAlbumDto.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'accessLost',
    'albumId',
    'albumName',
    'assetCount',
    'isOwner',
    'ownerName',
    'subscribed',
    'uploadedCount',
  };
}

