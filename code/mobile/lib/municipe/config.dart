/// Valores de arranque da app do munícipe (`--dart-define`, ver README).
class ConfigMunicipe {
  const ConfigMunicipe._();

  static const String _municipio = String.fromEnvironment('MUNICIPIO');

  /// O município da app (slug): uma app por câmara.
  static String get municipio =>
      _municipio.trim().isEmpty ? 'guimaraes' : _municipio.trim();

  static const String _webUrl = String.fromEnvironment('WEB_URL');

  /// O site (páginas dos links do SMS e o `/ligar`), sem barra no fim.
  static String get webUrl {
    var u = _webUrl.trim();
    while (u.endsWith('/')) {
      u = u.substring(0, u.length - 1);
    }
    return u.isEmpty ? 'http://localhost:3000' : u;
  }

  /// O número da linha da câmara, se a câmara o quiser no botão "Ligar"
  /// (sem ele, "Ligar" abre a chamada pela internet do site: `/ligar`).
  static const String telefone = String.fromEnvironment('TELEFONE');

  /// Push (Firebase Cloud Messaging): só com `--dart-define=FCM=true` e o
  /// `google-services.json` do projeto Firebase (ver README).
  static const bool fcm = bool.fromEnvironment('FCM');
}
