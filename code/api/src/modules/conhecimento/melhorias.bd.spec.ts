/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-return */
import { Client } from 'pg';
import type { UtilizadorPainel } from '../../common/pedido.js';
import type { DatabaseService, Tx } from '../../database/database.service.js';
import type { ClaudeService } from '../../ia/claude.service.js';
import type { JobsService } from '../../jobs/jobs.service.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import type { MensagensService } from '../comunicacao/mensagens.service.js';
import { ConhecimentoService } from './conhecimento.service.js';
import type { EmbeddingsService } from './embeddings.service.js';
import { MelhoriasService } from './melhorias.service.js';

/*
 * Melhorias ao portal contra o Postgres, tudo numa transação desfeita no fim.
 * Só corre com TESTE_BD=1 (BD já com todas as migrações):
 *
 *   TESTE_BD=1 DB_NAME=toucamara_por npx jest src/modules/conhecimento/melhorias.bd.spec.ts
 *
 * IA falsa (grupos e proposta fixos), sem embeddings (pesquisa só por texto).
 */
const correr = process.env.TESTE_BD === '1' ? describe : describe.skip;

correr('melhorias ao portal (BD)', () => {
  let client: Client;
  let db: DatabaseService;
  let svc: MelhoriasService;
  let municipio: string;
  let aguas: string;
  let u: UtilizadorPainel;
  const emails: { para: string; assunto: string; texto: string }[] = [];
  const pedidos: string[] = [];
  let ia = true;

  beforeAll(async () => {
    client = new Client({
      host: process.env.DB_HOST ?? 'localhost',
      port: Number(process.env.DB_PORT ?? 54330),
      user: 'toucamara',
      password: process.env.DB_PASSWORD ?? 'toucamara',
      database: process.env.DB_NAME ?? 'toucamara',
    });
    await client.connect();
    await client.query('BEGIN');

    let n = 0;
    const query = async (sql: string, p?: unknown[]) =>
      (await client.query(sql, p)).rows;
    db = {
      query,
      transaction: async <T>(fn: (t: Tx) => Promise<T>) => {
        const sp = `sp${++n}`;
        await client.query(`SAVEPOINT ${sp}`);
        try {
          const r = await fn({ query });
          await client.query(`RELEASE SAVEPOINT ${sp}`);
          return r;
        } catch (e) {
          await client.query(`ROLLBACK TO SAVEPOINT ${sp}`);
          throw e;
        }
      },
    } as unknown as DatabaseService;

    const embeddings = {
      disponivel: false,
      pergunta: () => Promise.resolve(null),
    } as unknown as EmbeddingsService;
    const claude = {
      get disponivel() {
        return ia;
      },
      extrair: (_e: unknown, p: { conteudo: string }) => {
        pedidos.push(p.conteudo);
        if (p.conteudo.startsWith('P1')) {
          return Promise.resolve({
            grupos: [
              { tema: 'Contador da água', perguntas: ['P1', 'P2'] },
              { tema: 'Ecocentro', perguntas: ['P3'] },
            ],
          });
        }
        const agua = p.conteudo.includes('Assunto: Contador da água');
        return Promise.resolve({
          titulo: agua ? 'Mudar o contador da água' : 'Horário do ecocentro',
          o_que_falta: 'O portal não explica.',
          ja_existe: agua,
          fonte_existente: agua ? 'T1' : '',
          sugestao: agua
            ? 'Peça a mudança do contador. Custa 25 euros e demora 5 dias úteis.'
            : 'O ecocentro abre ao sábado das 9h às 13h.',
          onde_pagina: agua ? 'F1' : '',
          onde_texto: agua ? '' : 'Ambiente › Ecocentros',
          entidade: agua ? 'E1' : 'E99',
        });
      },
    } as unknown as ClaudeService;
    const jobs = {
      enviar: () => Promise.resolve('job'),
    } as unknown as JobsService;
    const mensagens = {
      email: (e: { para: string; assunto: string; texto: string }) => {
        emails.push(e);
        return Promise.resolve();
      },
    } as unknown as MensagensService;

    svc = new MelhoriasService(
      db,
      claude,
      new ConhecimentoService(db, embeddings),
      jobs,
      new AuditoriaService(db),
      mensagens,
    );

    [{ id: municipio }] = await query(
      `INSERT INTO municipios (slug, nome) VALUES ('teste-melhorias', 'Teste') RETURNING id`,
    );
    [{ id: aguas }] = await query(
      `INSERT INTO entidades (municipio_id, nome, tipo) VALUES ($1, 'Águas Municipais', 'empresa_municipal') RETURNING id`,
      [municipio],
    );
    await query(
      `INSERT INTO entidade_contactos (entidade_id, tipo, valor) VALUES ($1, 'email', 'geral@aguas.pt')`,
      [aguas],
    );
    const [fo] = await query(
      `INSERT INTO fontes (municipio_id, entidade_id, titulo, tipo, url)
       VALUES ($1, $2, 'Contadores', 'pagina', 'https://aguas.pt/contadores') RETURNING id`,
      [municipio, aguas],
    );
    const [fv] = await query(
      `INSERT INTO fonte_versoes (fonte_id, hash, texto) VALUES ($1, 'h', 'x') RETURNING id`,
      [fo.id],
    );
    await query(
      `INSERT INTO trechos (fonte_versao_id, ordem, texto)
       VALUES ($1, 1, 'A mudança do contador da água custa 25 euros.')`,
      [fv.id],
    );
    const [ut] = await query(
      `INSERT INTO utilizadores (email, nome, perfil) VALUES ('teste-melh@x.pt', 'Chefe', 'chefe_divisao') RETURNING id`,
    );
    u = {
      id: ut.id,
      nome: 'Chefe',
      email: 'teste-melh@x.pt',
      perfil: 'chefe_divisao',
      municipioId: municipio,
      servicoId: null,
    };

    const [c] = await query(
      `INSERT INTO conversas (municipio_id, canal) VALUES ($1, 'telefone') RETURNING id`,
      [municipio],
    );
    const psr = [
      ['Como mudo o contador da água?', 9],
      ['Quanto custa trocar o contador?', 4],
      ['Horário do ecocentro ao sábado?', 3],
    ] as const;
    for (const [i, [texto, vezes]] of psr.entries()) {
      const [p] = await query(
        `INSERT INTO perguntas_sem_resposta (municipio_id, texto, vezes) VALUES ($1, $2, $3) RETURNING id`,
        [municipio, texto, vezes],
      );
      const [t] = await query(
        `INSERT INTO conversa_turnos (conversa_id, ordem, papel, texto) VALUES ($1, $2, 'municipe', $3) RETURNING id`,
        [c.id, i, `Olá, ${texto.toLowerCase()}`],
      );
      await query(
        `INSERT INTO pergunta_sem_resposta_ocorrencias (psr_id, turno_id) VALUES ($1, $2)`,
        [p.id, t.id],
      );
    }
  }, 30_000);

  afterAll(async () => {
    await client?.query('ROLLBACK').catch(() => undefined);
    await client?.end();
  });

  it('propõe uma melhoria por grupo, com valores protegidos', async () => {
    expect(await svc.correrMunicipio(municipio)).toBe(2);
    const { itens } = await svc.listar(municipio, undefined, 10, null);
    expect(itens.map((i: any) => [i.titulo, i.vezes, i.perguntas])).toEqual([
      ['Mudar o contador da água', 13, 2],
      ['Horário do ecocentro', 3, 1],
    ]);

    const agua = await svc.ver(municipio, itens[0].id);
    expect(agua.tipo).toBe('tornar_visivel');
    expect(agua.onde).toBe('Contadores');
    expect(agua.entidade_id).toBe(aguas);
    // 25 euros está na fonte; 5 dias úteis não.
    expect(agua.sugestao).toBe(
      'Peça a mudança do contador. Custa 25 euros e demora [a confirmar pela câmara: 5 dias úteis].',
    );
    expect(agua.perguntas[0].exemplos[0]).toMatch(/^Olá, como mudo/);

    const eco = await svc.ver(municipio, itens[1].id);
    expect(eco.entidade_id).toBeNull();
    expect(eco.onde).toBe('Ambiente › Ecocentros');
    expect(eco.sugestao).toContain('[a confirmar pela câmara: 9h]');
  });

  it('é idempotente: perguntas em melhoria ativa não voltam a ir', async () => {
    const antes = pedidos.length;
    expect(await svc.correrMunicipio(municipio)).toBe(0);
    expect(pedidos.length).toBe(antes);
  });

  it('envia ao email da entidade e publica (perguntas resolvidas)', async () => {
    const { itens } = await svc.listar(municipio, 'proposta', 10, null);
    const id = itens.find((i) => i.vezes === 13)!.id;
    const enviada = await svc.enviar(municipio, u, id, undefined);
    expect(enviada.estado).toBe('enviada');
    expect(emails[0].para).toBe('geral@aguas.pt');
    expect(emails[0].texto).toContain('Quanto custa trocar o contador? (4×)');
    expect(emails[0].texto).not.toContain('Olá, como');

    const pub = await svc.atualizar(municipio, u, id, {
      estado: 'publicada',
      notas: 'Publicado no site',
    });
    expect(pub.perguntas_resolvidas).toBe(2);
    expect(pub.perguntas.every((p) => p.estado === 'resolvida')).toBe(true);

    await expect(
      svc.atualizar(municipio, u, id, { estado: 'proposta' }),
    ).rejects.toMatchObject({ codigo: 'transicao_invalida' });

    expect(await svc.resumo(municipio)).toEqual({
      propostas: 1,
      enviadas: 0,
      publicadas: 1,
      rejeitadas: 0,
      perguntas_resolvidas: 2,
      vezes_resolvidas: 13,
    });
  });

  it('rejeitada sem perguntas novas não volta a ser proposta', async () => {
    const { itens } = await svc.listar(municipio, 'proposta', 10, null);
    await svc.atualizar(municipio, u, itens[0].id, { estado: 'rejeitada' });
    expect(await svc.correrMunicipio(municipio)).toBe(0);
  });

  it('sem IA, gerar é 503', async () => {
    ia = false;
    await expect(svc.gerar(municipio, u)).rejects.toMatchObject({
      codigo: 'ia_indisponivel',
    });
    ia = true;
  });
});
