import 'package:flutter_test/flutter_test.dart';
import 'package:toucamara_app/comum/api/cliente_api.dart';
import 'package:toucamara_app/comum/armazenamento/armazem.dart';
import 'package:toucamara_app/comum/armazenamento/ficheiros.dart';
import 'package:toucamara_app/comum/fila/fila_offline.dart';

import 'apoio.dart';

void main() {
  late ApiFalsa falsa;
  late ClienteApi api;
  late ArmazemMemoria armazem;
  String? dono = 'u-1';

  FilaOffline novaFila() => FilaOffline(
    armazem: armazem,
    ficheiros: GuardaFicheirosArmazem(armazem),
    api: api,
    dono: () => dono,
  );

  setUp(() {
    falsa = ApiFalsa();
    api = ClienteApi(servidor: () => 'http://api', cliente: falsa.cliente)
      ..token = 't';
    armazem = ArmazemMemoria();
    dono = 'u-1';
  });

  test(
    'sem rede fica guardado (sobrevive a reabrir a app) e envia quando volta, com a mesma chave',
    () async {
      falsa.semRede = true;
      falsa.em(
        'PATCH /v1/painel/ocorrencias/o1',
        (_) => (200, {'id': 'o1', 'numero': 'OC-1'}),
      );
      final fila = novaFila();
      final a = await fila.pedido(
        descricao: 'Com a equipa',
        alvo: 'o1',
        metodo: 'PATCH',
        caminho: '/painel/ocorrencias/o1',
        corpo: {'estado': 'com_equipa'},
      );
      final r1 = await fila.enviar();
      expect(r1.semRede, isTrue);
      expect(fila.porEnviar, 1);
      expect(fila.acoes.single.tentativas, greaterThanOrEqualTo(1));
      expect(fila.ultimaFalhaRede, isNotNull);

      // A app fecha e volta a abrir.
      final outra = novaFila();
      await outra.carregar();
      expect(outra.porEnviar, 1);
      expect(outra.temPendentes('o1'), isTrue);

      falsa.semRede = false;
      final enviados = <String>[];
      outra.aoEnviar = (acao, _) => enviados.add(acao.id);
      final r2 = await outra.enviar();
      expect(r2.enviadas, 1);
      expect(outra.porEnviar, 0);
      expect(outra.ultimaFalhaRede, isNull);
      expect(enviados, [a.id]);
      expect(falsa.pedidos.single.cabecalhos['Idempotency-Key'], a.id);
      expect(falsa.pedidos.single.json, {'estado': 'com_equipa'});
    },
  );

  test('envia por ordem e pára no primeiro erro transitório (503)', () async {
    var disponivel = false;
    falsa.em('POST /v1/a', (_) => (200, {}));
    falsa.em(
      'POST /v1/b',
      (_) => disponivel
          ? (200, {})
          : (503, erro('armazenamento_indisponivel', 'S3 por configurar.')),
    );
    falsa.em('POST /v1/c', (_) => (200, {}));
    final fila = novaFila();
    for (final c in ['a', 'b', 'c']) {
      await fila.pedido(
        descricao: c,
        alvo: 'x',
        metodo: 'POST',
        caminho: '/$c',
        enviarJa: false,
      );
    }
    final r = await fila.enviar();
    expect(r.enviadas, 1);
    expect(r.semRede, isTrue);
    expect(fila.acoes.map((a) => a.descricao), ['b', 'c']);
    expect(fila.acoes.first.ultimoErro, 'S3 por configurar.');
    expect(falsa.para('POST /v1/c'), isEmpty);

    disponivel = true;
    final r2 = await fila.enviar();
    expect(r2.enviadas, 2);
    expect(fila.porEnviar, 0);
  });

  test(
    'erro definitivo (409) fica marcado e não bloqueia as seguintes; descartar e tentar de novo',
    () async {
      falsa.em(
        'POST /v1/a',
        (_) => (409, erro('visita_fechada', 'A visita já está feita.')),
      );
      falsa.em('POST /v1/b', (_) => (200, {}));
      final fila = novaFila();
      await fila.pedido(
        descricao: 'a',
        alvo: 'x',
        metodo: 'POST',
        caminho: '/a',
        enviarJa: false,
      );
      await fila.pedido(
        descricao: 'b',
        alvo: 'x',
        metodo: 'POST',
        caminho: '/b',
        enviarJa: false,
      );
      final r = await fila.enviar();
      expect(r.enviadas, 1);
      expect(r.falharam, 1);
      expect(fila.falhadas, 1);
      final a = fila.acoes.single;
      expect(a.estado, EstadoAcao.falhou);
      expect(a.ultimoErro, 'A visita já está feita.');

      // Outra volta não a tenta (fica à espera da pessoa).
      await fila.enviar();
      expect(falsa.para('POST /v1/a'), hasLength(1));

      falsa.em('POST /v1/a', (_) => (200, {}));
      await fila.tentarDeNovo(a.id);
      expect(fila.porEnviar, 0);
      expect(falsa.para('POST /v1/a').last.cabecalhos['Idempotency-Key'], a.id);

      await fila.pedido(
        descricao: 'z',
        alvo: 'x',
        metodo: 'POST',
        caminho: '/z',
        enviarJa: false,
      );
      await fila.descartar(fila.acoes.single.id);
      expect(fila.porEnviar, 0);
    },
  );

  test(
    'foto do depois: pede a URL, envia o ficheiro (PUT) e o fecho leva o foto_id',
    () async {
      falsa.em(
        'POST /v1/painel/equipa/ocorrencias/o1/fotos',
        (p) => (
          201,
          {
            'foto_id': 'foto-99',
            'url_envio': 'https://s3.teste/guimaraes/x.png?assinado',
            'metodo': 'PUT',
            'cabecalhos': {'Content-Type': 'image/png'},
          },
        ),
      );
      falsa.em('PUT /guimaraes/x.png', (_) => (200, null));
      falsa.em(
        'POST /v1/painel/equipa/ocorrencias/o1/fechar',
        (_) => (200, {'id': 'o1', 'numero': 'OC-1'}),
      );
      falsa.semRede = true;
      final fila = novaFila();
      final foto = await fila.ficheiro(
        descricao: 'Foto',
        alvo: 'o1',
        caminho: '/painel/equipa/ocorrencias/o1/fotos',
        corpo: {'mime': 'image/png', 'lat': 41.4, 'lng': -8.2},
        bytes: png1px,
        enviarJa: false,
      );
      await fila.pedido(
        descricao: 'Fechar',
        alvo: 'o1',
        metodo: 'POST',
        caminho: '/painel/equipa/ocorrencias/o1/fechar',
        corpo: {'nota': 'Tapado', 'foto_ids': <String>[]},
        usarResultados: {
          'foto_ids': [foto.id],
        },
      );
      await fila.enviar();
      expect(fila.porEnviar, 2);
      expect(await fila.bytesDe(fila.acoes.first), png1px);

      falsa.semRede = false;
      final r = await fila.enviar();
      expect(r.enviadas, 2);
      final put = falsa.pedidos.firstWhere((p) => p.metodo == 'PUT');
      expect(put.url.host, 's3.teste');
      expect(put.bytes, png1px);
      expect(put.cabecalhos['Content-Type'], startsWith('image/png'));
      expect(
        falsa
            .para('POST /v1/painel/equipa/ocorrencias/o1/fotos')
            .single
            .cabecalhos['Idempotency-Key'],
        foto.id,
      );
      final fechar = falsa
          .para('POST /v1/painel/equipa/ocorrencias/o1/fechar')
          .single;
      expect(fechar.json, {
        'nota': 'Tapado',
        'foto_ids': ['foto-99'],
      });
      // O ficheiro apaga-se do telemóvel depois de enviado.
      expect(
        armazem.dados.keys.where((k) => k.startsWith('ficheiro:')),
        isEmpty,
      );
    },
  );

  test(
    'se o PUT falhar a meio, não volta a pedir a URL (passo 1 guardado)',
    () async {
      var putOk = false;
      falsa.em(
        'POST /v1/f',
        (_) => (
          201,
          {
            'foto_id': 'f1',
            'url_envio': 'https://s3.teste/k',
            'cabecalhos': {'Content-Type': 'image/png'},
          },
        ),
      );
      falsa.em('PUT /k', (_) => putOk ? (200, null) : (500, null));
      final fila = novaFila();
      await fila.ficheiro(
        descricao: 'f',
        alvo: 'v',
        caminho: '/f',
        corpo: {'mime': 'image/png'},
        bytes: png1px,
        enviarJa: false,
      );
      final r1 = await fila.enviar();
      expect(r1.semRede, isTrue);
      expect(fila.acoes.single.intermedio?['foto_id'], 'f1');
      putOk = true;
      await fila.enviar();
      expect(fila.porEnviar, 0);
      expect(falsa.para('POST /v1/f'), hasLength(1));
      expect(falsa.para('PUT /k'), hasLength(2));
    },
  );

  test('as ações de outra pessoa não se enviam com esta sessão', () async {
    falsa.em('POST /v1/a', (_) => (200, {}));
    final fila = novaFila();
    await fila.pedido(
      descricao: 'a',
      alvo: 'x',
      metodo: 'POST',
      caminho: '/a',
      enviarJa: false,
    );
    dono = 'u-2';
    expect(fila.porEnviar, 0);
    await fila.enviar();
    expect(falsa.pedidos, isEmpty);
    dono = 'u-1';
    expect(fila.porEnviar, 1);
    await fila.enviar();
    expect(falsa.pedidos, hasLength(1));
  });

  test('o que se junta enquanto uma volta corre vai na mesma volta', () async {
    falsa.em('POST /v1/a', (_) => (200, {}));
    falsa.em('POST /v1/b', (_) => (200, {}));
    final fila = novaFila();
    await fila.pedido(
      descricao: 'a',
      alvo: 'x',
      metodo: 'POST',
      caminho: '/a',
      enviarJa: false,
    );
    final volta = fila.enviar();
    await fila.pedido(descricao: 'b', alvo: 'x', metodo: 'POST', caminho: '/b');
    final r = await volta;
    expect(r.enviadas, 2);
    expect(fila.porEnviar, 0);
  });

  test('sem sessão não tenta enviar', () async {
    api.token = null;
    final fila = novaFila();
    await fila.pedido(
      descricao: 'a',
      alvo: 'x',
      metodo: 'POST',
      caminho: '/a',
      enviarJa: false,
    );
    final r = await fila.enviar();
    expect(r.semRede, isTrue);
    expect(falsa.pedidos, isEmpty);
  });
}
