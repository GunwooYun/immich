//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class GoogleDriveSetFolderDto {
  /// Returns a new [GoogleDriveSetFolderDto] instance.
  GoogleDriveSetFolderDto({
    required this.folderId,
  });

  /// Drive folder id to upload into; empty string clears the setting
  String folderId;

  @override
  bool operator ==(Object other) => identical(this, other) || other is GoogleDriveSetFolderDto &&
    other.folderId == folderId;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (folderId.hashCode);

  @override
  String toString() => 'GoogleDriveSetFolderDto[folderId=$folderId]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'folderId'] = this.folderId;
    return json;
  }

  /// Returns a new [GoogleDriveSetFolderDto] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static GoogleDriveSetFolderDto? fromJson(dynamic value) {
    upgradeDto(value, "GoogleDriveSetFolderDto");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return GoogleDriveSetFolderDto(
        folderId: mapValueOfType<String>(json, r'folderId')!,
      );
    }
    return null;
  }

  static List<GoogleDriveSetFolderDto> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <GoogleDriveSetFolderDto>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = GoogleDriveSetFolderDto.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, GoogleDriveSetFolderDto> mapFromJson(dynamic json) {
    final map = <String, GoogleDriveSetFolderDto>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = GoogleDriveSetFolderDto.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of GoogleDriveSetFolderDto-objects as value to a dart map
  static Map<String, List<GoogleDriveSetFolderDto>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<GoogleDriveSetFolderDto>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = GoogleDriveSetFolderDto.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'folderId',
  };
}

