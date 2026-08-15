//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class GoogleDriveStatusResponseDto {
  /// Returns a new [GoogleDriveStatusResponseDto] instance.
  GoogleDriveStatusResponseDto({
    required this.blockedReason,
    required this.connected,
    required this.connectedAt,
    required this.failedCount,
    required this.folderId,
    required this.folderName,
  });

  /// Account-level condition currently stopping all uploads, if any: 'quota_exceeded' or 'folder_missing'
  String? blockedReason;

  /// Whether this user has linked a Google Drive account
  bool connected;

  /// When the account was linked, if connected
  DateTime? connectedAt;

  /// Number of uploads currently in a failed state
  ///
  /// Minimum value: -9007199254740991
  /// Maximum value: 9007199254740991
  int failedCount;

  /// The configured upload destination folder, if any
  String? folderId;

  /// Display name of that folder, if it was chosen via the picker
  String? folderName;

  @override
  bool operator ==(Object other) => identical(this, other) || other is GoogleDriveStatusResponseDto &&
    other.blockedReason == blockedReason &&
    other.connected == connected &&
    other.connectedAt == connectedAt &&
    other.failedCount == failedCount &&
    other.folderId == folderId &&
    other.folderName == folderName;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (blockedReason == null ? 0 : blockedReason!.hashCode) +
    (connected.hashCode) +
    (connectedAt == null ? 0 : connectedAt!.hashCode) +
    (failedCount.hashCode) +
    (folderId == null ? 0 : folderId!.hashCode) +
    (folderName == null ? 0 : folderName!.hashCode);

  @override
  String toString() => 'GoogleDriveStatusResponseDto[blockedReason=$blockedReason, connected=$connected, connectedAt=$connectedAt, failedCount=$failedCount, folderId=$folderId, folderName=$folderName]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
    if (this.blockedReason != null) {
      json[r'blockedReason'] = this.blockedReason;
    } else {
      json[r'blockedReason'] = null;
    }
      json[r'connected'] = this.connected;
    if (this.connectedAt != null) {
      json[r'connectedAt'] = _isEpochMarker(r'/^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$/')
        ? this.connectedAt!.millisecondsSinceEpoch
        : this.connectedAt!.toUtc().toIso8601String();
    } else {
      json[r'connectedAt'] = null;
    }
      json[r'failedCount'] = this.failedCount;
    if (this.folderId != null) {
      json[r'folderId'] = this.folderId;
    } else {
      json[r'folderId'] = null;
    }
    if (this.folderName != null) {
      json[r'folderName'] = this.folderName;
    } else {
      json[r'folderName'] = null;
    }
    return json;
  }

  /// Returns a new [GoogleDriveStatusResponseDto] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static GoogleDriveStatusResponseDto? fromJson(dynamic value) {
    upgradeDto(value, "GoogleDriveStatusResponseDto");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return GoogleDriveStatusResponseDto(
        blockedReason: mapValueOfType<String>(json, r'blockedReason'),
        connected: mapValueOfType<bool>(json, r'connected')!,
        connectedAt: mapDateTime(json, r'connectedAt', r'/^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$/'),
        failedCount: mapValueOfType<int>(json, r'failedCount')!,
        folderId: mapValueOfType<String>(json, r'folderId'),
        folderName: mapValueOfType<String>(json, r'folderName'),
      );
    }
    return null;
  }

  static List<GoogleDriveStatusResponseDto> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <GoogleDriveStatusResponseDto>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = GoogleDriveStatusResponseDto.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, GoogleDriveStatusResponseDto> mapFromJson(dynamic json) {
    final map = <String, GoogleDriveStatusResponseDto>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = GoogleDriveStatusResponseDto.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of GoogleDriveStatusResponseDto-objects as value to a dart map
  static Map<String, List<GoogleDriveStatusResponseDto>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<GoogleDriveStatusResponseDto>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = GoogleDriveStatusResponseDto.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'blockedReason',
    'connected',
    'connectedAt',
    'failedCount',
    'folderId',
    'folderName',
  };
}

