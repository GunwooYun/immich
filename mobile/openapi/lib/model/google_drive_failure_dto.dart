//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class GoogleDriveFailureDto {
  /// Returns a new [GoogleDriveFailureDto] instance.
  GoogleDriveFailureDto({
    required this.assetId,
    required this.attempts,
    required this.detail,
    required this.error,
    required this.fileName,
    required this.lastFailedAt,
  });

  /// The asset that failed to upload
  String assetId;

  /// How many times this asset has been tried
  ///
  /// Minimum value: -9007199254740991
  /// Maximum value: 9007199254740991
  int attempts;

  /// What the upload reported, when it said anything useful
  String? detail;

  /// Failure classification, e.g. 'source_unreadable' or 'quota_exceeded'
  String error;

  /// Original file name, so the row is recognisable without a thumbnail
  String fileName;

  /// When it last failed
  DateTime lastFailedAt;

  @override
  bool operator ==(Object other) => identical(this, other) || other is GoogleDriveFailureDto &&
    other.assetId == assetId &&
    other.attempts == attempts &&
    other.detail == detail &&
    other.error == error &&
    other.fileName == fileName &&
    other.lastFailedAt == lastFailedAt;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (assetId.hashCode) +
    (attempts.hashCode) +
    (detail == null ? 0 : detail!.hashCode) +
    (error.hashCode) +
    (fileName.hashCode) +
    (lastFailedAt.hashCode);

  @override
  String toString() => 'GoogleDriveFailureDto[assetId=$assetId, attempts=$attempts, detail=$detail, error=$error, fileName=$fileName, lastFailedAt=$lastFailedAt]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'assetId'] = this.assetId;
      json[r'attempts'] = this.attempts;
    if (this.detail != null) {
      json[r'detail'] = this.detail;
    } else {
      json[r'detail'] = null;
    }
      json[r'error'] = this.error;
      json[r'fileName'] = this.fileName;
      json[r'lastFailedAt'] = _isEpochMarker(r'/^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$/')
        ? this.lastFailedAt.millisecondsSinceEpoch
        : this.lastFailedAt.toUtc().toIso8601String();
    return json;
  }

  /// Returns a new [GoogleDriveFailureDto] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static GoogleDriveFailureDto? fromJson(dynamic value) {
    upgradeDto(value, "GoogleDriveFailureDto");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return GoogleDriveFailureDto(
        assetId: mapValueOfType<String>(json, r'assetId')!,
        attempts: mapValueOfType<int>(json, r'attempts')!,
        detail: mapValueOfType<String>(json, r'detail'),
        error: mapValueOfType<String>(json, r'error')!,
        fileName: mapValueOfType<String>(json, r'fileName')!,
        lastFailedAt: mapDateTime(json, r'lastFailedAt', r'/^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$/')!,
      );
    }
    return null;
  }

  static List<GoogleDriveFailureDto> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <GoogleDriveFailureDto>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = GoogleDriveFailureDto.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, GoogleDriveFailureDto> mapFromJson(dynamic json) {
    final map = <String, GoogleDriveFailureDto>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = GoogleDriveFailureDto.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of GoogleDriveFailureDto-objects as value to a dart map
  static Map<String, List<GoogleDriveFailureDto>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<GoogleDriveFailureDto>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = GoogleDriveFailureDto.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'assetId',
    'attempts',
    'detail',
    'error',
    'fileName',
    'lastFailedAt',
  };
}

