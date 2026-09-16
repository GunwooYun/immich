//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class GoogleDriveUploadedLookupResponseDto {
  /// Returns a new [GoogleDriveUploadedLookupResponseDto] instance.
  GoogleDriveUploadedLookupResponseDto({
    this.assetIds = const [],
  });

  /// The subset of the requested asset IDs already uploaded to the caller connected Drive
  List<String> assetIds;

  @override
  bool operator ==(Object other) => identical(this, other) || other is GoogleDriveUploadedLookupResponseDto &&
    _deepEquality.equals(other.assetIds, assetIds);

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (assetIds.hashCode);

  @override
  String toString() => 'GoogleDriveUploadedLookupResponseDto[assetIds=$assetIds]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'assetIds'] = this.assetIds;
    return json;
  }

  /// Returns a new [GoogleDriveUploadedLookupResponseDto] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static GoogleDriveUploadedLookupResponseDto? fromJson(dynamic value) {
    upgradeDto(value, "GoogleDriveUploadedLookupResponseDto");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return GoogleDriveUploadedLookupResponseDto(
        assetIds: json[r'assetIds'] is Iterable
            ? (json[r'assetIds'] as Iterable).cast<String>().toList(growable: false)
            : const [],
      );
    }
    return null;
  }

  static List<GoogleDriveUploadedLookupResponseDto> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <GoogleDriveUploadedLookupResponseDto>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = GoogleDriveUploadedLookupResponseDto.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, GoogleDriveUploadedLookupResponseDto> mapFromJson(dynamic json) {
    final map = <String, GoogleDriveUploadedLookupResponseDto>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = GoogleDriveUploadedLookupResponseDto.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of GoogleDriveUploadedLookupResponseDto-objects as value to a dart map
  static Map<String, List<GoogleDriveUploadedLookupResponseDto>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<GoogleDriveUploadedLookupResponseDto>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = GoogleDriveUploadedLookupResponseDto.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'assetIds',
  };
}

