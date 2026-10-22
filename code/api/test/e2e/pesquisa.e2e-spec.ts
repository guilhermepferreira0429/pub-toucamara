/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment -- os corpos do supertest são `any`; as asserções do jest verificam a forma. */
import { randomInt, randomUUID } from 'crypto';
import {
  arrancarApp,
  Contexto,
  criarUtilizador,
  entrarPainel,
  linha,
  MUNICIPIO_ID,
  novoTelefone,
  TIPO_CP_ID,
} from './app';

interface Grupo {
  tipo: string;
  rotulo: string;
  itens: {
    tipo: string;
    id: string;
    titulo: string;
    subtitulo: string;
    href: string;
  }[];
}

/** Painel · pesquisa global (⌘K). */
describe('Pesquisa global (e2e)', () => {
  let ctx: Contexto;
  let chefe: Record<string, string>;
  // Palavras únicas desta execução: a BD é partilhada pelos ficheiros.
  const sufixo = randomUUID().slice(0, 6);
  const apelido = `Conceição${sufixo}`;
  const telefone = novoTelefone();
  const nProcesso = randomInt(90_000, 99_999);
  const nOcorrencia = randomInt(90_000, 99_999);
  let municipeId: string;
  let conversaId: string;
  let processoId: string;
  let ocorrenciaId: string;

  const pesquisar = async (q: string, headers = chefe) => {
    const r = await ctx
      .http()
      .get('/v1/painel/pesquisa')
      .query({ q })
      .set(headers)
      .expect(200);
    return r.body.grupos as Grupo[];
  };
  const grupo = (gs: Grupo[], tipo: string) => gs.find((g) => g.tipo === tipo);

  beforeAll(async () => {
    ctx = await arrancarApp();
    chefe = await entrarPainel(ctx);

    municipeId = (await linha<{ id: string }>(
      ctx.db,
      `INSERT INTO municipes (municipio_id, nome, telefone_e164)
       VALUES ($1, $2, $3) RETURNING id`,
      [MUNICIPIO_ID, `Joaquina ${apelido}`, telefone],
    ))!.id;
    conversaId = (await linha<{ id: string }>(
      ctx.db,
      `INSERT INTO conversas (municipio_id, municipe_id, canal, resumo)
       VALUES ($1, $2, 'telefone', $3) RETURNING id`,
      [
        MUNICIPIO_ID,
        municipeId,
        `Pediu licença para uma pérgula${sufixo} no quintal.`,
      ],
    ))!.id;
    processoId = (await linha<{ id: string }>(
      ctx.db,
      `INSERT INTO processos (municipio_id, numero, tipo_processo_id, assunto)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [
        MUNICIPIO_ID,
        `CP ${nProcesso}/2026`,
        TIPO_CP_ID,
        `Marquise${sufixo} na varanda`,
      ],
    ))!.id;
    ocorrenciaId = (await linha<{ id: string }>(
      ctx.db,
      `INSERT INTO ocorrencias (municipio_id, numero, categoria_id, descricao, morada)
       SELECT $1, $2, id, 'Buraco fundo', $3
       FROM categorias_ocorrencia WHERE municipio_id = $1 LIMIT 1
       RETURNING id`,
      [MUNICIPIO_ID, `OC-0${nOcorrencia}`, `Rua de São Dâmaso${sufixo}, 12`],
    ))!.id;
  });
  afterAll(() => ctx.fechar());

  it('encontra o munícipe pelo nome sem acentos, com o telefone mascarado', async () => {
    const gs = await pesquisar(`joaquina conceicao${sufixo}`);
    const m = grupo(gs, 'municipe');
    expect(m?.itens).toEqual([
      {
        tipo: 'municipe',
        id: municipeId,
        titulo: `Joaquina ${apelido}`,
        subtitulo: expect.stringMatching(/^\+351 9•• ••• \d{3} · 1 conversa$/),
        href: `/painel/conversas/${conversaId}`,
      },
    ]);
    expect(JSON.stringify(gs)).not.toContain(telefone);
  });

  it('encontra o munícipe pelo telefone inteiro, não por bocados', async () => {
    const local = telefone.slice(4);
    const inteiro = await pesquisar(local.replace(/(\d{3})(?=\d)/g, '$1 '));
    expect(grupo(inteiro, 'municipe')?.itens[0].id).toBe(municipeId);
    const bocado = await pesquisar(local.slice(-5));
    expect(grupo(bocado, 'municipe')).toBeUndefined();
  });

  it('número exato primeiro: processo e ocorrência', async () => {
    const p = await pesquisar(`cp ${nProcesso}/2026`);
    expect(p[0].tipo).toBe('processo');
    expect(p[0].itens[0]).toMatchObject({
      id: processoId,
      titulo: `CP ${nProcesso}/2026 · Marquise${sufixo} na varanda`,
      href: `/painel/processos/${processoId}`,
    });
    const o = await pesquisar(`oc-${nOcorrencia}`);
    expect(grupo(o, 'ocorrencia')?.itens[0]).toMatchObject({
      id: ocorrenciaId,
      href: `/painel/ocorrencias/${ocorrenciaId}`,
    });
  });

  it('procura no texto: conversa, assunto, morada e fonte', async () => {
    expect(
      grupo(await pesquisar(`PÉRGULA${sufixo}`), 'conversa')?.itens[0].id,
    ).toBe(conversaId);
    expect(
      grupo(await pesquisar(`marquise${sufixo}`), 'processo')?.itens[0].id,
    ).toBe(processoId);
    expect(
      grupo(await pesquisar(`damaso${sufixo}`), 'ocorrencia')?.itens[0].id,
    ).toBe(ocorrenciaId);
    expect(grupo(await pesquisar('rjue'), 'fonte')?.itens[0]).toMatchObject({
      titulo: 'RJUE',
      href: '/painel/conhecimento/fontes',
    });
  });

  it('respeita as permissões do perfil', async () => {
    const atendimento = await entrarPainel(
      ctx,
      await criarUtilizador(ctx, 'atendimento'),
    );
    const gs = await pesquisar(`marquise${sufixo}`, atendimento);
    expect(grupo(gs, 'processo')).toBeUndefined();
    expect(
      grupo(await pesquisar(`damaso${sufixo}`, atendimento), 'ocorrencia'),
    ).toBeDefined();

    const vereador = await entrarPainel(
      ctx,
      await criarUtilizador(ctx, 'vereador'),
    );
    expect(await pesquisar(`joaquina conceicao${sufixo}`, vereador)).toEqual(
      [],
    );
  });

  it('não mostra munícipes anonimizados nem conversas ocultas', async () => {
    const outro = (await linha<{ id: string }>(
      ctx.db,
      `INSERT INTO municipes (municipio_id, nome, anonimizado_em)
       VALUES ($1, $2, now()) RETURNING id`,
      [MUNICIPIO_ID, `Anonimo${sufixo}`],
    ))!.id;
    await ctx.db.query(
      `INSERT INTO conversas (municipio_id, municipe_id, canal, resumo, oculto_em)
       VALUES ($1, $2, 'chat', $3, now())`,
      [MUNICIPIO_ID, outro, `Teste escondido${sufixo}`],
    );
    expect(await pesquisar(`anonimo${sufixo}`)).toEqual([]);
    expect(await pesquisar(`escondido${sufixo}`)).toEqual([]);
  });

  it('valida o pedido e exige sessão', async () => {
    await ctx.http().get('/v1/painel/pesquisa').set(chefe).expect(400);
    await ctx.http().get('/v1/painel/pesquisa?q=rjue').expect(401);
    expect(await pesquisar('a')).toEqual([]);
  });
});
