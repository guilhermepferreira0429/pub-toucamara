import 'dart:typed_data';

import 'package:flutter/material.dart';

import '../../comum/componentes/componentes.dart';
import '../../comum/datas.dart';
import '../../comum/fila/fila_offline.dart';
import '../../comum/tema.dart';
import '../servicos.dart';

/// "Por enviar": o que se fez sem rede, guardado no telemóvel. Envia
/// sozinho quando a rede volta; aqui pode-se forçar, ver os problemas e
/// descartar.
class EcraFila extends StatelessWidget {
  const EcraFila({super.key});

  @override
  Widget build(BuildContext context) {
    final s = FornecedorServicos.de(context);
    final texto = Theme.of(context).textTheme;
    return ListenableBuilder(
      listenable: s.fila,
      builder: (context, _) {
        final fila = s.fila;
        return ListView(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
          children: [
            Cartao(
              cor: fila.ultimaFalhaRede != null
                  ? Cores.ambarSuave
                  : fila.porEnviar == 0
                  ? Cores.verdeSuave
                  : Cores.terracotaSuave,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Icon(
                        fila.porEnviar == 0
                            ? Icons.cloud_done_rounded
                            : fila.ultimaFalhaRede != null
                            ? Icons.cloud_off_rounded
                            : Icons.cloud_upload_rounded,
                        size: 36,
                        color: Cores.tinta,
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Text(
                          fila.porEnviar == 0
                              ? 'Tudo enviado'
                              : fila.porEnviar == 1
                              ? '1 por enviar'
                              : '${fila.porEnviar} por enviar',
                          style: texto.headlineSmall,
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 8),
                  Text(
                    fila.porEnviar == 0
                        ? 'O que fizer sem rede fica guardado neste telemóvel e é enviado quando a rede voltar.'
                        : fila.ultimaFalhaRede != null
                        ? 'Sem ligação: está tudo guardado neste telemóvel. Envia sozinho quando a rede voltar (tenta a cada 30 segundos).'
                        : 'Está guardado neste telemóvel e vai ser enviado por esta ordem.',
                    style: texto.bodyLarge,
                  ),
                  if (fila.ultimaFalhaRede != null) ...[
                    const SizedBox(height: 6),
                    Text(
                      'Último erro: ${fila.ultimaFalhaRede}',
                      style: texto.bodySmall,
                    ),
                  ],
                  if (fila.ultimaTentativa != null) ...[
                    const SizedBox(height: 4),
                    Text(
                      'Última tentativa: ${quando(fila.ultimaTentativa!)}',
                      style: texto.bodySmall,
                    ),
                  ],
                  if (fila.porEnviar > 0) ...[
                    const SizedBox(height: 14),
                    FilledButton.icon(
                      onPressed: fila.aEnviar
                          ? null
                          : () async {
                              final r = await fila.enviar();
                              if (!context.mounted) return;
                              avisar(
                                context,
                                r.semRede
                                    ? 'Ainda sem ligação. Fica guardado.'
                                    : r.enviadas == 1
                                    ? '1 enviado.'
                                    : '${r.enviadas} enviados.',
                              );
                            },
                      icon: const Icon(Icons.sync_rounded),
                      label: Text(fila.aEnviar ? 'A enviar…' : 'Enviar agora'),
                    ),
                  ],
                ],
              ),
            ),
            const SizedBox(height: 16),
            for (final a in fila.acoes) ...[
              _CartaoAcao(acao: a),
              const SizedBox(height: 12),
            ],
          ],
        );
      },
    );
  }
}

class _CartaoAcao extends StatelessWidget {
  const _CartaoAcao({required this.acao});
  final Acao acao;

  @override
  Widget build(BuildContext context) {
    final s = FornecedorServicos.de(context);
    final texto = Theme.of(context).textTheme;
    final falhou = acao.estado == EstadoAcao.falhou;
    return Cartao(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              if (acao.tipo == TipoAcao.ficheiro)
                FutureBuilder<Uint8List?>(
                  future: s.fila.bytesDe(acao),
                  builder: (context, snap) => ClipRRect(
                    borderRadius: BorderRadius.circular(12),
                    child: SizedBox(
                      width: 64,
                      height: 64,
                      child: snap.data == null
                          ? const ColoredBox(
                              color: Cores.creme2,
                              child: Icon(Icons.photo_outlined, size: 30),
                            )
                          : Image.memory(snap.data!, fit: BoxFit.cover),
                    ),
                  ),
                )
              else
                Container(
                  width: 64,
                  height: 64,
                  decoration: BoxDecoration(
                    color: Cores.creme2,
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Icon(
                    acao.caminho.endsWith('/fechar') ||
                            acao.caminho.endsWith('/concluir')
                        ? Icons.task_alt_rounded
                        : Icons.edit_note_rounded,
                    size: 32,
                    color: Cores.tinta,
                  ),
                ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(acao.descricao, style: texto.titleMedium),
                    const SizedBox(height: 4),
                    Text(
                      'Feito ${quando(acao.criadaEm)}',
                      style: texto.bodySmall,
                    ),
                    if (acao.tentativas > 0)
                      Text(
                        acao.tentativas == 1
                            ? '1 tentativa'
                            : '${acao.tentativas} tentativas',
                        style: texto.bodySmall,
                      ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          Pilula(
            falhou ? 'Não foi aceite' : 'À espera de rede',
            tom: falhou ? TomPilula.terracota : TomPilula.ambar,
            icone: falhou
                ? Icons.error_outline_rounded
                : Icons.schedule_rounded,
          ),
          if (acao.ultimoErro != null) ...[
            const SizedBox(height: 8),
            Text(acao.ultimoErro!, style: texto.bodyMedium),
          ],
          if (falhou) ...[
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton(
                    onPressed: () => s.fila.tentarDeNovo(acao.id),
                    child: const Text('Tentar outra vez'),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: TextButton(
                    onPressed: () async {
                      final sim = await showDialog<bool>(
                        context: context,
                        builder: (c) => AlertDialog(
                          title: const Text('Descartar?'),
                          content: Text(
                            '"${acao.descricao}" não vai ser enviado e apaga-se deste telemóvel.',
                          ),
                          actions: [
                            TextButton(
                              onPressed: () => Navigator.pop(c, false),
                              child: const Text('Não'),
                            ),
                            FilledButton(
                              onPressed: () => Navigator.pop(c, true),
                              child: const Text('Descartar'),
                            ),
                          ],
                        ),
                      );
                      if (sim == true) await s.fila.descartar(acao.id);
                    },
                    child: const Text('Descartar'),
                  ),
                ),
              ],
            ),
          ],
        ],
      ),
    );
  }
}
