import 'package:flutter/widgets.dart';

import '../localizacao/localizacao.dart';

/// Um marcador do MapaCidade. Os dois motores desenham-no a partir destes
/// dados: o flutter_map com widgets (a bolha em vidro), o nativo com uma
/// imagem gerada (imagem_marcador.dart).
class MarcadorMapa {
  const MarcadorMapa({
    required this.id,
    required this.ponto,
    required this.nome,
    required this.cor,
    this.icone,
    this.texto,
    this.titulo,
    this.subtitulo,
    this.pulsar = false,
    this.compacto = false,
  });

  final String id;
  final Ponto ponto;

  /// Nome para leitores de ecrã ("Obra: Andaime na via pública").
  final String nome;
  final Color cor;

  /// O ícone grande (ou [texto], ex.: o número da tarefa).
  final IconData? icone;
  final String? texto;

  /// O título na bolha em vidro (sem título: só o ícone).
  final String? titulo;
  final String? subtitulo;

  /// Emergência: um anel a pulsar (parado com "remover animações").
  final bool pulsar;

  /// Só o ícone (muitos marcadores).
  final bool compacto;
}

/// Um círculo à volta de um ponto (raio em metros): zona, "perto de mim".
class CirculoMapa {
  const CirculoMapa({
    required this.centro,
    required this.raioM,
    required this.cor,
    this.opacidade = 0.12,
  });
  final Ponto centro;
  final double raioM;
  final Color cor;
  final double opacidade;
}

/// Para mexer no mapa de fora (centrar, saber o centro). O motor liga-se
/// quando é criado.
class ControladorMapa {
  void Function(Ponto p, double? zoom)? _mover;
  Ponto? Function()? _centro;

  void ligar({
    required void Function(Ponto p, double? zoom) mover,
    required Ponto? Function() centro,
  }) {
    _mover = mover;
    _centro = centro;
  }

  void desligar() {
    _mover = null;
    _centro = null;
  }

  void mover(Ponto p, {double? zoom}) => _mover?.call(p, zoom);
  Ponto? get centro => _centro?.call();
}
