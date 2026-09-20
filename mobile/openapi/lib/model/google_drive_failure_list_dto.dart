//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class GoogleDriveFailureListDto {
  /// Returns a new [GoogleDriveFailureListDto] instance.
  GoogleDriveFailureListDto({
    this.failures = const [],
    required this.total,
  });

  /// Newest first, capped
  List<GoogleDriveFailureDto> failures;

  /// All current failures, which may exceed the returned list
  ///
  /// Minimum value: -9007199254740991
  /// Maximum value: 9007199254740991
  int total;

  @override
  bool operator ==(Object other) => identical(this, other) || other is GoogleDriveFailureListDto &&
    _deepEquality.equals(other.failures, failures) &&
    other.total == total;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (failures.hashCode) +
    (total.hashCode);

  @override
  String toString() => 'GoogleDriveFailureListDto[failures=$failures, total=$total]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'failures'] = this.failures;
      json[r'total'] = this.total;
    return json;
  }

  /// Returns a new [GoogleDriveFailureListDto] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static GoogleDriveFailureListDto? fromJson(dynamic value) {
    upgradeDto(value, "GoogleDriveFailureListDto");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return GoogleDriveFailureListDto(
        failures: GoogleDriveFailureDto.listFromJson(json[r'failures']),
        total: mapValueOfType<int>(json, r'total')!,
      );
    }
    return null;
  }

  static List<GoogleDriveFailureListDto> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <GoogleDriveFailureListDto>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = GoogleDriveFailureListDto.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, GoogleDriveFailureListDto> mapFromJson(dynamic json) {
    final map = <String, GoogleDriveFailureListDto>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = GoogleDriveFailureListDto.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of GoogleDriveFailureListDto-objects as value to a dart map
  static Map<String, List<GoogleDriveFailureListDto>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<GoogleDriveFailureListDto>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = GoogleDriveFailureListDto.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'failures',
    'total',
  };
}

