import 'package:flutter/material.dart';
import 'package:flutter/scheduler.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';

import '../../comum/componentes/componentes.dart';
import '../../comum/tema.dart';
import '../modelos.dart';
import '../servicos.dart';
import 'hoje.dart';

/// As tarefas de hoje no mapa (OpenStreetMap). Tocar num ponto mostra a
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

  /// Paços do Concelho de Guimarães (só para centrar sem tarefas).
  static const _centroPorOmissao = LatLng(41.4425, -8.2918);

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
        final pontos = [
          for (final t in tarefas) LatLng(t.lat!, t.lng!),
          if (eu != null) LatLng(eu.lat, eu.lng),
        ];
        final semLocal =
            (s.repositorio.dia?.tarefas.length ?? 0) - tarefas.length;
        return Stack(
          children: [
            FlutterMap(
              key: ValueKey(pontos.length),
              options: MapOptions(
                initialCenter: pontos.length == 1
                    ? pontos.first
                    : _centroPorOmissao,
                initialZoom: 15,
                initialCameraFit: pontos.length > 1
                    ? CameraFit.bounds(
                        bounds: LatLngBounds.fromPoints(pontos),
                        padding: const EdgeInsets.fromLTRB(48, 48, 48, 220),
                        maxZoom: 17,
                      )
                    : null,
                backgroundColor: Cores.creme2,
                onTap: (_, _) => setState(() => _escolhida = null),
              ),
              children: [
                TileLayer(
                  urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
                  userAgentPackageName: 'pt.toucamara.equipa',
                  maxZoom: 19,
                  errorTileCallback: (_, _, _) => _falhouMosaico(),
                ),
                MarkerLayer(
                  markers: [
                    if (eu != null)
                      Marker(
                        point: LatLng(eu.lat, eu.lng),
                        width: 28,
                        height: 28,
                        child: Semantics(
                          label: 'Estou aqui',
                          child: Container(
                            decoration: BoxDecoration(
                              color: const Color(0xFF1E6FD9),
                              shape: BoxShape.circle,
                              border: Border.all(color: Colors.white, width: 4),
                              boxShadow: const [
                                BoxShadow(blurRadius: 6, color: Colors.black26),
                              ],
                            ),
                          ),
                        ),
                      ),
                    for (final (i, t) in tarefas.indexed)
                      Marker(
                        point: LatLng(t.lat!, t.lng!),
                        width: 52,
                        height: 52,
                        child: _Alfinete(
                          numero: i + 1,
                          tarefa: t,
                          escolhida: _escolhida?.id == t.id,
                          aoTocar: () => setState(() => _escolhida = t),
                        ),
                      ),
                  ],
                ),
                const RichAttributionWidget(
                  alignment: AttributionAlignment.bottomLeft,
                  attributions: [
                    TextSourceAttribution('Contribuidores do OpenStreetMap'),
                  ],
                ),
              ],
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

class _Alfinete extends StatelessWidget {
  const _Alfinete({
    required this.numero,
    required this.tarefa,
    required this.escolhida,
    required this.aoTocar,
  });
  final int numero;
  final Tarefa tarefa;
  final bool escolhida;
  final VoidCallback aoTocar;

  @override
  Widget build(BuildContext context) {
    final visita = tarefa.tipo == TipoTarefa.visita;
    final cor = tarefa.feita
        ? Cores.verde
        : visita
        ? Cores.tinta
        : Cores.terracota;
    return Semantics(
      button: true,
      label: '$numero: ${tarefa.titulo}, ${tarefa.morada}',
      child: GestureDetector(
        onTap: aoTocar,
        child: Container(
          decoration: BoxDecoration(
            color: cor,
            shape: BoxShape.circle,
            border: Border.all(
              color: escolhida ? Cores.ambarSuave : Colors.white,
              width: escolhida ? 5 : 3,
            ),
            boxShadow: const [BoxShadow(blurRadius: 6, color: Colors.black38)],
          ),
          alignment: Alignment.center,
          child: tarefa.feita
              ? const Icon(Icons.check_rounded, color: Colors.white, size: 26)
              : Text(
                  '$numero',
                  style: const TextStyle(
                    color: Colors.white,
                    fontWeight: FontWeight.w700,
                    fontSize: 20,
                  ),
                ),
        ),
      ),
    );
  }
}
