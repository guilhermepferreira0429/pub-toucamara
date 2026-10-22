import 'package:flutter/material.dart';
import 'package:flutter/scheduler.dart';

import '../../comum/api/cliente_api.dart';
import '../../comum/componentes/componentes.dart';
import '../../comum/localizacao/localizacao.dart';
import '../../comum/mapa/mapa_cidade.dart';
import '../../comum/tema.dart';
import '../componentes.dart';
import '../modelos.dart';
import '../repositorio.dart';
import '../servicos.dart';

void abrirItem(BuildContext context, ItemAgora i) => Navigator.of(
  context,
).push(MaterialPageRoute(builder: (_) => EcraItemAgora(item: i)));

/// Perto de mim: o feed da câmara em lista ou no mapa, por tipo e (com a
/// localização) só à volta de onde a pessoa está.
class EcraPerto extends StatefulWidget {
  const EcraPerto({super.key, this.mapaInicial = false});
  final bool mapaInicial;

  @override
  State<EcraPerto> createState() => _EcraPertoState();
}

class _EcraPertoState extends State<EcraPerto> {
  late bool _mapa = widget.mapaInicial;
  final Set<TipoItem> _tipos = {};
  bool _pertoDeMim = false;
  int _raio = 1000;
  Ponto? _eu;
  String? _semLocalizacao;
  Future<Lido<Feed>>? _feed;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_feed == null) _carregar();
  }

  void _carregar() {
    final s = FornecedorMunicipe.de(context);
    setState(() {
      _feed = s.repositorio.feed(
        tipos: _tipos,
        perto: _pertoDeMim ? _eu : null,
        raioM: _pertoDeMim ? _raio : null,
      );
    });
  }

  Future<void> _mudarPerto(bool v) async {
    if (!v) {
      setState(() => _pertoDeMim = false);
      _carregar();
      return;
    }
    final s = FornecedorMunicipe.de(context);
    final p = await s.localizador.atual();
    if (!mounted) return;
    if (p == null) {
      setState(
        () => _semLocalizacao =
            'Não conseguimos saber onde está. Ligue a localização do telemóvel e autorize a app.',
      );
      return;
    }
    setState(() {
      _eu = p;
      _pertoDeMim = true;
      _semLocalizacao = null;
    });
    _carregar();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Perto de mim'),
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(64),
          child: Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 10),
            child: SegmentedButton<bool>(
              segments: const [
                ButtonSegment(
                  value: false,
                  icon: Icon(Icons.view_list_rounded),
                  label: Text('Lista'),
                ),
                ButtonSegment(
                  value: true,
                  icon: Icon(Icons.map_rounded),
                  label: Text('Mapa'),
                ),
              ],
              selected: {_mapa},
              showSelectedIcon: false,
              onSelectionChanged: (v) => setState(() => _mapa = v.first),
            ),
          ),
        ),
      ),
      body: Column(
        children: [
          // No mapa, os chips em vidro por cima do mapa fazem de filtro.
          if (!_mapa)
            _Filtros(
              tipos: _tipos,
              pertoDeMim: _pertoDeMim,
              raio: _raio,
              aoMudarTipo: (t, v) {
                setState(() => v ? _tipos.add(t) : _tipos.remove(t));
                _carregar();
              },
              aoMudarPerto: _mudarPerto,
              aoMudarRaio: (r) {
                setState(() => _raio = r);
                _carregar();
              },
            ),
          if (_semLocalizacao != null)
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
              child: ErroLinha(_semLocalizacao!),
            ),
          Expanded(
            child: FutureBuilder<Lido<Feed>>(
              future: _feed,
              builder: (context, s) {
                if (s.connectionState != ConnectionState.done) {
                  return const Center(child: CircularProgressIndicator());
                }
                if (s.hasError) {
                  return ListView(
                    padding: const EdgeInsets.all(16),
                    children: [
                      ErroLinha(mensagemDe(s.error!), aoTentar: _carregar),
                    ],
                  );
                }
                final l = s.data!;
                return _mapa
                    ? MapaAgora(
                        itens: l.valor.ordenados,
                        eu: _pertoDeMim ? _eu : null,
                        aoPertoDeMim: () => _mudarPerto(!_pertoDeMim),
                      )
                    : _Lista(lido: l, aoAtualizar: () async => _carregar());
              },
            ),
          ),
        ],
      ),
    );
  }
}

class _Filtros extends StatelessWidget {
  const _Filtros({
    required this.tipos,
    required this.pertoDeMim,
    required this.raio,
    required this.aoMudarTipo,
    required this.aoMudarPerto,
    required this.aoMudarRaio,
  });
  final Set<TipoItem> tipos;
  final bool pertoDeMim;
  final int raio;
  final void Function(TipoItem t, bool v) aoMudarTipo;
  final void Function(bool v) aoMudarPerto;
  final void Function(int r) aoMudarRaio;

  @override
  Widget build(BuildContext context) => SizedBox(
    height: 64,
    child: ListView(
      scrollDirection: Axis.horizontal,
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      children: [
        FilterChip(
          avatar: const Icon(Icons.my_location_rounded, size: 20),
          label: Text(
            pertoDeMim ? 'Perto de mim (${_raioDito(raio)})' : 'Perto de mim',
          ),
          selected: pertoDeMim,
          onSelected: aoMudarPerto,
          materialTapTargetSize: MaterialTapTargetSize.padded,
        ),
        if (pertoDeMim) ...[
          const SizedBox(width: 8),
          PopupMenuButton<int>(
            tooltip: 'Distância',
            onSelected: aoMudarRaio,
            itemBuilder: (_) => [
              for (final r in const [300, 500, 1000, 2000, 5000])
                PopupMenuItem(value: r, child: Text('Até ${_raioDito(r)}')),
            ],
            child: const Chip(
              avatar: Icon(Icons.straighten_rounded, size: 20),
              label: Text('Distância'),
            ),
          ),
        ],
        for (final t in TipoItem.values) ...[
          const SizedBox(width: 8),
          FilterChip(
            avatar: Icon(estilosTipo[t]!.icone, size: 20),
            label: Text(nomesTipo[t]!),
            selected: tipos.contains(t),
            onSelected: (v) => aoMudarTipo(t, v),
            materialTapTargetSize: MaterialTapTargetSize.padded,
          ),
        ],
      ],
    ),
  );
}

String _raioDito(int m) =>
    m >= 1000 ? '${(m / 1000).toString().replaceAll('.0', '')} km' : '$m m';

class _Lista extends StatelessWidget {
  const _Lista({required this.lido, required this.aoAtualizar});
  final Lido<Feed> lido;
  final Future<void> Function() aoAtualizar;

  @override
  Widget build(BuildContext context) {
    final f = lido.valor;
    return RefreshIndicator(
      onRefresh: aoAtualizar,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(16, 4, 16, 32),
        children: [
          if (lido.daCache) AvisoGuardado(lido.guardadoEm!),
          Text(
            f.total == 1
                ? '1 coisa a acontecer'
                : '${f.total} coisas a acontecer',
            style: Theme.of(
              context,
            ).textTheme.bodyLarge?.copyWith(color: Cores.tinta2),
          ),
          const SizedBox(height: 10),
          if (f.itens.isEmpty)
            const EstadoVazio(
              'Nada a assinalar com estes filtros.',
              icone: Icons.check_circle_outline_rounded,
            ),
          for (final i in f.ordenados) ...[
            CartaoItemAgora(item: i, onTap: () => abrirItem(context, i)),
            const SizedBox(height: 10),
          ],
          if (f.nota != null) ...[
            const SizedBox(height: 8),
            const Align(
              alignment: Alignment.centerLeft,
              child: Pilula('Valores de demonstração', tom: TomPilula.ambar),
            ),
            const SizedBox(height: 4),
            Text(
              f.nota!,
              style: Theme.of(
                context,
              ).textTheme.bodySmall?.copyWith(color: Cores.tinta2),
            ),
          ],
        ],
      ),
    );
  }
}

/// Os itens no mapa (MapaCidade: 3D nativo do Mapbox no Android com
/// MAPA_NATIVO, senão flutter_map com mosaicos do Mapbox ou OpenStreetMap):
/// chips em vidro por tipo (com contagem), bolhas por item, emergências a
/// pulsar e o item escolhido num cartão em vidro em baixo.
class MapaAgora extends StatefulWidget {
  const MapaAgora({super.key, required this.itens, this.eu, this.aoPertoDeMim});
  final List<ItemAgora> itens;
  final Ponto? eu;

  /// O botão "onde estou" do mapa (liga o "perto de mim").
  final VoidCallback? aoPertoDeMim;

  @override
  State<MapaAgora> createState() => _MapaAgoraState();
}

/// Filtro dos chips: null = tudo; 'emergencias'; ou o nome do tipo.
class _MapaAgoraState extends State<MapaAgora> {
  String? _escolhido;
  String? _filtro;
  bool _semFundo = false;

  /// Acima disto, os marcadores ficam só com o ícone.
  static const _maxBolhas = 6;

  void _falhouMosaico() {
    if (_semFundo) return;
    SchedulerBinding.instance.addPostFrameCallback((_) {
      if (mounted) setState(() => _semFundo = true);
    });
  }

  bool _passa(ItemAgora i) => switch (_filtro) {
    null => true,
    'emergencias' => i.emergencia,
    final t => !i.emergencia && i.tipo.name == t,
  };

  @override
  Widget build(BuildContext context) {
    final comLocal = widget.itens.where((i) => i.temLocal).toList();
    final visiveis = comLocal.where(_passa).toList();
    final eu = widget.eu;
    final semLocal = widget.itens.length - comLocal.length;
    final escolhido = visiveis.where((i) => i.id == _escolhido).firstOrNull;
    final compacto = visiveis.length > _maxBolhas;
    final contagem = <String?, int>{null: comLocal.length, 'emergencias': 0};
    for (final i in comLocal) {
      final k = i.emergencia ? 'emergencias' : i.tipo.name;
      contagem[k] = (contagem[k] ?? 0) + 1;
    }
    final chips = <(String?, String, IconData, Color)>[
      (null, 'Tudo', Icons.layers_rounded, Cores.tinta),
      if ((contagem['emergencias'] ?? 0) > 0)
        (
          'emergencias',
          estiloEmergencia.nome,
          estiloEmergencia.icone,
          estiloEmergencia.cor,
        ),
      for (final t in TipoItem.values)
        (t.name, nomesTipo[t]!, estilosTipo[t]!.icone, estilosTipo[t]!.cor),
    ];
    return Stack(
      children: [
        MapaCidade(
          rotulo: 'Mapa do que se passa (a lista tem a mesma informação)',
          marcadores: [
            for (final i in visiveis)
              MarcadorMapa(
                id: i.id,
                ponto: Ponto(i.lat!, i.lng!),
                nome: '${estiloDe(i).singular}: ${i.titulo}',
                cor: estiloDe(i).cor,
                icone: estiloDe(i).icone,
                titulo: i.titulo,
                subtitulo: i.etiqueta,
                pulsar: i.emergencia,
                compacto: compacto && !i.emergencia && i.id != _escolhido,
              ),
          ],
          circulos: [
            for (final i in visiveis)
              if ((i.raioM ?? 0) > 0)
                CirculoMapa(
                  centro: Ponto(i.lat!, i.lng!),
                  raioM: i.raioM!.toDouble(),
                  cor: estiloDe(i).cor,
                ),
          ],
          enquadrar: [for (final i in visiveis) Ponto(i.lat!, i.lng!), ?eu],
          selecionado: _escolhido,
          aoTocarMarcador: (id) => setState(() => _escolhido = id),
          aoTocarMapa: () => setState(() => _escolhido = null),
          eu: eu,
          vista3d: true,
          margens: EdgeInsets.fromLTRB(
            48,
            120,
            48,
            escolhido != null ? 240 : 64,
          ),
          aoFalharFundo: _falhouMosaico,
          aoLocalizar: widget.aoPertoDeMim,
        ),
        Positioned(
          left: 0,
          right: 0,
          top: 10,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              SizedBox(
                height: 52,
                child: ListView.separated(
                  scrollDirection: Axis.horizontal,
                  padding: const EdgeInsets.symmetric(horizontal: 12),
                  itemCount: chips.length,
                  separatorBuilder: (_, _) => const SizedBox(width: 8),
                  itemBuilder: (_, n) {
                    final (id, nome, icone, cor) = chips[n];
                    return ChipVidro(
                      nome: nome,
                      ativo: _filtro == id,
                      contagem: contagem[id] ?? 0,
                      icone: icone,
                      cor: cor,
                      aoTocar: () => setState(() {
                        _filtro = id;
                        _escolhido = null;
                      }),
                    );
                  },
                ),
              ),
              Padding(
                padding: const EdgeInsets.fromLTRB(12, 6, 12, 0),
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
                        '$semLocal sem sítio no mapa (ver na lista)',
                        icone: Icons.location_off_outlined,
                      ),
                  ],
                ),
              ),
            ],
          ),
        ),
        if (escolhido != null)
          Positioned(
            left: 10,
            right: 10,
            bottom: 12,
            child: Vidro(
              raio: 26,
              padding: const EdgeInsets.all(6),
              child: CartaoItemAgora(
                item: escolhido,
                onTap: () => abrirItem(context, escolhido),
              ),
            ),
          ),
      ],
    );
  }
}

/// O detalhe de um item do feed, com "Avisar-me".
class EcraItemAgora extends StatefulWidget {
  const EcraItemAgora({super.key, required this.item});
  final ItemAgora item;

  @override
  State<EcraItemAgora> createState() => _EcraItemAgoraState();
}

class _EcraItemAgoraState extends State<EcraItemAgora> {
  Future<DetalheAgora>? _f;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _f ??= FornecedorMunicipe.de(context).repositorio.detalhe(widget.item);
  }

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    return Scaffold(
      appBar: AppBar(title: Text(estiloDe(widget.item).singular)),
      body: FutureBuilder<DetalheAgora>(
        future: _f,
        builder: (context, s) {
          // Sem rede: mostra o que veio na lista.
          final d = s.data;
          final i = d?.item ?? widget.item;
          final e = estiloDe(i);
          return ListView(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 32),
            children: [
              Row(
                children: [
                  MarcaTipo(e, tamanho: 52),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Align(
                      alignment: Alignment.centerLeft,
                      child: Pilula(
                        i.etiqueta.isEmpty ? e.singular : i.etiqueta,
                        tom: i.emergencia
                            ? TomPilula.terracota
                            : TomPilula.neutro,
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 14),
              Semantics(
                header: true,
                child: Text(i.titulo, style: t.headlineSmall),
              ),
              const SizedBox(height: 12),
              if (d?.quando != null)
                LinhaDado(Icons.schedule_rounded, d!.quando!, forte: true),
              if (i.onde != null) LinhaDado(Icons.place_outlined, i.onde!),
              if (fonteDita[i.fonte] != null)
                LinhaDado(Icons.info_outline_rounded, fonteDita[i.fonte]!),
              const SizedBox(height: 12),
              if (s.connectionState != ConnectionState.done)
                const Center(child: CircularProgressIndicator())
              else
                Text(d?.texto ?? i.resumo, style: t.bodyLarge),
              if (s.hasError && s.error is! SemRede) ...[
                const SizedBox(height: 12),
                ErroLinha(mensagemDe(s.error!)),
              ],
              if (i.temLocal) ...[
                const SizedBox(height: 16),
                SizedBox(
                  height: 220,
                  child: ClipRRect(
                    borderRadius: BorderRadius.circular(20),
                    child: MapaAgora(itens: [i]),
                  ),
                ),
              ],
              const SizedBox(height: 20),
              BotaoLargo(
                icone: Icons.notifications_active_rounded,
                texto: 'Avisar-me de coisas assim',
                onPressed: () => pedirAvisos(context, item: i),
              ),
              if (i.link.isNotEmpty) ...[
                const SizedBox(height: 10),
                BotaoLargo(
                  icone: Icons.open_in_new_rounded,
                  texto: 'Ver no site da câmara',
                  contorno: true,
                  onPressed: () => abrirFora(context, i.link),
                ),
              ],
            ],
          );
        },
      ),
    );
  }
}

/// "Avisar-me": que tipos e onde (à volta deste sítio, de onde estou, ou a
/// freguesia). Os avisos chegam por notificação ou SMS.
Future<void> pedirAvisos(BuildContext context, {ItemAgora? item}) async {
  final mensagem = await showModalBottomSheet<String>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    builder: (_) => _FolhaAvisarMe(item: item),
  );
  if (mensagem != null && context.mounted) {
    await showDialog<void>(
      context: context,
      builder: (c) => AlertDialog(
        icon: const Icon(
          Icons.check_circle_rounded,
          color: Cores.verde,
          size: 40,
        ),
        title: const Text('Combinado'),
        content: Text(mensagem),
        actions: [
          FilledButton(
            onPressed: () => Navigator.of(c).pop(),
            child: const Text('Está bem'),
          ),
        ],
      ),
    );
  }
}

enum _Onde { sitio, eu, freguesia }

class _FolhaAvisarMe extends StatefulWidget {
  const _FolhaAvisarMe({this.item});
  final ItemAgora? item;

  @override
  State<_FolhaAvisarMe> createState() => _FolhaAvisarMeState();
}

class _FolhaAvisarMeState extends State<_FolhaAvisarMe> {
  late final Set<TipoItem> _tipos = {
    if (widget.item != null && tiposSubscricao.contains(widget.item!.tipo))
      widget.item!.tipo
    else
      TipoItem.obras,
  };
  late _Onde _onde = widget.item?.temLocal == true
      ? _Onde.sitio
      : widget.item?.freguesia != null
      ? _Onde.freguesia
      : _Onde.eu;
  bool _ocupado = false;
  String? _erro;

  Future<void> _confirmar() async {
    final s = FornecedorMunicipe.de(context);
    setState(() {
      _ocupado = true;
      _erro = null;
    });
    try {
      final i = widget.item;
      String m;
      switch (_onde) {
        case _Onde.sitio:
          m = await s.repositorio.subscrever(
            tipos: _tipos,
            ponto: Ponto(i!.lat!, i.lng!),
            descricao: i.rua ?? '«${i.titulo}»',
          );
        case _Onde.eu:
          final p = await s.localizador.atual();
          if (p == null) {
            throw ErroApi(
              0,
              'sem_localizacao',
              'Não conseguimos saber onde está. Ligue a localização do telemóvel.',
            );
          }
          m = await s.repositorio.subscrever(
            tipos: _tipos,
            ponto: p,
            descricao: 'onde estava',
          );
        case _Onde.freguesia:
          m = await s.repositorio.subscrever(
            tipos: _tipos,
            freguesia: i!.freguesia,
          );
      }
      if (mounted) Navigator.of(context).pop(m);
    } on Object catch (e) {
      if (mounted) setState(() => _erro = mensagemDe(e));
    } finally {
      if (mounted) setState(() => _ocupado = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    final i = widget.item;
    return SafeArea(
      child: SingleChildScrollView(
        padding: EdgeInsets.fromLTRB(
          20,
          0,
          20,
          20 + MediaQuery.viewInsetsOf(context).bottom,
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text('Avisar-me', style: t.headlineSmall),
            const SizedBox(height: 6),
            Text(
              'Avisamos quando aparecer algo novo. Só entre as 9h e as 21h, exceto emergências.',
              style: t.bodyLarge?.copyWith(color: Cores.tinta2),
            ),
            const SizedBox(height: 16),
            const Rotulo('De quê'),
            for (final tipo in tiposSubscricao)
              CheckboxListTile(
                value: _tipos.contains(tipo),
                onChanged: (v) => setState(
                  () => v == true ? _tipos.add(tipo) : _tipos.remove(tipo),
                ),
                secondary: Icon(estilosTipo[tipo]!.icone),
                title: Text(nomesTipo[tipo]!),
                contentPadding: EdgeInsets.zero,
              ),
            const SizedBox(height: 8),
            const Rotulo('Onde'),
            RadioGroup<_Onde>(
              groupValue: _onde,
              onChanged: (v) => setState(() => _onde = v ?? _onde),
              child: Column(
                children: [
                  if (i?.temLocal == true)
                    RadioListTile(
                      value: _Onde.sitio,
                      title: Text(
                        'À volta deste sítio (${i!.rua ?? 'no mapa'})',
                      ),
                      contentPadding: EdgeInsets.zero,
                    ),
                  const RadioListTile(
                    value: _Onde.eu,
                    title: Text('À volta de onde estou agora'),
                    contentPadding: EdgeInsets.zero,
                  ),
                  if (i?.freguesia != null)
                    RadioListTile(
                      value: _Onde.freguesia,
                      title: Text('Na freguesia (${i!.freguesia})'),
                      contentPadding: EdgeInsets.zero,
                    ),
                ],
              ),
            ),
            if (_erro != null) ...[
              const SizedBox(height: 8),
              ErroLinha(_erro!),
            ],
            const SizedBox(height: 16),
            FilledButton.icon(
              onPressed: _ocupado || _tipos.isEmpty ? null : _confirmar,
              icon: const Icon(Icons.notifications_active_rounded),
              label: Text(_ocupado ? 'A guardar…' : 'Avisar-me'),
            ),
          ],
        ),
      ),
    );
  }
}
