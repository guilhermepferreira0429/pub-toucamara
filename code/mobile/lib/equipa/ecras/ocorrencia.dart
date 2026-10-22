import 'package:flutter/material.dart';

import '../../comum/api/cliente_api.dart';
import '../../comum/componentes/componentes.dart';
import '../../comum/datas.dart';
import '../../comum/fila/fila_offline.dart';
import '../../comum/plataforma/camara.dart';
import '../../comum/plataforma/navegar.dart';
import '../../comum/tema.dart';
import '../modelos.dart';
import '../servicos.dart';
import 'fotos.dart';

/// Ocorrência reportada por munícipes: ver, mudar o estado e fechar com a
/// fotografia do depois (a API avisa quem reportou por SMS).
class EcraOcorrencia extends StatefulWidget {
  const EcraOcorrencia({super.key, required this.id, required this.numero});
  final String id;
  final String numero;

  @override
  State<EcraOcorrencia> createState() => _EcraOcorrenciaState();
}

class _EcraOcorrenciaState extends State<EcraOcorrencia> {
  OcorrenciaDetalhe? _o;
  bool _daCache = false;
  String? _erro;
  FilaOffline? _fila;
  int _pendentesAntes = 0;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_fila == null) {
      _fila = FornecedorServicos.de(context).fila;
      _fila!.addListener(_aoMudarFila);
      _pendentesAntes = _fila!.daTarefa(widget.id).length;
      _carregar();
    }
  }

  @override
  void dispose() {
    _fila?.removeListener(_aoMudarFila);
    super.dispose();
  }

  void _aoMudarFila() {
    final agora = _fila!.daTarefa(widget.id).length;
    if (_pendentesAntes > 0 && agora == 0) _carregar();
    _pendentesAntes = agora;
  }

  Future<void> _carregar() async {
    final repo = FornecedorServicos.de(context).repositorio;
    try {
      final (o, daCache) = await repo.ocorrencia(widget.id);
      if (!mounted) return;
      setState(() {
        _o = o;
        _daCache = daCache;
        _erro = null;
      });
    } on SemRede {
      if (mounted) {
        setState(() => _erro =
            'Sem rede e esta ocorrência não está guardada no telemóvel. Abra-a quando tiver rede.');
      }
    } on ErroApi catch (e) {
      if (mounted) setState(() => _erro = e.mensagem);
    }
  }

  Future<void> _estado(String estado) async {
    await FornecedorServicos.de(context)
        .repositorio
        .estadoOcorrencia(_o!, estado);
    if (mounted) avisar(context, 'Guardado: ${nomeEstadoOcorrencia(estado)}.');
  }

  Future<void> _fechar() async {
    final fechou = await Navigator.of(context).push<bool>(MaterialPageRoute(
        builder: (_) => EcraFecharOcorrencia(ocorrencia: _o!)));
    if (fechou == true && mounted) {
      avisar(context,
          'Fechada. Quem reportou é avisado por SMS quando chegar à câmara.');
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = FornecedorServicos.de(context);
    final texto = Theme.of(context).textTheme;
    final o = _o;
    return Scaffold(
      appBar: AppBar(title: Text('Ocorrência ${widget.numero}')),
      body: Column(children: [
        IndicadorFila(fila: s.fila),
        Expanded(
          child: o == null
              ? Center(
                  child: _erro != null
                      ? Padding(
                          padding: const EdgeInsets.all(16),
                          child: ErroLinha(_erro!, aoTentar: _carregar))
                      : const CircularProgressIndicator())
              : ListenableBuilder(
                  listenable: s.fila,
                  builder: (context, _) {
                    final pendentes = s.fila.daTarefa(o.id);
                    final fechadaLocal =
                        pendentes.any((a) => a.caminho.endsWith('/fechar'));
                    final estadoLocal = pendentes
                        .where((a) => a.metodo == 'PATCH')
                        .map((a) => a.corpo?['estado'] as String?)
                        .lastOrNull;
                    final estado = fechadaLocal
                        ? 'resolvida'
                        : estadoLocal ?? o.estado;
                    final aberta = estado == 'nova' || estado == 'com_equipa';
                    return ListView(
                      padding: const EdgeInsets.fromLTRB(16, 12, 16, 32),
                      children: [
                        Text(o.categoria, style: texto.headlineSmall),
                        const SizedBox(height: 8),
                        Wrap(spacing: 8, runSpacing: 6, children: [
                          Pilula(
                              pendentes.isEmpty
                                  ? o.estadoNome
                                  : '${nomeEstadoOcorrencia(estado)} · por enviar',
                              tom: pendentes.isNotEmpty
                                  ? TomPilula.tinta
                                  : estado == 'resolvida'
                                      ? TomPilula.verde
                                      : TomPilula.neutro),
                          if (o.reportes > 1)
                            Pilula('${o.reportes} pessoas avisaram',
                                tom: TomPilula.terracota),
                          if (o.previstaPara != null)
                            Pilula('Prevista ${diaCurto(o.previstaPara!)}',
                                icone: Icons.event_rounded),
                          if (_daCache)
                            const Pilula('Sem rede · guardado no telemóvel',
                                tom: TomPilula.ambar,
                                icone: Icons.cloud_off_rounded),
                        ]),
                        const SizedBox(height: 16),
                        Cartao(
                          child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                const Rotulo('O que foi reportado'),
                                Text(o.descricao, style: texto.bodyLarge),
                                const SizedBox(height: 10),
                                LinhaDado(Icons.place_outlined, o.morada,
                                    forte: true),
                                if (o.municipeNome != null)
                                  LinhaDado(Icons.person_outline_rounded,
                                      'Reportada por ${o.municipeNome}'),
                                const SizedBox(height: 10),
                                OutlinedButton.icon(
                                  onPressed: () => navegarPara(
                                      lat: o.lat, lng: o.lng, morada: o.morada),
                                  icon: const Icon(Icons.navigation_rounded),
                                  label: const Text('Navegar até lá'),
                                ),
                              ]),
                        ),
                        const SizedBox(height: 16),
                        Cartao(
                          child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                const Rotulo('Fotografias do munícipe'),
                                GaleriaFotos(
                                    fotos: o.fotosMunicipe,
                                    vazio: 'O munícipe não enviou fotografias.'),
                                if (o.fotosDepois.isNotEmpty ||
                                    pendentes.any(
                                        (a) => a.tipo == TipoAcao.ficheiro)) ...[
                                  const SizedBox(height: 16),
                                  const Rotulo('Depois (equipa)'),
                                  GaleriaFotos(
                                    fotos: o.fotosDepois,
                                    pendentes: pendentes
                                        .where(
                                            (a) => a.tipo == TipoAcao.ficheiro)
                                        .toList(),
                                  ),
                                ],
                              ]),
                        ),
                        if (o.duplicados.isNotEmpty) ...[
                          const SizedBox(height: 16),
                          Cartao(
                            child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Rotulo(
                                      'Outros avisos do mesmo problema (${o.duplicados.length})'),
                                  for (final d in o.duplicados)
                                    Padding(
                                      padding:
                                          const EdgeInsets.symmetric(vertical: 6),
                                      child: Column(
                                          crossAxisAlignment:
                                              CrossAxisAlignment.start,
                                          children: [
                                            Text('${d['numero']}',
                                                style: texto.titleMedium),
                                            Text('${d['descricao'] ?? ''}',
                                                style: texto.bodyMedium),
                                          ]),
                                    ),
                                ]),
                          ),
                        ],
                        const SizedBox(height: 20),
                        if (o.duplicada)
                          const ErroLinha(
                              'Esta ocorrência está junta a outra: trate a original.')
                        else if (aberta) ...[
                          FilledButton.icon(
                            onPressed: _fechar,
                            icon: const Icon(Icons.photo_camera_rounded),
                            label: const Text('Fechar com foto do depois'),
                          ),
                          const SizedBox(height: 10),
                          if (estado == 'nova')
                            OutlinedButton.icon(
                              onPressed: () => _estado('com_equipa'),
                              icon: const Icon(Icons.engineering_rounded),
                              label: const Text('Vou tratar disto'),
                            ),
                        ] else if (estado == 'resolvida' && pendentes.isEmpty)
                          OutlinedButton.icon(
                            onPressed: () => _estado('com_equipa'),
                            icon: const Icon(Icons.undo_rounded),
                            label: const Text('Reabrir'),
                          ),
                        if (o.eventos.isNotEmpty) ...[
                          const SizedBox(height: 20),
                          const Rotulo('Histórico'),
                          for (final e in o.eventos.reversed.take(6))
                            LinhaDado(Icons.history_rounded, _evento(e)),
                        ],
                      ],
                    );
                  },
                ),
        ),
      ]),
    );
  }

  String _evento(Map<String, dynamic> e) {
    final em = DateTime.tryParse('${e['em']}');
    final quem = e['ator_nome'] ?? (e['ator_tipo'] == 'municipe' ? 'Munícipe' : 'Sistema');
    final dados = (e['dados'] as Map?) ?? const {};
    final o = switch (e['tipo']) {
      'registada' => 'registada',
      'foto' => dados['origem'] == 'equipa' ? 'foto do depois' : 'fotografia',
      'resolvida' => 'resolvida',
      'estado' => 'estado: ${nomeEstadoOcorrencia('${dados['para']}')}',
      'nota' => 'nota: ${dados['texto']}',
      'avisado_sms' => 'munícipe avisado por SMS',
      'atribuida' => 'atribuída a um serviço',
      _ => '${e['tipo']}',
    };
    return '${em == null ? '' : '${quando(em)} · '}$quem: $o';
  }
}

/// Fechar no terreno: a fotografia do depois e uma nota curta.
class EcraFecharOcorrencia extends StatefulWidget {
  const EcraFecharOcorrencia({super.key, required this.ocorrencia});
  final OcorrenciaDetalhe ocorrencia;

  @override
  State<EcraFecharOcorrencia> createState() => _EcraFecharOcorrenciaState();
}

class _EcraFecharOcorrenciaState extends State<EcraFecharOcorrencia> {
  FotoTirada? _foto;
  final _nota = TextEditingController();
  bool _ocupado = false;

  @override
  void dispose() {
    _nota.dispose();
    super.dispose();
  }

  Future<void> _tirar(bool daGaleria) async {
    final f =
        await FornecedorServicos.de(context).camara.tirar(daGaleria: daGaleria);
    if (f != null && mounted) setState(() => _foto = f);
  }

  Future<void> _confirmar() async {
    if (_nota.text.trim().length < 3) {
      avisar(context, 'Escreva uma nota curta sobre o que foi feito.');
      return;
    }
    if (_foto == null) {
      final sem = await showDialog<bool>(
        context: context,
        builder: (c) => AlertDialog(
          title: const Text('Fechar sem fotografia?'),
          content: const Text(
              'A fotografia do depois mostra ao munícipe e à chefia que ficou resolvido.'),
          actions: [
            TextButton(
                onPressed: () => Navigator.pop(c, false),
                child: const Text('Tirar foto')),
            FilledButton(
                onPressed: () => Navigator.pop(c, true),
                child: const Text('Fechar sem foto')),
          ],
        ),
      );
      if (sem != true) return;
    }
    if (!mounted) return;
    setState(() => _ocupado = true);
    await FornecedorServicos.de(context)
        .repositorio
        .fecharOcorrencia(widget.ocorrencia, foto: _foto, nota: _nota.text);
    if (mounted) Navigator.of(context).pop(true);
  }

  @override
  Widget build(BuildContext context) {
    final texto = Theme.of(context).textTheme;
    final o = widget.ocorrencia;
    return Scaffold(
      appBar: AppBar(title: Text('Fechar ${o.numero}')),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 32),
        children: [
          Text('${o.categoria} · ${o.morada}', style: texto.titleMedium),
          const SizedBox(height: 16),
          const Rotulo('Fotografia do depois'),
          ClipRRect(
            borderRadius: BorderRadius.circular(18),
            child: AspectRatio(
              aspectRatio: 4 / 3,
              child: _foto == null
                  ? Container(
                      color: Cores.creme2,
                      alignment: Alignment.center,
                      child: const Column(mainAxisSize: MainAxisSize.min, children: [
                        Icon(Icons.photo_camera_outlined, size: 56, color: Cores.tinta2),
                        SizedBox(height: 8),
                        Text('Tire uma fotografia de como ficou',
                            style: TextStyle(fontSize: 17, color: Cores.tinta2)),
                      ]),
                    )
                  : Image.memory(_foto!.bytes, fit: BoxFit.cover),
            ),
          ),
          if (_foto != null) ...[
            const SizedBox(height: 8),
            Wrap(spacing: 8, children: [
              Pilula(quando(_foto!.tiradaEm), icone: Icons.schedule_rounded),
              Pilula(_foto!.local == null ? 'Sem GPS' : 'GPS ${_foto!.local}',
                  icone: Icons.my_location_rounded),
            ]),
          ],
          const SizedBox(height: 12),
          BotoesFoto(aoEscolher: _tirar, ativo: !_ocupado),
          const SizedBox(height: 20),
          TextField(
            controller: _nota,
            minLines: 3,
            maxLines: 6,
            maxLength: 1000,
            textCapitalization: TextCapitalization.sentences,
            decoration: const InputDecoration(
              labelText: 'O que foi feito',
              hintText: 'Ex.: Buraco tapado com betuminoso a frio.',
              alignLabelWithHint: true,
            ),
          ),
          const SizedBox(height: 16),
          FilledButton.icon(
            onPressed: _ocupado ? null : _confirmar,
            icon: const Icon(Icons.task_alt_rounded),
            label: const Text('Fechar e avisar quem reportou'),
          ),
          const SizedBox(height: 8),
          Text(
            'Sem rede fica guardado e vai sozinho quando a rede voltar.',
            style: texto.bodySmall?.copyWith(color: Cores.tinta2),
          ),
        ],
      ),
    );
  }
}
