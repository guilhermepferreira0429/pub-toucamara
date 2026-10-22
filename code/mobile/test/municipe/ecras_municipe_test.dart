import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:toucamara_app/comum/armazenamento/armazem.dart';
import 'package:toucamara_app/municipe/app_municipe.dart';
import 'package:toucamara_app/municipe/notificacoes.dart';
import 'package:toucamara_app/municipe/sessao.dart';
import 'package:toucamara_app/municipe/servicos.dart';

import '../apoio.dart';
import 'apoio_municipe.dart';

/// Os ecrãs principais da app do munícipe com a API falsa.
void main() {
  late ApiFalsa falsa;
  late ArmazemMemoria seguro;
  late CamaraFalsa camara;

  setUp(() {
    // A cache de mosaicos do flutter_map pede a pasta ao path_provider.
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(
          const MethodChannel('plugins.flutter.io/path_provider'),
          (_) async => Directory.systemTemp.path,
        );
    falsa = ApiFalsa();
    seguro = ArmazemMemoria();
    camara = CamaraFalsa();
    rotasMunicipe(falsa);
  });

  Future<ServicosMunicipe> arrancar(
    WidgetTester tester, {
    bool comSessao = false,
    bool alto = false,
    NotificacoesFalsas? notificacoes,
  }) async {
    if (comSessao) {
      await seguro.escrever(
        ControladorSessaoMunicipe.chave,
        jsonEncode(respostaEntrarMunicipe()),
      );
    }
    final s = await tester.runAsync(
      () => montarMunicipe(
        falsa,
        seguro: seguro,
        camara: camara,
        notificacoes: notificacoes,
      ),
    );
    await ecraTelemovel(tester, alto: alto);
    await tester.pumpWidget(AppMunicipe(servicos: s!));
    await tester.pumpAndSettle();
    return s;
  }

  testWidgets('Entrar: telemóvel → código errado → certo → Início', (
    tester,
  ) async {
    await arrancar(tester);
    expect(find.text('Porquê o telemóvel?'), findsOneWidget);
    await tester.enterText(find.byType(TextField), '21234');
    await tester.tap(find.text('Enviar código por SMS'));
    await tester.pumpAndSettle();
    expect(find.textContaining('9 algarismos'), findsOneWidget);

    await tester.enterText(find.byType(TextField), '912 000 001');
    await tester.tap(find.text('Enviar código por SMS'));
    await tester.pumpAndSettle();
    expect(find.textContaining('+351 9•• ••• 001'), findsOneWidget);

    await tester.enterText(find.byType(TextField), '000000');
    await tester.tap(find.widgetWithText(FilledButton, 'Entrar'));
    await tester.pumpAndSettle();
    expect(find.text('Código errado. Restam 4 tentativas.'), findsOneWidget);

    await tester.enterText(find.byType(TextField), '123456');
    await tester.tap(find.widgetWithText(FilledButton, 'Entrar'));
    await tester.pumpAndSettle();
    expect(find.text('Olá, Maria!'), findsOneWidget);
    expect(
      falsa.para('POST /v1/public/app/entrar').last.json,
      containsPair('municipio', 'guimaraes'),
    );
    expect(
      falsa.para('GET /v1/app/eu').last.cabecalhos['Authorization'],
      'Bearer tca_${'a' * 32}',
    );
  });

  testWidgets(
    'Início: emergência no topo, atalhos grandes e o resumo do feed',
    (tester) async {
      await arrancar(tester, comSessao: true, alto: true);
      final emergencia = tester
          .getTopLeft(find.text('Corte de água urgente'))
          .dy;
      final atalho = tester.getTopLeft(find.text('Falar com a câmara')).dy;
      expect(emergencia, lessThan(atalho));
      for (final a in [
        'Falar com a câmara',
        'Ligar',
        'Reportar um problema',
        'Os meus assuntos',
      ]) {
        final r = tester.getSize(
          find.ancestor(of: find.text(a), matching: find.byType(InkWell)).first,
        );
        expect(r.height, greaterThanOrEqualTo(48));
      }
      expect(find.text('Obras na Rua de Santo António'), findsOneWidget);
      expect(
        find.bySemanticsLabel(RegExp('^Emergência: Corte de água urgente')),
        findsOneWidget,
      );
    },
  );

  testWidgets('Perto de mim: lista, filtro por tipo e detalhe com Avisar-me', (
    tester,
  ) async {
    falsa.em(
      'GET /v1/public/agora/guimaraes/obras/*',
      (_) => (
        200,
        {
          'item': respostaFeed()['itens'][0],
          'texto': 'Repavimentação da rua.',
          'quando': 'até 29 de outubro',
        },
      ),
    );
    falsa.em(
      'POST /v1/app/agora/subscricoes',
      (_) =>
          (201, {'subscrito': true, 'mensagem': 'Fica combinado: avisamos.'}),
    );
    final s = await arrancar(tester, comSessao: true, alto: true);
    s.navegacao.separador.value = Navegacao.perto;
    await tester.pumpAndSettle();
    expect(find.text('3 coisas a acontecer'), findsOneWidget);
    expect(find.text('Valores de demonstração'), findsOneWidget);

    await tester.ensureVisible(
      find.widgetWithText(FilterChip, 'Obras e cortes'),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilterChip, 'Obras e cortes'));
    await tester.pumpAndSettle();
    expect(
      falsa
          .para('GET /v1/public/agora/guimaraes')
          .last
          .url
          .queryParameters['tipos'],
      'obras',
    );

    await tester.tap(find.text('Obras na Rua de Santo António').last);
    await tester.pumpAndSettle();
    expect(find.text('Repavimentação da rua.'), findsOneWidget);
    expect(find.text('até 29 de outubro'), findsOneWidget);
    await tester.tap(find.text('Avisar-me de coisas assim'));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton, 'Avisar-me'));
    await tester.pumpAndSettle();
    expect(find.text('Fica combinado: avisamos.'), findsOneWidget);
    final corpo =
        falsa.para('POST /v1/app/agora/subscricoes').single.json as Map;
    expect(corpo['tipos'], ['obras']);
    expect(corpo['lat'], 41.4428);
  });

  testWidgets('Os meus assuntos: processo com o que falta e a linha do tempo', (
    tester,
  ) async {
    final s = await arrancar(tester, comSessao: true, alto: true);
    s.navegacao.separador.value = Navegacao.assuntos;
    await tester.pumpAndSettle();
    expect(find.text('Anexo no quintal'), findsOneWidget);
    await tester.tap(find.text('Anexo no quintal'));
    await tester.pumpAndSettle();
    expect(find.text('O que falta da sua parte'), findsOneWidget);
    expect(
      find.text('Planta de localização (até 30 de outubro de 2026)'),
      findsOneWidget,
    );
    expect(find.text('Pedido de documentos'), findsWidgets);
    expect(find.text('Enviar documentos'), findsOneWidget);

    Navigator.of(tester.element(find.text('O que falta da sua parte'))).pop();
    await tester.pumpAndSettle();
    // O separador está fora do ecrã (a barra desliza).
    DefaultTabController.of(
      tester.element(find.text('Anexo no quintal')),
    ).index = 5;
    await tester.pumpAndSettle();
    expect(find.text('Foi resolvida a 18/10/2026.'), findsOneWidget);
  });

  testWidgets('Reportar: categoria → foto → sítio → descrição → "Já sabemos"', (
    tester,
  ) async {
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
      'POST /v1/public/ocorrencias/*/fotos',
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
    final s = await arrancar(tester, comSessao: true, alto: true);
    await tester.tap(find.text('Reportar um problema'));
    await tester.pumpAndSettle();
    expect(find.text('Passo 1 de 5'), findsOneWidget);
    await tester.tap(find.text('Buraco na via'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Tirar fotografia'));
    await tester.pumpAndSettle();
    expect(camara.tiradas, 1);
    await tester.tap(find.text('Seguir'));
    await tester.pumpAndSettle();
    expect(find.text('Sítio marcado'), findsOneWidget);
    await tester.tap(find.text('Seguir'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField).first, 'Buraco grande');
    await tester.pumpAndSettle();
    await tester.tap(find.text('Seguir'));
    await tester.pumpAndSettle();
    expect(find.text('Com fotografia'), findsOneWidget);
    await tester.tap(find.text('Enviar'));
    await tester.runAsync(
      () => Future<void>.delayed(const Duration(milliseconds: 100)),
    );
    await tester.pumpAndSettle();
    expect(find.text('Já sabemos!'), findsOneWidget);
    expect(find.text('N.º OC-0002'), findsOneWidget);
    expect(s.fila.porEnviar, 0);
    expect(falsa.para('PUT /f.png'), hasLength(1));
  });

  testWidgets('Reportar sem rede: fica guardado no telemóvel', (tester) async {
    final s = await arrancar(tester, comSessao: true, alto: true);
    await tester.tap(find.text('Reportar um problema'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Buraco na via'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Seguir sem foto'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Seguir'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField).first, 'Buraco grande');
    await tester.pumpAndSettle();
    await tester.tap(find.text('Seguir'));
    await tester.pumpAndSettle();
    falsa.semRede = true;
    await tester.tap(find.text('Enviar'));
    await tester.runAsync(
      () => Future<void>.delayed(const Duration(milliseconds: 100)),
    );
    await tester.pumpAndSettle();
    expect(find.text('Fica guardado no telemóvel'), findsOneWidget);
    expect(s.fila.porEnviar, 1);
  });

  testWidgets(
    'Avisos recebidos e Definições (notificações por configurar, letra, sair)',
    (tester) async {
      final s = await arrancar(tester, comSessao: true, alto: true);
      s.navegacao.separador.value = Navegacao.avisos;
      await tester.pumpAndSettle();
      expect(find.text('Risco de cheia no rio Ave'), findsOneWidget);
      expect(find.text('Suba para um andar alto.'), findsOneWidget);
      expect(find.text('Urgente'), findsOneWidget);

      s.navegacao.separador.value = Navegacao.definicoes;
      await tester.pumpAndSettle();
      expect(find.text('Notificações: por configurar'), findsOneWidget);
      await tester.tap(find.text('Avisos da câmara'));
      await tester.pumpAndSettle();
      expect(
        jsonDecode(
          utf8.decode(falsa.para('PUT /v1/app/eu/preferencias').single.bytes),
        ),
        {
          'tipos': {'avisos': false},
        },
      );
      await tester.tap(find.bySemanticsLabel('Muito grande'));
      await tester.pumpAndSettle();
      expect(s.letra.escala, 1.5);

      await tester.tap(find.text('Sair'));
      await tester.pumpAndSettle();
      await tester.tap(find.widgetWithText(FilledButton, 'Sair'));
      await tester.pumpAndSettle();
      expect(find.text('Porquê o telemóvel?'), findsOneWidget);
      expect(falsa.para('POST /v1/app/sair'), hasLength(1));
      expect(await seguro.ler(ControladorSessaoMunicipe.chave), isNull);
    },
  );

  testWidgets('Notificações: tocar abre o processo (data.link) ou os avisos', (
    tester,
  ) async {
    final n = NotificacoesFalsas();
    final s = await arrancar(
      tester,
      comSessao: true,
      alto: true,
      notificacoes: n,
    );
    expect(n.registos, 1);
    n.abrir!('/processos/$idProcesso');
    await tester.pumpAndSettle();
    expect(find.text('O que falta da sua parte'), findsOneWidget);
    n.abrir!('/avisos');
    await tester.pumpAndSettle();
    expect(s.navegacao.separador.value, Navegacao.avisos);
    expect(find.text('Risco de cheia no rio Ave'), findsOneWidget);
    n.receber!(
      const NotificacaoRecebida(
        titulo: 'O seu processo avançou',
        corpo: 'CP 1/2026',
        link: '/avisos',
      ),
    );
    await tester.pump();
    expect(find.textContaining('O seu processo avançou'), findsOneWidget);
  });
}
