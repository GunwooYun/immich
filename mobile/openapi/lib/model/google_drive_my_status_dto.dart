//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class GoogleDriveMyStatusDto {
  /// Returns a new [GoogleDriveMyStatusDto] instance.
  GoogleDriveMyStatusDto({
    required this.failed,
    required this.pending,
  });

  /// Assets whose last upload attempt failed
  ///
  /// Minimum value: -9007199254740991
  /// Maximum value: 9007199254740991
  int failed;

  /// Assets selected for backup that are not yet in this user Drive
  ///
  /// Minimum value: -9007199254740991
  /// Maximum value: 9007199254740991
  int pending;

  @override
  bool operator ==(Object other) => identical(this, other) || other is GoogleDriveMyStatusDto &&
    other.failed == failed &&
    other.pending == pending;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (failed.hashCode) +
    (pending.hashCode);

  @override
  String toString() => 'GoogleDriveMyStatusDto[failed=$failed, pending=$pending]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'failed'] = this.failed;
      json[r'pending'] = this.pending;
    return json;
  }

  /// Returns a new [GoogleDriveMyStatusDto] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static GoogleDriveMyStatusDto? fromJson(dynamic value) {
    upgradeDto(value, "GoogleDriveMyStatusDto");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return GoogleDriveMyStatusDto(
        failed: mapValueOfType<int>(json, r'failed')!,
        pending: mapValueOfType<int>(json, r'pending')!,
      );
    }
    return null;
  }

  static List<GoogleDriveMyStatusDto> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <GoogleDriveMyStatusDto>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = GoogleDriveMyStatusDto.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, GoogleDriveMyStatusDto> mapFromJson(dynamic json) {
    final map = <String, GoogleDriveMyStatusDto>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = GoogleDriveMyStatusDto.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of GoogleDriveMyStatusDto-objects as value to a dart map
  static Map<String, List<GoogleDriveMyStatusDto>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<GoogleDriveMyStatusDto>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = GoogleDriveMyStatusDto.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'failed',
    'pending',
  };
}

