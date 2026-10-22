import 'dart:typed_data';

import 'package:flutter/material.dart';

import '../../comum/componentes/componentes.dart';
import '../../comum/fila/fila_offline.dart';
import '../../comum/tema.dart';
import '../modelos.dart';
import '../servicos.dart';

/// Fotografias da API (URL assinada) e as tiradas aqui ainda por enviar.
class GaleriaFotos extends StatelessWidget {
  const GaleriaFotos({
    super.key,
    required this.fotos,
    this.pendentes = const [],
    this.vazio = 'Sem fotografias.',
  });
  final List<FotoApi> fotos;
  final List<Acao> pendentes;
  final String vazio;

  @override
  Widget build(BuildContext context) {
    final s = FornecedorServicos.de(context);
    if (fotos.isEmpty && pendentes.isEmpty) {
      return Text(
        vazio,
        style: Theme.of(
          context,
        ).textTheme.bodyMedium?.copyWith(color: Cores.tinta2),
      );
    }
    return Wrap(
      spacing: 10,
      runSpacing: 10,
      children: [
        for (final f in fotos) _Moldura(url: f.url, legenda: f.legenda),
        for (final a in pendentes)
          FutureBuilder<Uint8List?>(
            future: s.fila.bytesDe(a),
            builder: (context, snap) => _Moldura(
              bytes: snap.data,
              legenda: 'Por enviar',
              porEnviar: true,
            ),
          ),
      ],
    );
  }
}

class _Moldura extends StatelessWidget {
  const _Moldura({this.url, this.bytes, this.legenda, this.porEnviar = false});
  final String? url;
  final Uint8List? bytes;
  final String? legenda;
  final bool porEnviar;

  @override
  Widget build(BuildContext context) {
    Widget imagem;
    if (bytes != null) {
      imagem = Image.memory(bytes!, fit: BoxFit.cover);
    } else if (url != null) {
      imagem = Image.network(
        url!,
        fit: BoxFit.cover,
        errorBuilder: (_, _, _) => const _SemImagem(),
      );
    } else {
      imagem = const _SemImagem();
    }
    return SizedBox(
      width: 108,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          ClipRRect(
            borderRadius: BorderRadius.circular(14),
            child: SizedBox(width: 108, height: 108, child: imagem),
          ),
          if (legenda != null) ...[
            const SizedBox(height: 4),
            porEnviar
                ? const Pilula(
                    'Por enviar',
                    tom: TomPilula.tinta,
                    icone: Icons.cloud_upload_rounded,
                  )
                : Text(
                    legenda!,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(fontSize: 14, color: Cores.tinta2),
                  ),
          ],
        ],
      ),
    );
  }
}

class _SemImagem extends StatelessWidget {
  const _SemImagem();
  @override
  Widget build(BuildContext context) => const ColoredBox(
    color: Cores.creme2,
    child: Padding(
      padding: EdgeInsets.all(8),
      child: FittedBox(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.image_not_supported_outlined, color: Cores.tinta2),
            SizedBox(height: 4),
            Text(
              'Sem acesso\nà imagem',
              textAlign: TextAlign.center,
              style: TextStyle(fontSize: 13, color: Cores.tinta2),
            ),
          ],
        ),
      ),
    ),
  );
}

/// "Câmara" e "Galeria", lado a lado.
class BotoesFoto extends StatelessWidget {
  const BotoesFoto({super.key, required this.aoEscolher, this.ativo = true});
  final void Function(bool daGaleria) aoEscolher;
  final bool ativo;

  @override
  Widget build(BuildContext context) => Row(
    children: [
      Expanded(
        child: FilledButton.icon(
          onPressed: ativo ? () => aoEscolher(false) : null,
          icon: const Icon(Icons.photo_camera_rounded),
          label: const Text('Câmara'),
        ),
      ),
      const SizedBox(width: 10),
      Expanded(
        child: OutlinedButton.icon(
          onPressed: ativo ? () => aoEscolher(true) : null,
          icon: const Icon(Icons.photo_library_outlined),
          label: const Text('Galeria'),
        ),
      ),
    ],
  );
}
