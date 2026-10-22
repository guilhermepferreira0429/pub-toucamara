import 'package:flutter/material.dart';
import 'package:flutter/scheduler.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';

import '../../comum/componentes/componentes.dart';
import '../../comum/localizacao/localizacao.dart';
import '../../comum/plataforma/camara.dart';
import '../../comum/tema.dart';
import '../app_municipe.dart';
import '../componentes.dart';
import '../modelos.dart';
import '../reportar.dart';
import '../servicos.dart';

/// Reportar um problema: categoria → fotografia → sítio → descrição →
/// enviar. Sem rede fica no telemóvel e vai quando houver.
class EcraReportar extends StatefulWidget {
  const EcraReportar({super.key});

  @override
  State<EcraReportar> createState() => _EcraReportarState();
}

class _EcraReportarState extends State<EcraReportar> {
  static const _titulos = [
    'O que se passa?',
    'Uma fotografia',
    'Onde é?',
    'Conte-nos mais',
    'Confirmar',
  ];
  final _r = RascunhoOcorrencia();
  final _descricao = TextEditingController();
  final _referencia = TextEditingController();
  int _passo = 0;
  bool _aEnviar = false;
  ResultadoReporte? _resultado;

  @override
  void dispose() {
    _descricao.dispose();
    _referencia.dispose();
    super.dispose();
  }

  bool get _podeSeguir => switch (_passo) {
    0 => _r.categoria != null,
    2 => _r.local != null,
    3 => _descricao.text.trim().length >= 3,
    _ => true,
  };

  void _seguir() {
    if (!_podeSeguir) return;
    setState(() => _passo++);
  }

  Future<void> _enviar() async {
    final s = FornecedorMunicipe.de(context);
    _r
      ..descricao = _descricao.text
      ..pontoReferencia = _referencia.text;
    setState(() => _aEnviar = true);
    final r = await s.reportar.enviar(_r);
    if (mounted) {
      setState(() {
        _aEnviar = false;
        _resultado = r;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_resultado != null) return _Resultado(_resultado!);
    final t = Theme.of(context).textTheme;
    return PopScope(
      canPop: _passo == 0,
      onPopInvokedWithResult: (feito, _) {
        if (!feito) setState(() => _passo--);
      },
      child: Scaffold(
        appBar: AppBar(title: const Text('Reportar um problema')),
        body: Column(
          children: [
            Semantics(
              label: 'Passo ${_passo + 1} de ${_titulos.length}',
              child: LinearProgressIndicator(
                value: (_passo + 1) / _titulos.length,
                minHeight: 6,
                color: Cores.terracota,
                backgroundColor: Cores.creme2,
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 14, 16, 8),
              child: Row(
                children: [
                  Text(
                    'Passo ${_passo + 1} de ${_titulos.length}',
                    style: t.bodyMedium?.copyWith(color: Cores.tinta2),
                  ),
                ],
              ),
            ),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: Align(
                alignment: Alignment.centerLeft,
                child: Semantics(
                  header: true,
                  child: Text(_titulos[_passo], style: t.headlineSmall),
                ),
              ),
            ),
            const SizedBox(height: 8),
            Expanded(
              child: switch (_passo) {
                0 => _PassoCategoria(
                  escolhida: _r.categoria,
                  aoEscolher: (c) => setState(() {
                    _r.categoria = c;
                    _passo = 1;
                  }),
                ),
                1 => _PassoFoto(
                  foto: _r.foto,
                  aoMudar: (f) => setState(() => _r.foto = f),
                ),
                2 => _PassoLocal(
                  inicial: _r.local ?? _r.foto?.local,
                  aoMudar: (p) => setState(() => _r.local = p),
                ),
                3 => _PassoDescricao(
                  descricao: _descricao,
                  referencia: _referencia,
                  aoMudar: () => setState(() {}),
                ),
                _ => _PassoConfirmar(r: _r, descricao: _descricao.text),
              },
            ),
            SafeArea(
              top: false,
              child: Padding(
                padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
                child: Row(
                  children: [
                    if (_passo > 0) ...[
                      Expanded(
                        child: OutlinedButton.icon(
                          onPressed: _aEnviar
                              ? null
                              : () => setState(() => _passo--),
                          icon: const Icon(Icons.arrow_back_rounded),
                          label: const Text('Voltar'),
                        ),
                      ),
                      const SizedBox(width: 12),
                    ],
                    if (_passo > 0)
                      Expanded(
                        flex: 2,
                        child: _passo == _titulos.length - 1
                            ? FilledButton.icon(
                                onPressed: _aEnviar ? null : _enviar,
                                icon: _aEnviar
                                    ? const SizedBox(
                                        width: 20,
                                        height: 20,
                                        child: CircularProgressIndicator(
                                          strokeWidth: 3,
                                          color: Colors.white,
                                        ),
                                      )
                                    : const Icon(Icons.send_rounded),
                                label: Text(_aEnviar ? 'A enviar…' : 'Enviar'),
                              )
                            : FilledButton.icon(
                                onPressed: _podeSeguir ? _seguir : null,
                                icon: const Icon(Icons.arrow_forward_rounded),
                                label: Text(
                                  _passo == 1 && _r.foto == null
                                      ? 'Seguir sem foto'
                                      : 'Seguir',
                                ),
                              ),
                      ),
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

const _iconesCategoria = <String, IconData>{
  'buraco': Icons.add_road_rounded,
  'via': Icons.add_road_rounded,
  'ilumina': Icons.lightbulb_outline_rounded,
  'lixo': Icons.delete_outline_rounded,
  'resíduo': Icons.delete_outline_rounded,
  'residuo': Icons.delete_outline_rounded,
  'água': Icons.water_drop_outlined,
  'agua': Icons.water_drop_outlined,
  'árvore': Icons.park_outlined,
  'arvore': Icons.park_outlined,
  'jardim': Icons.park_outlined,
  'sinal': Icons.traffic_outlined,
  'passeio': Icons.directions_walk_rounded,
  'animal': Icons.pets_rounded,
  'ruído': Icons.volume_up_outlined,
  'ruido': Icons.volume_up_outlined,
  'grafit': Icons.format_paint_outlined,
  'estacion': Icons.local_parking_rounded,
};

IconData iconeCategoria(String nome) {
  final n = nome.toLowerCase();
  for (final e in _iconesCategoria.entries) {
    if (n.contains(e.key)) return e.value;
  }
  return Icons.report_problem_outlined;
}

class _PassoCategoria extends StatelessWidget {
  const _PassoCategoria({required this.escolhida, required this.aoEscolher});
  final String? escolhida;
  final void Function(String) aoEscolher;

  @override
  Widget build(BuildContext context) {
    final s = FornecedorMunicipe.de(context);
    return Carregar<List<Categoria>>(
      ler: s.repositorio.categorias,
      eVazio: (l) => l.isEmpty,
      vazio: 'Não foi possível ler as categorias.',
      construir: (context, l) => Column(
        children: [
          for (final c in l) ...[
            Cartao(
              onTap: () => aoEscolher(c.nome),
              cor: escolhida == c.nome ? Cores.terracotaSuave : null,
              padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 14),
              child: Row(
                children: [
                  Icon(
                    iconeCategoria(c.nome),
                    size: 30,
                    color: Cores.terracotaEscuro,
                  ),
                  const SizedBox(width: 14),
                  Expanded(
                    child: Text(
                      c.nome,
                      style: Theme.of(context).textTheme.titleMedium,
                    ),
                  ),
                  if (escolhida == c.nome)
                    const Icon(Icons.check_circle_rounded, color: Cores.verde),
                ],
              ),
            ),
            const SizedBox(height: 8),
          ],
        ],
      ),
    );
  }
}

class _PassoFoto extends StatelessWidget {
  const _PassoFoto({required this.foto, required this.aoMudar});
  final FotoTirada? foto;
  final void Function(FotoTirada?) aoMudar;

  @override
  Widget build(BuildContext context) {
    final s = FornecedorMunicipe.de(context);
    final t = Theme.of(context).textTheme;
    Future<void> tirar(bool galeria) async {
      try {
        final f = await s.camara.tirar(daGaleria: galeria);
        if (f != null) aoMudar(f);
      } on Object {
        if (context.mounted) {
          avisar(
            context,
            'Não foi possível usar a câmara. Pode seguir sem fotografia.',
          );
        }
      }
    }

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Text(
          'Uma fotografia ajuda a equipa a perceber o problema. É opcional.',
          style: t.bodyLarge?.copyWith(color: Cores.tinta2),
        ),
        const SizedBox(height: 16),
        if (foto != null) ...[
          ClipRRect(
            borderRadius: BorderRadius.circular(16),
            child: Image.memory(
              foto!.bytes,
              height: 240,
              fit: BoxFit.cover,
              semanticLabel: 'A fotografia que tirou',
            ),
          ),
          const SizedBox(height: 12),
          BotaoLargo(
            icone: Icons.delete_outline_rounded,
            texto: 'Apagar esta fotografia',
            contorno: true,
            onPressed: () => aoMudar(null),
          ),
        ] else ...[
          BotaoLargo(
            icone: Icons.photo_camera_rounded,
            texto: 'Tirar fotografia',
            onPressed: () => tirar(false),
          ),
          const SizedBox(height: 12),
          BotaoLargo(
            icone: Icons.photo_library_rounded,
            texto: 'Escolher da galeria',
            contorno: true,
            onPressed: () => tirar(true),
          ),
        ],
      ],
    );
  }
}

/// O sítio: o GPS do telemóvel num mapa; arrastar o mapa acerta o ponto.
class _PassoLocal extends StatefulWidget {
  const _PassoLocal({required this.inicial, required this.aoMudar});
  final Ponto? inicial;
  final void Function(Ponto) aoMudar;

  @override
  State<_PassoLocal> createState() => _PassoLocalState();
}

class _PassoLocalState extends State<_PassoLocal> {
  final _mapa = MapController();
  Ponto? _ponto;
  bool _aProcurar = false;
  bool _semFundo = false;
  String? _erro;

  static const _centro = Ponto(41.4425, -8.2918);

  @override
  void initState() {
    super.initState();
    _ponto = widget.inicial;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      // O sítio da fotografia (GPS) já serve; sem ele, pergunta ao GPS.
      final p = _ponto;
      if (p != null) {
        widget.aoMudar(p);
      } else {
        _ondeEstou();
      }
    });
  }

  Future<void> _ondeEstou() async {
    setState(() {
      _aProcurar = true;
      _erro = null;
    });
    final p = await FornecedorMunicipe.de(context).localizador.atual();
    if (!mounted) return;
    setState(() => _aProcurar = false);
    if (p == null) {
      setState(
        () => _erro =
            'Não conseguimos saber onde está. Arraste o mapa até ao sítio do problema.',
      );
      return;
    }
    _mudar(p);
    _mapa.move(LatLng(p.lat, p.lng), 17);
  }

  void _mudar(Ponto p) {
    _ponto = p;
    widget.aoMudar(p);
  }

  @override
  Widget build(BuildContext context) {
    final c = _ponto ?? widget.inicial ?? _centro;
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
          child: Text(
            'Arraste o mapa para pôr o alfinete no sítio exato.',
            style: Theme.of(
              context,
            ).textTheme.bodyLarge?.copyWith(color: Cores.tinta2),
          ),
        ),
        Expanded(
          child: Stack(
            alignment: Alignment.center,
            children: [
              FlutterMap(
                mapController: _mapa,
                options: MapOptions(
                  initialCenter: LatLng(c.lat, c.lng),
                  initialZoom: 17,
                  backgroundColor: Cores.creme2,
                  onPositionChanged: (cam, doUtilizador) {
                    if (doUtilizador) {
                      _mudar(Ponto(cam.center.latitude, cam.center.longitude));
                      setState(() {});
                    }
                  },
                ),
                children: [
                  TileLayer(
                    urlTemplate:
                        'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
                    userAgentPackageName: 'pt.toucamara.municipe',
                    maxZoom: 19,
                    errorTileCallback: (_, _, _) {
                      if (_semFundo) return;
                      SchedulerBinding.instance.addPostFrameCallback((_) {
                        if (mounted) setState(() => _semFundo = true);
                      });
                    },
                  ),
                  const RichAttributionWidget(
                    alignment: AttributionAlignment.bottomLeft,
                    attributions: [
                      TextSourceAttribution('Contribuidores do OpenStreetMap'),
                    ],
                  ),
                ],
              ),
              // O alfinete fica no centro; a ponta é o sítio.
              const IgnorePointer(
                child: Padding(
                  padding: EdgeInsets.only(bottom: 48),
                  child: Icon(
                    Icons.location_on_rounded,
                    size: 56,
                    color: Cores.terracota,
                    shadows: [Shadow(blurRadius: 6, color: Colors.black38)],
                    semanticLabel: 'Sítio do problema',
                  ),
                ),
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
                    if (_ponto != null)
                      const Pilula(
                        'Sítio marcado',
                        tom: TomPilula.verde,
                        icone: Icons.place_rounded,
                      )
                    else if (!_aProcurar)
                      const Pilula(
                        'Ainda sem sítio',
                        tom: TomPilula.ambar,
                        icone: Icons.location_searching_rounded,
                      ),
                  ],
                ),
              ),
            ],
          ),
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
          child: Column(
            children: [
              if (_erro != null) ...[
                ErroLinha(_erro!),
                const SizedBox(height: 8),
              ],
              BotaoLargo(
                icone: Icons.my_location_rounded,
                texto: _aProcurar ? 'A procurar…' : 'Usar onde estou agora',
                contorno: true,
                onPressed: _aProcurar ? null : _ondeEstou,
              ),
              if (_ponto == null) ...[
                const SizedBox(height: 8),
                BotaoLargo(
                  icone: Icons.push_pin_rounded,
                  texto: 'É aqui (centro do mapa)',
                  contorno: true,
                  onPressed: () {
                    final cam = _mapa.camera.center;
                    setState(() => _mudar(Ponto(cam.latitude, cam.longitude)));
                  },
                ),
              ],
            ],
          ),
        ),
      ],
    );
  }
}

class _PassoDescricao extends StatefulWidget {
  const _PassoDescricao({
    required this.descricao,
    required this.referencia,
    required this.aoMudar,
  });
  final TextEditingController descricao;
  final TextEditingController referencia;
  final VoidCallback aoMudar;

  @override
  State<_PassoDescricao> createState() => _PassoDescricaoState();
}

class _PassoDescricaoState extends State<_PassoDescricao> {
  bool _aOuvir = false;
  String _antes = '';

  Future<void> _ditar() async {
    final d = FornecedorMunicipe.de(context).ditado;
    if (_aOuvir) {
      await d.parar();
      setState(() => _aOuvir = false);
      return;
    }
    if (!await d.preparar()) {
      if (mounted) {
        avisar(
          context,
          'Este telemóvel não tem ditado por voz. Escreva, por favor.',
        );
      }
      return;
    }
    _antes = widget.descricao.text.trim();
    setState(() => _aOuvir = true);
    await d.comecar((texto, fim) {
      if (!mounted) return;
      widget.descricao.text = [
        _antes,
        texto,
      ].where((x) => x.isNotEmpty).join(' ');
      widget.aoMudar();
      if (fim) setState(() => _aOuvir = false);
    });
  }

  @override
  Widget build(BuildContext context) => ListView(
    padding: const EdgeInsets.all(16),
    children: [
      TextField(
        controller: widget.descricao,
        minLines: 4,
        maxLines: 8,
        maxLength: 1000,
        onChanged: (_) => widget.aoMudar(),
        style: const TextStyle(fontSize: 19),
        textCapitalization: TextCapitalization.sentences,
        decoration: const InputDecoration(
          labelText: 'O que se passa',
          hintText: 'Ex.: buraco grande junto à passadeira',
          alignLabelWithHint: true,
        ),
      ),
      const SizedBox(height: 8),
      BotaoLargo(
        icone: _aOuvir ? Icons.stop_rounded : Icons.mic_rounded,
        texto: _aOuvir ? 'Parar de ditar' : 'Ditar em vez de escrever',
        contorno: !_aOuvir,
        onPressed: _ditar,
      ),
      const SizedBox(height: 16),
      TextField(
        controller: widget.referencia,
        maxLength: 200,
        style: const TextStyle(fontSize: 19),
        decoration: const InputDecoration(
          labelText: 'Ponto de referência (opcional)',
          hintText: 'Ex.: em frente à farmácia',
        ),
      ),
    ],
  );
}

class _PassoConfirmar extends StatelessWidget {
  const _PassoConfirmar({required this.r, required this.descricao});
  final RascunhoOcorrencia r;
  final String descricao;

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Cartao(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              LinhaDado(
                iconeCategoria(r.categoria ?? ''),
                r.categoria ?? '',
                forte: true,
              ),
              LinhaDado(Icons.notes_rounded, descricao.trim()),
              if (r.local != null)
                LinhaDado(Icons.place_outlined, 'Sítio: ${r.local}'),
              LinhaDado(
                r.foto == null
                    ? Icons.no_photography_outlined
                    : Icons.photo_camera_outlined,
                r.foto == null ? 'Sem fotografia' : 'Com fotografia',
              ),
            ],
          ),
        ),
        const SizedBox(height: 12),
        Text(
          'Ao enviar, a câmara fica com este problema e com o seu contacto para o avisar quando estiver resolvido. Quem vê o mapa público não sabe quem reportou.',
          style: t.bodyMedium?.copyWith(color: Cores.tinta2),
        ),
      ],
    );
  }
}

class _Resultado extends StatelessWidget {
  const _Resultado(this.r);
  final ResultadoReporte r;

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    final o = r.registada;
    final (icone, cor, titulo, texto) = o == null
        ? (
            Icons.cloud_upload_outlined,
            Cores.ambar,
            'Fica guardado no telemóvel',
            'Está sem rede. Enviamos o seu aviso logo que houver ligação: não precisa de fazer mais nada.',
          )
        : o.duplicada
        ? (Icons.groups_rounded, Cores.verde, 'Já sabemos!', o.mensagem)
        : (
            Icons.check_circle_rounded,
            Cores.verde,
            'Recebido. Obrigado!',
            o.mensagem,
          );
    return Scaffold(
      appBar: AppBar(title: const Text('Reportar um problema')),
      body: ListView(
        padding: const EdgeInsets.all(24),
        children: [
          Icon(icone, size: 72, color: cor),
          const SizedBox(height: 16),
          Semantics(
            header: true,
            liveRegion: true,
            child: Text(
              titulo,
              style: t.headlineMedium,
              textAlign: TextAlign.center,
            ),
          ),
          const SizedBox(height: 12),
          Text(texto, style: t.bodyLarge, textAlign: TextAlign.center),
          if (o != null) ...[
            const SizedBox(height: 16),
            Center(child: Pilula('N.º ${o.numero}', tom: TomPilula.tinta)),
          ],
          const SizedBox(height: 28),
          BotaoLargo(
            icone: Icons.folder_open_rounded,
            texto: 'Ver os meus problemas reportados',
            onPressed: () => irPara(context, Navegacao.assuntos),
          ),
          const SizedBox(height: 10),
          BotaoLargo(
            icone: Icons.home_rounded,
            texto: 'Voltar ao início',
            contorno: true,
            onPressed: () => irPara(context, Navegacao.inicio),
          ),
        ],
      ),
    );
  }
}
