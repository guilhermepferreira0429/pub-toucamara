import 'package:flutter/foundation.dart';

/// Configuração dos mapas (docs/MAPAS.md), vinda de `--dart-define`.
///
/// - `MAPBOX_TOKEN`: o token PÚBLICO do Mapbox (começa por `pk.`). Nunca no
///   git. Sem ele, os mapas usam os mosaicos do OpenStreetMap, como antes.
/// - `MAPBOX_ESTILO_RASTER`: o estilo dos mosaicos 2D (flutter_map), por
///   omissão `streets-v12`.
/// - `MAPBOX_ESTILO`: o estilo do mapa 3D nativo (por omissão o Standard).
/// - `MAPA_NATIVO=true`: no Android, o mapa 3D nativo (mapbox_maps_flutter);
///   sem isto (ou no browser, ou sem token) fica o flutter_map em 2D.
class ConfigMapa {
  const ConfigMapa._();

  static const String _token = String.fromEnvironment('MAPBOX_TOKEN');
  static const String _estiloRaster = String.fromEnvironment(
    'MAPBOX_ESTILO_RASTER',
    defaultValue: 'streets-v12',
  );
  static const String _estilo = String.fromEnvironment('MAPBOX_ESTILO');
  static const bool _nativo = bool.fromEnvironment('MAPA_NATIVO');

  /// Paços do Concelho de Guimarães (para centrar sem pontos).
  static const double latOmissao = 41.4425;
  static const double lngOmissao = -8.2918;

  /// Inclinação e rotação da vista 3D (oblíqua).
  static const double pitch3d = 58;
  static const double bearing3d = -17;

  /// O token público, ou null (um token secreto "sk." nunca serve aqui).
  static String? get token =>
      _token.trim().startsWith('pk.') ? _token.trim() : null;

  static bool get temMapbox => token != null;

  /// Mapa 3D nativo? Só Android, com token e com MAPA_NATIVO=true.
  static bool get usarNativo =>
      _nativo &&
      temMapbox &&
      !kIsWeb &&
      defaultTargetPlatform == TargetPlatform.android;

  /// O estilo do mapa nativo (nome curto ou mapbox://styles/…).
  static String get estiloNativo {
    final v = _estilo.trim();
    if (v.isEmpty || v == 'standard') return 'mapbox://styles/mapbox/standard';
    if (v == 'standard-satellite') {
      return 'mapbox://styles/mapbox/standard-satellite';
    }
    return v.startsWith('mapbox://') ? v : 'mapbox://styles/mapbox/standard';
  }

  /// Os mosaicos 2D: os do Mapbox (512 px, @2x) com token, senão OSM.
  static String get urlMosaicos {
    final t = token;
    if (t == null) return 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
    return 'https://api.mapbox.com/styles/v1/mapbox/$_estiloRaster/tiles/512/{z}/{x}/{y}@2x?access_token=$t';
  }

  /// Os mosaicos do Mapbox têm 512 px (e o zoom desloca-se de 1).
  static int get tamanhoMosaico => temMapbox ? 512 : 256;
  static int get desvioZoom => temMapbox ? -1 : 0;

  /// Créditos obrigatórios do fundo.
  static List<String> get creditos => temMapbox
      ? const ['© Mapbox', '© Contribuidores do OpenStreetMap']
      : const ['Contribuidores do OpenStreetMap'];

  /// A config do Standard com as cores da marca (como na web).
  static const Map<String, Object> configStandard = {
    'lightPreset': 'day',
    'show3dObjects': true,
    'showPointOfInterestLabels': false,
    'showTransitLabels': false,
    'colorGreenspace': '#cfe0c3',
    'colorWater': '#a9c7d8',
    'colorMotorways': '#e9b9a1',
    'colorTrunks': '#f0cdb6',
    'colorRoads': '#fffbf5',
  };
}
