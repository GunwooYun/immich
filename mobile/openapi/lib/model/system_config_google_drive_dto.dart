//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class SystemConfigGoogleDriveDto {
  /// Returns a new [SystemConfigGoogleDriveDto] instance.
  SystemConfigGoogleDriveDto({
    required this.apiKey,
    required this.clientId,
    required this.clientSecret,
    required this.enabled,
    required this.redirectUrl,
  });

  /// Google API key, required only for the Drive folder picker
  String apiKey;

  /// Google OAuth client ID
  String clientId;

  /// Google OAuth client secret
  String clientSecret;

  /// Enabled
  bool enabled;

  /// OAuth redirect URL, e.g. https://immich.example.com/api/google-drive/callback
  String redirectUrl;

  @override
  bool operator ==(Object other) => identical(this, other) || other is SystemConfigGoogleDriveDto &&
    other.apiKey == apiKey &&
    other.clientId == clientId &&
    other.clientSecret == clientSecret &&
    other.enabled == enabled &&
    other.redirectUrl == redirectUrl;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (apiKey.hashCode) +
    (clientId.hashCode) +
    (clientSecret.hashCode) +
    (enabled.hashCode) +
    (redirectUrl.hashCode);

  @override
  String toString() => 'SystemConfigGoogleDriveDto[apiKey=$apiKey, clientId=$clientId, clientSecret=$clientSecret, enabled=$enabled, redirectUrl=$redirectUrl]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'apiKey'] = this.apiKey;
      json[r'clientId'] = this.clientId;
      json[r'clientSecret'] = this.clientSecret;
      json[r'enabled'] = this.enabled;
      json[r'redirectUrl'] = this.redirectUrl;
    return json;
  }

  /// Returns a new [SystemConfigGoogleDriveDto] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static SystemConfigGoogleDriveDto? fromJson(dynamic value) {
    upgradeDto(value, "SystemConfigGoogleDriveDto");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return SystemConfigGoogleDriveDto(
        apiKey: mapValueOfType<String>(json, r'apiKey')!,
        clientId: mapValueOfType<String>(json, r'clientId')!,
        clientSecret: mapValueOfType<String>(json, r'clientSecret')!,
        enabled: mapValueOfType<bool>(json, r'enabled')!,
        redirectUrl: mapValueOfType<String>(json, r'redirectUrl')!,
      );
    }
    return null;
  }

  static List<SystemConfigGoogleDriveDto> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <SystemConfigGoogleDriveDto>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = SystemConfigGoogleDriveDto.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, SystemConfigGoogleDriveDto> mapFromJson(dynamic json) {
    final map = <String, SystemConfigGoogleDriveDto>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = SystemConfigGoogleDriveDto.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of SystemConfigGoogleDriveDto-objects as value to a dart map
  static Map<String, List<SystemConfigGoogleDriveDto>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<SystemConfigGoogleDriveDto>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = SystemConfigGoogleDriveDto.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'apiKey',
    'clientId',
    'clientSecret',
    'enabled',
    'redirectUrl',
  };
}

