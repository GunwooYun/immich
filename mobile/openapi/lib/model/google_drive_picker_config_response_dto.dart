//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class GoogleDrivePickerConfigResponseDto {
  /// Returns a new [GoogleDrivePickerConfigResponseDto] instance.
  GoogleDrivePickerConfigResponseDto({
    required this.accessToken,
    required this.apiKey,
    required this.clientId,
  });

  /// Short-lived OAuth access token for the Picker to use
  String accessToken;

  /// Google API key (developer key) the Picker requires
  String apiKey;

  /// Google OAuth client id the Picker should identify as
  String clientId;

  @override
  bool operator ==(Object other) => identical(this, other) || other is GoogleDrivePickerConfigResponseDto &&
    other.accessToken == accessToken &&
    other.apiKey == apiKey &&
    other.clientId == clientId;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (accessToken.hashCode) +
    (apiKey.hashCode) +
    (clientId.hashCode);

  @override
  String toString() => 'GoogleDrivePickerConfigResponseDto[accessToken=$accessToken, apiKey=$apiKey, clientId=$clientId]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'accessToken'] = this.accessToken;
      json[r'apiKey'] = this.apiKey;
      json[r'clientId'] = this.clientId;
    return json;
  }

  /// Returns a new [GoogleDrivePickerConfigResponseDto] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static GoogleDrivePickerConfigResponseDto? fromJson(dynamic value) {
    upgradeDto(value, "GoogleDrivePickerConfigResponseDto");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return GoogleDrivePickerConfigResponseDto(
        accessToken: mapValueOfType<String>(json, r'accessToken')!,
        apiKey: mapValueOfType<String>(json, r'apiKey')!,
        clientId: mapValueOfType<String>(json, r'clientId')!,
      );
    }
    return null;
  }

  static List<GoogleDrivePickerConfigResponseDto> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <GoogleDrivePickerConfigResponseDto>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = GoogleDrivePickerConfigResponseDto.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, GoogleDrivePickerConfigResponseDto> mapFromJson(dynamic json) {
    final map = <String, GoogleDrivePickerConfigResponseDto>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = GoogleDrivePickerConfigResponseDto.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of GoogleDrivePickerConfigResponseDto-objects as value to a dart map
  static Map<String, List<GoogleDrivePickerConfigResponseDto>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<GoogleDrivePickerConfigResponseDto>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = GoogleDrivePickerConfigResponseDto.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'accessToken',
    'apiKey',
    'clientId',
  };
}

