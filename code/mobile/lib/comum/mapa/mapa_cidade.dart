import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';

import '../localizacao/localizacao.dart';
import '../tema.dart';
import 'config_mapa.dart';
import 'mapa_nativo.dart';
import 'modelo_mapa.dart';
import 'vidro.dart';

export 'modelo_mapa.dart';
export 'vidro.dart';

/// O mapa das apps (docs/MAPAS.md): uma só API, dois motores.
///
/// - Android com `--dart-define=MAPA_NATIVO=true` e `MAPBOX_TOKEN`: o mapa
///   3D nativo do Mapbox (mapbox_maps_flutter), com edifícios e vista
///   oblíqua ([MapaNativo]).
/// - De resto (browser, testes, sem token, sem a flag): flutter_map em 2D,
///   com os mosaicos do Mapbox se houver token, senão OpenStreetMap
///   ([MapaPlano]).
///
/// A lista do ecrã é sempre a alternativa acessível: os marcadores do
/// flutter_map têm nome e são botões; os do nativo são imagens no mapa.
class MapaCidade extends StatelessWidget {
  const MapaCidade({
    super.key,
    this.marcadores = const [],
    this.circulos = const [],
    this.enquadrar = const [],
    this.centro,
    this.zoom = 15,
    this.zoomMaximo = 16,
    this.selecionado,
    this.aoTocarMarcador,
    this.aoTocarMapa,
    this.aoMoverCentro,
    this.eu,
    this.vista3d = false,
    this.controlador,
    this.margens = const EdgeInsets.all(48),
    this.aoFalharFundo,
    this.aoLocalizar,
    this.rotulo = 'Mapa',
  });

  final List<MarcadorMapa> marcadores;
  final List<CirculoMapa> circulos;

  /// Enquadra estes pontos (à entrada e quando mudam).
  final List<Ponto> enquadrar;
  final Ponto? centro;
  final double zoom;
  final double zoomMaximo;
  final String? selecionado;
  final void Function(String id)? aoTocarMarcador;
  final VoidCallback? aoTocarMapa;

  /// A pessoa arrastou o mapa (o centro novo): escolher um sítio.
  final void Function(Ponto centro)? aoMoverCentro;

  /// Onde a pessoa está (o ponto azul).
  final Ponto? eu;

  /// Vista inicial 3D oblíqua (só no nativo; no plano é sempre 2D).
  final bool vista3d;
  final ControladorMapa? controlador;

  /// Espaço tapado por painéis por cima do mapa (para enquadrar).
  final EdgeInsets margens;

  /// Os mosaicos não chegam (sem rede?).
  final VoidCallback? aoFalharFundo;

  /// Mostra o botão "onde estou" (o ecrã pede o GPS).
  final VoidCallback? aoLocalizar;
  final String rotulo;

  @override
  Widget build(BuildContext context) {
    final mapa = ConfigMapa.usarNativo
        ? MapaNativo(config: this)
        : MapaPlano(config: this);
    return Semantics(container: true, label: rotulo, child: mapa);
  }
}

String _chave(List<Ponto> ps) => ps
    .map((p) => '${p.lat.toStringAsFixed(6)},${p.lng.toStringAsFixed(6)}')
    .join(';');

LatLng _ll(Ponto p) => LatLng(p.lat, p.lng);

/// O motor flutter_map (2D): Mapbox raster com token, OSM sem token.
class MapaPlano extends StatefulWidget {
  const MapaPlano({super.key, required this.config});
  final MapaCidade config;

  @override
  State<MapaPlano> createState() => _MapaPlanoState();
}

class _MapaPlanoState extends State<MapaPlano> {
  final _mapa = MapController();
  bool _pronto = false;
  late String _enquadrado = _chave(widget.config.enquadrar);

  MapaCidade get c => widget.config;

  @override
  void initState() {
    super.initState();
    c.controlador?.ligar(
      mover: (p, z) {
        if (_pronto) _mapa.move(_ll(p), z ?? _mapa.camera.zoom);
      },
      centro: () {
        if (!_pronto) return null;
        final x = _mapa.camera.center;
        return Ponto(x.latitude, x.longitude);
      },
    );
  }

  @override
  void didUpdateWidget(MapaPlano antes) {
    super.didUpdateWidget(antes);
    final k = _chave(c.enquadrar);
    if (k != _enquadrado && _pronto && c.enquadrar.isNotEmpty) {
      _enquadrado = k;
      _enquadrar();
    }
  }

  @override
  void dispose() {
    c.controlador?.desligar();
    super.dispose();
  }

  CameraFit? get _ajuste => c.enquadrar.length > 1
      ? CameraFit.coordinates(
          coordinates: [for (final p in c.enquadrar) _ll(p)],
          padding: c.margens,
          maxZoom: c.zoomMaximo,
        )
      : null;

  void _enquadrar() {
    final a = _ajuste;
    if (a != null) {
      _mapa.fitCamera(a);
    } else if (c.enquadrar.length == 1) {
      _mapa.move(_ll(c.enquadrar.first), c.zoomMaximo);
    }
  }

  @override
  Widget build(BuildContext context) {
    final inicio =
        c.centro ??
        (c.enquadrar.length == 1
            ? c.enquadrar.first
            : const Ponto(ConfigMapa.latOmissao, ConfigMapa.lngOmissao));
    // O selecionado por cima dos outros.
    final ordenados = [
      ...c.marcadores.where((m) => m.id != c.selecionado),
      ...c.marcadores.where((m) => m.id == c.selecionado),
    ];
    return Stack(
      children: [
        FlutterMap(
          mapController: _mapa,
          options: MapOptions(
            initialCenter: _ll(inicio),
            initialZoom: c.enquadrar.length == 1 ? c.zoomMaximo : c.zoom,
            initialCameraFit: _ajuste,
            backgroundColor: Cores.creme2,
            onMapReady: () => _pronto = true,
            onTap: c.aoTocarMapa == null ? null : (_, _) => c.aoTocarMapa!(),
            onPositionChanged: c.aoMoverCentro == null
                ? null
                : (cam, doUtilizador) {
                    if (doUtilizador) {
                      c.aoMoverCentro!(
                        Ponto(cam.center.latitude, cam.center.longitude),
                      );
                    }
                  },
          ),
          children: [
            TileLayer(
              urlTemplate: ConfigMapa.urlMosaicos,
              tileDimension: ConfigMapa.tamanhoMosaico,
              zoomOffset: ConfigMapa.desvioZoom.toDouble(),
              userAgentPackageName: 'pt.toucamara',
              maxZoom: 19,
              errorTileCallback: c.aoFalharFundo == null
                  ? null
                  : (_, _, _) => c.aoFalharFundo!(),
            ),
            if (c.circulos.isNotEmpty)
              CircleLayer(
                circles: [
                  for (final k in c.circulos)
                    CircleMarker(
                      point: _ll(k.centro),
                      radius: k.raioM,
                      useRadiusInMeter: true,
                      color: k.cor.withValues(alpha: k.opacidade),
                      borderColor: k.cor,
                      borderStrokeWidth: 1.5,
                    ),
                ],
              ),
            MarkerLayer(
              markers: [
                if (c.eu != null)
                  Marker(
                    point: _ll(c.eu!),
                    width: 30,
                    height: 30,
                    child: Semantics(
                      label: 'Está aqui',
                      child: const PontoAqui(),
                    ),
                  ),
                for (final m in ordenados)
                  Marker(
                    key: ValueKey(m.id),
                    point: _ll(m.ponto),
                    width: BolhaMapa.largura,
                    height: BolhaMapa.altura(m),
                    alignment: Alignment.topCenter,
                    child: Align(
                      alignment: Alignment.bottomCenter,
                      child: Semantics(
                        button: c.aoTocarMarcador != null,
                        selected: m.id == c.selecionado,
                        label: m.nome,
                        excludeSemantics: true,
                        child: GestureDetector(
                          onTap: c.aoTocarMarcador == null
                              ? null
                              : () => c.aoTocarMarcador!(m.id),
                          child: BolhaMapa(
                            marcador: m,
                            selecionado: m.id == c.selecionado,
                          ),
                        ),
                      ),
                    ),
                  ),
              ],
            ),
            RichAttributionWidget(
              alignment: AttributionAlignment.bottomLeft,
              attributions: [
                for (final t in ConfigMapa.creditos) TextSourceAttribution(t),
              ],
            ),
          ],
        ),
        if (c.aoLocalizar != null)
          Positioned(
            right: 12,
            bottom: c.margens.bottom > 48 ? c.margens.bottom - 36 : 24,
            child: BotaoVidro(
              rotulo: 'Mostrar onde estou',
              icone: Icons.my_location_rounded,
              ativo: c.eu != null,
              aoTocar: c.aoLocalizar,
            ),
          ),
      ],
    );
  }
}
