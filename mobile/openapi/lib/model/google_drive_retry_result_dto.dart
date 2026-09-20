//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class GoogleDriveRetryResultDto {
  /// Returns a new [GoogleDriveRetryResultDto] instance.
  GoogleDriveRetryResultDto({
    required this.queued,
  });

  /// Uploads queued by this retry, which may be fewer than the failures cleared
  ///
  /// Minimum value: -9007199254740991
  /// Maximum value: 9007199254740991
  int queued;

  @override
  bool operator ==(Object other) => identical(this, other) || other is GoogleDriveRetryResultDto &&
    other.queued == queued;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (queued.hashCode);

  @override
  String toString() => 'GoogleDriveRetryResultDto[queued=$queued]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'queued'] = this.queued;
    return json;
  }

  /// Returns a new [GoogleDriveRetryResultDto] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static GoogleDriveRetryResultDto? fromJson(dynamic value) {
    upgradeDto(value, "GoogleDriveRetryResultDto");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return GoogleDriveRetryResultDto(
        queued: mapValueOfType<int>(json, r'queued')!,
      );
    }
    return null;
  }

  static List<GoogleDriveRetryResultDto> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <GoogleDriveRetryResultDto>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = GoogleDriveRetryResultDto.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, GoogleDriveRetryResultDto> mapFromJson(dynamic json) {
    final map = <String, GoogleDriveRetryResultDto>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = GoogleDriveRetryResultDto.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of GoogleDriveRetryResultDto-objects as value to a dart map
  static Map<String, List<GoogleDriveRetryResultDto>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<GoogleDriveRetryResultDto>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = GoogleDriveRetryResultDto.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'queued',
  };
}

