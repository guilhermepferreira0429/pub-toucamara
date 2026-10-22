import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:http/http.dart' as http;

/// Resposta de erro da API: `{ "erro": { "codigo", "mensagem", "detalhes" } }`.
class ErroApi implements Exception {
  ErroApi(this.estado, this.codigo, this.mensagem, [this.detalhes = const {}]);

  final int estado;
  final String codigo;
  final String mensagem;
  final Map<String, dynamic> detalhes;

  /// Vale a pena tentar outra vez mais tarde (servidor em baixo, S3 por
  /// configurar, limite de pedidos).
  bool get transitorio => estado >= 500 || estado == 408 || estado == 429;

  bool get sessaoInvalida => estado == 401;

  factory ErroApi.daResposta(int estado, String corpo) {
    try {
      final j = jsonDecode(corpo);
      if (j is Map && j['erro'] is Map) {
        final e = j['erro'] as Map;
        return ErroApi(
          estado,
          '${e['codigo'] ?? 'erro'}',
          '${e['mensagem'] ?? 'Erro inesperado.'}',
          e['detalhes'] is Map
              ? Map<String, dynamic>.from(e['detalhes'] as Map)
              : const {},
        );
      }
    } on FormatException {
      // corpo não é JSON (proxy, HTML): cai no genérico.
    }
    return ErroApi(estado, 'http_$estado', _mensagemGenerica(estado));
  }

  static String _mensagemGenerica(int estado) {
    if (estado == 401) return 'A sessão terminou. Entre outra vez.';
    if (estado == 403) return 'O seu perfil não tem acesso a isto.';
    if (estado == 404) return 'Não encontrado.';
    if (estado >= 500) return 'O servidor não respondeu bem. Tenta-se outra vez.';
    return 'O pedido não foi aceite ($estado).';
  }

  @override
  String toString() => 'ErroApi($estado, $codigo): $mensagem';
}

/// Sem rede (ou o servidor não responde): a ação fica na fila.
class SemRede implements Exception {
  SemRede(this.motivo);
  final String motivo;
  @override
  String toString() => 'SemRede: $motivo';
}

/// Cliente HTTP da API central (`<servidor>/v1/...`): sessão do painel
/// (Bearer), município da equipa interna (X-Municipio) e Idempotency-Key.
class ClienteApi {
  ClienteApi({
    required this.servidor,
    http.Client? cliente,
    this.limite = const Duration(seconds: 20),
  }) : _http = cliente ?? http.Client();

  /// Lido a cada pedido: muda quando se altera o servidor nas definições.
  String Function() servidor;
  final http.Client _http;
  final Duration limite;

  String? token;
  String? municipio;

  /// Chamado quando a API diz 401 (sessão revogada ou expirada).
  void Function()? aoSessaoInvalida;

  Uri uri(String caminho, [Map<String, String>? query]) {
    final base = servidor();
    final c = caminho.startsWith('/') ? caminho : '/$caminho';
    final u = Uri.parse('$base/v1$c');
    return query == null || query.isEmpty
        ? u
        : u.replace(queryParameters: {...u.queryParameters, ...query});
  }

  Map<String, String> _cabecalhos({String? chave, bool json = false}) => {
        'Accept': 'application/json',
        if (json) 'Content-Type': 'application/json',
        if (token != null) 'Authorization': 'Bearer $token',
        if (municipio != null && municipio!.isNotEmpty)
          'X-Municipio': municipio!,
        'Idempotency-Key': ?chave,
      };

  Future<dynamic> get(String caminho, {Map<String, String>? query}) =>
      pedido('GET', caminho, query: query);

  Future<dynamic> post(String caminho,
          {Object? corpo, String? chaveIdempotencia}) =>
      pedido('POST', caminho, corpo: corpo, chave: chaveIdempotencia);

  Future<dynamic> patch(String caminho,
          {Object? corpo, String? chaveIdempotencia}) =>
      pedido('PATCH', caminho, corpo: corpo, chave: chaveIdempotencia);

  /// Um pedido JSON. Lança [ErroApi] (resposta de erro) ou [SemRede].
  Future<dynamic> pedido(
    String metodo,
    String caminho, {
    Object? corpo,
    String? chave,
    Map<String, String>? query,
  }) async {
    final r = await _enviar(() {
      final req = http.Request(metodo, uri(caminho, query));
      req.headers.addAll(_cabecalhos(chave: chave, json: corpo != null));
      if (corpo != null) req.body = jsonEncode(corpo);
      return req;
    });
    final texto = utf8.decode(r.bodyBytes);
    if (r.statusCode >= 400) {
      final e = ErroApi.daResposta(r.statusCode, texto);
      if (e.sessaoInvalida && token != null) aoSessaoInvalida?.call();
      throw e;
    }
    if (texto.isEmpty) return null;
    return jsonDecode(texto);
  }

  /// Bytes (o PDF do relatório).
  Future<Uint8List> bytes(String caminho) async {
    final r = await _enviar(() {
      final req = http.Request('GET', uri(caminho));
      req.headers.addAll(_cabecalhos()..['Accept'] = '*/*');
      return req;
    });
    if (r.statusCode >= 400) {
      throw ErroApi.daResposta(r.statusCode, utf8.decode(r.bodyBytes));
    }
    return r.bodyBytes;
  }

  /// PUT direto ao armazenamento (URL assinada que a API deu).
  Future<void> enviarFicheiro(
      String url, Map<String, String> cabecalhos, Uint8List conteudo) async {
    final r = await _enviar(() {
      final req = http.Request('PUT', Uri.parse(url));
      req.headers.addAll(cabecalhos);
      req.bodyBytes = conteudo;
      return req;
    }, limite: const Duration(seconds: 90));
    if (r.statusCode >= 400) {
      throw ErroApi(
          r.statusCode, 'envio_ficheiro', 'O ficheiro não foi aceite.');
    }
  }

  Future<http.Response> _enviar(http.BaseRequest Function() criar,
      {Duration? limite}) async {
    try {
      final s = await _http.send(criar()).timeout(limite ?? this.limite);
      return await http.Response.fromStream(s).timeout(limite ?? this.limite);
    } on TimeoutException {
      throw SemRede('O servidor demorou demasiado a responder.');
    } on http.ClientException catch (e) {
      throw SemRede(e.message);
    }
  }
}
