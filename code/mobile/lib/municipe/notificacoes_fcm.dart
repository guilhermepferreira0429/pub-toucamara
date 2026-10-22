import 'dart:async';

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';

import '../comum/api/cliente_api.dart';
import '../comum/armazenamento/armazem.dart';
import 'notificacoes.dart';

/// A API envia pelo FCM v1 para o token de registo (`message.token`), por
/// isso usa-se getToken/onTokenRefresh (marcados como obsoletos a favor do
/// envio direto por FID, que a API ainda não usa).
///
/// Push com o Firebase Cloud Messaging (só com `--dart-define=FCM=true` e o
/// `android/app/src/municipe/google-services.json`). A API envia
/// `data.link` (rota da app, ex.: `/processos/<id>`, `/avisos`) e o canal
/// Android do tipo.
class NotificacoesFcm extends Notificacoes {
  NotificacoesFcm(this._armazem);

  static const _chaveDispositivo = 'push_dispositivo_id';
  final Armazem _armazem;
  String _estado = 'Notificações: a preparar…';
  bool _pronto = false;
  StreamSubscription<String>? _renovar;

  @override
  String get estado => _estado;
  @override
  bool get configuradas => _pronto;

  @override
  Future<void> iniciar({
    required void Function(String link) aoAbrir,
    required void Function(NotificacaoRecebida n) aoReceber,
  }) async {
    try {
      await Firebase.initializeApp();
      await criarCanaisAndroid();
      final m = FirebaseMessaging.instance;
      final p = await m.requestPermission();
      _pronto = true;
      _estado = p.authorizationStatus == AuthorizationStatus.denied
          ? 'Notificações: bloqueadas nas definições do telemóvel'
          : 'Notificações: ligadas';
      String? linkDe(RemoteMessage r) {
        final l = r.data['link'];
        return l is String && l.isNotEmpty ? l : null;
      }

      final inicial = await m.getInitialMessage();
      final li = inicial == null ? null : linkDe(inicial);
      if (li != null) aoAbrir(li);
      FirebaseMessaging.onMessageOpenedApp.listen((r) {
        final l = linkDe(r);
        if (l != null) aoAbrir(l);
      });
      // Com a app aberta o Android não mostra a notificação: mostra a app.
      FirebaseMessaging.onMessage.listen((r) {
        aoReceber(
          NotificacaoRecebida(
            titulo: r.notification?.title ?? 'Aviso da câmara',
            corpo: r.notification?.body ?? '',
            link: linkDe(r),
          ),
        );
      });
    } on Object catch (e) {
      debugPrint('Firebase por configurar: $e');
      _pronto = false;
      _estado = 'Notificações: por configurar (Firebase)';
    }
    notifyListeners();
  }

  @override
  Future<void> registar(ClienteApi api) async {
    if (!_pronto) return;
    Future<void> enviar(String token) async {
      final r = await api.post(
        '/app/dispositivos',
        corpo: {
          'fcm_token': token,
          'plataforma': 'android',
          'idioma': 'pt-PT',
          'versao_app': '0.1.0',
        },
      );
      final id = r is Map ? r['id'] : null;
      if (id is String) await _armazem.escrever(_chaveDispositivo, id);
    }

    try {
      // ignore: deprecated_member_use
      final token = await FirebaseMessaging.instance.getToken();
      if (token != null) await enviar(token);
      await _renovar?.cancel();
      // ignore: deprecated_member_use
      _renovar = FirebaseMessaging.instance.onTokenRefresh.listen(
        (t) => unawaited(enviar(t).catchError((Object _) {})),
      );
    } on Object catch (e) {
      debugPrint('Push por registar: $e');
    }
  }

  @override
  Future<void> desregistar(ClienteApi api) async {
    await _renovar?.cancel();
    _renovar = null;
    final id = await _armazem.ler(_chaveDispositivo);
    if (id != null) {
      try {
        await api.pedido('DELETE', '/app/dispositivos/$id');
      } on Object {
        // Sair na API também desliga os telemóveis da sessão.
      }
      await _armazem.apagar(_chaveDispositivo);
    }
    if (_pronto) {
      try {
        // ignore: deprecated_member_use
        await FirebaseMessaging.instance.deleteToken();
      } on Object {
        // sem rede: o token antigo deixa de servir quando a API o recusar
      }
    }
  }
}
