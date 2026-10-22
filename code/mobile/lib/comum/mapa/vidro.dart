import 'dart:ui' as ui;

import 'package:flutter/material.dart';

import '../tema.dart';
import 'modelo_mapa.dart';

/// Peças em "vidro" para pôr por cima dos mapas (como na web,
/// components/mapa/vidro.tsx): fundo translúcido com blur, botões redondos,
/// chips com contagem e a bolha dos marcadores.

/// Fundo em vidro (papel translúcido + blur). Em "alto contraste" do
/// sistema, opaco.
class Vidro extends StatelessWidget {
  const Vidro({
    super.key,
    required this.child,
    this.raio = 24,
    this.padding,
    this.escuro = false,
  });
  final Widget child;
  final double raio;
  final EdgeInsetsGeometry? padding;

  /// Selecionado: tinta quase opaca com texto branco.
  final bool escuro;

  @override
  Widget build(BuildContext context) {
    final alto = MediaQuery.highContrastOf(context);
    final fundo = escuro
        ? Cores.tinta.withValues(alpha: 0.92)
        : Cores.papel.withValues(alpha: alto ? 1 : 0.82);
    final caixa = Container(
      padding: padding,
      decoration: BoxDecoration(
        color: fundo,
        borderRadius: BorderRadius.circular(raio),
        border: Border.all(
          color: alto ? Colors.black : Colors.white.withValues(alpha: 0.7),
          width: alto ? 2 : 1,
        ),
        boxShadow: [
          BoxShadow(
            color: Cores.tinta.withValues(alpha: 0.28),
            blurRadius: 24,
            offset: const Offset(0, 8),
            spreadRadius: -8,
          ),
        ],
      ),
      child: child,
    );
    if (alto) return caixa;
    return ClipRRect(
      borderRadius: BorderRadius.circular(raio),
      child: BackdropFilter(
        filter: ui.ImageFilter.blur(sigmaX: 18, sigmaY: 18),
        child: caixa,
      ),
    );
  }
}

/// Botão redondo em vidro (48 dp): localização, 3D, bússola.
class BotaoVidro extends StatelessWidget {
  const BotaoVidro({
    super.key,
    required this.rotulo,
    required this.aoTocar,
    this.icone,
    this.texto,
    this.ativo = false,
    this.rodar = 0,
  });
  final String rotulo;
  final VoidCallback? aoTocar;
  final IconData? icone;
  final String? texto;
  final bool ativo;

  /// Rotação do ícone em graus (bússola).
  final double rodar;

  @override
  Widget build(BuildContext context) {
    final cor = ativo ? Cores.terracotaEscuro : Cores.tinta;
    return Semantics(
      button: true,
      toggled: texto != null ? ativo : null,
      label: rotulo,
      excludeSemantics: true,
      child: Tooltip(
        message: rotulo,
        child: Vidro(
          raio: 999,
          child: InkWell(
            customBorder: const CircleBorder(),
            onTap: aoTocar,
            child: SizedBox(
              width: 52,
              height: 52,
              child: Center(
                child: texto != null
                    ? Text(
                        texto!,
                        style: TextStyle(
                          color: cor,
                          fontWeight: FontWeight.w800,
                          fontSize: 16,
                        ),
                      )
                    : Transform.rotate(
                        angle: rodar * 3.1415926535 / 180,
                        child: Icon(icone, color: cor, size: 24),
                      ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// Chip de filtro em vidro: ícone na cor do tipo, nome e contagem.
class ChipVidro extends StatelessWidget {
  const ChipVidro({
    super.key,
    required this.nome,
    required this.ativo,
    required this.aoTocar,
    this.contagem,
    this.icone,
    this.cor = Cores.tinta,
  });
  final String nome;
  final bool ativo;
  final VoidCallback aoTocar;
  final int? contagem;
  final IconData? icone;
  final Color cor;

  @override
  Widget build(BuildContext context) {
    final texto = ativo ? Colors.white : Cores.tinta;
    return Semantics(
      button: true,
      selected: ativo,
      label: contagem == null ? nome : '$nome, $contagem',
      excludeSemantics: true,
      child: Vidro(
        raio: 999,
        escuro: ativo,
        child: InkWell(
          onTap: aoTocar,
          child: ConstrainedBox(
            constraints: const BoxConstraints(minHeight: 48),
            child: Padding(
              padding: EdgeInsets.fromLTRB(icone != null ? 8 : 16, 0, 12, 0),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  if (icone != null) ...[
                    Container(
                      width: 30,
                      height: 30,
                      decoration: BoxDecoration(
                        color: cor,
                        shape: BoxShape.circle,
                      ),
                      child: Icon(icone, size: 17, color: Colors.white),
                    ),
                    const SizedBox(width: 8),
                  ],
                  Text(
                    nome,
                    style: TextStyle(
                      color: texto,
                      fontWeight: FontWeight.w600,
                      fontSize: 15,
                    ),
                  ),
                  if (contagem != null) ...[
                    const SizedBox(width: 8),
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 7,
                        vertical: 2,
                      ),
                      decoration: BoxDecoration(
                        color: ativo
                            ? Colors.white.withValues(alpha: 0.22)
                            : Cores.tinta.withValues(alpha: 0.1),
                        borderRadius: BorderRadius.circular(999),
                      ),
                      child: Text(
                        '$contagem',
                        style: TextStyle(
                          color: texto,
                          fontWeight: FontWeight.w700,
                          fontSize: 13,
                        ),
                      ),
                    ),
                  ],
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// O ícone grande com volume (gradiente, brilho e sombra), na cor do tipo.
class IconeVolume extends StatelessWidget {
  const IconeVolume({
    super.key,
    required this.cor,
    this.icone,
    this.texto,
    this.lado = 52,
    this.selecionado = false,
  });
  final Color cor;
  final IconData? icone;
  final String? texto;
  final double lado;
  final bool selecionado;

  @override
  Widget build(BuildContext context) {
    final claro = Color.lerp(cor, Colors.white, 0.38)!;
    final escuro = Color.lerp(cor, Colors.black, 0.28)!;
    return Transform.rotate(
      angle: -0.07,
      child: Container(
        width: lado,
        height: lado,
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(lado * 0.33),
          gradient: LinearGradient(
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
            colors: [claro, cor, escuro],
            stops: const [0, 0.55, 1],
          ),
          border: selecionado
              ? Border.all(color: Colors.white, width: 3)
              : null,
          boxShadow: [
            if (selecionado)
              BoxShadow(color: cor.withValues(alpha: 0.45), spreadRadius: 6),
            BoxShadow(
              color: Cores.tinta.withValues(alpha: 0.5),
              blurRadius: 16,
              offset: const Offset(0, 8),
              spreadRadius: -6,
            ),
          ],
        ),
        child: Stack(
          children: [
            // Brilho em cima à esquerda (o "volume").
            Positioned(
              left: lado * 0.1,
              top: lado * 0.06,
              child: Container(
                width: lado * 0.5,
                height: lado * 0.3,
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(lado),
                  gradient: RadialGradient(
                    colors: [
                      Colors.white.withValues(alpha: 0.5),
                      Colors.white.withValues(alpha: 0),
                    ],
                  ),
                ),
              ),
            ),
            Center(
              child: Transform.rotate(
                angle: 0.07,
                child: texto != null
                    ? Text(
                        texto!,
                        style: TextStyle(
                          color: Colors.white,
                          fontWeight: FontWeight.w800,
                          fontSize: lado * 0.4,
                        ),
                      )
                    : Icon(
                        icone,
                        color: Colors.white,
                        size: lado * 0.5,
                        shadows: const [
                          Shadow(color: Colors.black26, offset: Offset(0, 1.5)),
                        ],
                      ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// A bolha de um marcador: ícone com volume, título em vidro e o pé no
/// sítio (o ponto fica em baixo, ao meio).
class BolhaMapa extends StatefulWidget {
  const BolhaMapa({
    super.key,
    required this.marcador,
    this.selecionado = false,
  });
  final MarcadorMapa marcador;
  final bool selecionado;

  /// Largura e altura da caixa onde a bolha cabe (para o Marker).
  static const double largura = 200;
  static double altura(MarcadorMapa m) =>
      m.compacto || m.titulo == null ? 86 : 146;

  @override
  State<BolhaMapa> createState() => _BolhaMapaState();
}

class _BolhaMapaState extends State<BolhaMapa>
    with SingleTickerProviderStateMixin {
  AnimationController? _pulso;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final animar =
        widget.marcador.pulsar && !MediaQuery.disableAnimationsOf(context);
    if (animar && _pulso == null) {
      _pulso = AnimationController(
        vsync: this,
        duration: const Duration(milliseconds: 1600),
      )..repeat();
    } else if (!animar && _pulso != null) {
      _pulso!.dispose();
      _pulso = null;
    }
  }

  @override
  void dispose() {
    _pulso?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final m = widget.marcador;
    final mostrarTitulo = !m.compacto && m.titulo != null;
    Widget icone = IconeVolume(
      cor: m.cor,
      icone: m.icone,
      texto: m.texto,
      selecionado: widget.selecionado,
    );
    if (m.pulsar) {
      final p = _pulso;
      icone = Stack(
        alignment: Alignment.center,
        clipBehavior: Clip.none,
        children: [
          if (p != null)
            AnimatedBuilder(
              animation: p,
              builder: (_, _) => Opacity(
                opacity: (1 - p.value) * 0.85,
                child: Transform.scale(
                  scale: 1 + p.value * 0.55,
                  child: _anel(m.cor),
                ),
              ),
            )
          else
            Opacity(
              opacity: 0.6,
              child: Transform.scale(scale: 1.12, child: _anel(m.cor)),
            ),
          icone,
        ],
      );
    }
    return AnimatedScale(
      scale: widget.selecionado ? 1.08 : 1,
      alignment: Alignment.bottomCenter,
      duration: const Duration(milliseconds: 200),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        mainAxisAlignment: MainAxisAlignment.end,
        children: [
          icone,
          if (mostrarTitulo) ...[
            const SizedBox(height: 6),
            Vidro(
              raio: 14,
              padding: const EdgeInsets.fromLTRB(10, 5, 10, 6),
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 180),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      m.titulo!,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      textAlign: TextAlign.center,
                      style: const TextStyle(
                        color: Cores.tinta,
                        fontWeight: FontWeight.w700,
                        fontSize: 13,
                        height: 1.2,
                      ),
                    ),
                    if (m.subtitulo != null)
                      Text(
                        m.subtitulo!,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          color: Cores.tinta2,
                          fontWeight: FontWeight.w600,
                          fontSize: 12,
                        ),
                      ),
                  ],
                ),
              ),
            ),
          ],
          const SizedBox(height: 4),
          Container(
            width: 12,
            height: 12,
            decoration: BoxDecoration(
              color: m.cor,
              shape: BoxShape.circle,
              border: Border.all(color: Colors.white, width: 2.5),
              boxShadow: const [
                BoxShadow(color: Colors.black38, blurRadius: 5),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _anel(Color cor) => Container(
    width: 60,
    height: 60,
    decoration: BoxDecoration(
      borderRadius: BorderRadius.circular(20),
      border: Border.all(color: cor, width: 3),
    ),
  );
}

/// O ponto "está aqui".
class PontoAqui extends StatelessWidget {
  const PontoAqui({super.key});

  @override
  Widget build(BuildContext context) => Container(
    width: 26,
    height: 26,
    decoration: BoxDecoration(
      color: const Color(0xFF1F5FBF),
      shape: BoxShape.circle,
      border: Border.all(color: Colors.white, width: 4),
      boxShadow: [
        BoxShadow(
          color: const Color(0xFF1F5FBF).withValues(alpha: 0.3),
          spreadRadius: 10,
        ),
      ],
    ),
  );
}
