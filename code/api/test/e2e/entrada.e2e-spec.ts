/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return -- os corpos do supertest são `any`; as asserções do jest verificam a forma. */
import { randomUUID } from 'crypto';
import { EncaminhamentoAutomaticoService } from '../../src/modules/entrada/encaminhamento-automatico.service';
import {
  arrancarApp,
  Contexto,
  entrarPainel,
  esperarAte,
  linha,
  linhas,
  novoTelefone,
} from './app';

/**
 * Caixa de entrada única e encaminhamento automático. Tudo num município
 * próprio (criado aqui): ligar o encaminhamento não mexe nos dados dos
 * outros ficheiros, que usam o município 'teste'.
 */
describe('Entrada (e2e)', () => {
  let ctx: Contexto;
  let enc: EncaminhamentoAutomaticoService;
  const M = randomUUID();
  const ENT = randomUUID();
  const S_OBRAS = randomUUID();
  const S_VIAS = randomUUID();
  const TP = randomUUID();
  const CAT_SEM = randomUUID(); // categoria sem serviço
  const CAT_VIAS = randomUUID(); // categoria das vias
  const CHEFE = randomUUID();
  const BALCAO = randomUUID(); // perfil atendimento
  const T_OCUPADO = randomUUID(); // obras, 1 processo aberto
  const T_LIVRE = randomUUID(); // obras, nada aberto
  const T_VIAS = randomUUID();
  let chefe: Record<string, string>;
  let balcao: Record<string, string>;
  let tecnicoLivre: Record<string, string>;

  const http = () => ctx.http();
  const n = () => randomUUID().slice(0, 8);

  async function processo(tecnico: string | null, fase = 'entrada') {
    const id = randomUUID();
    await ctx.db.query(
      `INSERT INTO processos (id, municipio_id, numero, tipo_processo_id, assunto, fase, tecnico_id, prazo_fim)
       VALUES ($1, $2, $3, $4, 'Muro novo', $5, $6, current_date + 30)`,
      [id, M, `EN ${n()}/2026`, TP, fase, tecnico],
    );
    return id;
  }

  async function email(assunto: string, horas = 1) {
    const id = randomUUID();
    await ctx.db.query(
      `INSERT INTO emails_entrada (id, municipio_id, de, assunto, corpo, recebido_em, classificado_em)
       VALUES ($1, $2, $3, $4, 'Bom dia, queria saber...', now() - make_interval(hours => $5), now())`,
      [id, M, `ana.${n()}@exemplo.pt`, assunto, horas],
    );
    return id;
  }

  async function ocorrencia(categoria: string) {
    const id = randomUUID();
    await ctx.db.query(
      `INSERT INTO ocorrencias (id, municipio_id, numero, categoria_id, descricao, morada)
       VALUES ($1, $2, $3, $4, 'Buraco grande', 'Rua A, 1')`,
      [id, M, `OC-${n()}`, categoria],
    );
    return id;
  }

  async function passagem() {
    const conv = randomUUID();
    await ctx.db.query(
      `INSERT INTO conversas (id, municipio_id, canal, provider_id) VALUES ($1, $2, 'telefone', $3)`,
      [conv, M, `conv-${randomUUID()}`],
    );
    const [p] = (
      await ctx.db.query<{ id: string }>(
        `INSERT INTO passagens_humano (conversa_id, motivo, resumo, fora_de_horas, responder_ate)
         VALUES ($1, 'pedido', 'Quer falar sobre a obra do vizinho', false, now() + interval '2 hours')
         RETURNING id`,
        [conv],
      )
    ).rows;
    return p.id;
  }

  /** Todos os itens da entrada (percorre as páginas). */
  async function todos(query: Record<string, string> = {}, quem = chefe) {
    const itens: any[] = [];
    let cursor: string | null = null;
    do {
      const r = await http()
        .get('/v1/painel/entrada')
        .set(quem)
        .query({ ...query, limite: '2', ...(cursor ? { cursor } : {}) })
        .expect(200);
      itens.push(...r.body.itens);
      cursor = r.body.proximo_cursor;
    } while (cursor);
    return itens;
  }

  beforeAll(async () => {
    ctx = await arrancarApp();
    enc = ctx.app.get(EncaminhamentoAutomaticoService);
    await ctx.db.query(
      `INSERT INTO municipios (id, slug, nome) VALUES ($1, $2, 'Entrada')`,
      [M, `entrada-${n()}`],
    );
    await ctx.db.query(
      `INSERT INTO entidades (id, municipio_id, nome, tipo) VALUES ($1, $2, 'Câmara', 'camara')`,
      [ENT, M],
    );
    await ctx.db.query(
      `INSERT INTO servicos (id, municipio_id, entidade_id, nome) VALUES
         ($1, $3, $4, 'Obras particulares'), ($2, $3, $4, 'Vias')`,
      [S_OBRAS, S_VIAS, M, ENT],
    );
    await ctx.db.query(
      `INSERT INTO tipos_processo (id, municipio_id, codigo, nome, prazo_dias_uteis, servico_id, formulario)
       VALUES ($1, $2, 'EN', 'Obras de edificação', 20, $3, '[]')`,
      [TP, M, S_OBRAS],
    );
    await ctx.db.query(
      `INSERT INTO categorias_ocorrencia (id, municipio_id, nome, servico_id) VALUES
         ($1, $3, 'Outra coisa', NULL), ($2, $3, 'Buraco na via', $4)`,
      [CAT_SEM, CAT_VIAS, M, S_VIAS],
    );
    await ctx.db.query(
      `INSERT INTO utilizadores (id, municipio_id, email, nome, perfil, servico_id) VALUES
         ($1::uuid, $7, $1::uuid::text || '@e.pt', 'Chefe', 'chefe_divisao', NULL),
         ($2::uuid, $7, $2::uuid::text || '@e.pt', 'Balcão', 'atendimento', NULL),
         ($3::uuid, $7, $3::uuid::text || '@e.pt', 'Ocupado', 'tecnico', $8),
         ($4::uuid, $7, $4::uuid::text || '@e.pt', 'Livre', 'tecnico', $8),
         ($5::uuid, $7, $5::uuid::text || '@e.pt', 'Vias', 'tecnico', $9),
         ($6::uuid, $7, $6::uuid::text || '@e.pt', 'Inativo', 'tecnico', $8)`,
      [
        CHEFE,
        BALCAO,
        T_OCUPADO,
        T_LIVRE,
        T_VIAS,
        randomUUID(),
        M,
        S_OBRAS,
        S_VIAS,
      ],
    );
    await ctx.db.query(
      `UPDATE utilizadores SET ativo = false WHERE municipio_id = $1 AND nome = 'Inativo'`,
      [M],
    );
    // Carga: o "Ocupado" já tem um processo em apreciação.
    await processo(T_OCUPADO, 'apreciacao');
    chefe = await entrarPainel(ctx, CHEFE);
    balcao = await entrarPainel(ctx, BALCAO);
    tecnicoLivre = await entrarPainel(ctx, T_LIVRE);
  });

  afterAll(async () => {
    await ctx.db.query(
      `UPDATE entrada_config SET ativo = false WHERE municipio_id = $1`,
      [M],
    );
    await ctx.fechar();
  });

  describe('config', () => {
    it('desligado por omissão; só a chefia muda; fica na auditoria', async () => {
      const r = await http()
        .get('/v1/painel/entrada/config')
        .set(chefe)
        .expect(200);
      expect(r.body).toEqual({ ativo: false, atribuir_tecnico: true });

      await http()
        .put('/v1/painel/entrada/config')
        .set(balcao)
        .send({ ativo: true })
        .expect(403);
      await http()
        .put('/v1/painel/entrada/config')
        .set(chefe)
        .send({ ativo: 'sim' })
        .expect(400);

      // Desligado: o encaminhamento não faz nada.
      const p = await processo(null);
      expect(await enc.encaminharItem(M, 'processo', p)).toBeNull();

      const g = await http()
        .put('/v1/painel/entrada/config')
        .set(chefe)
        .send({ ativo: true })
        .expect(200);
      expect(g.body).toEqual({ ativo: true, atribuir_tecnico: true });
      const a = await linha(
        ctx.db,
        `SELECT dados FROM audit_log WHERE objeto_tipo = 'entrada_config' AND objeto_id = $1`,
        [M],
      );
      expect(a.dados.depois).toEqual({ ativo: true, atribuir_tecnico: true });
    });
  });

  describe('balcão', () => {
    let pedidoId: string;
    const telefone = novoTelefone();

    it('regista: conversa balcao com turno, pedido na entrada e técnico com menos carga (job)', async () => {
      const r = await http()
        .post('/v1/painel/entrada/balcao')
        .set(balcao)
        .send({
          telefone,
          nome: 'Ana Sousa',
          assunto: 'Licença para marquise',
          descricao: 'Quer fechar a varanda com uma marquise.',
          servico_id: S_OBRAS,
        })
        .expect(201);
      pedidoId = r.body.id;
      expect(r.body).toMatchObject({
        tipo: 'balcao',
        canal: 'balcao',
        estado: 'aberto',
        municipe: 'Ana S.',
        servico: { id: S_OBRAS, nome: 'Obras particulares' },
        link_painel: `/painel/entrada/pedidos/${pedidoId}`,
      });

      const conv = await linha(
        ctx.db,
        `SELECT c.canal::text, c.resultado::text, c.terminada_em, m.telefone_e164, t.papel::text, t.texto
         FROM conversas c JOIN municipes m ON m.id = c.municipe_id
         JOIN conversa_turnos t ON t.conversa_id = c.id
         WHERE c.id = $1`,
        [r.body.conversa_id],
      );
      expect(conv).toMatchObject({
        canal: 'balcao',
        resultado: 'passada_funcionario',
        telefone_e164: telefone,
        papel: 'funcionario',
      });
      expect(conv.terminada_em).not.toBeNull();
      expect(conv.texto).toContain('marquise');

      const e = await esperarAte(() =>
        linha(
          ctx.db,
          `SELECT tecnico_id, servico_id, motivo, automatico FROM encaminhamentos
           WHERE item_tipo = 'pedido' AND item_id = $1`,
          [pedidoId],
        ),
      );
      expect(e).toEqual({
        tecnico_id: T_LIVRE,
        servico_id: S_OBRAS,
        motivo: 'serviço indicado no registo; menor carga: 0 abertos',
        automatico: true,
      });
      const p = await linha(
        ctx.db,
        'SELECT tecnico_id FROM pedidos_entrada WHERE id = $1',
        [pedidoId],
      );
      expect(p.tecnico_id).toBe(T_LIVRE);
      const a = await linha(
        ctx.db,
        `SELECT ator_tipo::text, acao FROM audit_log
         WHERE objeto_tipo = 'pedido_entrada' AND objeto_id = $1 AND acao = 'encaminhar'`,
        [pedidoId],
      );
      expect(a).toEqual({ ator_tipo: 'sistema', acao: 'encaminhar' });
    });

    it('validação: telefone e NIF inválidos, serviço de outro município', async () => {
      const base = { assunto: 'x', descricao: 'y' };
      const t = await http()
        .post('/v1/painel/entrada/balcao')
        .set(balcao)
        .send({ ...base, telefone: '123' })
        .expect(400);
      expect(t.body.erro.codigo).toBe('telefone_invalido');
      const nif = await http()
        .post('/v1/painel/entrada/balcao')
        .set(balcao)
        .send({ ...base, nif: '123456780' })
        .expect(400);
      expect(nif.body.erro.codigo).toBe('nif_invalido');
      const s = await http()
        .post('/v1/painel/entrada/balcao')
        .set(balcao)
        .send({ ...base, servico_id: randomUUID() })
        .expect(400);
      expect(s.body.erro.codigo).toBe('servico_invalido');
    });

    it('a lista mostra o pedido; meus = atribuídos a mim ou ao meu serviço', async () => {
      const itens = await todos();
      const item = itens.find((i) => i.id === pedidoId);
      expect(item).toMatchObject({
        tipo: 'pedido',
        canal: 'balcao',
        assunto: 'Licença para marquise',
        municipe: 'Ana S.',
        tecnico: { id: T_LIVRE, nome: 'Livre' },
        encaminhamento: { automatico: true },
      });
      const meus = await todos({ meus: 'true' }, tecnicoLivre);
      expect(meus.map((i) => i.id)).toContain(pedidoId);
      expect(meus.every((i) => i.servico?.id === S_OBRAS)).toBe(true);
      expect(
        (await todos({ canal: 'email' })).find((i) => i.id === pedidoId),
      ).toBeUndefined();
    });

    it('fechar tira-o da entrada; fechar outra vez → 409', async () => {
      const r = await http()
        .post('/v1/painel/entrada/balcao')
        .set(balcao)
        .send({ assunto: 'Informação', descricao: 'Perguntou o horário.' })
        .expect(201);
      await http()
        .post(`/v1/painel/entrada/pedidos/${r.body.id}/fechar`)
        .set(balcao)
        .expect(200);
      expect((await todos()).find((i) => i.id === r.body.id)).toBeUndefined();
      const de = await http()
        .post(`/v1/painel/entrada/pedidos/${r.body.id}/fechar`)
        .set(balcao)
        .expect(409);
      expect(de.body.erro.codigo).toBe('pedido_fechado');
    });

    it('converte em processo: pedido ligado e processo encaminhado', async () => {
      const r = await http()
        .post(`/v1/painel/entrada/pedido/${pedidoId}/processo`)
        .set(chefe)
        .send({ tipo_processo_id: TP })
        .expect(201);
      expect(r.body.numero).toMatch(/^EN \d+\/\d{4}$/);
      expect(r.body.fase).toBe('entrada');
      const pe = await linha(
        ctx.db,
        'SELECT estado, processo_id FROM pedidos_entrada WHERE id = $1',
        [pedidoId],
      );
      expect(pe).toEqual({
        estado: 'virou_processo',
        processo_id: r.body.processo_id,
      });
      const ev = await linha(
        ctx.db,
        `SELECT dados FROM processo_eventos WHERE processo_id = $1 AND tipo = 'criado'`,
        [r.body.processo_id],
      );
      expect(ev.dados).toEqual({ origem: 'balcao', pedido_id: pedidoId });
      // O processo herda a conversa do balcão: canal 'balcao' na entrada.
      const item = (await todos({ tipo: 'processo' })).find(
        (i) => i.id === r.body.processo_id,
      );
      expect(item.canal).toBe('balcao');
      expect(r.body.encaminhamento.motivo).toContain(
        'serviço do tipo de processo EN',
      );
    });
  });

  describe('encaminhamento e atribuição', () => {
    it('email sem serviço e sem IA: fica por atribuir, sem registo', async () => {
      const id = await email('Pedido de informação');
      await enc.encaminharMunicipio(M);
      expect(
        await linhas(
          ctx.db,
          'SELECT 1 FROM encaminhamentos WHERE item_id = $1',
          [id],
        ),
      ).toHaveLength(0);
      const item = (await todos({ por_atribuir: 'true' })).find(
        (i) => i.id === id,
      );
      expect(item).toMatchObject({
        tipo: 'email',
        canal: 'email',
        servico: null,
        link_painel: `/painel/emails/${id}`,
      });
      expect(item.municipe).toMatch(/^an•••@exemplo\.pt$/);
    });

    it('ocorrência: serviço da categoria; sem regra fica por atribuir', async () => {
      const comRegra = await ocorrencia(CAT_VIAS);
      const semRegra = await ocorrencia(CAT_SEM);
      const feitos = await enc.encaminharMunicipio(M);
      expect(feitos.find((f) => f.id === comRegra)).toEqual({
        tipo: 'ocorrencia',
        id: comRegra,
        servico_id: S_VIAS,
        tecnico_id: null,
        motivo: 'serviço da categoria Buraco na via',
      });
      expect(feitos.find((f) => f.id === semRegra)).toBeUndefined();
      const o = await linha(
        ctx.db,
        'SELECT servico_id, estado::text FROM ocorrencias WHERE id = $1',
        [comRegra],
      );
      expect(o).toEqual({ servico_id: S_VIAS, estado: 'nova' });
      const ids = (await todos()).map((i) => i.id);
      expect(ids).not.toContain(comRegra);
      expect(ids).toContain(semRegra);
    });

    it('processo sem técnico: tipo → serviço, técnico com menos carga; manual desfaz', async () => {
      const p = await processo(null);
      const r = await enc.encaminharItem(M, 'processo', p);
      expect(r).toMatchObject({
        servico_id: S_OBRAS,
        tecnico_id: expect.any(String),
      });
      expect(r!.motivo).toMatch(
        /^serviço do tipo de processo EN; menor carga: \d+ abertos?/,
      );
      // Já decidido: não decide outra vez.
      expect(await enc.encaminharItem(M, 'processo', p)).toBeNull();

      const outro = r!.tecnico_id === T_LIVRE ? T_OCUPADO : T_LIVRE;
      const a = await http()
        .post(`/v1/painel/entrada/processo/${p}/atribuir`)
        .set(chefe)
        .send({ tecnico_id: outro })
        .expect(200);
      expect(a.body).toMatchObject({
        tecnico_id: outro,
        servico_id: S_OBRAS,
        automatico_desfeito: true,
      });
      expect(
        (
          await linha(
            ctx.db,
            'SELECT tecnico_id FROM processos WHERE id = $1',
            [p],
          )
        ).tecnico_id,
      ).toBe(outro);
      const regs = await linhas(
        ctx.db,
        `SELECT automatico, desfeito_em IS NOT NULL AS desfeito, motivo
         FROM encaminhamentos WHERE item_id = $1 ORDER BY criado_em`,
        [p],
      );
      expect(regs).toEqual([
        expect.objectContaining({ automatico: true, desfeito: true }),
        {
          automatico: false,
          desfeito: false,
          motivo: 'atribuição manual',
        },
      ]);
      const au = await linha(
        ctx.db,
        `SELECT dados FROM audit_log WHERE objeto_tipo = 'processo' AND objeto_id = $1 AND acao = 'reatribuir'`,
        [p],
      );
      expect(au.dados.para.tecnico_id).toBe(outro);
    });

    it('passagem: técnico automático; serviço à mão fica no registo e na lista', async () => {
      const id = await passagem();
      // Sem regra e sem IA: não há serviço, logo nem técnico.
      expect(await enc.encaminharItem(M, 'passagem', id)).toBeNull();
      await http()
        .post(`/v1/painel/entrada/passagem/${id}/atribuir`)
        .set(chefe)
        .send({ servico_id: S_VIAS, tecnico_id: T_VIAS })
        .expect(200);
      const ph = await linha(
        ctx.db,
        'SELECT atribuida_a, estado FROM passagens_humano WHERE id = $1',
        [id],
      );
      expect(ph).toEqual({ atribuida_a: T_VIAS, estado: 'aberta' });
      const item = (await todos({ tipo: 'passagem' })).find((i) => i.id === id);
      expect(item).toMatchObject({
        canal: 'telefone',
        servico: { id: S_VIAS, nome: 'Vias' },
        tecnico: { id: T_VIAS },
        urgente: true, // responde em 2 h
        encaminhamento: { motivo: 'atribuição manual', automatico: false },
      });
      // Urgentes primeiro.
      const lista = await todos();
      const primeiroNaoUrgente = lista.findIndex((i) => !i.urgente);
      expect(lista.findIndex((i) => i.id === id)).toBeLessThan(
        primeiroNaoUrgente === -1 ? Infinity : primeiroNaoUrgente,
      );
    });

    it('erros: técnico num email, tipo desconhecido, sem corpo, item de outro município', async () => {
      const id = await email('Outro');
      const t = await http()
        .post(`/v1/painel/entrada/email/${id}/atribuir`)
        .set(chefe)
        .send({ tecnico_id: T_LIVRE })
        .expect(400);
      expect(t.body.erro.codigo).toBe('tecnico_nao_aplicavel');
      await http()
        .post(`/v1/painel/entrada/coisa/${id}/atribuir`)
        .set(chefe)
        .send({ servico_id: S_OBRAS })
        .expect(400);
      await http()
        .post(`/v1/painel/entrada/email/${id}/atribuir`)
        .set(chefe)
        .send({})
        .expect(400);
      await http()
        .post(`/v1/painel/entrada/email/${randomUUID()}/atribuir`)
        .set(chefe)
        .send({ servico_id: S_OBRAS })
        .expect(404);

      const s = await http()
        .post(`/v1/painel/entrada/email/${id}/atribuir`)
        .set(chefe)
        .send({ servico_id: S_VIAS })
        .expect(200);
      expect(s.body.automatico_desfeito).toBe(false);
      expect(
        (
          await linha(
            ctx.db,
            'SELECT servico_id FROM emails_entrada WHERE id = $1',
            [id],
          )
        ).servico_id,
      ).toBe(S_VIAS);
    });

    it('email → processo: virou_processo, evento com origem; segunda vez → 409', async () => {
      const id = await email('Quero construir um anexo');
      const r = await http()
        .post(`/v1/painel/entrada/email/${id}/processo`)
        .set(chefe)
        .send({ tipo_processo_id: TP, assunto: 'Anexo no quintal' })
        .expect(201);
      const ee = await linha(
        ctx.db,
        'SELECT estado, processo_id FROM emails_entrada WHERE id = $1',
        [id],
      );
      expect(ee).toEqual({
        estado: 'virou_processo',
        processo_id: r.body.processo_id,
      });
      const p = await linha(
        ctx.db,
        'SELECT assunto, fase::text, tecnico_id FROM processos WHERE id = $1',
        [r.body.processo_id],
      );
      expect(p.assunto).toBe('Anexo no quintal');
      expect(p.fase).toBe('entrada');
      expect([T_LIVRE, T_OCUPADO]).toContain(p.tecnico_id);
      const ids = (await todos()).map((i) => i.id);
      expect(ids).not.toContain(id);
      expect(ids).toContain(r.body.processo_id);
      const item = (await todos({ tipo: 'processo' })).find(
        (i) => i.id === r.body.processo_id,
      );
      expect(item.canal).toBe('email');

      const de = await http()
        .post(`/v1/painel/entrada/email/${id}/processo`)
        .set(chefe)
        .send({ tipo_processo_id: TP })
        .expect(409);
      expect(de.body.erro.codigo).toBe('ja_e_processo');
      const oc = await ocorrencia(CAT_SEM);
      const nc = await http()
        .post(`/v1/painel/entrada/ocorrencia/${oc}/processo`)
        .set(chefe)
        .send({ tipo_processo_id: TP })
        .expect(400);
      expect(nc.body.erro.codigo).toBe('tipo_nao_convertivel');
      const tp = await http()
        .post(`/v1/painel/entrada/email/${await email('x')}/processo`)
        .set(chefe)
        .send({ tipo_processo_id: randomUUID() })
        .expect(404);
      expect(tp.body.erro.codigo).toBe('tipo_processo_desconhecido');
    });
  });

  describe('lista e resumo', () => {
    it('paginação sem repetidos nem falhas; resumo bate com a lista', async () => {
      const paginada = await todos();
      const tudo = await http()
        .get('/v1/painel/entrada')
        .set(chefe)
        .query({ limite: '200' })
        .expect(200);
      expect(paginada.map((i) => i.id)).toEqual(
        tudo.body.itens.map((i: any) => i.id),
      );
      expect(new Set(paginada.map((i) => i.id)).size).toBe(paginada.length);

      const r = await http()
        .get('/v1/painel/entrada/resumo')
        .set(chefe)
        .expect(200);
      expect(r.body.total).toBe(paginada.length);
      expect(r.body.urgentes).toBe(paginada.filter((i) => i.urgente).length);
      for (const tipo of [
        'passagem',
        'email',
        'processo',
        'ocorrencia',
        'pedido',
      ]) {
        expect(r.body.por_tipo[tipo]).toBe(
          paginada.filter((i) => i.tipo === tipo).length,
        );
      }
      expect(r.body.por_canal.email).toBe(
        paginada.filter((i) => i.canal === 'email').length,
      );
      const porAtribuir = await todos({ por_atribuir: 'true' });
      expect(r.body.por_atribuir).toBe(porAtribuir.length);
    });

    it('cursor estragado → 400; perfil sem acesso → 403', async () => {
      const c = await http()
        .get('/v1/painel/entrada')
        .set(chefe)
        .query({ cursor: 'lixo' })
        .expect(400);
      expect(c.body.erro.codigo).toBe('cursor_invalido');
      const vereador = randomUUID();
      await ctx.db.query(
        `INSERT INTO utilizadores (id, municipio_id, email, nome, perfil)
         VALUES ($1::uuid, $2, $1::uuid::text || '@e.pt', 'Vereador', 'vereador')`,
        [vereador, M],
      );
      const sessao = await entrarPainel(ctx, vereador);
      await http().get('/v1/painel/entrada').set(sessao).expect(403);
    });
  });
});
