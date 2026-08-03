//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class GoogleDriveAuthUrlResponseDto {
  /// Returns a new [GoogleDriveAuthUrlResponseDto] instance.
  GoogleDriveAuthUrlResponseDto({
    required this.url,
  });

  /// Google OAuth consent URL to redirect the browser to
  String url;

  @override
  bool operator ==(Object other) => identical(this, other) || other is GoogleDriveAuthUrlResponseDto &&
    other.url == url;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (url.hashCode);

  @override
  String toString() => 'GoogleDriveAuthUrlResponseDto[url=$url]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'url'] = this.url;
    return json;
  }

  /// Returns a new [GoogleDriveAuthUrlResponseDto] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static GoogleDriveAuthUrlResponseDto? fromJson(dynamic value) {
    upgradeDto(value, "GoogleDriveAuthUrlResponseDto");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return GoogleDriveAuthUrlResponseDto(
        url: mapValueOfType<String>(json, r'url')!,
      );
    }
    return null;
  }

  static List<GoogleDriveAuthUrlResponseDto> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <GoogleDriveAuthUrlResponseDto>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = GoogleDriveAuthUrlResponseDto.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, GoogleDriveAuthUrlResponseDto> mapFromJson(dynamic json) {
    final map = <String, GoogleDriveAuthUrlResponseDto>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = GoogleDriveAuthUrlResponseDto.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of GoogleDriveAuthUrlResponseDto-objects as value to a dart map
  static Map<String, List<GoogleDriveAuthUrlResponseDto>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<GoogleDriveAuthUrlResponseDto>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = GoogleDriveAuthUrlResponseDto.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'url',
  };
}

