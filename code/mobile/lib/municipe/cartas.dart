import 'dart:convert';
import 'dart:typed_data';

import '../comum/api/cliente_api.dart';
import 'modelos.dart';

/// "Não percebi esta carta da câmara": a carta lida pela API
/// (`/v1/app/cartas` e `/v1/public/cartas/:codigo`, módulo `cartas`).
class Carta {
  const Carta({
    required this.codigo,
    required this.link,
    required this.estado,
    required this.demonstracao,
    this.leitura,
    this.prazo,
    this.perguntaRececao = false,
    this.processo,
    this.encaminhamento,
    this.respostasPossiveis = const [],
    this.respostas = const [],
    this.aviso,
  });

  final String codigo;
  final String link;

  /// a_espera | lida | ilegivel | respondida
  final String estado;
  final bool demonstracao;
  final LeituraCarta? leitura;
  final PrazoCarta? prazo;
  final bool perguntaRececao;
  final ({String numero, String assunto, String fase})? processo;
  final ({String entidade, String dizer})? encaminhamento;
  final List<({String tipo, String rotulo})> respostasPossiveis;
  final List<RespostaCarta> respostas;
  final String? aviso;

  bool get daCamara => leitura?.daCamara ?? true;

  factory Carta.deJson(Json j) {
    final p = obj(j['processo']);
    final e = obj(j['encaminhamento']);
    return Carta(
      codigo: txt(j['codigo']) ?? '',
      link: txt(j['link']) ?? '',
      estado: txt(j['estado']) ?? 'a_espera',
      demonstracao: sim(j['demonstracao']),
      leitura: j['leitura'] is Map
          ? LeituraCarta.deJson(obj(j['leitura']))
          : null,
      prazo: j['prazo'] is Map ? PrazoCarta.deJson(obj(j['prazo'])) : null,
      perguntaRececao: sim(j['pergunta_rececao']),
      processo: txt(p['numero']) == null
          ? null
          : (
              numero: txt(p['numero'])!,
              assunto: txt(p['assunto']) ?? '',
              fase: txt(p['fase_em_palavras']) ?? '',
            ),
      encaminhamento: txt(e['entidade']) == null
          ? null
          : (entidade: txt(e['entidade'])!, dizer: txt(e['dizer']) ?? ''),
      respostasPossiveis: [
        for (final r in listaDe(j['respostas_possiveis']))
          (tipo: txt(r['tipo']) ?? '', rotulo: txt(r['rotulo']) ?? ''),
      ],
      respostas: listaDe(j['respostas']).map(RespostaCarta.deJson).toList(),
      aviso: txt(j['aviso']),
    );
  }
}

class LeituraCarta {
  const LeituraCarta({
    required this.daCamara,
    required this.tipoRotulo,
    required this.assunto,
    required this.explicacao,
    required this.oQueE,
    this.entidade,
    this.referencia,
    this.excertoPrazo,
    this.pedido = const [],
    this.consequencias = const [],
    this.termos = const [],
    this.motivoIlegivel,
  });
  final bool daCamara;
  final String tipoRotulo;
  final String assunto;
  final String explicacao;
  final String oQueE;
  final String? entidade;
  final String? referencia;
  final String? excertoPrazo;
  final List<String> pedido;

  /// (texto, da carta?) — as da regra geral dizem que a carta não o diz.
  final List<({String texto, bool daCarta})> consequencias;
  final List<({String termo, String explicacao})> termos;
  final String? motivoIlegivel;

  factory LeituraCarta.deJson(Json j) => LeituraCarta(
    daCamara: j['da_camara'] != false,
    tipoRotulo: txt(j['tipo_rotulo']) ?? 'Carta da câmara',
    assunto: txt(j['assunto']) ?? '',
    explicacao: txt(j['explicacao']) ?? '',
    oQueE: txt(j['o_que_e']) ?? '',
    entidade: txt(j['entidade_emissora']),
    referencia: txt(obj(j['referencia'])['valor']),
    excertoPrazo: txt(obj(j['prazo_lido'])['excerto']),
    pedido: [
      for (final p in listaDe(j['pedido']))
        if (txt(p['o_que']) != null) txt(p['o_que'])!,
    ],
    consequencias: [
      for (final c in listaDe(j['consequencias']))
        if (txt(c['texto']) != null)
          (texto: txt(c['texto'])!, daCarta: c['origem'] == 'carta'),
    ],
    termos: [
      for (final t in listaDe(j['termos']))
        (termo: txt(t['termo']) ?? '', explicacao: txt(t['explicacao']) ?? ''),
    ],
    motivoIlegivel: txt(j['motivo_ilegivel']),
  );
}

class PrazoCarta {
  const PrazoCarta({
    required this.estado,
    this.dataLimite,
    this.faltamDiasUteis,
    this.faltamDias,
    this.terminou = false,
    this.regra = '',
    this.dias,
    this.unidade,
  });

  /// calculado | sem_prazo | falta_data
  final String estado;
  final String? dataLimite;
  final int? faltamDiasUteis;
  final int? faltamDias;
  final bool terminou;
  final String regra;
  final int? dias;
  final String? unidade;

  bool get calculado => estado == 'calculado' && dataLimite != null;

  factory PrazoCarta.deJson(Json j) => PrazoCarta(
    estado: txt(j['estado']) ?? 'sem_prazo',
    dataLimite: txt(j['data_limite']),
    faltamDiasUteis: inteiro(j['faltam_dias_uteis']),
    faltamDias: inteiro(j['faltam_dias']),
    terminou: sim(j['terminou']),
    regra: txt(j['regra']) ?? '',
    dias: inteiro(j['dias']),
    unidade: txt(j['unidade']),
  );
}

class RespostaCarta {
  const RespostaCarta({
    required this.id,
    required this.tipo,
    required this.rotulo,
    required this.texto,
    required this.estado,
    this.numeroEntrada,
  });
  final String id;
  final String tipo;
  final String rotulo;
  final String texto;
  final String estado;
  final String? numeroEntrada;

  bool get entregue => estado == 'entregue';

  factory RespostaCarta.deJson(Json j) => RespostaCarta(
    id: txt(j['id']) ?? '',
    tipo: txt(j['tipo']) ?? '',
    rotulo: txt(j['rotulo']) ?? '',
    texto: txt(j['texto']) ?? '',
    estado: txt(j['estado']) ?? 'rascunho',
    numeroEntrada: txt(j['numero_entrada']),
  );
}

/// Uma carta da lista "as suas cartas".
class CartaResumo {
  const CartaResumo({
    required this.codigo,
    required this.estado,
    this.assunto,
    this.dataLimite,
  });
  final String codigo;
  final String estado;
  final String? assunto;
  final String? dataLimite;

  factory CartaResumo.deJson(Json j) => CartaResumo(
    codigo: txt(j['codigo']) ?? '',
    estado: txt(j['estado']) ?? '',
    assunto: txt(j['assunto']),
    dataLimite: txt(j['data_limite']),
  );
}

/// As chamadas à API das cartas. Ler a carta precisa de rede (a IA lê-a na
/// hora): sem rede, a app diz para tentar depois em vez de pôr na fila.
class ServicoCartas {
  ServicoCartas(this.api);
  final ClienteApi api;

  String _publico(String codigo) =>
      '/public/cartas/${Uri.encodeComponent(codigo)}';

  Future<List<CartaResumo>> minhas() async => listaDe(
    obj(await api.get('/app/cartas'))['itens'],
  ).map(CartaResumo.deJson).toList();

  /// A fotografia (ou o PDF): cria a carta e lê-a.
  Future<Carta> enviar(Uint8List bytes, String mime) async => Carta.deJson(
    obj(
      await api.post(
        '/app/cartas',
        corpo: {'mime': mime, 'ficheiro_base64': base64Encode(bytes)},
      ),
    ),
  );

  /// Sem ficheiro: a carta fica à espera (para enviar o PDF pela página).
  Future<Carta> criarAEspera() async =>
      Carta.deJson(obj(await api.post('/app/cartas', corpo: const {})));

  Future<Carta> ver(String codigo) async => Carta.deJson(
    obj(await api.get('/app/cartas/${Uri.encodeComponent(codigo)}')),
  );

  Future<Carta> rececao(String codigo, DateTime dia) async => Carta.deJson(
    obj(
      await api.post('${_publico(codigo)}/rececao', corpo: {'data': _iso(dia)}),
    ),
  );

  Future<Carta> preparar(
    String codigo,
    String tipo, {
    String? argumentos,
  }) async => Carta.deJson(
    obj(
      obj(
        await api.post(
          '${_publico(codigo)}/respostas',
          corpo: {
            'tipo': tipo,
            if (argumentos != null && argumentos.trim().isNotEmpty)
              'argumentos': argumentos.trim(),
          },
        ),
      )['carta'],
    ),
  );

  Future<Carta> entregar(
    String codigo,
    String respostaId,
  ) async => Carta.deJson(
    obj(
      obj(
        await api.post(
          '${_publico(codigo)}/respostas/${Uri.encodeComponent(respostaId)}/entregar',
        ),
      )['carta'],
    ),
  );
}

String _iso(DateTime d) =>
    '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';
