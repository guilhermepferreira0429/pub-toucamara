import 'dart:convert';
import 'dart:typed_data';

import '../comum/api/cliente_api.dart';
import '../comum/armazenamento/armazem.dart';
import '../comum/localizacao/localizacao.dart';
import 'modelos.dart';

/// O que se leu da API, ou (sem rede) o que ficou guardada da última vez.
class Lido<T> {
  const Lido(this.valor, {this.guardadoEm});
  final T valor;

  /// Sem rede: a cópia guardada é desta hora.
  final DateTime? guardadoEm;
  bool get daCache => guardadoEm != null;
}

/// Todas as leituras e escritas da app do munícipe na API. Guarda a última
/// resposta de cada lista, para abrir sem rede (só da pessoa da sessão).
class RepositorioMunicipe {
  RepositorioMunicipe({
    required this.api,
    required Armazem cache,
    required this.municipio,
    required this.dono,
  }) : _cache = cache;

  final ClienteApi api;
  final Armazem _cache;
  final String Function() municipio;

  /// A sessão (as cópias de outra pessoa não se mostram).
  final String? Function() dono;

  Future<Lido<T>> _ler<T>(
    String chave,
    Future<dynamic> Function() pedir,
    T Function(Json j) ler,
  ) async {
    final c = 'cache_municipe:$chave';
    try {
      final r = obj(await pedir());
      final valor = ler(r);
      await _cache.escrever(
        c,
        jsonEncode({
          'dono': dono(),
          'em': DateTime.now().toIso8601String(),
          'dados': r,
        }),
      );
      return Lido(valor);
    } on SemRede {
      final t = await _cache.ler(c);
      if (t != null) {
        final j = obj(jsonDecode(t));
        if (j['dono'] == dono()) {
          return Lido(
            ler(obj(j['dados'])),
            guardadoEm: DateTime.tryParse('${j['em']}') ?? DateTime.now(),
          );
        }
      }
      rethrow;
    }
  }

  /// Esquece as cópias (ao sair).
  Future<void> limpar(Iterable<String> chaves) async {
    for (final c in chaves) {
      await _cache.apagar('cache_municipe:$c');
    }
  }

  static const chavesCache = [
    'eu',
    'feed',
    'processos',
    'licencas',
    'pagamentos',
    'marcacoes',
    'reclamacoes',
    'ocorrencias',
    'avisos',
    'categorias',
  ];

  // --- A pessoa ---------------------------------------------------------

  Future<Lido<Eu>> eu() => _ler('eu', () => api.get('/app/eu'), Eu.deJson);

  Future<void> guardarPreferencias({bool? avisos, bool? processos}) =>
      api.pedido(
        'PUT',
        '/app/eu/preferencias',
        corpo: {
          'tipos': {'avisos': ?avisos, 'processos': ?processos},
        },
      );

  // --- Feed -------------------------------------------------------------

  /// O feed (rota pública). Com [perto], só à volta desse ponto.
  Future<Lido<Feed>> feed({
    Set<TipoItem>? tipos,
    Ponto? perto,
    int? raioM,
    int limite = 50,
  }) {
    final q = <String, String>{
      'limite': '$limite',
      if (tipos != null && tipos.isNotEmpty)
        'tipos': tipos.map((t) => t.name).join(','),
      if (perto != null) 'lat': perto.lat.toStringAsFixed(6),
      if (perto != null) 'lng': perto.lng.toStringAsFixed(6),
      if (perto != null && raioM != null) 'raio_m': '$raioM',
    };
    // Só a vista sem filtros fica guardada (a do início).
    final simples = perto == null && (tipos == null || tipos.isEmpty);
    Future<dynamic> pedir() =>
        api.get('/public/agora/${municipio()}', query: q);
    if (!simples) return pedir().then((r) => Lido(Feed.deJson(obj(r))));
    return _ler('feed', pedir, Feed.deJson);
  }

  Future<DetalheAgora> detalhe(ItemAgora i) async => DetalheAgora.deJson(
    obj(
      await api.get(
        '/public/agora/${municipio()}/${i.tipo.name}/${Uri.encodeComponent(i.id)}',
      ),
    ),
  );

  Future<List<Subscricao>> subscricoes() async => listaDe(
    obj(await api.get('/app/agora/subscricoes'))['subscricoes'],
  ).map(Subscricao.deJson).toList();

  /// Devolve a frase de confirmação da API.
  Future<String> subscrever({
    required Set<TipoItem> tipos,
    Ponto? ponto,
    int? raioM,
    String? descricao,
    String? freguesia,
  }) async {
    final r = obj(
      await api.post(
        '/app/agora/subscricoes',
        corpo: {
          'tipos': tipos.map((t) => t.name).toList(),
          if (ponto != null) 'lat': ponto.lat,
          if (ponto != null) 'lng': ponto.lng,
          'raio_m': ?raioM,
          'descricao': ?descricao,
          'freguesia': ?freguesia,
        },
      ),
    );
    return txt(r['mensagem']) ?? 'Fica combinado.';
  }

  Future<void> cancelarSubscricao(String id) =>
      api.pedido('DELETE', '/app/agora/subscricoes/$id');

  // --- Os meus assuntos ---------------------------------------------------

  Future<Lido<List<ProcessoResumo>>> processos() => _ler(
    'processos',
    () => api.get('/app/processos'),
    (j) => listaDe(j['processos']).map(ProcessoResumo.deJson).toList(),
  );

  Future<Lido<Processo>> processo(String id) => _ler(
    'processo:$id',
    () => api.get('/app/processos/$id'),
    Processo.deJson,
  );

  Future<Lido<List<Licenca>>> licencas() => _ler(
    'licencas',
    () => api.get('/app/licencas'),
    (j) => listaDe(j['licencas']).map(Licenca.deJson).toList(),
  );

  Future<Lido<List<Pagamento>>> pagamentos() => _ler(
    'pagamentos',
    () => api.get('/app/pagamentos'),
    (j) => listaDe(j['pagamentos']).map(Pagamento.deJson).toList(),
  );

  Future<Lido<List<Marcacao>>> marcacoes() => _ler(
    'marcacoes',
    () => api.get('/app/marcacoes'),
    (j) =>
        [
          ...listaDe(j['marcacoes']).map(Marcacao.deJson),
          ...listaDe(j['recolhas']).map(Marcacao.deRecolha),
        ]..sort((a, b) {
          if (a.futura != b.futura) return a.futura ? -1 : 1;
          return (b.inicio ?? DateTime(0)).compareTo(a.inicio ?? DateTime(0));
        }),
  );

  Future<Lido<List<Reclamacao>>> reclamacoes() => _ler(
    'reclamacoes',
    () => api.get('/app/reclamacoes'),
    (j) => listaDe(j['reclamacoes']).map(Reclamacao.deJson).toList(),
  );

  Future<Lido<List<OcorrenciaMinha>>> ocorrencias() => _ler(
    'ocorrencias',
    () => api.get('/app/ocorrencias'),
    (j) => listaDe(j['ocorrencias']).map(OcorrenciaMinha.deJson).toList(),
  );

  /// A página pública da ocorrência (estado e fotografias, também as da equipa).
  Future<OcorrenciaDetalhe> ocorrencia(String token) async =>
      OcorrenciaDetalhe.deJson(
        obj(await api.get('/public/ocorrencias/${Uri.encodeComponent(token)}')),
      );

  Future<Lido<List<Categoria>>> categorias() => _ler(
    'categorias',
    () => api.get('/app/ocorrencias/categorias'),
    (j) => [
      for (final c in listaDe(j['categorias']))
        Categoria(txt(c['nome']) ?? '', txt(c['icone'])),
    ],
  );

  Future<Lido<List<Aviso>>> avisos() => _ler(
    'avisos',
    () => api.get('/app/avisos'),
    (j) => listaDe(j['avisos']).map(Aviso.deJson).toList(),
  );

  Future<Uint8List> pdfLicenca(String codigo) =>
      api.bytes('/public/licencas/${Uri.encodeComponent(codigo)}/pdf');

  Future<Uint8List> pdfDecisao(String codigo) =>
      api.bytes('/public/processos/${Uri.encodeComponent(codigo)}/decisao.pdf');

  /// O token de uma sessão de chat já ligada a esta pessoa.
  Future<Json> novaSessaoChat() async =>
      obj(await api.post('/app/chat/sessoes', corpo: {'idioma': 'pt-PT'}));
}
