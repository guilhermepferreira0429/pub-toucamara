import 'package:flutter/material.dart';
import 'package:toucamara_app/comum/api/cliente_api.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:toucamara_app/comum/armazenamento/armazem.dart';
import 'package:toucamara_app/comum/armazenamento/ficheiros.dart';
import 'package:toucamara_app/comum/localizacao/localizacao.dart';
import 'package:toucamara_app/comum/plataforma/ditado.dart';
import 'package:toucamara_app/municipe/notificacoes.dart';
import 'package:toucamara_app/municipe/servicos.dart';

import '../apoio.dart';

/// As respostas da API do munícipe (formas de `code/api/src/modules/app-municipe`).
Map<String, dynamic> respostaEntrarMunicipe() => {
  'token': 'tca_${'a' * 32}',
  'sessao_id': 'sessao-1',
  'municipe': {
    'nome': 'Maria da Conceição Silva',
    'telefone': '+351 9•• ••• 001',
  },
  'municipio': {'slug': 'guimaraes', 'nome': 'Guimarães'},
};

Map<String, dynamic> respostaEu({bool avisos = true}) => {
  'nome': 'Maria da Conceição Silva',
  'telefone': '+351 9•• ••• 001',
  'tem_email': false,
  'municipio': {'slug': 'guimaraes', 'nome': 'Guimarães'},
  'preferencias': {
    'tipos': {'urgente': true, 'avisos': avisos, 'processos': true},
    'zona': null,
  },
  'sugestao_zona': null,
};

Map<String, dynamic> item({
  required String id,
  required String tipo,
  required String fonte,
  required String titulo,
  String? gravidade,
  double? lat = 41.4428,
  double? lng = -8.2937,
  String? rua = 'Rua de Santo António',
}) => {
  'id': id,
  'tipo': tipo,
  'fonte': fonte,
  'etiqueta': '',
  'titulo': titulo,
  'resumo': 'Resumo de $titulo',
  'inicio': '2026-10-20T08:00:00Z',
  'fim': '2026-10-29T18:00:00Z',
  'publicado_em': DateTime.now().toUtc().toIso8601String(),
  'lat': lat,
  'lng': lng,
  'raio_m': 200,
  'poligono': null,
  'freguesia': 'Oliveira, São Paio e São Sebastião',
  'freguesias': null,
  'todo_concelho': false,
  'rua': rua,
  'gravidade': gravidade,
  'link': 'https://toucamara.pt/agora/guimaraes/$tipo/$id',
  'imagem': null,
};

Map<String, dynamic> respostaFeed() => {
  'municipio': {'slug': 'guimaraes', 'nome': 'Guimarães', 'telefone_sms': null},
  'freguesias': ['Azurém'],
  'filtro': {'lat': null, 'lng': null, 'raio_m': null},
  'total': 3,
  'itens': [
    item(
      id: '00000000-0000-0000-0000-000000000001',
      tipo: 'obras',
      fonte: 'aviso_zona',
      titulo: 'Obras na Rua de Santo António',
    ),
    item(
      id: '00000000-0000-0000-0000-000000000002',
      tipo: 'avisos',
      fonte: 'aviso_zona',
      titulo: 'Corte de água urgente',
      gravidade: 'emergencia',
    ),
    item(
      id: '00000000-0000-0000-0000-000000000003',
      tipo: 'eventos',
      fonte: 'evento',
      titulo: 'Feira de São Martinho',
      lat: null,
      lng: null,
      rua: null,
    ),
  ],
  'proximo_cursor': null,
  'link': 'https://toucamara.pt/agora/guimaraes',
  'parametros': {
    'nota': 'Valores de demonstração (raios).',
    'demonstracao': true,
  },
};

const idProcesso = '11111111-1111-1111-1111-111111111111';

Map<String, dynamic> respostaProcessos() => {
  'processos': [
    {
      'id': idProcesso,
      'numero': 'CP 1/2026',
      'tipo': 'Comunicação prévia',
      'assunto': 'Anexo no quintal',
      'fase': 'documentos',
      'fase_rotulo': 'À espera de documentos',
      'decisao': null,
      'prazo_fim': null,
      'ultimo_evento': {
        'descricao': 'Pedido de documentos',
        'em': '2026-10-16T09:15:00Z',
      },
    },
  ],
};

Map<String, dynamic> respostaProcesso() => {
  'id': idProcesso,
  'municipio': 'Guimarães',
  'numero': 'CP 1/2026',
  'tipo': 'Comunicação prévia',
  'assunto': 'Anexo no quintal',
  'fase': 'documentos',
  'fase_rotulo': 'À espera de documentos',
  'fase_em_palavras': 'falta um documento da sua parte',
  'decisao': null,
  'prazo': {
    'inicio': null,
    'fim': null,
    'dias_uteis_restantes': null,
    'a_contar': false,
  },
  'documentos': {
    'tem': 2,
    'faltam': 1,
    'em_falta': [
      {'nome': 'Planta de localização', 'prazo': '2026-10-30'},
    ],
  },
  'linha_do_tempo': [
    {
      'em': '2026-10-10T09:00:00Z',
      'tipo': 'criado',
      'descricao': 'Pedido recebido',
    },
    {
      'em': '2026-10-16T09:15:00Z',
      'tipo': 'pedido',
      'descricao': 'Pedido de documentos',
    },
  ],
  'pagamento': null,
  'decisao_pdf': false,
  'link': 'https://toucamara.pt/r/ABC123',
  'codigo': 'ABC123',
};

Map<String, dynamic> respostaOcorrencias() => {
  'ocorrencias': [
    {
      'numero': 'OC-0006',
      'juntada_a_outra': false,
      'categoria': 'Recolha de lixo',
      'descricao': 'Contentor partido',
      'morada': 'Rua D. João I',
      'estado': 'resolvida',
      'estado_explicado': 'Foi resolvida a 18/10/2026.',
      'criada_em': '2026-10-16T09:47:00Z',
      'token': 'token-oc-0006-abcdefgh',
      'link': 'https://toucamara.pt/ocorrencia/token-oc-0006-abcdefgh',
    },
  ],
};

Map<String, dynamic> respostaAvisos() => {
  'avisos': [
    {
      'id': 'a-1',
      'origem': 'emergencia',
      'tipo': 'cheia',
      'titulo': 'Risco de cheia no rio Ave',
      'mensagem': 'Evite as margens do rio.',
      'instrucoes': 'Suba para um andar alto.',
      'zona': 'Margens do Ave',
      'em': '2026-10-22T10:00:00Z',
      'urgente': true,
      'ativo': true,
      'link': null,
    },
  ],
};

/// A API falsa com as rotas da app do munícipe.
void rotasMunicipe(ApiFalsa f) {
  f.em(
    'POST /v1/public/app/codigo',
    (_) => (202, {'enviado': true, 'telefone': '+351 9•• ••• 001'}),
  );
  f.em('POST /v1/public/app/entrar', (p) {
    return (p.json as Map)['codigo'] == '123456'
        ? (201, respostaEntrarMunicipe())
        : (
            400,
            erro('codigo_errado', 'Código errado.', {
              'tentativas_restantes': 4,
            }),
          );
  });
  f.em('GET /v1/app/eu', (_) => (200, respostaEu()));
  f.em('PUT /v1/app/eu/preferencias', (_) => (200, {}));
  f.em('GET /v1/public/agora/guimaraes', (_) => (200, respostaFeed()));
  f.em('GET /v1/app/processos', (_) => (200, respostaProcessos()));
  f.em('GET /v1/app/processos/$idProcesso', (_) => (200, respostaProcesso()));
  f.em('GET /v1/app/licencas', (_) => (200, {'licencas': []}));
  f.em('GET /v1/app/pagamentos', (_) => (200, {'pagamentos': []}));
  f.em(
    'GET /v1/app/marcacoes',
    (_) => (200, {'marcacoes': [], 'recolhas': []}),
  );
  f.em('GET /v1/app/reclamacoes', (_) => (200, {'reclamacoes': []}));
  f.em('GET /v1/app/ocorrencias', (_) => (200, respostaOcorrencias()));
  f.em('GET /v1/app/avisos', (_) => (200, respostaAvisos()));
  f.em(
    'GET /v1/app/ocorrencias/categorias',
    (_) => (
      200,
      {
        'categorias': [
          {'id': 'c1', 'nome': 'Buraco na via', 'icone': null},
          {'id': 'c2', 'nome': 'Iluminação pública', 'icone': null},
        ],
      },
    ),
  );
  f.em('POST /v1/app/sair', (_) => (200, {'saiu': true}));
}

Future<ServicosMunicipe> montarMunicipe(
  ApiFalsa falsa, {
  ArmazemMemoria? prefs,
  ArmazemMemoria? seguro,
  CamaraFalsa? camara,
  Notificacoes? notificacoes,
}) {
  final p = prefs ?? ArmazemMemoria();
  return ServicosMunicipe.montar(
    prefs: p,
    seguro: seguro ?? ArmazemMemoria(),
    ficheiros: GuardaFicheirosArmazem(p),
    localizador: LocalizadorFixo(camaraGuimaraes),
    ditado: DitadoIndisponivel(),
    camara: camara ?? CamaraFalsa(),
    notificacoes: notificacoes,
    cliente: falsa.cliente,
  );
}

/// Ecrã de telemóvel (390×844), ou comprido para os detalhes.
Future<void> ecraTelemovel(WidgetTester tester, {bool alto = false}) async {
  await tester.binding.setSurfaceSize(Size(390, alto ? 2400 : 844));
  addTearDown(() => tester.binding.setSurfaceSize(null));
}

/// Push falso: guarda o "abrir" e o "receber" da app, e os registos.
class NotificacoesFalsas extends NotificacoesSemFirebase {
  void Function(String link)? abrir;
  void Function(NotificacaoRecebida n)? receber;
  int registos = 0;

  @override
  String get estado => 'Notificações: ligadas';
  @override
  bool get configuradas => true;

  @override
  Future<void> iniciar({
    required void Function(String link) aoAbrir,
    required void Function(NotificacaoRecebida n) aoReceber,
  }) async {
    abrir = aoAbrir;
    receber = aoReceber;
  }

  @override
  Future<void> registar(ClienteApi api) async => registos++;
}
