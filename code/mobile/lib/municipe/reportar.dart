import 'dart:async';

import 'package:flutter/foundation.dart';

import '../comum/fila/fila_offline.dart';
import '../comum/localizacao/localizacao.dart';
import '../comum/plataforma/camara.dart';
import 'modelos.dart';

/// O que a pessoa preencheu em "Reportar um problema".
class RascunhoOcorrencia {
  RascunhoOcorrencia({
    this.categoria,
    this.foto,
    this.local,
    this.descricao = '',
    this.pontoReferencia = '',
  });
  String? categoria;
  FotoTirada? foto;
  Ponto? local;
  String descricao;
  String pontoReferencia;

  bool get completo =>
      categoria != null && local != null && descricao.trim().length >= 3;

  /// O corpo de `POST /v1/app/ocorrencias` (`esquemaNovaOcorrencia`).
  Map<String, dynamic> corpo() => {
    'categoria': categoria,
    'descricao': descricao.trim(),
    'lat': double.parse(local!.lat.toStringAsFixed(6)),
    'lng': double.parse(local!.lng.toStringAsFixed(6)),
    if (pontoReferencia.trim().isNotEmpty)
      'ponto_referencia': pontoReferencia.trim(),
  };
}

/// Como acabou o envio.
class ResultadoReporte {
  const ResultadoReporte({this.registada, this.naFila = false});

  /// A resposta da API (número, "já sabemos"), se já chegou.
  final OcorrenciaRegistada? registada;

  /// Sem rede: ficou no telemóvel e vai quando houver rede.
  final bool naFila;
}

/// Reportar um problema pela fila do telemóvel ([FilaOffline]): a
/// ocorrência e depois a fotografia (pela rota pública da ocorrência, com o
/// token que a API devolve). Cada uma leva a sua Idempotency-Key.
class ServicoReportar extends ChangeNotifier {
  ServicoReportar(this.fila) {
    final anterior = fila.aoEnviar;
    fila.aoEnviar = (a, resposta) {
      anterior?.call(a, resposta);
      if (a.caminho == caminho && resposta is Map) {
        final r = OcorrenciaRegistada.deJson(obj(resposta));
        _respostas[a.id] = r;
        ultimas.insert(0, r);
        notifyListeners();
      }
    };
  }

  static const caminho = '/app/ocorrencias';
  final FilaOffline fila;
  final Map<String, OcorrenciaRegistada> _respostas = {};

  /// As que chegaram à API desde que a app abriu (as da fila também).
  final List<OcorrenciaRegistada> ultimas = [];

  /// Junta à fila e tenta enviar já. Espera até [espera] pela resposta.
  Future<ResultadoReporte> enviar(
    RascunhoOcorrencia r, {
    Duration espera = const Duration(seconds: 25),
  }) async {
    final id = fila.novoId();
    final titulo = '${r.categoria}: ${r.descricao.trim()}';
    final descricao = titulo.length > 60
        ? '${titulo.substring(0, 59)}…'
        : titulo;
    await fila.pedido(
      id: id,
      descricao: 'Reportar: $descricao',
      alvo: id,
      metodo: 'POST',
      caminho: caminho,
      corpo: r.corpo(),
      enviarJa: false,
    );
    final foto = r.foto;
    if (foto != null) {
      await fila.ficheiro(
        descricao: 'Fotografia de "$descricao"',
        alvo: id,
        caminho: '/public/ocorrencias/{token}/fotos',
        caminhoDe: {'token': id},
        corpo: {'mime': foto.mime},
        bytes: foto.bytes,
        enviarJa: false,
      );
    }
    try {
      await fila.enviar().timeout(espera);
    } on TimeoutException {
      // Continua em segundo plano.
    }
    final registada = _respostas[id];
    return ResultadoReporte(registada: registada, naFila: registada == null);
  }
}
