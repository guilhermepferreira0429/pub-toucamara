import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:toucamara_app/comum/armazenamento/armazem.dart';
import 'package:toucamara_app/comum/armazenamento/ficheiros.dart';
import 'package:toucamara_app/comum/localizacao/localizacao.dart';
import 'package:toucamara_app/comum/plataforma/ditado.dart';
import 'package:toucamara_app/comum/sessao/sessao.dart';
import 'package:toucamara_app/equipa/app_equipa.dart';
import 'package:toucamara_app/equipa/servicos.dart';

import 'apoio.dart';

/// Os ecrãs principais com a API falsa (sem rede real, sem GPS, sem câmara).
void main() {
  late ApiFalsa falsa;
  late ArmazemMemoria prefs;
  late ArmazemMemoria seguro;
  late CamaraFalsa camara;

  setUp(() {
    falsa = ApiFalsa();
    prefs = ArmazemMemoria();
    seguro = ArmazemMemoria();
    camara = CamaraFalsa();
    falsa.em(
      'POST /v1/painel/auth/app/codigo',
      (_) => (202, {'enviado': true, 'validade_minutos': 10}),
    );
    falsa.em('POST /v1/painel/auth/app/entrar', (p) {
      final codigo = (p.json as Map)['codigo'];
      return codigo == '123456'
          ? (200, respostaEntrar())
          : (
              400,
              erro('codigo_errado', 'Código errado.', {
                'tentativas_restantes': 4,
              }),
            );
    });
    falsa.em('GET /v1/painel/equipa/hoje', (_) => (200, respostaHoje()));
    falsa.em(
      'GET /v1/painel/ocorrencias/*',
      (_) => (200, respostaOcorrencia()),
    );
    falsa.em(
      'GET /v1/painel/fiscalizacao/visitas/*',
      (_) => (200, respostaVisita()),
    );
  });

  /// [alto]: ecrã comprido, para os ecrãs de detalhe caberem sem deslizar.
  Future<Servicos> arrancar(
    WidgetTester tester, {
    bool comSessao = false,
    bool alto = false,
  }) async {
    if (comSessao) {
      final s = Sessao.daResposta(respostaEntrar());
      await seguro.escrever('sessao_equipa_v1', jsonDaSessao(s));
    }
    final servicos = await tester.runAsync(
      () => Servicos.montar(
        prefs: prefs,
        seguro: seguro,
        ficheiros: GuardaFicheirosArmazem(prefs),
        localizador: LocalizadorFixo(camaraGuimaraes),
        ditado: DitadoIndisponivel(),
        camara: camara,
        cliente: falsa.cliente,
      ),
    );
    await tester.binding.setSurfaceSize(Size(390, alto ? 2400 : 844));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await tester.pumpWidget(AppEquipa(servicos: servicos!));
    await tester.pumpAndSettle();
    return servicos;
  }

  testWidgets(
    'Entrar: email → código errado (mostra tentativas) → certo → Hoje',
    (tester) async {
      await arrancar(tester);
      expect(find.text('Entrar'), findsWidgets);
      await tester.enterText(find.byType(TextField), 'rui@camara.pt');
      await tester.tap(find.text('Enviar código'));
      await tester.pumpAndSettle();
      expect(find.textContaining('Enviámos um código'), findsOneWidget);
      expect(falsa.para('POST /v1/painel/auth/app/codigo').single.json, {
        'email': 'rui@camara.pt',
      });

      await tester.enterText(find.byType(TextField), '000000');
      await tester.tap(find.widgetWithText(FilledButton, 'Entrar'));
      await tester.pumpAndSettle();
      expect(find.text('Código errado. Restam 4 tentativas.'), findsOneWidget);

      await tester.enterText(find.byType(TextField), '123456');
      await tester.tap(find.widgetWithText(FilledButton, 'Entrar'));
      await tester.pumpAndSettle();
      expect(find.text('3 tarefas por fazer'), findsOneWidget);
      expect(await seguro.ler('sessao_equipa_v1'), contains('jwt-de-teste'));
      expect(
        falsa
            .para('GET /v1/painel/equipa/hoje')
            .last
            .cabecalhos['Authorization'],
        'Bearer jwt-de-teste',
      );
    },
  );

  testWidgets(
    'Hoje: ordenadas pela distância a onde estou, com a distância e "Navegar"',
    (tester) async {
      final s = await arrancar(tester, comSessao: true);
      final hoje = falsa.para('GET /v1/painel/equipa/hoje').single;
      expect(hoje.url.queryParameters['lat'], '41.442500');
      expect(s.repositorio.dia!.tarefas.map((t) => t.numero), [
        'OC-2026-0001',
        'FIS-2026-0001',
        'OC-2026-0003',
      ]);
      // O primeiro cartão (o mais perto) está no topo do ecrã.
      final primeiro = tester
          .getTopLeft(find.text('Ocorrência · OC-2026-0001'))
          .dy;
      final segundo = tester.getTopLeft(find.text('Visita · FIS-2026-0001')).dy;
      expect(primeiro, lessThan(segundo));
      expect(find.text('10 m'), findsOneWidget);
      expect(find.text('3 pessoas avisaram'), findsOneWidget);
      expect(find.text('Navegar até lá'), findsWidgets);
    },
  );

  testWidgets('Sem rede: abre com as tarefas guardadas e avisa', (
    tester,
  ) async {
    final s = await arrancar(tester, comSessao: true);
    falsa.semRede = true;
    await tester.runAsync(() => s.repositorio.carregarHoje());
    await tester.pumpAndSettle();
    expect(find.textContaining('Sem rede · dados de'), findsOneWidget);
    expect(find.text('3 tarefas por fazer'), findsOneWidget);
  });

  testWidgets(
    'Ocorrência sem rede: fechar com foto fica "por enviar" e vai quando a rede volta',
    (tester) async {
      final s = await arrancar(tester, comSessao: true, alto: true);
      await tester.tap(find.text('Buraco na via'));
      await tester.pumpAndSettle();
      expect(find.text('Buraco grande junto à passadeira'), findsOneWidget);
      expect(find.text('OUTROS AVISOS DO MESMO PROBLEMA (2)'), findsOneWidget);

      falsa.semRede = true;
      await tester.tap(find.text('Fechar com foto do depois'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Câmara'));
      await tester.pumpAndSettle();
      expect(camara.tiradas, 1);
      expect(find.textContaining('GPS 41.44250'), findsOneWidget);
      await tester.enterText(find.byType(TextField), 'Buraco tapado.');
      await tester.ensureVisible(find.text('Fechar e avisar quem reportou'));
      await tester.tap(find.text('Fechar e avisar quem reportou'));
      await tester.runAsync(
        () => Future<void>.delayed(const Duration(milliseconds: 50)),
      );
      await tester.pumpAndSettle();

      expect(s.fila.porEnviar, 2);
      expect(find.text('2 por enviar'), findsOneWidget);
      expect(find.text('Resolvida · por enviar'), findsOneWidget);

      // A rede volta.
      falsa.semRede = false;
      falsa.em(
        'POST /v1/painel/equipa/ocorrencias/oc-perto/fotos',
        (_) => (
          201,
          {
            'foto_id': 'foto-1',
            'url_envio': 'https://s3.teste/f.png',
            'cabecalhos': {'Content-Type': 'image/png'},
          },
        ),
      );
      falsa.em('PUT /f.png', (_) => (200, null));
      falsa.em(
        'POST /v1/painel/equipa/ocorrencias/oc-perto/fechar',
        (_) => (200, respostaOcorrencia(estado: 'resolvida')..['avisados'] = 3),
      );
      await tester.runAsync(() => s.fila.enviar());
      await tester.pumpAndSettle();
      expect(s.fila.porEnviar, 0);
      expect(
        falsa
            .para('POST /v1/painel/equipa/ocorrencias/oc-perto/fechar')
            .single
            .json,
        {
          'nota': 'Buraco tapado.',
          'foto_ids': ['foto-1'],
        },
      );
    },
  );

  testWidgets(
    'Visita: checklist, relatório escrito e concluir vão para a fila',
    (tester) async {
      final s = await arrancar(tester, comSessao: true, alto: true);
      await tester.tap(find.text('Fiscalização de obra particular'));
      await tester.pumpAndSettle();
      expect(find.text('valores de demonstração'), findsOneWidget);
      expect(find.text('O aviso da licença está afixado?'), findsOneWidget);

      falsa.semRede = true;
      await tester.tap(find.text('Não'));
      await tester.pumpAndSettle();
      expect(find.text('Não conforme'), findsOneWidget);
      final relatorio = find.widgetWithText(TextField, 'Relatório');
      await tester.ensureVisible(relatorio);
      await tester.enterText(
        relatorio,
        'Obra em curso sem o aviso da licença afixado.',
      );
      await tester.ensureVisible(find.text('Concluir visita'));
      await tester.tap(find.text('Concluir visita'));
      await tester.pumpAndSettle();
      await tester.tap(find.widgetWithText(FilledButton, 'Concluir'));
      await tester.runAsync(
        () => Future<void>.delayed(const Duration(milliseconds: 50)),
      );
      await tester.pumpAndSettle();

      final acoes = s.fila.acoes;
      expect(acoes.map((a) => a.caminho), [
        '/painel/fiscalizacao/visitas/v-1/relatorio',
        '/painel/fiscalizacao/visitas/v-1/concluir',
      ]);
      expect(acoes.first.corpo, {
        'texto': 'Obra em curso sem o aviso da licença afixado.',
        'checklist': [
          {'chave': 'licenca_afixada', 'resposta': 'nao'},
        ],
      });
      expect(find.text('Concluída · por enviar'), findsOneWidget);
    },
  );

  testWidgets('Sessão: sair pede confirmação e volta a Entrar', (tester) async {
    falsa.em('POST /v1/painel/auth/app/sair', (_) => (200, {'revogada': true}));
    await arrancar(tester, comSessao: true);
    await tester.tap(find.text('Sessão'));
    await tester.pumpAndSettle();
    expect(find.text('Rui Fiscal'), findsOneWidget);
    await tester.ensureVisible(find.widgetWithText(FilledButton, 'Sair'));
    await tester.tap(find.widgetWithText(FilledButton, 'Sair'));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton, 'Sair').last);
    await tester.runAsync(
      () => Future<void>.delayed(const Duration(milliseconds: 20)),
    );
    await tester.pumpAndSettle();
    expect(find.text('Enviar código'), findsOneWidget);
    expect(falsa.para('POST /v1/painel/auth/app/sair'), hasLength(1));
    expect(await seguro.ler('sessao_equipa_v1'), isNull);
  });
}

String jsonDaSessao(Sessao s) => jsonEncode(s.paraJson());
