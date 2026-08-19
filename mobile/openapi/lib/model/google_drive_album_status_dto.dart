//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class GoogleDriveAlbumStatusDto {
  /// Returns a new [GoogleDriveAlbumStatusDto] instance.
  GoogleDriveAlbumStatusDto({
    required this.accessLost,
    required this.assetCount,
    required this.subscribed,
    required this.uploadedCount,
  });

  /// Selected but no longer shared with this user, so uploads have stopped
  bool accessLost;

  /// Assets in the album, excluding trashed
  ///
  /// Minimum value: -9007199254740991
  /// Maximum value: 9007199254740991
  int assetCount;

  /// Whether this album is backed up to the authenticated user Drive
  bool subscribed;

  /// Of those, how many are already in this user Drive
  ///
  /// Minimum value: -9007199254740991
  /// Maximum value: 9007199254740991
  int uploadedCount;

  @override
  bool operator ==(Object other) => identical(this, other) || other is GoogleDriveAlbumStatusDto &&
    other.accessLost == accessLost &&
    other.assetCount == assetCount &&
    other.subscribed == subscribed &&
    other.uploadedCount == uploadedCount;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (accessLost.hashCode) +
    (assetCount.hashCode) +
    (subscribed.hashCode) +
    (uploadedCount.hashCode);

  @override
  String toString() => 'GoogleDriveAlbumStatusDto[accessLost=$accessLost, assetCount=$assetCount, subscribed=$subscribed, uploadedCount=$uploadedCount]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'accessLost'] = this.accessLost;
      json[r'assetCount'] = this.assetCount;
      json[r'subscribed'] = this.subscribed;
      json[r'uploadedCount'] = this.uploadedCount;
    return json;
  }

  /// Returns a new [GoogleDriveAlbumStatusDto] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static GoogleDriveAlbumStatusDto? fromJson(dynamic value) {
    upgradeDto(value, "GoogleDriveAlbumStatusDto");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return GoogleDriveAlbumStatusDto(
        accessLost: mapValueOfType<bool>(json, r'accessLost')!,
        assetCount: mapValueOfType<int>(json, r'assetCount')!,
        subscribed: mapValueOfType<bool>(json, r'subscribed')!,
        uploadedCount: mapValueOfType<int>(json, r'uploadedCount')!,
      );
    }
    return null;
  }

  static List<GoogleDriveAlbumStatusDto> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <GoogleDriveAlbumStatusDto>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = GoogleDriveAlbumStatusDto.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, GoogleDriveAlbumStatusDto> mapFromJson(dynamic json) {
    final map = <String, GoogleDriveAlbumStatusDto>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = GoogleDriveAlbumStatusDto.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of GoogleDriveAlbumStatusDto-objects as value to a dart map
  static Map<String, List<GoogleDriveAlbumStatusDto>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<GoogleDriveAlbumStatusDto>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = GoogleDriveAlbumStatusDto.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'accessLost',
    'assetCount',
    'subscribed',
    'uploadedCount',
  };
}

