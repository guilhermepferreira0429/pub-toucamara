import 'package:flutter_test/flutter_test.dart';
import 'package:toucamara_app/comum/api/cliente_api.dart';
import 'package:toucamara_app/comum/config.dart';

import 'apoio.dart';

void main() {
  late ApiFalsa falsa;
  late ClienteApi api;

  setUp(() {
    falsa = ApiFalsa();
    api = ClienteApi(servidor: () => 'http://api.teste', cliente: falsa.cliente);
  });

  test('acrescenta /v1, a sessão, o município e a Idempotency-Key', () async {
    falsa.em('POST /v1/painel/equipa/ocorrencias/x/fechar', (_) => (200, {'ok': true}));
    api
      ..token = 'abc'
      ..municipio = 'guimaraes';
    final r = await api.post('/painel/equipa/ocorrencias/x/fechar',
        corpo: {'nota': 'feito'}, chaveIdempotencia: 'chave-1');
    expect(r, {'ok': true});
    final p = falsa.pedidos.single;
    expect(p.url.toString(), 'http://api.teste/v1/painel/equipa/ocorrencias/x/fechar');
    expect(p.cabecalhos['Authorization'], 'Bearer abc');
    expect(p.cabecalhos['X-Municipio'], 'guimaraes');
    expect(p.cabecalhos['Idempotency-Key'], 'chave-1');
    expect(p.cabecalhos['Content-Type'], startsWith('application/json'));
    expect(p.json, {'nota': 'feito'});
  });

  test('query string no GET; sem sessão não manda Authorization', () async {
    falsa.em('GET /v1/painel/equipa/hoje', (_) => (200, {'tarefas': []}));
    await api.get('/painel/equipa/hoje', query: {'lat': '41.1', 'lng': '-8.2'});
    final p = falsa.pedidos.single;
    expect(p.url.queryParameters, {'lat': '41.1', 'lng': '-8.2'});
    expect(p.cabecalhos.containsKey('Authorization'), isFalse);
  });

  test('erro da API vira ErroApi com código, mensagem e detalhes', () async {
    falsa.em(
        'POST /v1/painel/auth/app/entrar',
        (_) => (400, erro('codigo_errado', 'Código errado.', {'tentativas_restantes': 3})));
    await expectLater(
      api.post('/painel/auth/app/entrar', corpo: {}),
      throwsA(isA<ErroApi>()
          .having((e) => e.codigo, 'codigo', 'codigo_errado')
          .having((e) => e.detalhes['tentativas_restantes'], 'restantes', 3)
          .having((e) => e.transitorio, 'transitorio', false)),
    );
  });

  test('503 e 429 são transitórios; corpo que não é JSON dá mensagem genérica', () {
    expect(ErroApi.daResposta(503, '<html>').transitorio, isTrue);
    expect(ErroApi.daResposta(429, '').transitorio, isTrue);
    expect(ErroApi.daResposta(409, '').transitorio, isFalse);
    expect(ErroApi.daResposta(502, '<html>').mensagem, contains('servidor'));
  });

  test('401 com sessão chama aoSessaoInvalida', () async {
    var chamado = 0;
    api
      ..token = 'revogado'
      ..aoSessaoInvalida = () => chamado++;
    falsa.em('GET /v1/painel/equipa/hoje',
        (_) => (401, erro('nao_autenticado', 'Sessão inválida ou expirada.')));
    await expectLater(api.get('/painel/equipa/hoje'), throwsA(isA<ErroApi>()));
    expect(chamado, 1);
  });

  test('sem ligação lança SemRede', () async {
    falsa.semRede = true;
    await expectLater(api.get('/painel/equipa/hoje'), throwsA(isA<SemRede>()));
  });

  test('o servidor lê-se a cada pedido (definições mudadas)', () async {
    var servidor = 'http://um';
    api.servidor = () => servidor;
    falsa.em('GET /v1/saude', (_) => (200, {'ok': true}));
    await api.get('/saude');
    servidor = 'http://dois';
    await api.get('/saude');
    expect(falsa.pedidos.map((p) => p.url.host), ['um', 'dois']);
  });

  test('normalizar e validar o URL do servidor', () {
    expect(ConfigApp.normalizarUrl(' https://api.pt/v1/ '), 'https://api.pt');
    expect(ConfigApp.normalizarUrl('http://10.0.2.2:3001//'), 'http://10.0.2.2:3001');
    expect(ConfigApp.urlValido('ftp://x'), isFalse);
    expect(ConfigApp.urlValido('api.pt'), isFalse);
    expect(ConfigApp.urlValido('https://api.pt'), isTrue);
  });
}
