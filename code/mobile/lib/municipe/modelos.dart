/// As respostas da API que a app do munícipe usa (`/v1/app/*`,
/// `/v1/public/agora/*`, `/v1/public/ocorrencias/:token`). A leitura é
/// tolerante: um campo que falte não deita o ecrã abaixo.
library;

typedef Json = Map<String, dynamic>;

Json obj(Object? v) =>
    v is Map ? v.cast<String, dynamic>() : <String, dynamic>{};
List<Json> listaDe(Object? v) =>
    v is List ? v.map(obj).toList() : const <Json>[];
String? txt(Object? v) {
  if (v == null) return null;
  final s = '$v'.trim();
  return s.isEmpty ? null : s;
}

double? numero(Object? v) => v is num ? v.toDouble() : double.tryParse('$v');
int? inteiro(Object? v) => v is num ? v.toInt() : int.tryParse('$v');
DateTime? data(Object? v) => v == null ? null : DateTime.tryParse('$v');
bool sim(Object? v) => v == true;

/// "12,34 €".
String euros(int cent) {
  final e = cent ~/ 100;
  final c = (cent % 100).toString().padLeft(2, '0');
  final milhares = e.toString().replaceAllMapped(
    RegExp(r'\B(?=(\d{3})+(?!\d))'),
    (_) => ' ',
  );
  return '$milhares,$c €';
}

// ---------------------------------------------------------------------
// A pessoa
// ---------------------------------------------------------------------

class Eu {
  const Eu({
    required this.nome,
    required this.telefone,
    required this.avisos,
    required this.processos,
    this.zona,
  });
  final String? nome;
  final String telefone;

  /// Os tipos de notificação (os urgentes não se desligam).
  final bool avisos;
  final bool processos;
  final String? zona;

  factory Eu.deJson(Json j) {
    final p = obj(j['preferencias']);
    final t = obj(p['tipos']);
    final z = obj(p['zona']);
    return Eu(
      nome: txt(j['nome']),
      telefone: txt(j['telefone']) ?? '',
      avisos: t['avisos'] != false,
      processos: t['processos'] != false,
      zona: txt(z['morada']) ?? txt(z['freguesia']),
    );
  }
}

// ---------------------------------------------------------------------
// "O que se passa perto de mim" (feed)
// ---------------------------------------------------------------------

enum TipoItem { obras, incidentes, avisos, eventos, consultas }

const nomesTipo = {
  TipoItem.obras: 'Obras e cortes',
  TipoItem.incidentes: 'Incidentes',
  TipoItem.avisos: 'Avisos',
  TipoItem.eventos: 'Eventos',
  TipoItem.consultas: 'Consultas públicas',
};

/// Os tipos que se podem pedir em "Avisar-me" (as consultas não).
const tiposSubscricao = [
  TipoItem.obras,
  TipoItem.incidentes,
  TipoItem.eventos,
  TipoItem.avisos,
];

const fonteDita = {
  'licenca': 'Licença emitida pela câmara',
  'aviso_zona': 'Aviso da câmara aos moradores da zona',
  'emergencia': 'Alerta da Proteção Civil municipal',
  'ocorrencia': 'Problema comunicado à câmara (sem dados de quem o comunicou)',
  'comunicado': 'Comunicado da câmara',
  'evento': 'Agenda da câmara',
  'consulta_publica': 'Consulta pública da câmara',
};

class ItemAgora {
  const ItemAgora({
    required this.id,
    required this.tipo,
    required this.fonte,
    required this.etiqueta,
    required this.titulo,
    required this.resumo,
    required this.publicadoEm,
    required this.link,
    this.inicio,
    this.fim,
    this.lat,
    this.lng,
    this.raioM,
    this.freguesia,
    this.rua,
    this.todoConcelho = false,
    this.gravidade,
    this.distanciaM,
  });

  final String id;
  final TipoItem tipo;
  final String fonte;
  final String etiqueta;
  final String titulo;
  final String resumo;
  final DateTime? inicio;
  final DateTime? fim;
  final DateTime publicadoEm;
  final double? lat;
  final double? lng;
  final int? raioM;
  final String? freguesia;
  final String? rua;
  final bool todoConcelho;
  final String? gravidade;
  final String link;
  final double? distanciaM;

  bool get emergencia => fonte == 'emergencia' || gravidade == 'emergencia';
  bool get temLocal => lat != null && lng != null;

  /// "Rua Direita · Azurém", "Todo o concelho".
  String? get onde {
    final p = {rua, freguesia}.whereType<String>().where((x) => x.isNotEmpty);
    if (p.isNotEmpty) return p.join(' · ');
    return todoConcelho ? 'Todo o concelho' : null;
  }

  /// Publicado há menos de 48 h.
  bool novo([DateTime? agora]) {
    final d = (agora ?? DateTime.now()).difference(publicadoEm);
    return d.inMinutes >= -1 && d.inHours < 48;
  }

  factory ItemAgora.deJson(Json j) => ItemAgora(
    id: '${j['id']}',
    tipo: TipoItem.values.asNameMap()[j['tipo']] ?? TipoItem.avisos,
    fonte: txt(j['fonte']) ?? '',
    etiqueta: txt(j['etiqueta']) ?? '',
    titulo: txt(j['titulo']) ?? '',
    resumo: txt(j['resumo']) ?? '',
    inicio: data(j['inicio']),
    fim: data(j['fim']),
    publicadoEm: data(j['publicado_em']) ?? DateTime.now(),
    lat: numero(j['lat']),
    lng: numero(j['lng']),
    raioM: inteiro(j['raio_m']),
    freguesia: txt(j['freguesia']),
    rua: txt(j['rua']),
    todoConcelho: sim(j['todo_concelho']),
    gravidade: txt(j['gravidade']),
    link: txt(j['link']) ?? '',
    distanciaM: numero(j['distancia_m']),
  );
}

class Feed {
  const Feed({
    required this.itens,
    required this.total,
    required this.freguesias,
    required this.nota,
    this.municipio,
    this.raioM,
  });
  final List<ItemAgora> itens;
  final int total;
  final List<String> freguesias;
  final String? nota;
  final String? municipio;

  /// O raio usado, quando se pediu "perto de mim".
  final int? raioM;

  /// As emergências primeiro (a ordem da API decide o resto).
  List<ItemAgora> get ordenados => [
    ...itens.where((i) => i.emergencia),
    ...itens.where((i) => !i.emergencia),
  ];

  factory Feed.deJson(Json j) => Feed(
    itens: listaDe(j['itens']).map(ItemAgora.deJson).toList(),
    total: inteiro(j['total']) ?? 0,
    freguesias: (j['freguesias'] as List?)?.map((e) => '$e').toList() ?? [],
    nota: txt(obj(j['parametros'])['nota']),
    municipio: txt(obj(j['municipio'])['nome']),
    raioM: inteiro(obj(j['filtro'])['raio_m']),
  );
}

class DetalheAgora {
  const DetalheAgora({required this.item, this.texto, this.quando});
  final ItemAgora item;
  final String? texto;
  final String? quando;

  factory DetalheAgora.deJson(Json j) => DetalheAgora(
    item: ItemAgora.deJson(obj(j['item'])),
    texto: txt(j['texto']),
    quando: txt(j['quando']),
  );
}

class Subscricao {
  const Subscricao({required this.id, required this.zona, required this.tipos});
  final String id;
  final String zona;
  final List<String> tipos;
  factory Subscricao.deJson(Json j) => Subscricao(
    id: '${j['id']}',
    zona: txt(j['zona']) ?? '',
    tipos: (j['tipos_ditos'] as List?)?.map((e) => '$e').toList() ?? [],
  );
}

// ---------------------------------------------------------------------
// Os meus assuntos
// ---------------------------------------------------------------------

class ProcessoResumo {
  const ProcessoResumo({
    required this.id,
    required this.numero,
    required this.tipo,
    required this.assunto,
    required this.faseRotulo,
    this.prazoFim,
    this.ultimoEvento,
    this.atualizadoEm,
  });
  final String id;
  final String numero;
  final String tipo;
  final String assunto;
  final String faseRotulo;
  final String? prazoFim;
  final String? ultimoEvento;
  final DateTime? atualizadoEm;

  factory ProcessoResumo.deJson(Json j) => ProcessoResumo(
    id: '${j['id']}',
    numero: txt(j['numero']) ?? '',
    tipo: txt(j['tipo']) ?? '',
    assunto: txt(j['assunto']) ?? '',
    faseRotulo: txt(j['fase_rotulo']) ?? txt(j['fase']) ?? '',
    prazoFim: txt(j['prazo_fim']),
    ultimoEvento: txt(obj(j['ultimo_evento'])['descricao']),
    atualizadoEm: data(j['atualizado_em']),
  );
}

class EventoProcesso {
  const EventoProcesso(this.em, this.descricao);
  final DateTime? em;
  final String descricao;
}

class DocumentoEmFalta {
  const DocumentoEmFalta(this.nome, this.prazo);
  final String nome;
  final String? prazo;
}

class Processo {
  const Processo({
    required this.id,
    required this.numero,
    required this.tipo,
    required this.assunto,
    required this.fase,
    required this.faseRotulo,
    required this.faseEmPalavras,
    required this.linhaDoTempo,
    required this.emFalta,
    this.decisao,
    this.prazoFim,
    this.diasUteisRestantes,
    this.prazoAContar = true,
    this.pagamento,
    this.link,
    this.codigo,
    this.decisaoPdf = false,
  });

  final String id;
  final String numero;
  final String tipo;
  final String assunto;
  final String fase;
  final String faseRotulo;
  final String? faseEmPalavras;
  final String? decisao;
  final String? prazoFim;
  final int? diasUteisRestantes;
  final bool prazoAContar;
  final List<EventoProcesso> linhaDoTempo;

  /// "O que falta" da parte da pessoa.
  final List<DocumentoEmFalta> emFalta;
  final Json? pagamento;

  /// A página "O seu processo" (link curto), para o que a app não mostra.
  final String? link;

  /// O código do link curto (para o PDF da decisão).
  final String? codigo;
  final bool decisaoPdf;

  factory Processo.deJson(Json j) {
    final prazo = obj(j['prazo']);
    final docs = obj(j['documentos']);
    final pg = j['pagamento'] is Map ? obj(j['pagamento']) : null;
    return Processo(
      id: '${j['id']}',
      numero: txt(j['numero']) ?? '',
      tipo: txt(j['tipo']) ?? '',
      assunto: txt(j['assunto']) ?? '',
      fase: txt(j['fase']) ?? '',
      faseRotulo: txt(j['fase_rotulo']) ?? '',
      faseEmPalavras: txt(j['fase_em_palavras']),
      decisao: txt(j['decisao']),
      prazoFim: txt(prazo['fim']),
      diasUteisRestantes: inteiro(prazo['dias_uteis_restantes']),
      prazoAContar: prazo['a_contar'] != false,
      linhaDoTempo: [
        for (final e in listaDe(j['linha_do_tempo']))
          EventoProcesso(data(e['em']), txt(e['descricao']) ?? ''),
      ],
      emFalta: [
        for (final d in listaDe(docs['em_falta']))
          DocumentoEmFalta(txt(d['nome']) ?? 'Documento', txt(d['prazo'])),
      ],
      pagamento: pg,
      link: txt(j['link']),
      codigo: txt(j['codigo']),
      decisaoPdf: sim(j['decisao_pdf']),
    );
  }
}

class Licenca {
  const Licenca({
    required this.id,
    required this.tipoNome,
    required this.estado,
    required this.processoNumero,
    required this.codigo,
    required this.link,
    this.validaAte,
    this.data,
    this.morada,
    this.taxaCent,
    this.motivoRecusa,
  });
  final String id;
  final String tipoNome;
  final String estado;
  final String processoNumero;
  final String codigo;
  final String link;
  final String? validaAte;
  final String? data;
  final String? morada;
  final int? taxaCent;
  final String? motivoRecusa;

  String get estadoDito =>
      const {
        'a_pagar': 'À espera do pagamento',
        'por_aprovar': 'Em análise',
        'para_tecnico': 'Com um técnico',
        'emitida': 'Emitida',
        'recusada': 'Recusada',
      }[estado] ??
      estado.replaceAll('_', ' ');

  bool get valida => estado == 'emitida';

  factory Licenca.deJson(Json j) => Licenca(
    id: '${j['id']}',
    tipoNome: txt(j['tipo_nome']) ?? txt(j['tipo']) ?? 'Licença',
    estado: txt(j['estado']) ?? '',
    processoNumero: txt(j['processo_numero']) ?? '',
    codigo: txt(j['codigo']) ?? '',
    link: txt(j['link']) ?? '',
    validaAte: txt(j['valida_ate']),
    data: txt(j['data']),
    morada: txt(j['morada']),
    taxaCent: inteiro(j['taxa_cent']),
    motivoRecusa: txt(j['motivo_recusa']),
  );
}

class Pagamento {
  const Pagamento({
    required this.id,
    required this.estado,
    required this.valorCent,
    this.metodo,
    this.entidade,
    this.referencia,
    this.pagarAte,
    this.pagoEm,
    this.modoTeste = false,
    this.processoNumero,
    this.processoId,
    this.guia,
    this.link,
  });
  final String id;
  final String estado;
  final int valorCent;
  final String? metodo;
  final String? entidade;
  final String? referencia;
  final String? pagarAte;
  final DateTime? pagoEm;
  final bool modoTeste;
  final String? processoNumero;
  final String? processoId;
  final String? guia;

  /// A página de pagar (MB WAY, referência), só quando está por pagar.
  final String? link;

  bool get pendente => estado == 'pendente';

  String get estadoDito =>
      const {
        'pendente': 'Por pagar',
        'pago': 'Pago',
        'expirado': 'Expirado',
        'cancelado': 'Cancelado',
        'falhado': 'Falhou',
      }[estado] ??
      estado;

  /// "123 456 789".
  String? get referenciaDita =>
      referencia?.replaceAllMapped(RegExp(r'(\d{3})(?=\d)'), (m) => '${m[1]} ');

  factory Pagamento.deJson(Json j) => Pagamento(
    id: '${j['id']}',
    estado: txt(j['estado']) ?? '',
    valorCent: inteiro(j['valor_cent']) ?? 0,
    metodo: txt(j['metodo']),
    entidade: txt(j['mb_entidade']),
    referencia: txt(j['mb_referencia']),
    pagarAte: txt(j['pagar_ate']),
    pagoEm: data(j['pago_em']),
    modoTeste: sim(j['modo_teste']),
    processoNumero: txt(j['processo_numero']),
    processoId: txt(j['processo_id']),
    guia: txt(j['guia_numero']),
    link: txt(j['link']),
  );
}

class Marcacao {
  const Marcacao({
    required this.id,
    required this.servico,
    required this.inicio,
    required this.estado,
    required this.futura,
    this.fim,
    this.local,
    this.assunto,
    this.levar = const [],
    this.link,
    this.recolha = false,
  });
  final String id;
  final String servico;
  final DateTime? inicio;
  final DateTime? fim;
  final String? local;
  final String? assunto;
  final List<String> levar;
  final String estado;
  final bool futura;
  final String? link;

  /// Recolha de monos/verdes (não é atendimento).
  final bool recolha;

  String get estadoDito =>
      const {
        'marcada': 'Marcada',
        'cancelada': 'Cancelada',
        'feita': 'Feita',
        'compareceu': 'Feita',
        'faltou': 'Faltou',
        'agendada': 'Agendada',
        'recolhida': 'Recolhida',
      }[estado] ??
      estado;

  factory Marcacao.deJson(Json j) => Marcacao(
    id: '${j['id']}',
    servico: txt(j['servico']) ?? 'Atendimento',
    inicio: data(j['inicio']),
    fim: data(j['fim']),
    local: txt(j['local']),
    assunto: txt(j['assunto']),
    levar: (j['levar'] as List?)?.map((e) => '$e').toList() ?? const [],
    estado: txt(j['estado']) ?? '',
    futura: sim(j['futura']),
    link: txt(j['link']),
  );

  factory Marcacao.deRecolha(Json j) {
    final inicio = data(j['inicio']);
    return Marcacao(
      id: '${j['id']}',
      servico: 'Recolha de objetos',
      inicio: inicio,
      fim: data(j['fim']),
      local: txt(j['morada']),
      estado: txt(j['estado']) ?? '',
      futura: inicio != null && inicio.isAfter(DateTime.now()),
      recolha: true,
    );
  }
}

class Reclamacao {
  const Reclamacao({
    required this.numero,
    required this.estadoRotulo,
    required this.descricao,
    required this.recebidaEm,
    required this.responderAte,
    this.servico,
    this.resposta,
    this.link,
  });
  final String numero;
  final String estadoRotulo;
  final String descricao;
  final String recebidaEm;
  final String responderAte;
  final String? servico;
  final String? resposta;
  final String? link;

  factory Reclamacao.deJson(Json j) => Reclamacao(
    numero: txt(j['numero']) ?? '',
    estadoRotulo: txt(j['estado_rotulo']) ?? txt(j['estado']) ?? '',
    descricao: txt(j['descricao']) ?? '',
    recebidaEm: txt(j['recebida_em']) ?? '',
    responderAte: txt(j['responder_ate']) ?? '',
    servico: txt(j['servico_visado']),
    resposta: txt(j['resposta']),
    link: txt(j['link']),
  );
}

class OcorrenciaMinha {
  const OcorrenciaMinha({
    required this.numero,
    required this.categoria,
    required this.descricao,
    required this.morada,
    required this.estado,
    required this.estadoExplicado,
    required this.token,
    this.juntadaAOutra = false,
    this.criadaEm,
    this.link,
  });
  final String numero;
  final String categoria;
  final String descricao;
  final String morada;
  final String estado;
  final String estadoExplicado;
  final String token;
  final bool juntadaAOutra;
  final DateTime? criadaEm;
  final String? link;

  bool get resolvida => estado == 'resolvida';

  factory OcorrenciaMinha.deJson(Json j) => OcorrenciaMinha(
    numero: txt(j['numero']) ?? '',
    categoria: txt(j['categoria']) ?? '',
    descricao: txt(j['descricao']) ?? '',
    morada: txt(j['morada']) ?? '',
    estado: txt(j['estado']) ?? '',
    estadoExplicado: txt(j['estado_explicado']) ?? '',
    token: txt(j['token']) ?? '',
    juntadaAOutra: sim(j['juntada_a_outra']),
    criadaEm: data(j['criada_em']),
    link: txt(j['link']),
  );
}

class FotoOcorrencia {
  const FotoOcorrencia({required this.id, required this.origem, this.url});
  final String id;

  /// 'municipe' (quem reportou) ou 'equipa' (a foto do depois).
  final String origem;
  final String? url;
  bool get daEquipa => origem != 'municipe';
}

class OcorrenciaDetalhe {
  const OcorrenciaDetalhe({
    required this.numero,
    required this.categoria,
    required this.descricao,
    required this.morada,
    required this.estado,
    required this.estadoExplicado,
    required this.fotos,
  });
  final String numero;
  final String categoria;
  final String descricao;
  final String morada;
  final String estado;
  final String estadoExplicado;
  final List<FotoOcorrencia> fotos;

  factory OcorrenciaDetalhe.deJson(Json j) => OcorrenciaDetalhe(
    numero: txt(j['numero']) ?? '',
    categoria: txt(j['categoria']) ?? '',
    descricao: txt(j['descricao']) ?? '',
    morada: txt(j['morada']) ?? '',
    estado: txt(j['estado']) ?? '',
    estadoExplicado: txt(j['estado_explicado']) ?? '',
    fotos: [
      for (final f in listaDe(j['fotos']))
        FotoOcorrencia(
          id: '${f['id']}',
          origem: txt(f['origem']) ?? 'municipe',
          url: txt(f['url']),
        ),
    ],
  );
}

class Categoria {
  const Categoria(this.nome, [this.icone]);
  final String nome;
  final String? icone;
}

/// A resposta de reportar (`POST /v1/app/ocorrencias`).
class OcorrenciaRegistada {
  const OcorrenciaRegistada({
    required this.numero,
    required this.duplicada,
    required this.mensagem,
    this.token,
    this.link,
  });
  final String numero;

  /// Já estava reportada: "Já sabemos".
  final bool duplicada;
  final String mensagem;
  final String? token;
  final String? link;

  factory OcorrenciaRegistada.deJson(Json j) => OcorrenciaRegistada(
    numero: txt(j['numero']) ?? '',
    duplicada: sim(j['duplicada']),
    mensagem: txt(j['mensagem']) ?? 'Ocorrência registada.',
    token: txt(j['token']),
    link: txt(j['link']),
  );
}

// ---------------------------------------------------------------------
// Avisos recebidos
// ---------------------------------------------------------------------

class Aviso {
  const Aviso({
    required this.id,
    required this.origem,
    required this.titulo,
    required this.mensagem,
    required this.zona,
    required this.urgente,
    required this.ativo,
    this.instrucoes,
    this.em,
    this.link,
  });
  final String id;
  final String origem;
  final String titulo;
  final String mensagem;
  final String? instrucoes;
  final String zona;
  final DateTime? em;
  final bool urgente;
  final bool ativo;
  final String? link;

  factory Aviso.deJson(Json j) => Aviso(
    id: '${j['id']}',
    origem: txt(j['origem']) ?? '',
    titulo: txt(j['titulo']) ?? 'Aviso',
    mensagem: txt(j['mensagem']) ?? '',
    instrucoes: txt(j['instrucoes']),
    zona: txt(j['zona']) ?? '',
    em: data(j['em']),
    urgente: sim(j['urgente']),
    ativo: j['ativo'] != false,
    link: txt(j['link']),
  );
}
