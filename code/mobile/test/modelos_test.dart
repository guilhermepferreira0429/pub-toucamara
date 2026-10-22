import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:toucamara_app/comum/datas.dart';
import 'package:toucamara_app/comum/localizacao/localizacao.dart';
import 'package:toucamara_app/comum/plataforma/camara.dart';
import 'package:toucamara_app/comum/plataforma/navegar.dart';
import 'package:toucamara_app/comum/sessao/sessao.dart';
import 'package:toucamara_app/equipa/modelos.dart';

import 'apoio.dart';

void main() {
  group('proximidade', () {
    test('haversine como na API (~1,1 km por 0,01º de latitude)', () {
      expect(distanciaMetros(camaraGuimaraes, camaraGuimaraes), 0);
      final d = distanciaMetros(camaraGuimaraes, const Ponto(41.4525, -8.2918));
      expect(d, inInclusiveRange(1100, 1120));
    });

    test('por fazer da mais perto para a mais longe; sem local no fim; feitas depois', () {
      Tarefa t(String id, double? lat, {bool feita = false}) => Tarefa(
            tipo: TipoTarefa.ocorrencia, id: id, numero: id, titulo: '', resumo: '',
            morada: '', lat: lat, lng: lat == null ? null : -8.2918,
            estado: '', estadoNome: '', feita: feita,
          );
      final r = ordenarPorProximidade(
        [t('longe', 41.5), t('feita', 41.4426, feita: true), t('sem', null), t('perto', 41.443)],
        camaraGuimaraes,
      );
      expect(r.map((x) => x.id), ['perto', 'longe', 'sem', 'feita']);
      expect(r.first.distanciaM, greaterThan(0));
      expect(r[2].distanciaM, isNull);
    });

    test('sem localização: pelo número', () {
      final dia = DiaDeTrabalho.deJson(respostaHoje(), obtidoEm: DateTime(2026));
      final r = ordenarPorProximidade(dia.tarefas, null);
      expect(r.map((t) => t.numero), ['FIS-2026-0001', 'OC-2026-0001', 'OC-2026-0003']);
      expect(r.every((t) => t.distanciaM == null), isTrue);
    });

    test('distância legível', () {
      expect(distanciaLegivel(null), '');
      expect(distanciaLegivel(3), '10 m');
      expect(distanciaLegivel(347), '350 m');
      expect(distanciaLegivel(1234), '1,2 km');
      expect(distanciaLegivel(15400), '15 km');
    });
  });

  group('leitura das respostas da API', () {
    test('Hoje', () {
      final d = DiaDeTrabalho.deJson(respostaHoje(), obtidoEm: DateTime(2026));
      expect(d.porFazer, 3);
      final v = d.tarefas.firstWhere((t) => t.tipo == TipoTarefa.visita);
      expect(v.janela, '10:00–11:00');
      expect(v.ponto?.lat, 41.4432);
      final o = d.tarefas.firstWhere((t) => t.id == 'oc-perto');
      expect(o.reportes, 3);
      expect(o.estadoNome, 'Com a equipa');
    });

    test('visita: checklist, conformidade, relatório', () {
      final v = VisitaDetalhe(respostaVisita());
      expect(v.aberta, isTrue);
      expect(v.valoresDemonstracao, isTrue);
      final i = v.checklist.single;
      expect(i.naoConforme, isFalse);
      i.resposta = 'nao';
      expect(i.naoConforme, isTrue);
      i.nota = '  sem aviso ';
      expect(i.paraResposta(), {'chave': 'licenca_afixada', 'resposta': 'nao', 'nota': 'sem aviso'});
      i.resposta = 'na';
      expect(i.naoConforme, isFalse);
      expect(v.relatorioFechado, isFalse);
    });

    test('ocorrência: fotos do munícipe e do depois, duplicados', () {
      final j = respostaOcorrencia();
      (j['fotos'] as List).add({'id': 'f-2', 'url': 'https://x', 'origem': 'equipa', 'legenda': 'Depois'});
      final o = OcorrenciaDetalhe(j);
      expect(o.aberta, isTrue);
      expect(o.fotosMunicipe.map((f) => f.id), ['f-1']);
      expect(o.fotosDepois.single.legenda, 'Depois');
      expect(o.duplicados, hasLength(2));
      expect(o.estadoNome, 'Com a equipa');
    });

    test('sessão: resposta de entrar e de volta (guardada)', () {
      final s = Sessao.daResposta(respostaEntrar());
      expect(s.nome, 'Rui Fiscal');
      expect(s.servicoId, 'srv-1');
      expect(s.municipioNome, 'Guimarães');
      expect(s.perfilLegivel, 'Técnico / fiscal');
      expect(s.expirada, isFalse);
      final de2 = Sessao.daResposta(s.paraJson());
      expect(de2.token, s.token);
      expect(de2.municipioSlug, 'guimaraes');
    });
  });

  group('fotografias e navegação', () {
    test('tipo da fotografia pelos bytes', () {
      expect(mimeDe(null, 'x', png1px), 'image/png');
      expect(mimeDe(null, 'x', Uint8List.fromList([0xFF, 0xD8, 0xFF, 0xE0])), 'image/jpeg');
      expect(mimeDe('image/heic', 'a.heic', Uint8List.fromList([0, 0, 0, 0])), 'image/heic');
    });

    test('corpo da fotografia com GPS e hora (UTC)', () {
      final f = FotoTirada(
          bytes: png1px, mime: 'image/png', tiradaEm: DateTime.utc(2026, 10, 22, 9),
          local: const Ponto(41.44, -8.29));
      expect(f.corpo(legenda: ' Depois '), {
        'mime': 'image/png', 'legenda': 'Depois', 'lat': 41.44, 'lng': -8.29,
        'tirada_em': '2026-10-22T09:00:00.000Z',
      });
    });

    test('navegar: geo: com o ponto e o Google Maps como alternativa', () {
      final l = enderecosNavegacao(lat: 41.44, lng: -8.29, morada: 'Largo do Toural');
      expect(l.first.scheme, 'geo');
      expect(l.first.toString(), startsWith('geo:41.44,-8.29?q=41.44,-8.29('));
      expect(l.last.host, 'www.google.com');
      expect(l.last.queryParameters['destination'], '41.44,-8.29');
      final semPonto = enderecosNavegacao(morada: 'Rua X, 1');
      expect(semPonto.last.queryParameters['destination'], 'Rua X, 1');
    });

    test('datas em português', () {
      expect(diaPorExtenso(DateTime(2026, 10, 22)), 'quinta-feira, 22 de outubro');
      expect(diaCurto('2026-10-05'), '05/10');
      expect(quando(DateTime(2026, 10, 22, 9, 5), agora: DateTime(2026, 10, 22, 18)), 'hoje às 09:05');
    });
  });
}
