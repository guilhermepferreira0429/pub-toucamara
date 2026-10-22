import 'dart:convert';
import 'dart:typed_data';

import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:toucamara_app/comum/localizacao/localizacao.dart';
import 'package:toucamara_app/comum/plataforma/camara.dart';

/// Um pedido que a API falsa recebeu.
class PedidoVisto {
  PedidoVisto(this.metodo, this.url, this.cabecalhos, this.corpo, this.bytes);
  final Uint8List bytes;
  final String metodo;
  final Uri url;
  final Map<String, String> cabecalhos;
  final String corpo;
  dynamic get json => corpo.isEmpty ? null : jsonDecode(corpo);
  String get caminho => url.path;
}

typedef Resposta = (int, Object?);

/// API falsa: `rotas['POST /v1/x']` → (estado, corpo). Com [semRede] todos
/// os pedidos falham como sem ligação.
class ApiFalsa {
  final Map<String, Resposta Function(PedidoVisto)> rotas = {};
  final List<PedidoVisto> pedidos = [];
  bool semRede = false;

  void em(String rota, Resposta Function(PedidoVisto p) f) => rotas[rota] = f;

  List<PedidoVisto> para(String metodoECaminho) => pedidos
      .where((p) => '${p.metodo} ${p.caminho}' == metodoECaminho)
      .toList();

  late final http.Client cliente = MockClient((r) async {
    if (semRede) throw http.ClientException('Sem rede (teste)', r.url);
    // O PUT ao S3 leva bytes (não é texto).
    final p = PedidoVisto(
      r.method,
      r.url,
      r.headers,
      r.method == 'PUT' ? '' : r.body,
      r.bodyBytes,
    );
    pedidos.add(p);
    final chave = '${r.method} ${r.url.path}';
    final f =
        rotas[chave] ??
        rotas.entries
            .where((e) => _casa(e.key, chave))
            .map((e) => e.value)
            .firstOrNull;
    if (f == null) {
      return http.Response(
        jsonEncode({
          'erro': {'codigo': 'nao_encontrado', 'mensagem': 'Rota $chave'},
        }),
        404,
      );
    }
    final (estado, corpo) = f(p);
    return http.Response.bytes(
      utf8.encode(corpo == null ? '' : jsonEncode(corpo)),
      estado,
      headers: {'content-type': 'application/json'},
    );
  });

  /// `POST /v1/x/*/y` casa com qualquer segmento no lugar do `*`.
  static bool _casa(String padrao, String real) {
    if (!padrao.contains('*')) return false;
    final a = padrao.split('/');
    final b = real.split('/');
    if (a.length != b.length) return false;
    for (var i = 0; i < a.length; i++) {
      if (a[i] != '*' && a[i] != b[i]) return false;
    }
    return true;
  }
}

Map<String, dynamic> erro(
  String codigo,
  String mensagem, [
  Map<String, dynamic>? detalhes,
]) => {
  'erro': {'codigo': codigo, 'mensagem': mensagem, 'detalhes': ?detalhes},
};

/// Resposta de entrar.
Map<String, dynamic> respostaEntrar({String id = 'u-1'}) => {
  'token': 'jwt-de-teste',
  'expira_em': DateTime.now()
      .add(const Duration(days: 30))
      .toUtc()
      .toIso8601String(),
  'sessao_id': 's-1',
  'utilizador': {
    'id': id,
    'nome': 'Rui Fiscal',
    'email': 'rui@camara.pt',
    'perfil': 'tecnico',
    'municipioId': 'm-1',
    'servicoId': 'srv-1',
  },
  'municipio': {'slug': 'guimaraes', 'nome': 'Guimarães'},
};

const camaraGuimaraes = Ponto(41.4425, -8.2918);

/// As tarefas de hoje: uma ocorrência perto, uma visita, uma longe.
Map<String, dynamic> respostaHoje() => {
  'dia': '2026-10-22',
  'mostra': {'visitas': true, 'ocorrencias': true},
  'por_fazer': 3,
  'tarefas': [
    {
      'tipo': 'ocorrencia',
      'id': 'oc-longe',
      'numero': 'OC-2026-0003',
      'titulo': 'Iluminação pública',
      'resumo': 'Candeeiro apagado',
      'morada': 'Rua de Santo António, 90',
      'lat': 41.4520,
      'lng': -8.2930,
      'estado': 'nova',
      'estado_nome': 'Nova',
      'feita': false,
    },
    {
      'tipo': 'visita',
      'id': 'v-1',
      'numero': 'FIS-2026-0001',
      'titulo': 'Fiscalização de obra particular',
      'resumo': 'Obra sem licença',
      'morada': 'Rua da Rainha, 12',
      'lat': 41.4432,
      'lng': -8.2925,
      'estado': 'agendada',
      'estado_nome': 'Agendada',
      'feita': false,
      'janela': '10:00–11:00',
    },
    {
      'tipo': 'ocorrencia',
      'id': 'oc-perto',
      'numero': 'OC-2026-0001',
      'titulo': 'Buraco na via',
      'resumo': 'Buraco grande',
      'morada': 'Largo do Toural',
      'lat': 41.4426,
      'lng': -8.2919,
      'estado': 'com_equipa',
      'estado_nome': 'Com a equipa',
      'feita': false,
      'reportes': 3,
    },
  ],
};

Map<String, dynamic> respostaOcorrencia({String estado = 'com_equipa'}) => {
  'id': 'oc-perto',
  'numero': 'OC-2026-0001',
  'estado': estado,
  'categoria': 'Buraco na via',
  'descricao': 'Buraco grande junto à passadeira',
  'morada': 'Largo do Toural',
  'lat': 41.4426,
  'lng': -8.2919,
  'reportes': 3,
  'duplicada_de': null,
  'fotos': [
    {'id': 'f-1', 'url': null, 'origem': 'municipe'},
  ],
  'duplicados': [
    {'id': 'd-1', 'numero': 'OC-2026-0007', 'descricao': 'Mesmo buraco'},
    {
      'id': 'd-2',
      'numero': 'OC-2026-0009',
      'descricao': 'Cuidado com o buraco',
    },
  ],
  'eventos': [],
};

Map<String, dynamic> respostaVisita({String estado = 'agendada'}) => {
  'id': 'v-1',
  'numero': 'FIS-2026-0001',
  'tipo': 'obra',
  'tipo_nome': 'Fiscalização de obra particular',
  'estado': estado,
  'estado_nome': estado == 'feita' ? 'Feita' : 'Agendada',
  'morada': 'Rua da Rainha, 12',
  'lat': 41.4432,
  'lng': -8.2925,
  'motivo': 'Obra sem licença denunciada',
  'checklist': [
    {
      'chave': 'licenca_afixada',
      'rotulo': 'O aviso da licença está afixado?',
      'conforme_se': 'sim',
      'artigo': null,
      'resposta': null,
      'nota': null,
    },
  ],
  'fotos': [],
  'relatorio': null,
  'valores_demonstracao': true,
};

/// PNG de 1×1 (para fotografias de teste).
final Uint8List png1px = base64Decode(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
);

class CamaraFalsa implements Camara {
  int tiradas = 0;
  @override
  Future<FotoTirada?> tirar({required bool daGaleria}) async {
    tiradas++;
    return FotoTirada(
      bytes: png1px,
      mime: 'image/png',
      tiradaEm: DateTime.utc(2026, 10, 22, 10, 15),
      local: camaraGuimaraes,
    );
  }
}
