/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call -- os corpos do supertest são `any`; as asserções do jest verificam a forma. */
import { randomInt } from 'crypto';
import { WEB_URL } from './ambiente';
import {
  arrancarApp,
  Chamada,
  Contexto,
  criarUtilizador,
  entrarPainel,
  ferramenta,
  linha,
  linhas,
  MUNICIPIO_ID,
  novaChamada,
  smsPara,
} from './app';

/** `.expect(estado(200))`: como `.expect(200)`, mas com o corpo na mensagem de erro. */
function estado(esperado: number) {
  return (r: { status: number; body: unknown }) => {
    if (r.status !== esperado) {
      throw new Error(
        `Esperava ${esperado}, veio ${r.status}: ${JSON.stringify(r.body)}`,
      );
    }
  };
}

/** NIF português válido e aleatório. */
function novoNif(): string {
  const base = `2${String(randomInt(0, 10_000_000)).padStart(7, '0')}`;
  const soma = [...base].reduce((s, d, i) => s + Number(d) * (9 - i), 0);
  const controlo = 11 - (soma % 11);
  return `${base}${controlo >= 10 ? 0 : controlo}`;
}

/** Um requerimento CP pronto, preenchido na chamada (com NIF). */
async function requerimentoPronto(ctx: Contexto, chamada: Chamada) {
  const i = await ferramenta(ctx, chamada, 'iniciar_requerimento', {
    tipo: 'CP',
  }).expect(estado(200));
  await ferramenta(ctx, chamada, 'preencher_campo', {
    campos: {
      morada_obra: 'Rua de Santa Maria, 5',
      descricao: 'Trocar as janelas da fachada',
      nif: novoNif(),
    },
  }).expect(estado(200));
  await ferramenta(ctx, chamada, 'concluir_requerimento', {}).expect(
    estado(200),
  );
  return i.body.requerimento_id as string;
}

/** As duas chamadas da ferramenta: ler o resumo e confirmar. */
async function confirmarEntrega(ctx: Contexto, chamada: Chamada) {
  const r1 = await ferramenta(ctx, chamada, 'entregar_pedido', {}).expect(
    estado(200),
  );
  return ferramenta(ctx, chamada, 'entregar_pedido', {
    confirmado: true,
    codigo_resumo: r1.body.codigo_resumo,
    palavras_do_municipe: 'Sim, pode entregar.',
  });
}

function tokenDoLink(link: string): string {
  const m = new RegExp(`^${WEB_URL}/entrega/([^/?]+)$`).exec(link);
  if (!m) throw new Error(`Link inesperado: ${link}`);
  return m[1];
}

async function auditoria(ctx: Contexto, entregaId: string) {
  return linhas<{ acao: string; ator_tipo: string; dados: any }>(
    ctx.db,
    `SELECT acao, ator_tipo::text, dados FROM audit_log
     WHERE objeto_tipo = 'entrega_em_nome' AND objeto_id = $1 ORDER BY em, id`,
    [entregaId],
  );
}

/** Autenticar (consentimento) e passar a página simulada da CMD. */
async function autorizar(ctx: Contexto, token: string, telefone: string) {
  const a = await ctx
    .http()
    .post(`/v1/public/entregas/${token}/autenticar`)
    .send({ consentimento: true })
    .expect(estado(200));
  const state = new URL(a.body.url).searchParams.get('estado')!;
  return ctx
    .http()
    .post(`/v1/public/entregas/${token}/autorizar-simulado`)
    .send({ estado: state, telefone, pin: '1234' });
}

/**
 * Entregar o pedido em nome da pessoa (simulado): ferramenta → SMS →
 * autorizar com a Chave Móvel Digital simulada → entregue → comprovativo.
 */
describe('Entregar o pedido em nome da pessoa (e2e)', () => {
  let ctx: Contexto;
  let chefe: Record<string, string>;

  beforeAll(async () => {
    delete process.env.ENTREGA_AUTENTICACAO;
    delete process.env.ENTREGA_SUBMISSAO;
    delete process.env.ENTREGA_SUBMISSAO_TAXA_FALHA;
    ctx = await arrancarApp();
    chefe = await entrarPainel(ctx);
  });
  afterAll(() => ctx.fechar());

  describe('fluxo completo', () => {
    const chamada = novaChamada('entrega');
    let requerimentoId: string;
    let entregaId: string;
    let token: string;
    let numero: string;
    let processoId: string;

    it('sem confirmação só devolve o resumo para ler (nada é entregue)', async () => {
      requerimentoId = await requerimentoPronto(ctx, chamada);
      const r = await ferramenta(ctx, chamada, 'entregar_pedido', {}).expect(
        estado(200),
      );
      expect(r.body).toMatchObject({
        estado: 'por_confirmar',
        codigo_resumo: expect.stringMatching(/^[0-9a-f]{10}$/),
        simulado: true,
        resumo: {
          tipo: { codigo: 'CP' },
          campos: expect.arrayContaining([
            { rotulo: expect.any(String), valor: 'Rua de Santa Maria, 5' },
          ]),
        },
        dizer: expect.stringContaining('não tem validade legal'),
      });
      expect(r.body.dizer).not.toContain('NIF');
      const n = await linha<{ n: number }>(
        ctx.db,
        'SELECT count(*)::int AS n FROM entregas_em_nome WHERE requerimento_id = $1',
        [requerimentoId],
      );
      expect(n?.n).toBe(0);
    });

    it('recusa confirmar sem código, com um "não" ou com o resumo antigo', async () => {
      const sem = await ferramenta(ctx, chamada, 'entregar_pedido', {
        confirmado: true,
      }).expect(estado(422));
      expect(sem.body.erro.codigo).toBe('confirmacao_em_falta');

      const r1 = await ferramenta(ctx, chamada, 'entregar_pedido', {});
      const nao = await ferramenta(ctx, chamada, 'entregar_pedido', {
        confirmado: true,
        codigo_resumo: r1.body.codigo_resumo,
        palavras_do_municipe: 'Não, espere um bocadinho.',
      }).expect(estado(422));
      expect(nao.body.erro.codigo).toBe('confirmacao_pouco_clara');

      const antigo = await ferramenta(ctx, chamada, 'entregar_pedido', {
        confirmado: true,
        codigo_resumo: '0000000000',
        palavras_do_municipe: 'Sim',
      }).expect(estado(200));
      expect(antigo.body).toMatchObject({
        estado: 'por_confirmar',
        motivo: expect.any(String),
      });
      const n = await linha<{ n: number }>(
        ctx.db,
        'SELECT count(*)::int AS n FROM entregas_em_nome WHERE requerimento_id = $1',
        [requerimentoId],
      );
      expect(n?.n).toBe(0);
    });

    it('confirmado: fica à espera de autorização e o SMS com o link fica gravado', async () => {
      const r = await confirmarEntrega(ctx, chamada).then((x) => {
        estado(200)(x);
        return x;
      });
      expect(r.body).toMatchObject({
        estado: 'a_espera_autorizacao',
        sms_enviado: true,
        simulado: true,
        validade_horas: 24,
        dizer: expect.stringContaining('Chave Móvel Digital'),
      });
      token = tokenDoLink(r.body.link);
      const e = await linha(
        ctx.db,
        `SELECT id, estado, simulado, autenticacao_modo, submissao_modo, confirmacao, canal,
                expira_em > now() + interval '23 hours' AS valida
         FROM entregas_em_nome WHERE token_publico = $1`,
        [token],
      );
      expect(e).toMatchObject({
        estado: 'a_espera_autorizacao',
        simulado: true,
        autenticacao_modo: 'simulada',
        submissao_modo: 'simulada',
        confirmacao: 'Sim, pode entregar.',
        canal: 'telefone',
        valida: true,
      });
      entregaId = e.id;

      const sms = (await smsPara(ctx, chamada.telefone, 'requerimento')).find(
        (s) => s.relacionado.entrega_id === entregaId,
      );
      expect(sms?.corpo).toContain(`${WEB_URL}/entrega/${token}`);
      expect(sms?.corpo).toContain('DEMONSTRAÇÃO');

      expect((await auditoria(ctx, entregaId)).map((a) => a.acao)).toEqual([
        'confirmar_entrega',
        'pedir_autorizacao_entrega',
      ]);
      const [conf] = await auditoria(ctx, entregaId);
      expect(conf).toMatchObject({
        ator_tipo: 'municipe',
        dados: { palavras: 'Sim, pode entregar.', simulado: true },
      });
    });

    it('idempotente: chamar outra vez não cria outra entrega nem outro SMS', async () => {
      const r = await confirmarEntrega(ctx, chamada).then((x) => {
        estado(200)(x);
        return x;
      });
      expect(r.body.estado).toBe('a_espera_autorizacao');
      const n = await linha<{ n: number }>(
        ctx.db,
        'SELECT count(*)::int AS n FROM entregas_em_nome WHERE requerimento_id = $1',
        [requerimentoId],
      );
      expect(n?.n).toBe(1);
      const sms = (await smsPara(ctx, chamada.telefone)).filter(
        (s) => s.relacionado.entrega_id === entregaId,
      );
      expect(sms).toHaveLength(1);
    });

    it('a página do munícipe mostra o resumo, o aviso e o PIN de demonstração', async () => {
      const r = await ctx
        .http()
        .get(`/v1/public/entregas/${token}`)
        .expect(estado(200));
      expect(r.body).toMatchObject({
        estado: 'a_espera_autorizacao',
        simulado: true,
        aviso: expect.stringContaining('sem validade legal'),
        pode_autorizar: true,
        autenticacao: {
          modo: 'simulada',
          simulada: true,
          pin_demonstracao: '1234',
          pede_nif: false,
          telefone_mascarado: expect.stringContaining('•'),
        },
        resumo: { tipo: { codigo: 'CP' } },
        comprovativo: null,
      });
      expect(JSON.stringify(r.body)).not.toContain(entregaId);
    });

    it('autenticar exige o consentimento explícito', async () => {
      const r = await ctx
        .http()
        .post(`/v1/public/entregas/${token}/autenticar`)
        .send({})
        .expect(estado(400));
      expect(r.body.erro.codigo).toBe('pedido_invalido');
    });

    it('PIN errado ou state de outro pedido → recusado e registado', async () => {
      const a = await ctx
        .http()
        .post(`/v1/public/entregas/${token}/autenticar`)
        .send({ consentimento: true })
        .expect(estado(200));
      expect(a.body.url).toMatch(
        new RegExp(`^${WEB_URL}/entrega/${token}/autorizar\\?estado=`),
      );
      const state = new URL(a.body.url).searchParams.get('estado')!;
      const pin = await ctx
        .http()
        .post(`/v1/public/entregas/${token}/autorizar-simulado`)
        .send({ estado: state, telefone: chamada.telefone, pin: '9999' })
        .expect(estado(403));
      expect(pin.body.erro.codigo).toBe('pin_errado');

      const outro = await ctx
        .http()
        .post(`/v1/public/entregas/${token}/autorizar-simulado`)
        .send({
          estado: 'x'.repeat(43),
          telefone: chamada.telefone,
          pin: '1234',
        })
        .expect(estado(400));
      expect(outro.body.erro.codigo).toBe('pedido_autenticacao_invalido');

      const acoes = (await auditoria(ctx, entregaId)).map((x) => x.acao);
      expect(acoes).toContain('consentir_entrega');
      expect(acoes).toContain('autenticacao_recusada');
    });

    it('autorizado com a CMD simulada: entregue, processo, comprovativo, SMS e auditoria', async () => {
      const r = await autorizar(ctx, token, chamada.telefone);
      estado(200)(r);
      expect(r.body).toMatchObject({
        estado: 'entregue',
        simulado: true,
        autorizacao: { nivel_garantia: 'simulado', simulada: true },
        comprovativo: {
          numero_entrada: expect.stringMatching(/^DEMO-\d{4}\/\d{6}$/),
          simulado: true,
          pdf: `/v1/public/entregas/${token}/comprovativo.pdf`,
        },
        processo: { numero: expect.stringMatching(/^CP /) },
      });
      numero = r.body.comprovativo.numero_entrada;

      const e = await linha(
        ctx.db,
        `SELECT e.estado, e.numero_entrada, e.processo_id, e.identidade, r.estado::text AS req_estado,
                r.assinatura::text AS assinatura
         FROM entregas_em_nome e JOIN requerimentos r ON r.id = e.requerimento_id
         WHERE e.id = $1`,
        [entregaId],
      );
      expect(e).toMatchObject({
        estado: 'entregue',
        numero_entrada: numero,
        req_estado: 'entregue',
        assinatura: 'simulada',
        identidade: {
          nivel_garantia: 'simulado',
          fornecedor: 'simulacao',
          simulada: true,
          nif_mascarado: expect.stringMatching(/^\*{6}\d{3}$/),
        },
      });
      processoId = e.processo_id;

      const evento = await linha(
        ctx.db,
        `SELECT descricao FROM processo_eventos WHERE processo_id = $1 AND tipo = 'entrega_em_nome'`,
        [processoId],
      );
      expect(evento?.descricao).toContain(numero);
      expect(evento?.descricao).toContain('sem validade legal');

      const sms = (await smsPara(ctx, chamada.telefone, 'requerimento')).filter(
        (s) => s.relacionado.entrega_id === entregaId,
      );
      expect(sms).toHaveLength(2);
      expect(sms[1].corpo).toContain(numero);
      expect(sms[1].corpo).toContain('DEMONSTRAÇÃO');

      const aud = await auditoria(ctx, entregaId);
      const autorizou = aud.find((a) => a.acao === 'autorizar_entrega');
      expect(autorizou).toMatchObject({
        ator_tipo: 'municipe',
        dados: {
          nivel_garantia: 'simulado',
          simulado: true,
          consentimento_em: expect.any(String),
          nif_confirmado: true,
        },
      });
      const entregou = aud.filter((a) => a.acao === 'entregar_em_nome');
      expect(entregou).toHaveLength(1);
      expect(entregou[0].dados).toMatchObject({
        numero_entrada: numero,
        processo_id: processoId,
        simulado: true,
        nivel_garantia: 'simulado',
      });
      // O NIF nunca vai em claro para a auditoria.
      expect(JSON.stringify(aud)).not.toMatch(/\b2\d{8}\b/);
    });

    it('não entrega duas vezes: repetir devolve o mesmo comprovativo', async () => {
      const r = await ctx
        .http()
        .post(`/v1/public/entregas/${token}/autenticar`)
        .send({ consentimento: true })
        .expect(estado(409));
      expect(r.body.erro.codigo).toBe('entrega_nao_espera_autorizacao');

      const f = await ferramenta(ctx, chamada, 'entregar_pedido', {}).expect(
        estado(200),
      );
      expect(f.body).toMatchObject({
        estado: 'entregue',
        numero_entrada: numero,
      });
      const n = await linha<{ n: number }>(
        ctx.db,
        `SELECT count(*)::int AS n FROM audit_log
         WHERE objeto_tipo = 'entrega_em_nome' AND objeto_id = $1 AND acao = 'entregar_em_nome'`,
        [entregaId],
      );
      expect(n?.n).toBe(1);
    });

    it('o comprovativo em PDF (público e no painel)', async () => {
      const p = await ctx
        .http()
        .get(`/v1/public/entregas/${token}/comprovativo.pdf`)
        .buffer(true)
        .expect(estado(200));
      expect(p.headers['content-type']).toBe('application/pdf');
      expect(Buffer.from(p.body).subarray(0, 5).toString()).toBe('%PDF-');

      await ctx
        .http()
        .get(`/v1/painel/entregas/${entregaId}/comprovativo.pdf`)
        .set(chefe)
        .expect(estado(200));
    });

    it('painel: a entrega na ficha do processo, com o histórico e o modo', async () => {
      const l = await ctx
        .http()
        .get(`/v1/painel/entregas?processo_id=${processoId}`)
        .set(chefe)
        .expect(estado(200));
      expect(l.body.modo).toMatchObject({
        simulado: true,
        estado: 'simulado',
        autenticacao: { modo: 'simulada', configurada: true },
        submissao: { modo: 'simulada' },
        o_que_falta: expect.arrayContaining([
          expect.stringContaining('Credenciação na AMA'),
        ]),
      });
      expect(l.body.itens).toHaveLength(1);
      expect(l.body.itens[0]).toMatchObject({
        id: entregaId,
        estado: 'entregue',
        simulado: true,
        numero_entrada: numero,
        processo: { id: processoId },
      });

      const d = await ctx
        .http()
        .get(`/v1/painel/entregas/${entregaId}`)
        .set(chefe)
        .expect(estado(200));
      expect(d.body.historico.map((h: { acao: string }) => h.acao)).toEqual(
        expect.arrayContaining([
          'confirmar_entrega',
          'consentir_entrega',
          'autorizar_entrega',
          'entregar_em_nome',
        ]),
      );
    });
  });

  describe('permissões do painel', () => {
    it('atendimento não vê as entregas; técnico vê', async () => {
      const atendimento = await entrarPainel(
        ctx,
        await criarUtilizador(ctx, 'atendimento'),
      );
      await ctx
        .http()
        .get('/v1/painel/entregas')
        .set(atendimento)
        .expect(estado(403));
      await ctx
        .http()
        .get('/v1/painel/entregas/modo')
        .set(atendimento)
        .expect(estado(403));
      const tecnico = await entrarPainel(
        ctx,
        await criarUtilizador(ctx, 'tecnico'),
      );
      await ctx
        .http()
        .get('/v1/painel/entregas')
        .set(tecnico)
        .expect(estado(200));
    });

    it('sem login → 401', async () => {
      await ctx.http().get('/v1/painel/entregas').expect(estado(401));
    });
  });

  describe('expiração do link', () => {
    it('passado o prazo fica expirado, não autoriza, e pode preparar-se outra', async () => {
      const chamada = novaChamada('entrega-exp');
      const reqId = await requerimentoPronto(ctx, chamada);
      const r = await confirmarEntrega(ctx, chamada);
      estado(200)(r);
      const token = tokenDoLink(r.body.link);
      const e = await linha<{ id: string }>(
        ctx.db,
        `UPDATE entregas_em_nome SET expira_em = now() - interval '1 minute'
         WHERE token_publico = $1 RETURNING id`,
        [token],
      );

      const v = await ctx
        .http()
        .get(`/v1/public/entregas/${token}`)
        .expect(estado(200));
      expect(v.body).toMatchObject({
        estado: 'expirado',
        pode_autorizar: false,
      });

      const a = await ctx
        .http()
        .post(`/v1/public/entregas/${token}/autenticar`)
        .send({ consentimento: true })
        .expect(estado(410));
      expect(a.body.erro.codigo).toBe('link_expirado');
      expect((await auditoria(ctx, e!.id)).map((x) => x.acao)).toContain(
        'expirar_entrega',
      );

      // Com o link expirado, o agente pode preparar a entrega outra vez.
      const de_novo = await confirmarEntrega(ctx, chamada);
      estado(200)(de_novo);
      expect(de_novo.body.estado).toBe('a_espera_autorizacao');
      const n = await linha<{ n: number }>(
        ctx.db,
        'SELECT count(*)::int AS n FROM entregas_em_nome WHERE requerimento_id = $1',
        [reqId],
      );
      expect(n?.n).toBe(2);
    });

    it('expirado entre a página e o clique → 410', async () => {
      const chamada = novaChamada('entrega-410');
      await requerimentoPronto(ctx, chamada);
      const r = await confirmarEntrega(ctx, chamada);
      const token = tokenDoLink(r.body.link);
      await ctx.db.query(
        `UPDATE entregas_em_nome SET expira_em = now() - interval '1 second' WHERE token_publico = $1`,
        [token],
      );
      const a = await ctx
        .http()
        .post(`/v1/public/entregas/${token}/autenticar`)
        .send({ consentimento: true })
        .expect(estado(410));
      expect(a.body.erro.codigo).toBe('link_expirado');
    });
  });

  describe('salvaguardas', () => {
    it('se o pedido mudar depois de confirmado, não se entrega', async () => {
      const chamada = novaChamada('entrega-mudou');
      await requerimentoPronto(ctx, chamada);
      const r = await confirmarEntrega(ctx, chamada);
      const token = tokenDoLink(r.body.link);
      await ferramenta(ctx, chamada, 'preencher_campo', {
        campos: { descricao: 'Afinal é uma marquise' },
      }).expect(estado(200));
      const a = await autorizar(ctx, token, chamada.telefone);
      estado(409)(a);
      expect(a.body.erro.codigo).toBe('pedido_alterado');
      const e = await linha(
        ctx.db,
        'SELECT estado, numero_entrada FROM entregas_em_nome WHERE token_publico = $1',
        [token],
      );
      expect(e).toEqual({ estado: 'cancelado', numero_entrada: null });
    });

    it('o requerimento tem de estar concluído', async () => {
      const chamada = novaChamada('entrega-incompleto');
      await ferramenta(ctx, chamada, 'iniciar_requerimento', {
        tipo: 'CP',
      }).expect(estado(200));
      const r = await ferramenta(ctx, chamada, 'entregar_pedido', {}).expect(
        estado(422),
      );
      expect(r.body.erro.codigo).toBe('requerimento_por_concluir');
    });

    it('a submissão falha → "falhou"; o painel tenta de novo e entrega', async () => {
      const chamada = novaChamada('entrega-falha');
      await requerimentoPronto(ctx, chamada);
      const r = await confirmarEntrega(ctx, chamada);
      const token = tokenDoLink(r.body.link);
      process.env.ENTREGA_SUBMISSAO_TAXA_FALHA = '1';
      try {
        const a = await autorizar(ctx, token, chamada.telefone);
        estado(200)(a);
        expect(a.body).toMatchObject({
          estado: 'falhou',
          erro: expect.any(String),
          comprovativo: null,
        });
      } finally {
        delete process.env.ENTREGA_SUBMISSAO_TAXA_FALHA;
      }
      const e = await linha<{ id: string; processo_id: string | null }>(
        ctx.db,
        'SELECT id, processo_id FROM entregas_em_nome WHERE token_publico = $1',
        [token],
      );
      // A falha volta atrás com tudo: sem processo a meio.
      expect(e?.processo_id).toBeNull();

      const t = await ctx
        .http()
        .post(`/v1/painel/entregas/${e!.id}/tentar-de-novo`)
        .set(chefe)
        .expect(estado(200));
      expect(t.body).toMatchObject({
        estado: 'entregue',
        numero_entrada: expect.stringMatching(/^DEMO-/),
      });
      const acoes = (await auditoria(ctx, e!.id)).map((x) => x.acao);
      expect(acoes).toEqual(
        expect.arrayContaining([
          'entrega_falhou',
          'tentar_entrega_de_novo',
          'entregar_em_nome',
        ]),
      );

      // Entregue não se cancela.
      const c = await ctx
        .http()
        .post(`/v1/painel/entregas/${e!.id}/cancelar`)
        .set(chefe)
        .send({ motivo: 'Engano' })
        .expect(estado(409));
      expect(c.body.erro.codigo).toBe('entrega_nao_cancelavel');
    });

    it('o painel cancela uma entrega à espera; o link deixa de servir', async () => {
      const chamada = novaChamada('entrega-cancelar');
      await requerimentoPronto(ctx, chamada);
      const r = await confirmarEntrega(ctx, chamada);
      const token = tokenDoLink(r.body.link);
      const e = await linha<{ id: string }>(
        ctx.db,
        'SELECT id FROM entregas_em_nome WHERE token_publico = $1',
        [token],
      );
      await ctx
        .http()
        .post(`/v1/painel/entregas/${e!.id}/cancelar`)
        .set(chefe)
        .send({ motivo: 'A pessoa pediu para não entregar' })
        .expect(estado(200));
      const v = await ctx
        .http()
        .get(`/v1/public/entregas/${token}`)
        .expect(estado(200));
      expect(v.body.estado).toBe('cancelado');
    });

    it('regresso do fornecedor real com um state desconhecido → página de link expirado', async () => {
      const r = await ctx
        .http()
        .get('/v1/public/entregas/autenticacao/retorno?state=desconhecido&code=x')
        .expect(estado(302));
      expect(r.headers.location).toBe(`${WEB_URL}/expirado`);
    });

    it('link que não existe → 404 link_invalido', async () => {
      const r = await ctx
        .http()
        .get(`/v1/public/entregas/${'a'.repeat(24)}`)
        .expect(estado(404));
      expect(r.body.erro.codigo).toBe('link_invalido');
    });
  });

  describe('modo cmd (Chave Móvel Digital real) sem configuração', () => {
    afterEach(() => {
      delete process.env.ENTREGA_AUTENTICACAO;
    });

    it('a ferramenta recusa com "por configurar — falta a credenciação na AMA"', async () => {
      const chamada = novaChamada('entrega-cmd');
      await requerimentoPronto(ctx, chamada);
      const r1 = await ferramenta(ctx, chamada, 'entregar_pedido', {}).expect(
        estado(200),
      );
      process.env.ENTREGA_AUTENTICACAO = 'cmd';
      const r = await ferramenta(ctx, chamada, 'entregar_pedido', {
        confirmado: true,
        codigo_resumo: r1.body.codigo_resumo,
        palavras_do_municipe: 'sim',
      }).expect(estado(503));
      expect(r.body.erro).toMatchObject({
        codigo: 'autenticacao_por_configurar',
        mensagem:
          'Autenticação com Chave Móvel Digital por configurar — falta a credenciação na AMA.',
        detalhes: {
          em_falta: expect.arrayContaining(['CMD_PROTOCOLO', 'CMD_URL_BASE']),
        },
      });
      const n = await linha<{ n: number }>(
        ctx.db,
        `SELECT count(*)::int AS n FROM entregas_em_nome e
         JOIN requerimentos r ON r.id = e.requerimento_id
         JOIN conversas c ON c.id = r.conversa_id WHERE c.provider_id = $1`,
        [chamada.conversa],
      );
      expect(n?.n).toBe(0);
    });

    it('o painel mostra "real por configurar" e o que falta', async () => {
      process.env.ENTREGA_AUTENTICACAO = 'cmd';
      const m = await ctx
        .http()
        .get('/v1/painel/entregas/modo')
        .set(chefe)
        .expect(estado(200));
      expect(m.body).toMatchObject({
        estado: 'simulado', // a submissão continua simulada
        autenticacao: {
          modo: 'cmd',
          simulada: false,
          configurada: false,
          em_falta: expect.arrayContaining(['CMD_PROTOCOLO']),
        },
      });
      process.env.ENTREGA_SUBMISSAO = 'balcao';
      try {
        const m2 = await ctx
          .http()
          .get('/v1/painel/entregas/modo')
          .set(chefe)
          .expect(estado(200));
        expect(m2.body).toMatchObject({
          simulado: false,
          estado: 'real_por_configurar',
          submissao: {
            modo: 'balcao',
            configurada: false,
            em_falta: ['BALCAO_URL', 'BALCAO_CREDENCIAL'],
          },
        });
      } finally {
        delete process.env.ENTREGA_SUBMISSAO;
      }
    });
  });

  it('as ações ficam no registo de acessos em frases', async () => {
    const r = await linha<{ n: number }>(
      ctx.db,
      `SELECT count(*)::int AS n FROM audit_log
       WHERE municipio_id = $1 AND objeto_tipo = 'entrega_em_nome'`,
      [MUNICIPIO_ID],
    );
    expect(r?.n).toBeGreaterThan(5);
  });
});
