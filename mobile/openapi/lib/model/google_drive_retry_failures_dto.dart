//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class GoogleDriveRetryFailuresDto {
  /// Returns a new [GoogleDriveRetryFailuresDto] instance.
  GoogleDriveRetryFailuresDto({
    this.assetIds = const Optional.present(const []),
  });

  /// Assets to retry; empty retries every failure
  Optional<List<String>?> assetIds;

  @override
  bool operator ==(Object other) => identical(this, other) || other is GoogleDriveRetryFailuresDto &&
    _deepEquality.equals(other.assetIds, assetIds);

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (assetIds.hashCode);

  @override
  String toString() => 'GoogleDriveRetryFailuresDto[assetIds=$assetIds]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
    if (this.assetIds.isPresent) {
      final value = this.assetIds.value;
      json[r'assetIds'] = value;
    }
    return json;
  }

  /// Returns a new [GoogleDriveRetryFailuresDto] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static GoogleDriveRetryFailuresDto? fromJson(dynamic value) {
    upgradeDto(value, "GoogleDriveRetryFailuresDto");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return GoogleDriveRetryFailuresDto(
        assetIds: json.containsKey(r'assetIds') ? Optional.present(json[r'assetIds'] is Iterable
            ? (json[r'assetIds'] as Iterable).cast<String>().toList(growable: false)
            : const []) : const Optional.absent(),
      );
    }
    return null;
  }

  static List<GoogleDriveRetryFailuresDto> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <GoogleDriveRetryFailuresDto>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = GoogleDriveRetryFailuresDto.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, GoogleDriveRetryFailuresDto> mapFromJson(dynamic json) {
    final map = <String, GoogleDriveRetryFailuresDto>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = GoogleDriveRetryFailuresDto.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of GoogleDriveRetryFailuresDto-objects as value to a dart map
  static Map<String, List<GoogleDriveRetryFailuresDto>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<GoogleDriveRetryFailuresDto>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = GoogleDriveRetryFailuresDto.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
  };
}

