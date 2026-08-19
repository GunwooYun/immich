//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class GoogleDriveStorageDto {
  /// Returns a new [GoogleDriveStorageDto] instance.
  GoogleDriveStorageDto({
    required this.limitBytes,
    required this.usageBytes,
    required this.usageInDriveBytes,
    required this.usageInDriveTrashBytes,
  });

  /// Total quota in bytes, or null when the account is unlimited
  ///
  /// Minimum value: -9007199254740991
  /// Maximum value: 9007199254740991
  int? limitBytes;

  /// Bytes used across the whole Google account
  ///
  /// Minimum value: -9007199254740991
  /// Maximum value: 9007199254740991
  int usageBytes;

  /// Bytes used by Drive specifically
  ///
  /// Minimum value: -9007199254740991
  /// Maximum value: 9007199254740991
  int usageInDriveBytes;

  /// Bytes held by files in the Drive trash, reclaimable by emptying it
  ///
  /// Minimum value: -9007199254740991
  /// Maximum value: 9007199254740991
  int usageInDriveTrashBytes;

  @override
  bool operator ==(Object other) => identical(this, other) || other is GoogleDriveStorageDto &&
    other.limitBytes == limitBytes &&
    other.usageBytes == usageBytes &&
    other.usageInDriveBytes == usageInDriveBytes &&
    other.usageInDriveTrashBytes == usageInDriveTrashBytes;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (limitBytes == null ? 0 : limitBytes!.hashCode) +
    (usageBytes.hashCode) +
    (usageInDriveBytes.hashCode) +
    (usageInDriveTrashBytes.hashCode);

  @override
  String toString() => 'GoogleDriveStorageDto[limitBytes=$limitBytes, usageBytes=$usageBytes, usageInDriveBytes=$usageInDriveBytes, usageInDriveTrashBytes=$usageInDriveTrashBytes]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
    if (this.limitBytes != null) {
      json[r'limitBytes'] = this.limitBytes;
    } else {
      json[r'limitBytes'] = null;
    }
      json[r'usageBytes'] = this.usageBytes;
      json[r'usageInDriveBytes'] = this.usageInDriveBytes;
      json[r'usageInDriveTrashBytes'] = this.usageInDriveTrashBytes;
    return json;
  }

  /// Returns a new [GoogleDriveStorageDto] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static GoogleDriveStorageDto? fromJson(dynamic value) {
    upgradeDto(value, "GoogleDriveStorageDto");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return GoogleDriveStorageDto(
        limitBytes: mapValueOfType<int>(json, r'limitBytes'),
        usageBytes: mapValueOfType<int>(json, r'usageBytes')!,
        usageInDriveBytes: mapValueOfType<int>(json, r'usageInDriveBytes')!,
        usageInDriveTrashBytes: mapValueOfType<int>(json, r'usageInDriveTrashBytes')!,
      );
    }
    return null;
  }

  static List<GoogleDriveStorageDto> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <GoogleDriveStorageDto>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = GoogleDriveStorageDto.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, GoogleDriveStorageDto> mapFromJson(dynamic json) {
    final map = <String, GoogleDriveStorageDto>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = GoogleDriveStorageDto.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of GoogleDriveStorageDto-objects as value to a dart map
  static Map<String, List<GoogleDriveStorageDto>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<GoogleDriveStorageDto>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = GoogleDriveStorageDto.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'limitBytes',
    'usageBytes',
    'usageInDriveBytes',
    'usageInDriveTrashBytes',
  };
}

