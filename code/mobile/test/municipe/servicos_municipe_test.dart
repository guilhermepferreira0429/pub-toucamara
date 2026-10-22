import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:toucamara_app/comum/api/cliente_api.dart';
import 'package:toucamara_app/comum/armazenamento/armazem.dart';
import 'package:toucamara_app/comum/armazenamento/ficheiros.dart';
import 'package:toucamara_app/comum/plataforma/camara.dart';
import 'package:toucamara_app/comum/fila/fila_offline.dart';
import 'package:toucamara_app/comum/localizacao/localizacao.dart';
import 'package:toucamara_app/municipe/chat.dart';
import 'package:toucamara_app/municipe/modelos.dart';
import 'package:toucamara_app/municipe/reportar.dart';
import 'package:toucamara_app/municipe/repositorio.dart';
import 'package:toucamara_app/municipe/sessao.dart';

import '../apoio.dart';
import 'apoio_municipe.dart';

void main() {
  group('Leitura das respostas', () {
    test(
      'feed: emergências primeiro, onde, "novo" e a nota de demonstração',
      () {
        final f = Feed.deJson(respostaFeed());
        expect(f.total, 3);
        expect(f.ordenados.first.titulo, 'Corte de água urgente');
        expect(f.ordenados.first.emergencia, isTrue);
        expect(
          f.itens.first.onde,
          'Rua de Santo António · Oliveira, São Paio e São Sebastião',
        );
        expect(f.itens.first.novo(), isTrue);
        expect(f.itens.last.temLocal, isFalse);
        expect(f.nota, contains('demonstração'));
      },
    );

    test(
      'processo: fase em palavras, o que falta, linha do tempo e o código',
      () {
        final p = Processo.deJson(respostaProcesso());
        expect(p.faseEmPalavras, 'falta um documento da sua parte');
        expect(p.emFalta.single.nome, 'Planta de localização');
        expect(p.emFalta.single.prazo, '2026-10-30');
        expect(p.prazoAContar, isFalse);
        expect(p.linhaDoTempo.map((e) => e.descricao), [
          'Pedido recebido',
          'Pedido de documentos',
        ]);
        expect(p.codigo, 'ABC123');
      },
    );

    test('pagamento, licença, marcação (e recolha), aviso, ocorrência', () {
      final pg = Pagamento.deJson({
        'id': 'p',
        'estado': 'pendente',
        'valor_cent': 6470,
        'mb_entidade': '12345',
        'mb_referencia': '866881044',
        'modo_teste': true,
        'link': 'https://x/pagamento/ABC',
      });
      expect(pg.pendente, isTrue);
      expect(pg.referenciaDita, '866 881 044');
      expect(euros(pg.valorCent), '64,70 €');
      expect(euros(123456), '1 234,56 €');

      final l = Licenca.deJson({
        'id': 'l',
        'tipo': 'ruido',
        'tipo_nome': 'Licença especial de ruído',
        'estado': 'emitida',
        'processo_numero': 'LER 2/2026',
        'codigo': 'K7Q2',
        'link': 'https://x/licenca/K7Q2',
      });
      expect(l.valida, isTrue);
      expect(l.estadoDito, 'Emitida');

      final r = Marcacao.deRecolha({
        'id': 'r',
        'morada': 'Rua A',
        'inicio': DateTime.now().add(const Duration(days: 2)).toIso8601String(),
        'estado': 'agendada',
      });
      expect(r.recolha, isTrue);
      expect(r.futura, isTrue);

      final a = Aviso.deJson(
        respostaAvisos()['avisos'][0] as Map<String, dynamic>,
      );
      expect(a.urgente, isTrue);
      expect(a.instrucoes, 'Suba para um andar alto.');

      final o = OcorrenciaMinha.deJson(
        respostaOcorrencias()['ocorrencias'][0] as Map<String, dynamic>,
      );
      expect(o.resolvida, isTrue);
      final d = OcorrenciaDetalhe.deJson({
        'numero': 'OC-0006',
        'fotos': [
          {'id': '1', 'origem': 'municipe', 'url': null},
          {'id': '2', 'origem': 'equipa', 'url': 'https://s3/x.jpg'},
        ],
      });
      expect(d.fotos.where((f) => f.daEquipa).single.url, 'https://s3/x.jpg');
    });

    test('campos em falta não deitam a leitura abaixo', () {
      expect(Processo.deJson({}).numero, '');
      expect(Feed.deJson({}).itens, isEmpty);
      expect(Eu.deJson({}).avisos, isTrue);
      expect(ItemAgora.deJson({'tipo': 'desconhecido'}).tipo, TipoItem.avisos);
    });

    test('evento SSE: JSON, texto simples e comentários', () {
      final e = EventoSse.doBloco('event: texto\ndata: {"texto":"Olá"}')!;
      expect(e.evento, 'texto');
      expect(e.dados, {'texto': 'Olá'});
      expect(EventoSse.doBloco(': vivo'), isNull);
      expect(EventoSse.doBloco('data: simples')!.dados, 'simples');
    });
  });

  group('Sessão', () {
    test('telefones aceites e limpos', () {
      expect(ControladorSessaoMunicipe.telefoneValido('912 345 678'), isTrue);
      expect(
        ControladorSessaoMunicipe.telefoneValido('+351 912345678'),
        isTrue,
      );
      expect(ControladorSessaoMunicipe.telefoneValido('212345678'), isFalse);
      expect(ControladorSessaoMunicipe.telefoneValido('9123'), isFalse);
      expect(
        ControladorSessaoMunicipe.limparTelefone('+351 912-345-678'),
        '+351912345678',
      );
    });

    test('entrar guarda o token cifrado; 401 termina a sessão', () async {
      final falsa = ApiFalsa();
      rotasMunicipe(falsa);
      final seguro = ArmazemMemoria();
      final api = ClienteApi(
        servidor: () => 'http://api',
        cliente: falsa.cliente,
      );
      final s = ControladorSessaoMunicipe(
        api: api,
        armazemSeguro: seguro,
        municipio: () => 'guimaraes',
      );
      await s.carregar();
      expect(s.estado, EstadoSessao.fora);
      expect(await s.pedirCodigo('912 000 001'), '+351 9•• ••• 001');
      expect(falsa.para('POST /v1/public/app/codigo').single.json, {
        'municipio': 'guimaraes',
        'telefone': '912000001',
      });
      await s.entrar('912000001', '123456');
      expect(s.estado, EstadoSessao.dentro);
      expect(s.sessao!.municipioNome, 'Guimarães');
      expect(
        await seguro.ler(ControladorSessaoMunicipe.chave),
        contains('tca_'),
      );

      falsa.em(
        'GET /v1/app/eu',
        (_) => (401, erro('sessao_invalida', 'Terminou.')),
      );
      await expectLater(api.get('/app/eu'), throwsA(isA<ErroApi>()));
      expect(s.estado, EstadoSessao.fora);
      expect(s.aviso, contains('Entre outra vez'));
      expect(await seguro.ler(ControladorSessaoMunicipe.chave), isNull);
    });
  });

  group('Repositório', () {
    test('sem rede mostra a última cópia (só da mesma sessão)', () async {
      final falsa = ApiFalsa();
      rotasMunicipe(falsa);
      final cache = ArmazemMemoria();
      var dono = 's1';
      final r = RepositorioMunicipe(
        api: ClienteApi(servidor: () => 'http://api', cliente: falsa.cliente),
        cache: cache,
        municipio: () => 'guimaraes',
        dono: () => dono,
      );
      expect((await r.processos()).daCache, isFalse);
      falsa.semRede = true;
      final l = await r.processos();
      expect(l.daCache, isTrue);
      expect(l.valor.single.numero, 'CP 1/2026');
      dono = 's2';
      await expectLater(r.processos(), throwsA(isA<SemRede>()));
    });

    test('feed perto de mim leva lat, lng, raio e tipos', () async {
      final falsa = ApiFalsa();
      rotasMunicipe(falsa);
      final r = RepositorioMunicipe(
        api: ClienteApi(servidor: () => 'http://api', cliente: falsa.cliente),
        cache: ArmazemMemoria(),
        municipio: () => 'guimaraes',
        dono: () => 's',
      );
      await r.feed(
        tipos: {TipoItem.obras, TipoItem.eventos},
        perto: const Ponto(41.4, -8.29),
        raioM: 500,
      );
      final q = falsa
          .para('GET /v1/public/agora/guimaraes')
          .single
          .url
          .queryParameters;
      expect(q['tipos'], 'obras,eventos');
      expect(q['lat'], '41.400000');
      expect(q['raio_m'], '500');
    });

    test('avisar-me envia o sítio e devolve a frase da API', () async {
      final falsa = ApiFalsa();
      falsa.em(
        'POST /v1/app/agora/subscricoes',
        (_) => (201, {'subscrito': true, 'mensagem': 'Fica combinado.'}),
      );
      final r = RepositorioMunicipe(
        api: ClienteApi(servidor: () => 'http://api', cliente: falsa.cliente),
        cache: ArmazemMemoria(),
        municipio: () => 'guimaraes',
        dono: () => 's',
      );
      final m = await r.subscrever(
        tipos: {TipoItem.obras},
        ponto: const Ponto(41.44, -8.29),
        descricao: 'Rua Direita',
      );
      expect(m, 'Fica combinado.');
      expect(falsa.para('POST /v1/app/agora/subscricoes').single.json, {
        'tipos': ['obras'],
        'lat': 41.44,
        'lng': -8.29,
        'descricao': 'Rua Direita',
      });
    });
  });

  group('Reportar pela fila', () {
    late ApiFalsa falsa;
    late FilaOffline fila;
    late ServicoReportar reportar;

    setUp(() {
      falsa = ApiFalsa();
      final api = ClienteApi(
        servidor: () => 'http://api',
        cliente: falsa.cliente,
      )..token = 'tca_x';
      final prefs = ArmazemMemoria();
      fila = FilaOffline(
        armazem: prefs,
        ficheiros: GuardaFicheirosArmazem(prefs),
        api: api,
        codigosDefinitivos: const {'armazenamento_indisponivel'},
      );
      reportar = ServicoReportar(fila);
    });

    RascunhoOcorrencia rascunho({bool comFoto = true}) => RascunhoOcorrencia(
      categoria: 'Buraco na via',
      descricao: 'Buraco grande',
      local: camaraGuimaraes,
      foto: comFoto
          ? FotoTirada(
              bytes: png1px,
              mime: 'image/png',
              tiradaEm: DateTime.utc(2026, 10, 22),
              local: camaraGuimaraes,
            )
          : null,
    );

    test(
      'com rede: regista, envia a fotografia pela rota com o token e diz "já sabemos"',
      () async {
        falsa.em(
          'POST /v1/app/ocorrencias',
          (_) => (
            201,
            {
              'numero': 'OC-0002',
              'duplicada': true,
              'mensagem': 'Esse problema já estava reportado (OC-0002).',
              'token': 'tok-123456789012345',
            },
          ),
        );
        falsa.em(
          'POST /v1/public/ocorrencias/tok-123456789012345/fotos',
          (_) => (
            201,
            {
              'foto_id': 'f1',
              'url_envio': 'https://s3.teste/f.png',
              'cabecalhos': {'Content-Type': 'image/png'},
            },
          ),
        );
        falsa.em('PUT /f.png', (_) => (200, null));
        final r = await reportar.enviar(rascunho());
        expect(r.naFila, isFalse);
        expect(r.registada!.duplicada, isTrue);
        expect(r.registada!.numero, 'OC-0002');
        final pedido = falsa.para('POST /v1/app/ocorrencias').single;
        expect(pedido.json, {
          'categoria': 'Buraco na via',
          'descricao': 'Buraco grande',
          'lat': camaraGuimaraes.lat,
          'lng': camaraGuimaraes.lng,
        });
        expect(pedido.cabecalhos['Idempotency-Key'], isNotNull);
        expect(falsa.para('PUT /f.png').single.bytes, png1px);
        expect(fila.porEnviar, 0);
      },
    );

    test(
      'sem rede: fica na fila e segue quando a rede volta (sem duplicar)',
      () async {
        falsa.semRede = true;
        final r = await reportar.enviar(rascunho(comFoto: false));
        expect(r.naFila, isTrue);
        expect(fila.porEnviar, 1);
        falsa.semRede = false;
        falsa.em(
          'POST /v1/app/ocorrencias',
          (_) => (
            201,
            {
              'numero': 'OC-0009',
              'duplicada': false,
              'mensagem': 'Registada.',
              'token': 'tok-999999999999999',
            },
          ),
        );
        await fila.enviar();
        expect(fila.porEnviar, 0);
        expect(reportar.ultimas.single.numero, 'OC-0009');
      },
    );

    test(
      'sem armazenamento de fotografias: a ocorrência fica, a foto não prende as seguintes',
      () async {
        falsa.em(
          'POST /v1/app/ocorrencias',
          (_) => (
            201,
            {
              'numero': 'OC-0010',
              'duplicada': false,
              'mensagem': 'Registada.',
              'token': 'tok-000000000000010',
            },
          ),
        );
        falsa.em(
          'POST /v1/public/ocorrencias/*/fotos',
          (_) =>
              (503, erro('armazenamento_indisponivel', 'Sem armazenamento.')),
        );
        final r = await reportar.enviar(rascunho());
        expect(r.registada!.numero, 'OC-0010');
        expect(fila.falhadas, 1);
        final outra = await reportar.enviar(rascunho(comFoto: false));
        expect(outra.registada, isNotNull);
        expect(falsa.para('POST /v1/app/ocorrencias'), hasLength(2));
      },
    );
  });

  group('Chat', () {
    test('lê o SSE: texto, ferramenta, cartão e fim', () async {
      const corpoSse =
          'event: ferramenta\ndata: {"nome":"o_que_se_passa"}\n\n'
          ': vivo\n\n'
          'event: texto\ndata: {"texto":"Há obras "}\n\n'
          'event: texto\ndata: {"texto":"na sua rua."}\n\n'
          'event: cartao\ndata: {"tipo":"agora","ferramenta":"o_que_se_passa","dados":{"itens":[{"frase":"Obras na Rua Direita"}]}}\n\n'
          'event: fim\ndata: {}\n\n';
      final cliente = MockClient((r) async {
        if (r.url.path == '/v1/app/chat/sessoes') {
          return http.Response.bytes(
            utf8.encode(
              jsonEncode({
                'sessao': 's' * 24,
                'saudacao': 'Olá!',
                'agente': 'Tou, Câmara?',
              }),
            ),
            201,
          );
        }
        return http.Response.bytes(
          utf8.encode(corpoSse),
          200,
          headers: {'content-type': 'text/event-stream'},
        );
      });
      final api = ClienteApi(servidor: () => 'http://api', cliente: cliente)
        ..token = 'tca_x';
      final c = ControladorChat(
        api: api,
        repositorio: RepositorioMunicipe(
          api: api,
          cache: ArmazemMemoria(),
          municipio: () => 'guimaraes',
          dono: () => 's',
        ),
      );
      await c.iniciar();
      expect(c.mensagens.single.texto, 'Olá!');
      expect(await c.enviar('Há obras?'), isTrue);
      final r = c.mensagens.last;
      expect(r.texto, 'Há obras na sua rua.');
      expect(r.estado, EstadoMensagem.feita);
      expect(r.cartoes.single.tipo, 'agora');
      expect(
        listaDe(r.cartoes.single.dados['itens']).single['frase'],
        'Obras na Rua Direita',
      );
    });

    test('sem rede: a mensagem fica por enviar', () async {
      final falsa = ApiFalsa()..semRede = true;
      final api = ClienteApi(
        servidor: () => 'http://api',
        cliente: falsa.cliente,
      );
      final c = ControladorChat(
        api: api,
        repositorio: RepositorioMunicipe(
          api: api,
          cache: ArmazemMemoria(),
          municipio: () => 'guimaraes',
          dono: () => 's',
        ),
      );
      expect(await c.enviar('Olá'), isFalse);
      expect(c.ligacao, LigacaoChat.semLigacao);
      expect(c.mensagens.single.estado, EstadoMensagem.porEnviar);
    });
  });
}
