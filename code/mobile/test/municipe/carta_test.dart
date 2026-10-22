import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:toucamara_app/comum/armazenamento/armazem.dart';
import 'package:toucamara_app/municipe/app_municipe.dart';
import 'package:toucamara_app/municipe/cartas.dart';
import 'package:toucamara_app/municipe/sessao.dart';

import '../apoio.dart';
import 'apoio_municipe.dart';

const codigo = 'ABCDEFGH23';

/// A carta como a API a devolve (`/v1/public/cartas/:codigo`).
Map<String, dynamic> respostaCarta({
  String prazoEstado = 'falta_data',
  bool daCamara = true,
  List<Map<String, dynamic>> respostas = const [],
  String estado = 'lida',
}) => {
  'codigo': codigo,
  'link': 'https://toucamara.pt/carta/$codigo',
  'estado': estado,
  'demonstracao': false,
  'leitura': {
    'da_camara': daCamara,
    'entidade_emissora': daCamara
        ? 'Câmara Municipal de Guimarães'
        : 'Autoridade Tributária e Aduaneira',
    'tipo': 'audiencia_previa',
    'tipo_rotulo': 'Notificação para audiência prévia',
    'assunto': 'Porta na cozinha',
    'explicacao': 'A câmara pensa recusar a obra porque falta um papel.',
    'o_que_e': 'A câmara diz-lhe o que pensa decidir antes de decidir.',
    'referencia': {'valor': 'CP 412/2026', 'excerto': 'Processo CP 412/2026'},
    'prazo_lido': {
      'encontrado': true,
      'dias': 10,
      'excerto': 'no prazo de 10 (dez) dias úteis',
    },
    'pedido': [
      {'o_que': 'Responder por escrito se não concordar.', 'excerto': 'x'},
    ],
    'valores': [],
    'consequencias': [
      {
        'texto': 'A câmara rejeita o pedido.',
        'excerto': 'será rejeitada',
        'origem': 'carta',
      },
    ],
    'termos': [
      {
        'termo': 'audiência prévia',
        'explicacao': 'Antes de decidir contra si, a câmara ouve-o.',
      },
    ],
    'motivo_ilegivel': null,
  },
  'prazo': prazoEstado == 'calculado'
      ? {
          'estado': 'calculado',
          'data_limite': '2026-11-05',
          'faltam_dias_uteis': 10,
          'faltam_dias': 14,
          'terminou': false,
          'regra': '10 dias úteis a partir do dia seguinte.',
          'dias': 10,
          'unidade': 'uteis',
        }
      : {
          'estado': prazoEstado,
          'data_limite': null,
          'dias': 10,
          'unidade': 'uteis',
          'terminou': false,
          'regra': '',
        },
  'pergunta_rececao': prazoEstado != 'calculado',
  'processo': daCamara
      ? {
          'numero': 'CP 412/2026',
          'assunto': 'Porta na cozinha',
          'fase_em_palavras': 'está a ser analisado pelo técnico',
        }
      : null,
  'encaminhamento': daCamara
      ? null
      : {
          'entidade': 'Autoridade Tributária e Aduaneira',
          'dizer': 'Esta carta não é da câmara: é da Autoridade Tributária.',
        },
  'respostas_possiveis': daCamara && estado != 'respondida'
      ? [
          {'tipo': 'pronuncia', 'rotulo': 'Responder por escrito (pronúncia)'},
          {'tipo': 'prorrogacao', 'rotulo': 'Pedir mais tempo'},
        ]
      : [],
  'respostas': respostas,
  'aviso': 'Esta explicação ajuda a perceber a carta.',
};

void main() {
  late ApiFalsa falsa;
  late ArmazemMemoria seguro;
  late CamaraFalsa camara;

  setUp(() {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(
          const MethodChannel('plugins.flutter.io/path_provider'),
          (_) async => Directory.systemTemp.path,
        );
    falsa = ApiFalsa();
    seguro = ArmazemMemoria();
    camara = CamaraFalsa();
    rotasMunicipe(falsa);
    falsa.em('GET /v1/app/cartas', (_) => (200, {'itens': []}));
  });

  Future<void> arrancar(WidgetTester tester) async {
    await seguro.escrever(
      ControladorSessaoMunicipe.chave,
      jsonEncode(respostaEntrarMunicipe()),
    );
    final s = await tester.runAsync(
      () => montarMunicipe(falsa, seguro: seguro, camara: camara),
    );
    await ecraTelemovel(tester, alto: true);
    await tester.pumpWidget(AppMunicipe(servicos: s!));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Não percebi uma carta'));
    await tester.pumpAndSettle();
    expect(find.text('Mostre-nos a carta'), findsOneWidget);
  }

  testWidgets(
    'Não percebi uma carta: foto → explicação → dia de receção → rascunho → entregar',
    (tester) async {
      falsa.em('POST /v1/app/cartas', (_) => (201, respostaCarta()));
      falsa.em(
        'POST /v1/public/cartas/$codigo/rececao',
        (_) => (200, respostaCarta(prazoEstado: 'calculado')),
      );
      final rascunho = {
        'id': 'r1',
        'tipo': 'pronuncia',
        'rotulo': 'Responder por escrito (pronúncia)',
        'texto': 'Exmo. Senhor Presidente…\n1. A parede não é estrutural.',
        'estado': 'rascunho',
        'numero_entrada': null,
      };
      falsa.em(
        'POST /v1/public/cartas/$codigo/respostas',
        (_) => (
          201,
          {
            'resposta_id': 'r1',
            'carta': respostaCarta(
              prazoEstado: 'calculado',
              respostas: [rascunho],
            ),
          },
        ),
      );
      falsa.em(
        'POST /v1/public/cartas/$codigo/respostas/r1/entregar',
        (_) => (
          200,
          {
            'entregue': true,
            'carta': respostaCarta(
              prazoEstado: 'calculado',
              estado: 'respondida',
              respostas: [
                {
                  ...rascunho,
                  'estado': 'entregue',
                  'numero_entrada': 'DEMO-CARTA-0001/2026',
                },
              ],
            ),
          },
        ),
      );
      await arrancar(tester);

      await tester.tap(find.text('Tirar fotografia'));
      await tester.runAsync(
        () => Future<void>.delayed(const Duration(milliseconds: 50)),
      );
      await tester.pumpAndSettle();
      expect(camara.tiradas, 1);
      final enviado = falsa.para('POST /v1/app/cartas').single.json as Map;
      expect(enviado['mime'], 'image/png');
      expect(enviado['ficheiro_base64'], isNotEmpty);

      expect(find.text('Notificação para audiência prévia'), findsOneWidget);
      expect(
        find.text('A câmara pensa recusar a obra porque falta um papel.'),
        findsOneWidget,
      );
      expect(find.textContaining('Diga-nos esse dia'), findsOneWidget);
      expect(find.textContaining('audiência prévia: '), findsOneWidget);

      await tester.tap(find.text('Recebi-a hoje'));
      await tester.pumpAndSettle();
      expect(find.text('Faltam 10 dias úteis.'), findsOneWidget);
      expect(find.text('Até 5 de novembro de 2026'), findsOneWidget);

      await tester.ensureVisible(
        find.text('Responder por escrito (pronúncia)'),
      );
      await tester.tap(find.text('Responder por escrito (pronúncia)'));
      await tester.pumpAndSettle();
      await tester.enterText(
        find.byType(TextField),
        'a parede não segura nada',
      );
      await tester.tap(find.text('Preparar'));
      await tester.pumpAndSettle();
      final preparado =
          falsa.para('POST /v1/public/cartas/$codigo/respostas').single.json
              as Map;
      expect(preparado, {
        'tipo': 'pronuncia',
        'argumentos': 'a parede não segura nada',
      });
      expect(
        find.text('Rascunho: Responder por escrito (pronúncia)'),
        findsOneWidget,
      );

      await tester.ensureVisible(find.text('Confirmar e entregar'));
      await tester.tap(find.text('Confirmar e entregar'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Sim, entregar'));
      await tester.pumpAndSettle();
      expect(find.text('Resposta entregue'), findsOneWidget);
      expect(find.textContaining('DEMO-CARTA-0001/2026'), findsOneWidget);
    },
  );

  testWidgets('Carta de outra entidade: diz de quem é', (tester) async {
    falsa.em(
      'POST /v1/app/cartas',
      (_) => (201, respostaCarta(daCamara: false)),
    );
    await arrancar(tester);
    await tester.tap(find.text('Escolher da galeria'));
    await tester.runAsync(
      () => Future<void>.delayed(const Duration(milliseconds: 50)),
    );
    await tester.pumpAndSettle();
    expect(find.text('Esta carta não é da câmara.'), findsOneWidget);
    expect(find.textContaining('Autoridade Tributária'), findsOneWidget);
    expect(find.text('Pedir mais tempo'), findsNothing);
  });

  testWidgets('Sem rede: diz para tentar depois (a carta não fica na fila)', (
    tester,
  ) async {
    await arrancar(tester);
    falsa.semRede = true;
    await tester.tap(find.text('Tirar fotografia'));
    await tester.runAsync(
      () => Future<void>.delayed(const Duration(milliseconds: 50)),
    );
    await tester.pumpAndSettle();
    expect(find.textContaining('Sem rede: para ler a carta'), findsOneWidget);
  });

  test('Carta.deJson é tolerante a campos em falta', () {
    final c = Carta.deJson({'codigo': codigo, 'estado': 'a_espera'});
    expect(c.leitura, isNull);
    expect(c.prazo, isNull);
    expect(c.daCamara, isTrue);
    final l = Carta.deJson(respostaCarta(prazoEstado: 'calculado'));
    expect(l.prazo!.calculado, isTrue);
    expect(l.processo!.numero, 'CP 412/2026');
    expect(l.respostasPossiveis.map((r) => r.tipo), [
      'pronuncia',
      'prorrogacao',
    ]);
  });
}
