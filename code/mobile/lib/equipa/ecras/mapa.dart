import 'package:flutter/material.dart';
import 'package:flutter/scheduler.dart';

import '../../comum/componentes/componentes.dart';
import '../../comum/localizacao/localizacao.dart';
import '../../comum/mapa/mapa_cidade.dart';
import '../../comum/tema.dart';
import '../modelos.dart';
import '../servicos.dart';
import 'hoje.dart';

/// As tarefas de hoje no mapa (MapaCidade: 2D por omissão, 3D nativo com
/// MAPA_NATIVO no Android). Tocar num ponto mostra a
/// tarefa por baixo, com "Navegar".
class MapaTarefas extends StatefulWidget {
  const MapaTarefas({super.key, required this.aCarregar});
  final bool aCarregar;

  @override
  State<MapaTarefas> createState() => _MapaTarefasState();
}

class _MapaTarefasState extends State<MapaTarefas> {
  Tarefa? _escolhida;
  bool _semFundo = false;

  void _falhouMosaico() {
    if (_semFundo) return;
    SchedulerBinding.instance.addPostFrameCallback((_) {
      if (mounted) setState(() => _semFundo = true);
    });
  }

  @override
  Widget build(BuildContext context) {
    final s = FornecedorServicos.de(context);
    return ListenableBuilder(
      listenable: Listenable.merge([s.repositorio, s.fila]),
      builder: (context, _) {
        final tarefas = (s.repositorio.dia?.tarefas ?? const <Tarefa>[])
            .where((t) => t.temLocal)
            .toList();
        final eu = s.repositorio.ondeEstou;
        final semLocal =
            (s.repositorio.dia?.tarefas.length ?? 0) - tarefas.length;
        return Stack(
          children: [
            MapaCidade(
              rotulo:
                  'Mapa das tarefas de hoje (a lista tem a mesma informação)',
              marcadores: [
                for (final (i, t) in tarefas.indexed)
                  MarcadorMapa(
                    id: t.id,
                    ponto: Ponto(t.lat!, t.lng!),
                    nome: '${i + 1}: ${t.titulo}, ${t.morada}',
                    cor: _corDe(t),
                    texto: t.feita ? null : '${i + 1}',
                    icone: t.feita ? Icons.check_rounded : null,
                    titulo: _escolhida?.id == t.id ? t.titulo : null,
                  ),
              ],
              enquadrar: [for (final t in tarefas) Ponto(t.lat!, t.lng!), ?eu],
              zoom: 15,
              zoomMaximo: 17,
              selecionado: _escolhida?.id,
              aoTocarMarcador: (id) => setState(
                () => _escolhida = tarefas.where((t) => t.id == id).firstOrNull,
              ),
              aoTocarMapa: () => setState(() => _escolhida = null),
              eu: eu,
              margens: EdgeInsets.fromLTRB(
                48,
                72,
                48,
                _escolhida != null ? 240 : 48,
              ),
              aoFalharFundo: _falhouMosaico,
            ),
            Positioned(
              left: 12,
              right: 12,
              top: 12,
              child: Wrap(
                spacing: 8,
                runSpacing: 6,
                children: [
                  if (_semFundo)
                    const Pilula(
                      'Mapa de fundo indisponível (sem rede?)',
                      tom: TomPilula.ambar,
                      icone: Icons.layers_clear_rounded,
                    ),
                  if (semLocal > 0)
                    Pilula(
                      '$semLocal sem localização (ver na lista)',
                      icone: Icons.location_off_outlined,
                    ),
                ],
              ),
            ),
            if (_escolhida != null)
              Positioned(
                left: 12,
                right: 12,
                bottom: 12,
                child: CartaoTarefa(tarefa: _escolhida!, compacto: true),
              ),
          ],
        );
      },
    );
  }
}

/// Feita: verde; visita: tinta; o resto: terracota.
Color _corDe(Tarefa t) => t.feita
    ? Cores.verde
    : t.tipo == TipoTarefa.visita
    ? Cores.tinta
    : Cores.terracota;
