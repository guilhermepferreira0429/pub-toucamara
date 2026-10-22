import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';

import '../comum/api/cliente_api.dart';
import '../comum/armazenamento/armazem.dart';
import '../comum/fila/fila_offline.dart';
import '../comum/localizacao/localizacao.dart';
import '../comum/plataforma/camara.dart';
import 'modelos.dart';

/// Os dados da app da equipa: da API quando há rede, da cache quando não
/// há; o que se faz vai para a [FilaOffline] (com Idempotency-Key).
class RepositorioEquipa extends ChangeNotifier {
  RepositorioEquipa({
    required this.api,
    required this.fila,
    required Armazem cache,
    required this.localizador,
    String? Function()? dono,
  }) : _cache = cache,
       _dono = dono ?? (() => null) {
    fila.aoEnviar = _depoisDeEnviar;
  }

  final ClienteApi api;
  final FilaOffline fila;
  final Armazem _cache;
  final Localizador localizador;
  final String? Function() _dono;

  // A cache é de cada pessoa (o telemóvel pode passar de mão em mão).
  String get _chaveHoje => 'cache_${_dono() ?? 'anon'}_hoje_v1';
  String _chaveDetalhe(TipoTarefa t, String id) =>
      'cache_${_dono() ?? 'anon'}_${t.name}_$id';

  /// Ao sair: esquece o que está em memória (a cache fica, por pessoa).
  void limpar() {
    dia = null;
    notifyListeners();
  }

  DiaDeTrabalho? dia;
  Ponto? ondeEstou;

  /// As tarefas de hoje. Sem rede devolve as guardadas (e reordena-as com a
  /// localização atual). Lança [SemRede] só se não houver nada guardado.
  Future<DiaDeTrabalho> carregarHoje() async {
    ondeEstou = await localizador.atual() ?? ondeEstou;
    try {
      final j =
          await api.get(
                '/painel/equipa/hoje',
                query: {
                  if (ondeEstou != null)
                    'lat': ondeEstou!.lat.toStringAsFixed(6),
                  if (ondeEstou != null)
                    'lng': ondeEstou!.lng.toStringAsFixed(6),
                },
              )
              as Map;
      final agora = DateTime.now();
      await _cache.escrever(
        _chaveHoje,
        jsonEncode({'obtido_em': agora.toIso8601String(), 'dados': j}),
      );
      final d = DiaDeTrabalho.deJson(
        j.cast<String, dynamic>(),
        obtidoEm: agora,
      );
      dia = _reordenar(d);
      notifyListeners();
      // Há rede: aproveita para enviar o que ficou e guardar os detalhes.
      unawaited(fila.enviar());
      unawaited(_guardarDetalhes(d.tarefas));
      return dia!;
    } on SemRede {
      final guardado = await _hojeDaCache();
      if (guardado == null) rethrow;
      dia = _reordenar(guardado);
      notifyListeners();
      return dia!;
    }
  }

  DiaDeTrabalho _reordenar(DiaDeTrabalho d) => DiaDeTrabalho(
    dia: d.dia,
    tarefas: ordenarPorProximidade(d.tarefas, ondeEstou),
    obtidoEm: d.obtidoEm,
    daCache: d.daCache,
    mostraVisitas: d.mostraVisitas,
    mostraOcorrencias: d.mostraOcorrencias,
  );

  Future<DiaDeTrabalho?> _hojeDaCache() async {
    final t = await _cache.ler(_chaveHoje);
    if (t == null) return null;
    final j = jsonDecode(t) as Map<String, dynamic>;
    return DiaDeTrabalho.deJson(
      (j['dados'] as Map).cast<String, dynamic>(),
      obtidoEm: DateTime.parse(j['obtido_em'] as String),
      daCache: true,
    );
  }

  Future<void> _guardarDetalhes(List<Tarefa> tarefas) async {
    for (final t in tarefas.where((t) => !t.feita)) {
      try {
        await _detalhe(t.tipo, t.id);
      } on Object {
        return; // sem rede a meio: fica o que já se guardou
      }
    }
  }

  String _caminho(TipoTarefa t, String id) => t == TipoTarefa.visita
      ? '/painel/fiscalizacao/visitas/$id'
      : '/painel/ocorrencias/$id';

  /// O detalhe da API (e guarda-o); sem rede, o guardado.
  Future<(Map<String, dynamic>, bool)> _detalhe(TipoTarefa t, String id) async {
    try {
      final j = (await api.get(_caminho(t, id)) as Map).cast<String, dynamic>();
      await _cache.escrever(_chaveDetalhe(t, id), jsonEncode(j));
      return (j, false);
    } on SemRede {
      final g = await _cache.ler(_chaveDetalhe(t, id));
      if (g == null) rethrow;
      return ((jsonDecode(g) as Map).cast<String, dynamic>(), true);
    }
  }

  Future<(VisitaDetalhe, bool)> visita(String id) async {
    final (j, daCache) = await _detalhe(TipoTarefa.visita, id);
    return (VisitaDetalhe(j), daCache);
  }

  Future<(OcorrenciaDetalhe, bool)> ocorrencia(String id) async {
    final (j, daCache) = await _detalhe(TipoTarefa.ocorrencia, id);
    return (OcorrenciaDetalhe(j), daCache);
  }

  Future<Uint8List> pdfVisita(String id) =>
      api.bytes('/painel/fiscalizacao/visitas/$id/pdf');

  // ------------------------------------------------------------------
  // Ações (vão para a fila; enviam logo se houver rede)
  // ------------------------------------------------------------------

  Future<Acao> fotoVisita(VisitaDetalhe v, FotoTirada f, {String? legenda}) =>
      fila.ficheiro(
        descricao: 'Fotografia da visita ${v.numero}',
        alvo: v.id,
        caminho: '/painel/equipa/visitas/${v.id}/fotos',
        corpo: f.corpo(legenda: legenda),
        bytes: f.bytes,
      );

  /// O texto ditado e as respostas da checklist (a API estrutura-o).
  Future<Acao> relatorioVisita(
    VisitaDetalhe v,
    String texto,
    List<ItemChecklist> checklist, {
    bool enviarJa = true,
  }) => fila.pedido(
    descricao: 'Relatório da visita ${v.numero}',
    alvo: v.id,
    metodo: 'POST',
    caminho: '/painel/fiscalizacao/visitas/${v.id}/relatorio',
    corpo: {
      'texto': texto,
      'checklist': [
        for (final i in checklist)
          if (i.resposta != null) i.paraResposta(),
      ],
    },
    enviarJa: enviarJa,
  );

  Future<Acao> concluirVisita(VisitaDetalhe v) => fila.pedido(
    descricao: 'Concluir a visita ${v.numero}',
    alvo: v.id,
    metodo: 'POST',
    caminho: '/painel/fiscalizacao/visitas/${v.id}/concluir',
  );

  Future<Acao> estadoOcorrencia(OcorrenciaDetalhe o, String estado) =>
      fila.pedido(
        descricao: '${nomeEstadoOcorrencia(estado)}: ocorrência ${o.numero}',
        alvo: o.id,
        metodo: 'PATCH',
        caminho: '/painel/ocorrencias/${o.id}',
        corpo: {'estado': estado},
      );

  /// A foto do depois (se houver) e o fecho com a nota, por esta ordem; o
  /// fecho leva o id da foto que a API der ao enviá-la.
  Future<void> fecharOcorrencia(
    OcorrenciaDetalhe o, {
    FotoTirada? foto,
    required String nota,
  }) async {
    final ids = <String>[];
    if (foto != null) {
      final a = await fila.ficheiro(
        descricao: 'Fotografia do depois · ${o.numero}',
        alvo: o.id,
        caminho: '/painel/equipa/ocorrencias/${o.id}/fotos',
        corpo: foto.corpo(legenda: 'Depois'),
        bytes: foto.bytes,
        enviarJa: false,
      );
      ids.add(a.id);
    }
    await fila.pedido(
      descricao: 'Fechar a ocorrência ${o.numero}',
      alvo: o.id,
      metodo: 'POST',
      caminho: '/painel/equipa/ocorrencias/${o.id}/fechar',
      corpo: {'nota': nota.trim(), 'foto_ids': <String>[]},
      usarResultados: {if (ids.isNotEmpty) 'foto_ids': ids},
    );
  }

  /// "Por enviar" desta tarefa: o que o ecrã mostra por cima dos dados.
  /// Fechada (ocorrência) ou concluída (visita) neste telemóvel, por enviar.
  bool fechadaAqui(String alvo) => fila
      .daTarefa(alvo)
      .any(
        (a) => a.caminho.endsWith('/fechar') || a.caminho.endsWith('/concluir'),
      );

  String? pendenteDe(String alvo) {
    final l = fila.daTarefa(alvo);
    if (l.isEmpty) return null;
    if (l.any((a) => a.caminho.endsWith('/fechar'))) {
      return 'Fechada · por enviar';
    }
    if (l.any((a) => a.caminho.endsWith('/concluir'))) {
      return 'Concluída · por enviar';
    }
    return l.length == 1 ? '1 por enviar' : '${l.length} por enviar';
  }

  void _depoisDeEnviar(Acao a, dynamic resposta) {
    // A resposta do relatório/concluir/fechar já é o detalhe atualizado.
    if (resposta is Map &&
        resposta['id'] == a.alvo &&
        resposta['numero'] != null) {
      final tipo =
          a.caminho.contains('/fiscalizacao/') ||
              a.caminho.contains('/equipa/visitas/')
          ? TipoTarefa.visita
          : TipoTarefa.ocorrencia;
      unawaited(
        _cache.escrever(_chaveDetalhe(tipo, a.alvo), jsonEncode(resposta)),
      );
    }
    if (fila.porEnviar == 0) {
      unawaited(carregarHoje().then((_) {}, onError: (_) {}));
    }
    notifyListeners();
  }
}
