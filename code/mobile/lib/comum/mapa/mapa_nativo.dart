import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:mapbox_maps_flutter/mapbox_maps_flutter.dart' as mb;

import '../localizacao/localizacao.dart';
import 'config_mapa.dart';
import 'imagem_marcador.dart';
import 'mapa_cidade.dart';

/// O motor nativo do MapaCidade (Android, `--dart-define=MAPA_NATIVO=true`):
/// mapbox_maps_flutter com o estilo Standard (edifícios 3D, luz de dia,
/// cores da marca), vista oblíqua, marcadores como anotações com a imagem da
/// bolha (imagem_marcador.dart) e zonas como polígonos. Por cima, os botões
/// em vidro: 3D, bússola e "onde estou".
///
/// Não foi corrido num telemóvel neste ambiente (sem SDK Android nem rede
/// para o Mapbox): ver docs/MAPAS.md.
class MapaNativo extends StatefulWidget {
  const MapaNativo({super.key, required this.config});
  final MapaCidade config;

  @override
  State<MapaNativo> createState() => _MapaNativoState();
}

mb.Point _ponto(Ponto p) => mb.Point(coordinates: mb.Position(p.lng, p.lat));

List<mb.Position> _circulo(Ponto c, double raioM, {int passos = 48}) {
  const r = 6371008.8;
  final lat1 = c.lat * math.pi / 180;
  final lng1 = c.lng * math.pi / 180;
  final d = raioM / r;
  return [
    for (var i = 0; i <= passos; i++)
      () {
        final b = 2 * math.pi * i / passos;
        final lat2 = math.asin(
          math.sin(lat1) * math.cos(d) +
              math.cos(lat1) * math.sin(d) * math.cos(b),
        );
        final lng2 =
            lng1 +
            math.atan2(
              math.sin(b) * math.sin(d) * math.cos(lat1),
              math.cos(d) - math.sin(lat1) * math.sin(lat2),
            );
        return mb.Position(lng2 * 180 / math.pi, lat2 * 180 / math.pi);
      }(),
  ];
}

class _MapaNativoState extends State<MapaNativo> {
  static bool _tokenPosto = false;
  mb.MapboxMap? _mapa;
  mb.PointAnnotationManager? _marcadores;
  mb.PolygonAnnotationManager? _zonas;
  mb.CircleAnnotationManager? _eu;
  mb.Cancelable? _toques;
  final Map<String, String> _idDe = {};
  late bool _em3d = widget.config.vista3d;
  double _graus = 0;
  Ponto? _centro;
  DateTime _ultimoToqueMarcador = DateTime(2000);
  String _desenhado = '';
  String _enquadrado = '';

  MapaCidade get c => widget.config;

  @override
  void initState() {
    super.initState();
    if (!_tokenPosto) {
      mb.MapboxOptions.setAccessToken(ConfigMapa.token!);
      _tokenPosto = true;
    }
    _graus = _em3d ? ConfigMapa.bearing3d : 0;
    c.controlador?.ligar(
      mover: (p, z) => _mapa?.easeTo(
        mb.CameraOptions(center: _ponto(p), zoom: z),
        mb.MapAnimationOptions(duration: _duracao(600)),
      ),
      centro: () => _centro,
    );
  }

  @override
  void didUpdateWidget(MapaNativo antes) {
    super.didUpdateWidget(antes);
    unawaited(_desenhar());
    unawaited(_enquadrar());
  }

  @override
  void dispose() {
    _toques?.cancel();
    c.controlador?.desligar();
    super.dispose();
  }

  int _duracao(int ms) => MediaQuery.disableAnimationsOf(context) ? 0 : ms;

  Future<void> _criado(mb.MapboxMap mapa) async {
    _mapa = mapa;
    await mapa.compass.updateSettings(mb.CompassSettings(enabled: false));
    await mapa.scaleBar.updateSettings(mb.ScaleBarSettings(enabled: false));
    mapa.addInteraction(
      mb.TapInteraction.onMap((_) {
        // O toque num marcador também chega aqui: ignora-se.
        if (DateTime.now().difference(_ultimoToqueMarcador).inMilliseconds <
            400) {
          return;
        }
        c.aoTocarMapa?.call();
      }, stopPropagation: false),
    );
  }

  Future<void> _estiloPronto() async {
    final mapa = _mapa;
    if (mapa == null) return;
    if (ConfigMapa.estiloNativo.startsWith('mapbox://styles/mapbox/standard')) {
      for (final e in ConfigMapa.configStandard.entries) {
        try {
          await mapa.setStyleImportConfigProperty('basemap', e.key, e.value);
        } catch (_) {
          // Propriedade que este estilo não conhece: ignora-se.
        }
      }
    }
    _zonas = await mapa.annotations.createPolygonAnnotationManager();
    _eu = await mapa.annotations.createCircleAnnotationManager();
    _marcadores = await mapa.annotations.createPointAnnotationManager();
    _toques = _marcadores!.tapEvents(
      onTap: (a) {
        _ultimoToqueMarcador = DateTime.now();
        final id = _idDe[a.id];
        if (id != null) c.aoTocarMarcador?.call(id);
      },
    );
    _desenhado = '';
    await _desenhar();
    await _enquadrar();
  }

  /// Volta a pôr as anotações quando mudam os marcadores, a seleção ou o "eu".
  Future<void> _desenhar() async {
    final pontos = _marcadores;
    final zonas = _zonas;
    final eu = _eu;
    if (pontos == null || zonas == null || eu == null) return;
    final chave = [
      for (final m in c.marcadores)
        '${m.id}:${m.compacto}:${m.id == c.selecionado}',
      for (final k in c.circulos) '${k.centro}:${k.raioM}',
      '${c.eu}',
    ].join('|');
    if (chave == _desenhado) return;
    _desenhado = chave;
    final escala = MediaQuery.devicePixelRatioOf(context);

    await zonas.deleteAll();
    await zonas.createMulti([
      for (final k in c.circulos)
        mb.PolygonAnnotationOptions(
          geometry: mb.Polygon(coordinates: [_circulo(k.centro, k.raioM)]),
          fillColor: k.cor.toARGB32(),
          fillOpacity: k.opacidade,
          fillOutlineColor: k.cor.toARGB32(),
        ),
    ]);

    await eu.deleteAll();
    if (c.eu != null) {
      await eu.create(
        mb.CircleAnnotationOptions(
          geometry: _ponto(c.eu!),
          circleColor: const Color(0xFF1F5FBF).toARGB32(),
          circleRadius: 9,
          circleStrokeColor: Colors.white.toARGB32(),
          circleStrokeWidth: 4,
        ),
      );
    }

    await pontos.deleteAll();
    _idDe.clear();
    final opcoes = <mb.PointAnnotationOptions>[];
    for (final m in c.marcadores) {
      final sel = m.id == c.selecionado;
      opcoes.add(
        mb.PointAnnotationOptions(
          geometry: _ponto(m.ponto),
          image: await imagemMarcador(m, selecionado: sel, escala: escala),
          iconAnchor: mb.IconAnchor.BOTTOM,
          symbolSortKey: sel ? 10 : (m.pulsar ? 5 : 0),
        ),
      );
    }
    final criadas = await pontos.createMulti(opcoes);
    for (var i = 0; i < criadas.length; i++) {
      final a = criadas[i];
      if (a != null) _idDe[a.id] = c.marcadores[i].id;
    }
  }

  Future<void> _enquadrar() async {
    final mapa = _mapa;
    if (mapa == null || c.enquadrar.isEmpty) return;
    final chave = c.enquadrar.map((p) => p.toString()).join(';');
    if (chave == _enquadrado) return;
    _enquadrado = chave;
    if (c.enquadrar.length == 1) {
      await mapa.easeTo(
        mb.CameraOptions(center: _ponto(c.enquadrar.first), zoom: c.zoomMaximo),
        mb.MapAnimationOptions(duration: _duracao(600)),
      );
      return;
    }
    final m = c.margens;
    final camara = await mapa.cameraForCoordinatesPadding(
      [for (final p in c.enquadrar) _ponto(p)],
      mb.CameraOptions(
        pitch: _em3d ? ConfigMapa.pitch3d : 0,
        bearing: _em3d ? ConfigMapa.bearing3d : 0,
      ),
      mb.MbxEdgeInsets(
        top: m.top,
        left: m.left,
        bottom: m.bottom,
        right: m.right,
      ),
      c.zoomMaximo,
      null,
    );
    await mapa.easeTo(camara, mb.MapAnimationOptions(duration: _duracao(600)));
  }

  void _alternar3d() {
    setState(() => _em3d = !_em3d);
    _mapa?.easeTo(
      mb.CameraOptions(
        pitch: _em3d ? ConfigMapa.pitch3d : 0,
        bearing: _em3d ? ConfigMapa.bearing3d : 0,
      ),
      mb.MapAnimationOptions(duration: _duracao(900)),
    );
  }

  @override
  Widget build(BuildContext context) {
    final inicio =
        c.centro ??
        (c.enquadrar.isNotEmpty
            ? c.enquadrar.first
            : const Ponto(ConfigMapa.latOmissao, ConfigMapa.lngOmissao));
    final baixo = c.margens.bottom > 48 ? c.margens.bottom - 36 : 24.0;
    return Stack(
      children: [
        mb.MapWidget(
          styleUri: ConfigMapa.estiloNativo,
          viewport: mb.CameraViewportState(
            center: _ponto(inicio),
            zoom: c.zoom,
            pitch: _em3d ? ConfigMapa.pitch3d : 0,
            bearing: _em3d ? ConfigMapa.bearing3d : 0,
          ),
          onMapCreated: _criado,
          onStyleLoadedListener: (_) => _estiloPronto(),
          onMapLoadErrorListener: (_) => c.aoFalharFundo?.call(),
          onCameraChangeListener: (e) {
            final s = e.cameraState;
            final p = Ponto(
              s.center.coordinates.lat.toDouble(),
              s.center.coordinates.lng.toDouble(),
            );
            _centro = p;
            c.aoMoverCentro?.call(p);
            if ((s.bearing - _graus).abs() > 1) {
              setState(() => _graus = s.bearing);
            }
          },
        ),
        Positioned(
          right: 12,
          bottom: baixo,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              BotaoVidro(
                rotulo: 'Ver a cidade em 3D',
                texto: '3D',
                ativo: _em3d,
                aoTocar: _alternar3d,
              ),
              const SizedBox(height: 10),
              BotaoVidro(
                rotulo: 'Apontar o mapa para norte',
                icone: Icons.navigation_rounded,
                rodar: -_graus,
                aoTocar: () => _mapa?.easeTo(
                  mb.CameraOptions(bearing: 0),
                  mb.MapAnimationOptions(duration: _duracao(500)),
                ),
              ),
              if (c.aoLocalizar != null) ...[
                const SizedBox(height: 10),
                BotaoVidro(
                  rotulo: 'Mostrar onde estou',
                  icone: Icons.my_location_rounded,
                  ativo: c.eu != null,
                  aoTocar: c.aoLocalizar,
                ),
              ],
            ],
          ),
        ),
      ],
    );
  }
}
