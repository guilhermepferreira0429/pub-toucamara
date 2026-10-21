/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument -- os corpos do supertest são `any`; as asserções do jest verificam a forma. */
import { randomInt, randomUUID } from 'crypto';
import {
  arrancarApp,
  CHEFE_ID,
  Chamada,
  Contexto,
  conversaId,
  criarUtilizador,
  entrarPainel,
  esperarSmsEnviado,
  ferramenta,
  FONTE_RJUE_ID,
  linha,
  linhas,
  novaChamada,
  smsPara,
} from './app';

/** NIF português válido aleatório (9 dígitos com dígito de controlo). */
function novoNif(): string {
  const base = `2${String(randomInt(0, 10_000_000)).padStart(7, '0')}`;
  const soma = [...base].reduce((s, d, i) => s + Number(d) * (9 - i), 0);
  const controlo = 11 - (soma % 11);
  return `${base}${controlo >= 10 ? 0 : controlo}`;
}

/** Palavras que não existem em nenhuma fonte nem regra. */
function semSentido(): string {
  return `zorblatex quiffnorp ${randomUUID().replace(/\d/g, '').slice(0, 8)}`;
}

async function momentos(ctx: Contexto, providerId: string, tipo: string) {
  return linhas<{ dados: Record<string, unknown> }>(
    ctx.db,
    `SELECT m.dados FROM conversa_momentos m
     JOIN conversas c ON c.id = m.conversa_id
     WHERE c.provider_id = $1 AND m.tipo = $2 ORDER BY m.id`,
    [providerId, tipo],
  );
}

/** Atendimento: conhecimento, encaminhamento, identificação, passagens e emergência. */
describe('Atendimento (e2e)', () => {
  let ctx: Contexto;
  let painel: Record<string, string>;

  beforeAll(async () => {
    ctx = await arrancarApp();
    painel = await entrarPainel(ctx);
  });
  afterAll(() => ctx.fechar());

  describe('procurar_conhecimento', () => {
    it('pergunta sobre a porta na fachada → trechos do RJUE com referência e fonte, e momento gravado', async () => {
      const chamada = novaChamada();
      const r = await ferramenta(ctx, chamada, 'procurar_conhecimento', {
        pergunta: 'Preciso de licença para abrir uma porta na fachada?',
      }).expect(200);

      expect(r.body.sem_fonte).toBe(false);
      const trecho = (r.body.trechos as any[]).find(
        (t) => t.referencia === 'art. 4.º, n.º 4',
      );
      expect(trecho).toMatchObject({
        trecho_id: expect.any(String),
        referencia: 'art. 4.º, n.º 4',
        texto: expect.stringContaining('porta ou janela na fachada'),
        titulo: 'RJUE',
        url: 'https://exemplo.pt/rjue',
        tipo_fonte: 'lei',
        entidade: 'Câmara Municipal',
        lida_em: expect.any(String),
        pontuacao: expect.any(Number),
      });
      // O trecho é mesmo da fonte RJUE do seed.
      const fonte = await linha<{ fonte_id: string }>(
        ctx.db,
        `SELECT fv.fonte_id FROM trechos t JOIN fonte_versoes fv ON fv.id = t.fonte_versao_id
         WHERE t.id = $1`,
        [trecho.trecho_id],
      );
      expect(fonte?.fonte_id).toBe(FONTE_RJUE_ID);

      const m = await momentos(ctx, chamada.conversa, 'resposta_com_fonte');
      expect(m).toHaveLength(1);
      expect(m[0].dados).toMatchObject({
        pergunta: 'Preciso de licença para abrir uma porta na fachada?',
        trechos: expect.arrayContaining([trecho.trecho_id]),
        respostas: expect.any(Array),
      });
    });

    it('o limite corta o número de trechos', async () => {
      const r = await ferramenta(ctx, novaChamada(), 'procurar_conhecimento', {
        pergunta: 'obras de alteração na fachada e no interior de edifícios',
        limite: 1,
      }).expect(200);
      expect(r.body.sem_fonte).toBe(false);
      expect(r.body.trechos).toHaveLength(1);
    });

    it('pergunta sem nada no conhecimento → sem_fonte, sem momento de resposta com fonte', async () => {
      const chamada = novaChamada();
      const r = await ferramenta(ctx, chamada, 'procurar_conhecimento', {
        pergunta: semSentido(),
      }).expect(200);
      expect(r.body).toEqual({ sem_fonte: true, respostas: [], trechos: [] });

      // A conversa existe, mas nada fica citado: sem IA, as perguntas sem
      // resposta só nascem do resumo do fim da chamada (ResumoService).
      const id = await conversaId(ctx, chamada.conversa);
      expect(
        await momentos(ctx, chamada.conversa, 'resposta_com_fonte'),
      ).toHaveLength(0);
      const psr = await linha<{ n: number }>(
        ctx.db,
        `SELECT count(*)::int AS n FROM pergunta_sem_resposta_ocorrencias o
         JOIN conversa_turnos t ON t.id = o.turno_id WHERE t.conversa_id = $1`,
        [id],
      );
      expect(psr?.n).toBe(0);
    });

    it('pergunta curta demais → 400 pedido_invalido', async () => {
      const r = await ferramenta(ctx, novaChamada(), 'procurar_conhecimento', {
        pergunta: 'a',
      }).expect(400);
      expect(r.body.erro.codigo).toBe('pedido_invalido');
    });
  });

  describe('encaminhar', () => {
    it('falta de água → Águas do Concelho, linha de avarias 800 aberta 24 horas', async () => {
      const r = await ferramenta(ctx, novaChamada(), 'encaminhar', {
        assunto: 'Estou sem água em casa desde manhã',
      }).expect(200);
      expect(r.body).toMatchObject({
        encontrada: true,
        emergencia: false,
        assunto: 'Falta de água, roturas, contadores',
        entidade: { nome: 'Águas do Concelho', tipo: 'empresa_municipal' },
        contacto: {
          tipo: 'avarias',
          rotulo: 'Avarias, 24 horas',
          valor: '800 000 000',
          aberto_agora: true,
        },
        passa_a_pessoa: null,
      });
      expect(r.body.dizer).toContain('Águas do Concelho');
      expect(r.body.dizer).toContain('800 000 000');
    });

    it('acidente com pessoa ferida → 112, como emergência', async () => {
      const r = await ferramenta(ctx, novaChamada(), 'encaminhar', {
        assunto: 'Houve um acidente na estrada e há uma pessoa ferida',
      }).expect(200);
      expect(r.body).toEqual({
        encontrada: true,
        emergencia: true,
        entidade: 'Emergência 112',
        dizer: 'Ligue já para o 112.',
        instrucao: expect.stringContaining('emergencia'),
      });
    });

    it('assunto sem regra → encontrada: false, sem inventar contactos', async () => {
      const r = await ferramenta(ctx, novaChamada(), 'encaminhar', {
        assunto: semSentido(),
      }).expect(200);
      expect(r.body).toEqual({ encontrada: false, dizer: expect.any(String) });
    });
  });

  describe('identificar_municipe', () => {
    it('NIF + nome → o munícipe do número fica com o NIF (cifrado e com hash) e ligado à conversa', async () => {
      const chamada = novaChamada();
      const nif = novoNif();
      const r = await ferramenta(ctx, chamada, 'identificar_municipe', {
        nif: `${nif.slice(0, 3)} ${nif.slice(3, 6)} ${nif.slice(6)}`,
        nome: 'Maria Teste Silva',
      }).expect(200);
      expect(r.body).toEqual({
        identificado: true,
        nome: 'Maria Teste Silva',
        novo: true,
      });

      const c = await linha<{ municipe_id: string; telefone_e164: string }>(
        ctx.db,
        `SELECT c.municipe_id, m.telefone_e164 FROM conversas c
         JOIN municipes m ON m.id = c.municipe_id WHERE c.provider_id = $1`,
        [chamada.conversa],
      );
      // É o munícipe criado pelo número de onde liga.
      expect(c?.telefone_e164).toBe(chamada.telefone);

      const m = await linha<{
        texto: string;
        hash_ok: boolean;
        decifrado: string;
      }>(
        ctx.db,
        `SELECT row_to_json(m)::text AS texto,
                m.nif_hash = hmac($2, 'pepper-e2e', 'sha256') AS hash_ok,
                pgp_sym_decrypt(m.nif_cifrado, 'chave-dados-e2e') AS decifrado
         FROM municipes m WHERE m.id = $1`,
        [c!.municipe_id, nif],
      );
      // Nunca em claro: nem em nenhuma coluna, nem dentro do cifrado.
      expect(m?.texto).not.toContain(nif);
      expect(m?.hash_ok).toBe(true);
      expect(m?.decifrado).toBe(nif);
    });

    it('o mesmo NIF a partir de outro telefone identifica o mesmo munícipe (novo: false)', async () => {
      const nif = novoNif();
      const a = novaChamada();
      await ferramenta(ctx, a, 'identificar_municipe', {
        nif,
        nome: 'João Teste',
      }).expect(200);
      const idA = (await linha<{ municipe_id: string }>(
        ctx.db,
        'SELECT municipe_id FROM conversas WHERE provider_id = $1',
        [a.conversa],
      ))!.municipe_id;

      const b = novaChamada();
      const r = await ferramenta(ctx, b, 'identificar_municipe', {
        nif: `PT${nif}`,
      }).expect(200);
      expect(r.body).toEqual({
        identificado: true,
        nome: 'João Teste',
        novo: false,
      });
      const cb = await linha<{ municipe_id: string }>(
        ctx.db,
        'SELECT municipe_id FROM conversas WHERE provider_id = $1',
        [b.conversa],
      );
      expect(cb?.municipe_id).toBe(idA);
    });

    it('NIF com dígito de controlo errado → identificado: false, nif_invalido', async () => {
      const nif = novoNif();
      const errado = `${nif.slice(0, 8)}${(Number(nif[8]) + 1) % 10}`;
      const chamada = novaChamada();
      const r = await ferramenta(ctx, chamada, 'identificar_municipe', {
        nif: errado,
      }).expect(200);
      expect(r.body).toMatchObject({
        identificado: false,
        motivo: 'nif_invalido',
        dizer: expect.any(String),
      });
      const m = await linha<{ tem_nif: boolean }>(
        ctx.db,
        `SELECT m.nif_hash IS NOT NULL AS tem_nif FROM conversas c
         JOIN municipes m ON m.id = c.municipe_id WHERE c.provider_id = $1`,
        [chamada.conversa],
      );
      expect(m?.tem_nif).toBe(false);
    });
  });

  describe('passar_a_humano e emergencia', () => {
    it('cria a passagem, marca a conversa e responde com o "dizer" (SMS por defeito)', async () => {
      const chamada = novaChamada();
      const r = await ferramenta(ctx, chamada, 'passar_a_humano', {
        motivo: 'sem_fonte',
        resumo: 'Pergunta sobre um muro de vedação; não há resposta oficial.',
      }).expect(200);
      expect(r.body).toEqual({
        passada: true,
        passagem_id: expect.any(String),
        fora_de_horas: expect.any(Boolean),
        responder_ate: expect.any(String),
        // Dentro ou fora do horário ("Passei…" / "…já passei…"): depende da hora a que corre.
        dizer: expect.stringMatching(/[Pp]assei o seu caso.*por SMS\.$/),
      });

      const p = await linha(
        ctx.db,
        `SELECT p.*, c.provider_id, c.resultado::text AS resultado_conversa
         FROM passagens_humano p JOIN conversas c ON c.id = p.conversa_id
         WHERE p.id = $1`,
        [r.body.passagem_id],
      );
      expect(p).toMatchObject({
        provider_id: chamada.conversa,
        motivo: 'sem_fonte',
        estado: 'aberta',
        preferencia_resposta: 'sms',
        atribuida_a: null,
        resultado_conversa: 'passada_funcionario',
      });
      expect(new Date(p.responder_ate).toISOString()).toBe(
        r.body.responder_ate,
      );
      const m = await momentos(ctx, chamada.conversa, 'passagem');
      expect(m[0].dados).toMatchObject({
        passagem_id: r.body.passagem_id,
        motivo: 'sem_fonte',
      });

      // Segunda chamada na mesma conversa: atualiza a passagem aberta.
      const r2 = await ferramenta(ctx, chamada, 'passar_a_humano', {
        motivo: 'pedido',
        resumo: 'Afinal quer falar com uma pessoa sobre o muro de vedação.',
        preferencia_resposta: 'telefone',
      }).expect(200);
      expect(r2.body.passagem_id).toBe(r.body.passagem_id);
      expect(r2.body.dizer).toMatch(/liga-lhe até/);
      const n = await linha<{ n: number; motivo: string }>(
        ctx.db,
        `SELECT count(*)::int AS n, max(motivo) AS motivo FROM passagens_humano
         WHERE conversa_id = $1`,
        [p.conversa_id],
      );
      expect(n).toEqual({ n: 1, motivo: 'pedido' });
    });

    it('sem X-Conversa-Id → 422 sem_conversa', async () => {
      const r = await ferramenta(ctx, undefined, 'passar_a_humano', {
        motivo: 'pedido',
        resumo: 'Quer falar com uma pessoa sobre a obra.',
      }).expect(422);
      expect(r.body.erro.codigo).toBe('sem_conversa');
    });

    it('emergencia regista o momento e o resultado; uma passagem depois não o sobrepõe', async () => {
      const chamada = novaChamada();
      const r = await ferramenta(ctx, chamada, 'emergencia', {
        situacao: 'Fumo a sair de uma casa na Rua Direita',
      }).expect(200);
      expect(r.body).toEqual({
        registado: true,
        dizer: 'Ligue já para o 112.',
        instrucao: expect.any(String),
      });
      const m = await momentos(ctx, chamada.conversa, 'emergencia');
      expect(m).toEqual([
        { dados: { situacao: 'Fumo a sair de uma casa na Rua Direita' } },
      ]);

      await ferramenta(ctx, chamada, 'passar_a_humano', {
        motivo: 'outro',
        resumo: 'Emergência registada; o munícipe pediu também uma pessoa.',
      }).expect(200);
      const c = await linha<{ resultado: string }>(
        ctx.db,
        'SELECT resultado::text AS resultado FROM conversas WHERE provider_id = $1',
        [chamada.conversa],
      );
      expect(c?.resultado).toBe('emergencia');
    });

    it('emergencia sem conversa só responde (não regista nada)', async () => {
      const r = await ferramenta(ctx, undefined, 'emergencia', {}).expect(200);
      expect(r.body).toMatchObject({ registado: true });
    });
  });

  describe('Painel · passagens', () => {
    /** Uma passagem nova a partir de uma chamada com telefone. */
    async function criarPassagem(
      chamada: Chamada | undefined = novaChamada(),
      corpo: object = {},
    ): Promise<string> {
      const r = await ferramenta(ctx, chamada, 'passar_a_humano', {
        motivo: 'pedido',
        resumo: 'Quer saber quando sai a licença da obra na Rua Direita.',
        ...corpo,
      }).expect(200);
      return r.body.passagem_id as string;
    }

    it('sem sessão → 401 nao_autenticado', async () => {
      const r = await ctx.http().get('/v1/painel/passagens').expect(401);
      expect(r.body.erro.codigo).toBe('nao_autenticado');
    });

    it('lista: a passagem nova aparece nas pendentes e por pegar, com o munícipe mascarado', async () => {
      const chamada = novaChamada();
      const id = await criarPassagem(chamada);

      const r = await ctx
        .http()
        .get('/v1/painel/passagens')
        .query({ estado: 'pendentes', atribuida_a: 'ninguem', limite: 200 })
        .set(painel)
        .expect(200);
      expect(r.body).toEqual({
        itens: expect.any(Array),
        proximo_cursor:
          r.body.proximo_cursor === null ? null : expect.any(String),
      });
      const item = (r.body.itens as any[]).find((p) => p.id === id);
      expect(item).toMatchObject({
        id,
        motivo: 'pedido',
        estado: 'aberta',
        atribuida_a: null,
        canal: 'telefone',
        atrasada: false,
        municipe: {
          id: expect.any(String),
          tem_telefone: true,
          tem_email: false,
          telefone: expect.stringContaining('•'),
        },
      });
      expect(JSON.stringify(item)).not.toContain(chamada.telefone.slice(4));

      // Filtro por outro estado: não aparece.
      const fechadas = await ctx
        .http()
        .get('/v1/painel/passagens')
        .query({ estado: 'fechada', limite: 200 })
        .set(painel)
        .expect(200);
      expect((fechadas.body.itens as any[]).some((p) => p.id === id)).toBe(
        false,
      );
    });

    it('filtro inválido → 400 pedido_invalido; id inexistente → 404 nao_encontrado', async () => {
      const a = await ctx
        .http()
        .get('/v1/painel/passagens')
        .query({ estado: 'perdida' })
        .set(painel)
        .expect(400);
      expect(a.body.erro.codigo).toBe('pedido_invalido');
      const b = await ctx
        .http()
        .get(`/v1/painel/passagens/${randomUUID()}`)
        .set(painel)
        .expect(404);
      expect(b.body.erro.codigo).toBe('nao_encontrado');
    });

    it('ciclo completo: detalhe → atribuir → reatribuir → responder por SMS → fechar', async () => {
      const chamada = novaChamada();
      const id = await criarPassagem(chamada);
      const convId = await conversaId(ctx, chamada.conversa);

      // Detalhe
      const d = await ctx
        .http()
        .get(`/v1/painel/passagens/${id}`)
        .set(painel)
        .expect(200);
      expect(d.body).toMatchObject({
        id,
        conversa_id: convId,
        estado: 'aberta',
        resumo: 'Quer saber quando sai a licença da obra na Rua Direita.',
        conversa: {
          id: convId,
          canal: 'telefone',
          resultado: 'passada_funcionario',
        },
        respostas: [],
      });

      // Atribuir (sem corpo: fica para quem pede)
      const a = await ctx
        .http()
        .post(`/v1/painel/passagens/${id}/atribuir`)
        .set(painel)
        .expect(200);
      expect(a.body).toMatchObject({
        id,
        estado: 'em_curso',
        atribuida_a: { id: CHEFE_ID, nome: 'Chefe Teste' },
      });
      const minhas = await ctx
        .http()
        .get('/v1/painel/passagens')
        .query({ atribuida_a: 'eu', limite: 200 })
        .set(painel)
        .expect(200);
      expect((minhas.body.itens as any[]).some((p) => p.id === id)).toBe(true);

      // Reatribuir a um colega; a auditoria regista as duas
      const colega = await criarUtilizador(ctx, 'atendimento');
      const re = await ctx
        .http()
        .post(`/v1/painel/passagens/${id}/atribuir`)
        .set(painel)
        .send({ utilizador_id: colega })
        .expect(200);
      expect(re.body.atribuida_a).toMatchObject({ id: colega });
      const auditoria = await linhas<{ acao: string; dados: any }>(
        ctx.db,
        `SELECT acao, dados FROM audit_log
         WHERE objeto_tipo = 'passagem_humano' AND objeto_id = $1 ORDER BY id`,
        [id],
      );
      expect(auditoria.map((x) => x.acao)).toEqual(['atribuir', 'reatribuir']);
      expect(auditoria[1].dados).toEqual({ de: CHEFE_ID, para: colega });

      // Utilizador que não existe
      const inv = await ctx
        .http()
        .post(`/v1/painel/passagens/${id}/atribuir`)
        .set(painel)
        .send({ utilizador_id: randomUUID() })
        .expect(400);
      expect(inv.body.erro.codigo).toBe('utilizador_invalido');

      // Responder por email sem email → 422
      const semEmail = await ctx
        .http()
        .post(`/v1/painel/passagens/${id}/responder`)
        .set(painel)
        .send({ canal: 'email', texto: 'Olá, a licença sai esta semana.' })
        .expect(422);
      expect(semEmail.body.erro.codigo).toBe('sem_email');

      // Responder por SMS
      const texto = `Olá, a licença sai esta semana. (${randomUUID().slice(0, 6)})`;
      const resp = await ctx
        .http()
        .post(`/v1/painel/passagens/${id}/responder`)
        .set(painel)
        .send({ canal: 'sms', texto })
        .expect(200);
      expect(resp.body).toMatchObject({
        id,
        estado: 'respondida',
        respondida_em: expect.any(String),
        mensagem_id: expect.any(String),
        atribuida_a: { id: colega },
        respostas: [
          expect.objectContaining({
            id: resp.body.mensagem_id,
            canal: 'sms',
            corpo: texto,
          }),
        ],
      });
      const sms = await smsPara(ctx, chamada.telefone, 'passagem');
      expect(sms).toHaveLength(1);
      expect(sms[0]).toMatchObject({
        id: resp.body.mensagem_id,
        destino: chamada.telefone,
        corpo: texto,
        relacionado: { conversa_id: convId, passagem_id: id },
      });
      await esperarSmsEnviado(ctx, chamada.telefone, 'passagem');

      // O mesmo texto outra vez (duplo clique): o mesmo SMS, não sai outro.
      const repetido = await ctx
        .http()
        .post(`/v1/painel/passagens/${id}/responder`)
        .set(painel)
        .send({ canal: 'sms', texto })
        .expect(200);
      expect(repetido.body.mensagem_id).toBe(resp.body.mensagem_id);
      expect(await smsPara(ctx, chamada.telefone, 'passagem')).toHaveLength(1);

      // Fechar
      const f = await ctx
        .http()
        .post(`/v1/painel/passagens/${id}/fechar`)
        .set(painel)
        .expect(200);
      expect(f.body).toMatchObject({ id, estado: 'fechada' });
      const est = await linha<{ estado: string }>(
        ctx.db,
        'SELECT estado FROM passagens_humano WHERE id = $1',
        [id],
      );
      expect(est?.estado).toBe('fechada');

      // Fechada: não se responde nem atribui; fechar de novo não faz mal.
      const r409 = await ctx
        .http()
        .post(`/v1/painel/passagens/${id}/responder`)
        .set(painel)
        .send({ canal: 'sms', texto: 'Mais uma coisa sobre a licença.' })
        .expect(409);
      expect(r409.body.erro.codigo).toBe('passagem_fechada');
      const a409 = await ctx
        .http()
        .post(`/v1/painel/passagens/${id}/atribuir`)
        .set(painel)
        .expect(409);
      expect(a409.body.erro.codigo).toBe('passagem_fechada');
      await ctx
        .http()
        .post(`/v1/painel/passagens/${id}/fechar`)
        .set(painel)
        .expect(200);
      const fechos = await linha<{ n: number }>(
        ctx.db,
        `SELECT count(*)::int AS n FROM audit_log
         WHERE objeto_tipo = 'passagem_humano' AND objeto_id = $1 AND acao = 'fechar'`,
        [id],
      );
      expect(fechos?.n).toBe(1);
    });

    it('passagem de uma chamada sem número: responder por SMS → 422 sem_telefone', async () => {
      const chamada = novaChamada();
      const id = await criarPassagem({ conversa: chamada.conversa } as Chamada);
      const d = await ctx
        .http()
        .get(`/v1/painel/passagens/${id}`)
        .set(painel)
        .expect(200);
      expect(d.body.municipe).toBeNull();
      const r = await ctx
        .http()
        .post(`/v1/painel/passagens/${id}/responder`)
        .set(painel)
        .send({ canal: 'sms', texto: 'Olá, a licença sai esta semana.' })
        .expect(422);
      expect(r.body.erro.codigo).toBe('sem_telefone');
      const p = await linha<{ estado: string }>(
        ctx.db,
        'SELECT estado FROM passagens_humano WHERE id = $1',
        [id],
      );
      expect(p?.estado).toBe('aberta');
    });

    it('responder com texto vazio ou canal inválido → 400 pedido_invalido', async () => {
      const id = await criarPassagem();
      const r = await ctx
        .http()
        .post(`/v1/painel/passagens/${id}/responder`)
        .set(painel)
        .send({ canal: 'pombo', texto: '' })
        .expect(400);
      expect(r.body.erro.codigo).toBe('pedido_invalido');
    });
  });
});
