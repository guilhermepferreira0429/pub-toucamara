import '../comum/localizacao/localizacao.dart';

double? _num(dynamic v) => v is num ? v.toDouble() : null;
String? _txt(dynamic v) => v?.toString();
List<Map<String, dynamic>> _lista(dynamic v) => v is List
    ? v.whereType<Map>().map((e) => e.cast<String, dynamic>()).toList()
    : const [];

enum TipoTarefa { visita, ocorrencia }

/// Uma linha de "Hoje" (`GET /v1/painel/equipa/hoje`).
class Tarefa {
  const Tarefa({
    required this.tipo,
    required this.id,
    required this.numero,
    required this.titulo,
    required this.resumo,
    required this.morada,
    this.lat,
    this.lng,
    required this.estado,
    required this.estadoNome,
    required this.feita,
    this.atrasada = false,
    this.dia,
    this.janela,
    this.referencia,
    this.reportes = 1,
    this.fotos = 0,
    this.distanciaM,
  });

  final TipoTarefa tipo;
  final String id;
  final String numero;
  final String titulo;
  final String resumo;
  final String morada;
  final double? lat;
  final double? lng;
  final String estado;
  final String estadoNome;
  final bool feita;
  final bool atrasada;
  final String? dia;
  final String? janela;
  final String? referencia;
  final int reportes;
  final int fotos;
  final double? distanciaM;

  bool get temLocal => lat != null && lng != null;
  Ponto? get ponto => temLocal ? Ponto(lat!, lng!) : null;

  factory Tarefa.deJson(Map<String, dynamic> j) => Tarefa(
    tipo: j['tipo'] == 'visita' ? TipoTarefa.visita : TipoTarefa.ocorrencia,
    id: j['id'] as String,
    numero: _txt(j['numero']) ?? '',
    titulo: _txt(j['titulo']) ?? '',
    resumo: _txt(j['resumo']) ?? '',
    morada: _txt(j['morada']) ?? 'Sem morada',
    lat: _num(j['lat']),
    lng: _num(j['lng']),
    estado: _txt(j['estado']) ?? '',
    estadoNome: _txt(j['estado_nome']) ?? _txt(j['estado']) ?? '',
    feita: j['feita'] == true,
    atrasada: j['atrasada'] == true,
    dia: _txt(j['dia']),
    janela: _txt(j['janela']),
    referencia: _txt(j['referencia']),
    reportes: (j['reportes'] as num?)?.toInt() ?? 1,
    fotos: (j['fotos'] as num?)?.toInt() ?? 0,
    distanciaM: _num(j['distancia_m']),
  );

  Tarefa comDistancia(double? d) => Tarefa(
    tipo: tipo,
    id: id,
    numero: numero,
    titulo: titulo,
    resumo: resumo,
    morada: morada,
    lat: lat,
    lng: lng,
    estado: estado,
    estadoNome: estadoNome,
    feita: feita,
    atrasada: atrasada,
    dia: dia,
    janela: janela,
    referencia: referencia,
    reportes: reportes,
    fotos: fotos,
    distanciaM: d,
  );
}

/// Por fazer primeiro, da mais perto para a mais longe (sem coordenadas no
/// fim das por fazer); depois as feitas. Sem localização, pelo número. As
/// mesmas regras da API (`equipa-campo/regras.ts`), para reordenar com a
/// localização atual mesmo sem rede.
List<Tarefa> ordenarPorProximidade(List<Tarefa> tarefas, Ponto? origem) {
  final l = [
    for (final t in tarefas)
      t.comDistancia(
        origem != null && t.ponto != null
            ? distanciaMetros(origem, t.ponto!)
            : null,
      ),
  ];
  l.sort((a, b) {
    if (a.feita != b.feita) return a.feita ? 1 : -1;
    final da = a.distanciaM ?? double.infinity;
    final db = b.distanciaM ?? double.infinity;
    if (da != db) return da.compareTo(db);
    return a.numero.compareTo(b.numero);
  });
  return l;
}

/// O dia de trabalho, com de onde veio (API ou cache sem rede).
class DiaDeTrabalho {
  const DiaDeTrabalho({
    required this.dia,
    required this.tarefas,
    required this.obtidoEm,
    this.daCache = false,
    this.mostraVisitas = true,
    this.mostraOcorrencias = true,
  });

  final String dia;
  final List<Tarefa> tarefas;
  final DateTime obtidoEm;
  final bool daCache;
  final bool mostraVisitas;
  final bool mostraOcorrencias;

  int get porFazer => tarefas.where((t) => !t.feita).length;

  factory DiaDeTrabalho.deJson(
    Map<String, dynamic> j, {
    required DateTime obtidoEm,
    bool daCache = false,
  }) {
    final mostra = (j['mostra'] as Map?) ?? const {};
    return DiaDeTrabalho(
      dia: _txt(j['dia']) ?? '',
      tarefas: _lista(j['tarefas']).map(Tarefa.deJson).toList(),
      obtidoEm: obtidoEm,
      daCache: daCache,
      mostraVisitas: mostra['visitas'] != false,
      mostraOcorrencias: mostra['ocorrencias'] != false,
    );
  }
}

/// Um ponto da checklist da visita.
class ItemChecklist {
  ItemChecklist({
    required this.chave,
    required this.rotulo,
    this.conformeSe,
    this.artigo,
    this.resposta,
    this.nota,
  });
  final String chave;
  final String rotulo;
  final String? conformeSe;
  final String? artigo;
  String? resposta;
  String? nota;

  factory ItemChecklist.deJson(Map<String, dynamic> j) => ItemChecklist(
    chave: j['chave'] as String,
    rotulo: _txt(j['rotulo']) ?? '',
    conformeSe: _txt(j['conforme_se']),
    artigo: _txt(j['artigo']),
    resposta: _txt(j['resposta']),
    nota: _txt(j['nota']),
  );

  Map<String, dynamic> paraResposta() => {
    'chave': chave,
    'resposta': resposta,
    if (nota != null && nota!.trim().isNotEmpty) 'nota': nota!.trim(),
  };

  /// Respondido ao contrário do que está bem (vai dar infração).
  bool get naoConforme =>
      conformeSe != null &&
      resposta != null &&
      resposta != 'na' &&
      resposta != conformeSe;
}

/// Uma fotografia vinda da API (a URL assinada pode faltar sem S3).
class FotoApi {
  const FotoApi({required this.id, this.url, this.legenda, this.origem});
  final String id;
  final String? url;
  final String? legenda;
  final String? origem;

  factory FotoApi.deJson(Map<String, dynamic> j) => FotoApi(
    id: j['id'] as String,
    url: _txt(j['url']),
    legenda: _txt(j['legenda']),
    origem: _txt(j['origem']),
  );
}

/// `GET /v1/painel/fiscalizacao/visitas/:id`.
class VisitaDetalhe {
  VisitaDetalhe(this.j);
  final Map<String, dynamic> j;

  String get id => j['id'] as String;
  String get numero => _txt(j['numero']) ?? '';
  String get tipoNome => _txt(j['tipo_nome']) ?? '';
  String get estado => _txt(j['estado']) ?? '';
  String get estadoNome => _txt(j['estado_nome']) ?? estado;
  String get morada => _txt(j['morada']) ?? '';
  double? get lat => _num(j['lat']);
  double? get lng => _num(j['lng']);
  String get motivo => _txt(j['motivo']) ?? '';
  String? get dia => _txt(j['dia']);
  String? get janela => j['janela_inicio'] != null && j['janela_fim'] != null
      ? '${j['janela_inicio']}–${j['janela_fim']}'
      : null;
  bool get aberta => estado == 'por_agendar' || estado == 'agendada';
  bool get feita => estado == 'feita';
  bool get valoresDemonstracao => j['valores_demonstracao'] == true;
  List<ItemChecklist> get checklist =>
      _lista(j['checklist']).map(ItemChecklist.deJson).toList();
  List<FotoApi> get fotos => _lista(j['fotos']).map(FotoApi.deJson).toList();
  Map<String, dynamic>? get relatorio =>
      (j['relatorio'] as Map?)?.cast<String, dynamic>();
  String? get transcricao => _txt(relatorio?['transcricao']);
  bool get relatorioFechado => relatorio?['fechado_em'] != null;
  String? get conclusaoNome => _txt(relatorio?['conclusao_nome']);
  String? get resumoRelatorio =>
      _txt((relatorio?['estruturado'] as Map?)?['resumo']);
  Map<String, dynamic>? get ocorrencia =>
      (j['ocorrencia'] as Map?)?.cast<String, dynamic>();
  Map<String, dynamic>? get processo =>
      (j['processo'] as Map?)?.cast<String, dynamic>();
}

/// `GET /v1/painel/ocorrencias/:id`.
class OcorrenciaDetalhe {
  OcorrenciaDetalhe(this.j);
  final Map<String, dynamic> j;

  String get id => j['id'] as String;
  String get numero => _txt(j['numero']) ?? '';
  String get estado => _txt(j['estado']) ?? '';
  String get categoria => _txt(j['categoria']) ?? '';
  String get descricao => _txt(j['descricao']) ?? '';
  String get morada => _txt(j['morada']) ?? '';
  double? get lat => _num(j['lat']);
  double? get lng => _num(j['lng']);
  String? get previstaPara => _txt(j['prevista_para']);
  String? get servico => _txt(j['servico']);
  String? get municipeNome => _txt(j['municipe_nome']);
  int get reportes => (j['reportes'] as num?)?.toInt() ?? 1;
  bool get aberta => estado == 'nova' || estado == 'com_equipa';
  bool get duplicada => j['duplicada_de'] != null;
  List<FotoApi> get fotos => _lista(j['fotos']).map(FotoApi.deJson).toList();
  List<FotoApi> get fotosMunicipe =>
      fotos.where((f) => f.origem != 'equipa').toList();
  List<FotoApi> get fotosDepois =>
      fotos.where((f) => f.origem == 'equipa').toList();
  List<Map<String, dynamic>> get duplicados => _lista(j['duplicados']);
  List<Map<String, dynamic>> get eventos => _lista(j['eventos']);

  String get estadoNome => nomeEstadoOcorrencia(estado);
}

String nomeEstadoOcorrencia(String e) =>
    const {
      'nova': 'Nova',
      'com_equipa': 'Com a equipa',
      'resolvida': 'Resolvida',
      'rejeitada': 'Rejeitada',
      'duplicada': 'Duplicada',
    }[e] ??
    e;
