import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';

import '../comum/api/cliente_api.dart';

/// Os três canais Android (os mesmos ids que a API põe em cada push:
/// `code/api/src/modules/app-municipe/fcm.ts`, CANAL_ANDROID).
class CanalNotificacao {
  const CanalNotificacao(this.id, this.nome, this.descricao, this.importancia);
  final String id;
  final String nome;
  final String descricao;

  /// 4 = alta (som e aparece por cima), 3 = normal.
  final int importancia;

  Map<String, Object> paraMapa() => {
    'id': id,
    'nome': nome,
    'descricao': descricao,
    'importancia': importancia,
  };
}

const canaisNotificacao = [
  CanalNotificacao(
    'toucamara_urgente',
    'Urgente',
    'Emergências e avisos urgentes da Proteção Civil municipal.',
    4,
  ),
  CanalNotificacao(
    'toucamara_avisos',
    'Avisos da câmara',
    'Obras, cortes e avisos para a sua zona.',
    3,
  ),
  CanalNotificacao(
    'toucamara_processos',
    'Os meus processos',
    'Quando um pedido seu muda de fase ou falta alguma coisa.',
    3,
  ),
];

/// Uma notificação que chegou com a app aberta.
class NotificacaoRecebida {
  const NotificacaoRecebida({
    required this.titulo,
    required this.corpo,
    this.link,
  });
  final String titulo;
  final String corpo;
  final String? link;
}

/// Notificações push. Sem Firebase configurado ([NotificacoesSemFirebase])
/// a app funciona igual, só não regista o telemóvel.
abstract class Notificacoes extends ChangeNotifier {
  /// Para o ecrã de definições ("Notificações: ligadas", "por configurar").
  String get estado;
  bool get configuradas;

  /// Arranca (canais, permissão, toques nas notificações).
  Future<void> iniciar({
    required void Function(String link) aoAbrir,
    required void Function(NotificacaoRecebida n) aoReceber,
  });

  /// Regista este telemóvel na API (depois de entrar).
  Future<void> registar(ClienteApi api);

  /// Tira o registo (ao sair).
  Future<void> desregistar(ClienteApi api);
}

class NotificacoesSemFirebase extends Notificacoes {
  @override
  String get estado => 'Notificações: por configurar';
  @override
  bool get configuradas => false;
  @override
  Future<void> iniciar({
    required void Function(String link) aoAbrir,
    required void Function(NotificacaoRecebida n) aoReceber,
  }) async {}
  @override
  Future<void> registar(ClienteApi api) async {}
  @override
  Future<void> desregistar(ClienteApi api) async {}
}

/// Cria os canais no Android (MainActivity.kt, canal `pt.toucamara/notificacoes`).
Future<void> criarCanaisAndroid() async {
  if (kIsWeb || defaultTargetPlatform != TargetPlatform.android) return;
  try {
    await const MethodChannel('pt.toucamara/notificacoes').invokeMethod(
      'criarCanais',
      [for (final c in canaisNotificacao) c.paraMapa()],
    );
  } on PlatformException catch (e) {
    debugPrint('Canais de notificação por criar: $e');
  }
}
