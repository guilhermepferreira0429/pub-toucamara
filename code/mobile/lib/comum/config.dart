import 'package:flutter/foundation.dart';

/// Valores de arranque vindos de `--dart-define` (ver README).
///
/// `API_URL` é o endereço da API central sem o `/v1` (ex.:
/// `https://api.toucamara.pt`). Pode mudar-se depois no ecrã escondido de
/// definições ("Servidor").
class ConfigApp {
  const ConfigApp._();

  static const String _apiUrl = String.fromEnvironment('API_URL');

  /// Slug do município para a equipa interna (sem município na conta).
  static const String municipio = String.fromEnvironment('MUNICIPIO');

  /// Sem `API_URL`: no emulador Android a máquina é 10.0.2.2; no browser,
  /// a mesma máquina.
  static String get apiUrlPorOmissao {
    if (_apiUrl.isNotEmpty) return normalizarUrl(_apiUrl);
    return kIsWeb ? 'http://localhost:3001' : 'http://10.0.2.2:3001';
  }

  /// Sem barra no fim e sem o `/v1` (a app acrescenta-o).
  static String normalizarUrl(String url) {
    var u = url.trim();
    while (u.endsWith('/')) {
      u = u.substring(0, u.length - 1);
    }
    if (u.endsWith('/v1')) u = u.substring(0, u.length - 3);
    return u;
  }

  /// Aceita só http(s) com servidor.
  static bool urlValido(String url) {
    final u = Uri.tryParse(normalizarUrl(url));
    return u != null &&
        (u.scheme == 'http' || u.scheme == 'https') &&
        u.host.isNotEmpty;
  }
}
