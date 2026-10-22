import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';

import '../tema.dart';
import 'modelo_mapa.dart';

/// A bolha de um marcador desenhada numa imagem PNG (para o mapa nativo,
/// onde os marcadores são anotações com imagem e não widgets): o ícone com
/// volume na cor do tipo, o título num cartão claro e o pé no sítio. O
/// ponto geográfico é o fundo da imagem, ao meio (âncora "bottom").
Future<Uint8List> imagemMarcador(
  MarcadorMapa m, {
  bool selecionado = false,
  double escala = 3,
}) async {
  const largura = 200.0;
  final comTitulo = !m.compacto && m.titulo != null;
  final altura = comTitulo ? 146.0 : 86.0;
  final gravador = ui.PictureRecorder();
  final tela = Canvas(gravador)..scale(escala);
  const lado = 52.0;
  const x0 = (largura - lado) / 2;
  const y0 = 8.0;

  // Sombra + quadrado com gradiente.
  final quadrado = RRect.fromRectAndRadius(
    const Rect.fromLTWH(x0, y0, lado, lado),
    const Radius.circular(lado * 0.33),
  );
  tela.drawRRect(
    quadrado.shift(const Offset(0, 6)),
    Paint()
      ..color = Cores.tinta.withValues(alpha: 0.35)
      ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 7),
  );
  if (selecionado || m.pulsar) {
    tela.drawRRect(
      quadrado.inflate(6),
      Paint()..color = m.cor.withValues(alpha: 0.4),
    );
    tela.drawRRect(quadrado.inflate(3), Paint()..color = Colors.white);
  }
  tela.drawRRect(
    quadrado,
    Paint()
      ..shader = ui.Gradient.linear(
        const Offset(x0, y0),
        const Offset(x0 + lado, y0 + lado),
        [
          Color.lerp(m.cor, Colors.white, 0.38)!,
          m.cor,
          Color.lerp(m.cor, Colors.black, 0.28)!,
        ],
        const [0, 0.55, 1],
      ),
  );
  // Brilho.
  tela.drawOval(
    const Rect.fromLTWH(x0 + 6, y0 + 4, lado * 0.5, lado * 0.28),
    Paint()..color = Colors.white.withValues(alpha: 0.28),
  );
  // Ícone (ou número).
  final icone = m.icone;
  final glifo = TextPainter(
    textDirection: TextDirection.ltr,
    text: TextSpan(
      text: icone != null
          ? String.fromCharCode(icone.codePoint)
          : (m.texto ?? ''),
      style: TextStyle(
        fontFamily: icone?.fontFamily,
        package: icone?.fontPackage,
        fontSize: icone != null ? lado * 0.5 : lado * 0.4,
        fontWeight: icone != null ? null : FontWeight.w800,
        color: Colors.white,
      ),
    ),
  )..layout();
  glifo.paint(
    tela,
    Offset(x0 + (lado - glifo.width) / 2, y0 + (lado - glifo.height) / 2),
  );

  var y = y0 + lado + 6;
  if (comTitulo) {
    final titulo = TextPainter(
      textDirection: TextDirection.ltr,
      textAlign: TextAlign.center,
      maxLines: 2,
      ellipsis: '…',
      text: TextSpan(
        style: const TextStyle(
          color: Cores.tinta,
          fontSize: 13,
          fontWeight: FontWeight.w700,
          height: 1.2,
        ),
        text: m.titulo,
        children: [
          if (m.subtitulo != null)
            TextSpan(
              text: '\n${m.subtitulo}',
              style: const TextStyle(
                color: Cores.tinta2,
                fontSize: 12,
                fontWeight: FontWeight.w600,
              ),
            ),
        ],
      ),
    )..layout(maxWidth: 176);
    final w = titulo.width + 20;
    final h = titulo.height + 10;
    final cartao = RRect.fromRectAndRadius(
      Rect.fromLTWH((largura - w) / 2, y, w, h),
      const Radius.circular(14),
    );
    tela.drawRRect(
      cartao.shift(const Offset(0, 4)),
      Paint()
        ..color = Cores.tinta.withValues(alpha: 0.2)
        ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 6),
    );
    tela.drawRRect(
      cartao,
      Paint()..color = Cores.papel.withValues(alpha: 0.95),
    );
    titulo.paint(tela, Offset((largura - titulo.width) / 2, y + 5));
    y += h;
  }
  // O pé (no fundo da imagem).
  final pe = Offset(largura / 2, altura - 8);
  tela.drawCircle(pe, 7.5, Paint()..color = Colors.white);
  tela.drawCircle(pe, 5, Paint()..color = m.cor);

  final imagem = await gravador.endRecording().toImage(
    (largura * escala).round(),
    (altura * escala).round(),
  );
  final bytes = await imagem.toByteData(format: ui.ImageByteFormat.png);
  return bytes!.buffer.asUint8List();
}
