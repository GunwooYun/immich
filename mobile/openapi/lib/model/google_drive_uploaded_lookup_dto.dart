//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class GoogleDriveUploadedLookupDto {
  /// Returns a new [GoogleDriveUploadedLookupDto] instance.
  GoogleDriveUploadedLookupDto({
    this.assetIds = const [],
  });

  /// Asset IDs to check, at most 1000 per request
  List<String> assetIds;

  @override
  bool operator ==(Object other) => identical(this, other) || other is GoogleDriveUploadedLookupDto &&
    _deepEquality.equals(other.assetIds, assetIds);

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (assetIds.hashCode);

  @override
  String toString() => 'GoogleDriveUploadedLookupDto[assetIds=$assetIds]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'assetIds'] = this.assetIds;
    return json;
  }

  /// Returns a new [GoogleDriveUploadedLookupDto] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static GoogleDriveUploadedLookupDto? fromJson(dynamic value) {
    upgradeDto(value, "GoogleDriveUploadedLookupDto");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return GoogleDriveUploadedLookupDto(
        assetIds: json[r'assetIds'] is Iterable
            ? (json[r'assetIds'] as Iterable).cast<String>().toList(growable: false)
            : const [],
      );
    }
    return null;
  }

  static List<GoogleDriveUploadedLookupDto> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <GoogleDriveUploadedLookupDto>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = GoogleDriveUploadedLookupDto.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, GoogleDriveUploadedLookupDto> mapFromJson(dynamic json) {
    final map = <String, GoogleDriveUploadedLookupDto>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = GoogleDriveUploadedLookupDto.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of GoogleDriveUploadedLookupDto-objects as value to a dart map
  static Map<String, List<GoogleDriveUploadedLookupDto>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<GoogleDriveUploadedLookupDto>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = GoogleDriveUploadedLookupDto.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'assetIds',
  };
}

