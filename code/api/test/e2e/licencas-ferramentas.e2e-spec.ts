/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment -- os corpos do supertest são `any`; as asserções do jest verificam a forma. */
import {
  arrancarApp,
  Contexto,
  ferramenta,
  linha,
  MUNICIPIO_ID,
  novaChamada,
  pedirLicenca,
} from './app';

function daquiA(dias = 20): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + dias);
  while ([0, 6].includes(d.getUTCDay())) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** Um pedido que cumpre as regras por omissão, de cada tipo. */
const PEDIDOS: Record<string, Record<string, unknown>> = {
  ruido: {
    atividade: 'festa_privada',
    descricao: 'Jantar de anos no quintal',
    morada: 'Rua Nova 5, Guimarães',
    data: daquiA(),
    hora_inicio: '20:00',
    hora_fim: '23:00',
    pessoas: 30,
    musica_amplificada: true,
  },
  ocupacao_via: {
    equipamento: 'andaime',
    descricao: 'Pintar a fachada',
    morada: 'Rua de Santa Maria 10, Guimarães',
    data_inicio: daquiA(),
    dias: 10,
    area_m2: 8,
    passeio_livre_m: 1.5,
    ocupa_estrada: false,
  },
  esplanada: {
    estabelecimento: 'Café Teste',
    morada: 'Largo do Toural 9, Guimarães',
    data_inicio: daquiA(),
    meses: 3,
    area_m2: 10,
    mesas: 4,
    passeio_livre_m: 2,
  },
  distico_residente: {
    morada: 'Rua da Rainha 22, Guimarães',
    matricula: 'AB-12-CD',
    disticos_ja_tem: 0,
    morada_comprovada: true,
    viatura_em_nome: true,
  },
  publicidade: {
    suporte: 'placa',
    estabelecimento: 'Loja Teste',
    mensagem: 'Nome da loja',
    morada: 'Rua de Santo António 40, Guimarães',
    largura_m: 1,
    altura_m: 0.5,
    iluminado: false,
    no_proprio_estabelecimento: true,
    centro_historico: false,
    data_inicio: daquiA(),
    meses: 12,
  },
  recinto_improvisado: {
    descricao: 'Arraial de teste',
    morada: 'Largo da Oliveira, Guimarães',
    data_inicio: daquiA(),
    dias: 1,
    lotacao: 150,
    estruturas: ['palco'],
    musica: false,
  },
};

/**
 * As licenças em duas ferramentas (campos_da_licenca e pedir_licenca, em
 * vez de uma por tipo): os campos vêm do zod de cada tipo, a validação diz
 * em português o que falta, e o pedido segue o mesmo caminho de sempre.
 * Os resultados das regras (emitida, exceção, técnico) estão nos e2e
 * licencas, licencas-tipos e regras-publicas, que já usam pedir_licenca.
 */
describe('Licenças: campos_da_licenca e pedir_licenca (e2e)', () => {
  let ctx: Contexto;

  beforeAll(async () => {
    ctx = await arrancarApp();
  });
  afterAll(() => ctx.fechar());

  it.each(Object.keys(PEDIDOS))(
    'campos_da_licenca(%s) e pedir_licenca com esses campos → pedida',
    async (tipo) => {
      const c = await ferramenta(ctx, novaChamada('cl'), 'campos_da_licenca', {
        tipo,
      }).expect(200);
      expect(c.body).toMatchObject({ tipo, licenca: expect.any(String) });
      const obrigatorios = (
        c.body.campos as { campo: string; obrigatorio: boolean }[]
      )
        .filter((x) => x.obrigatorio)
        .map((x) => x.campo);
      // O pedido de teste tem todos os obrigatórios que a ferramenta diz.
      for (const o of obrigatorios) expect(PEDIDOS[tipo]).toHaveProperty(o);

      const r = await pedirLicenca(
        ctx,
        novaChamada('pl'),
        tipo,
        PEDIDOS[tipo],
      ).expect(200);
      expect(r.body).toMatchObject({
        pedida: true,
        tipo,
        proposta: 'aprovar',
        numero: expect.any(String),
      });
      const l = await linha<{ tipo: string }>(
        ctx.db,
        `SELECT l.tipo FROM licencas l JOIN processos p ON p.id = l.processo_id
         WHERE p.numero = $1 AND p.municipio_id = $2`,
        [r.body.numero, MUNICIPIO_ID],
      );
      expect(l?.tipo).toBe(tipo);
    },
  );

  it('campos_da_licenca: perguntas, formatos e notas do tipo', async () => {
    const r = await ferramenta(ctx, novaChamada('cl'), 'campos_da_licenca', {
      tipo: 'publicidade',
    }).expect(200);
    expect(r.body.campos).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          campo: 'suporte',
          obrigatorio: true,
          valores: expect.arrayContaining(['placa', 'toldo']),
        }),
        expect.objectContaining({
          campo: 'data_inicio',
          formato: 'data AAAA-MM-DD',
        }),
      ]),
    );
    expect(r.body.notas[0]).toContain('mera comunicação');
    expect(r.body.renovavel).toBe(true);
    // Um tipo que não existe: 400 com o que está mal.
    await ferramenta(ctx, novaChamada('cl'), 'campos_da_licenca', {
      tipo: 'feira',
    }).expect(400);
  });

  it('pedir_licenca sem dados obrigatórios → não pede nada e diz o que perguntar', async () => {
    const chamada = novaChamada('pl');
    const { mesas: _m, morada: _x, ...sem } = PEDIDOS.esplanada;
    void _m;
    void _x;
    const r = await pedirLicenca(ctx, chamada, 'esplanada', sem).expect(200);
    expect(r.body).toMatchObject({
      pedida: false,
      motivo: 'faltam_dados',
      tipo: 'esplanada',
      em_falta: expect.arrayContaining([
        expect.objectContaining({ campo: 'mesas' }),
        expect.objectContaining({ campo: 'morada' }),
      ]),
    });
    expect(r.body.instrucao).toContain('Pergunta à pessoa');
    const n = await linha<{ n: number }>(
      ctx.db,
      `SELECT count(*)::int AS n FROM licencas l JOIN conversas c ON c.id = l.conversa_id
       WHERE c.provider_id = $1`,
      [chamada.conversa],
    );
    expect(n?.n).toBe(0);
  });

  it('pedir_licenca com valores fora do esquema do tipo → dados_invalidos, em português', async () => {
    const r = await pedirLicenca(ctx, novaChamada('pl'), 'esplanada', {
      ...PEDIDOS.esplanada,
      meses: 40,
    }).expect(200);
    expect(r.body).toMatchObject({
      pedida: false,
      motivo: 'dados_invalidos',
      invalidos: [{ campo: 'meses', problema: 'tem de ser no máximo 24' }],
    });
  });

  it('recinto com música → lembra a licença de ruído (tambem_ruido)', async () => {
    const r = await pedirLicenca(
      ctx,
      novaChamada('pl'),
      'recinto_improvisado',
      {
        ...PEDIDOS.recinto_improvisado,
        musica: true,
      },
    ).expect(200);
    expect(r.body).toMatchObject({ pedida: true, tambem_ruido: true });
    expect(r.body.dizer).toContain('licença especial de ruído');
  });

  it('as ferramentas antigas (uma por tipo) já não existem', async () => {
    const r = await ferramenta(
      ctx,
      novaChamada('pl'),
      'pedir_licenca_ruido',
      PEDIDOS.ruido,
    ).expect(404);
    expect(r.body.erro.codigo).toBe('ferramenta_desconhecida');
  });
});
