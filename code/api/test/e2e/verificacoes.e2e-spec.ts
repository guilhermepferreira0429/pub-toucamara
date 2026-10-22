/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument -- os corpos do supertest são `any`; as asserções do jest verificam a forma. */
import { ClaudeService } from '../../src/ia/claude.service';
import { esquemaRegulamentoIa } from '../../src/modules/processos/apoio';
import {
  leituraDemo,
  PROCESSOS_PERFIS,
} from '../../src/modules/processos/projetos-perfis-pdf';
import {
  esquemaLeituraProjeto,
  LeituraProjeto,
} from '../../src/modules/processos/verificacoes';
import {
  arrancarApp,
  Contexto,
  criarUtilizador,
  entrarPainel,
  linha,
  linhas,
  MUNICIPIO_ID,
  TIPO_CP_ID,
} from './app';

/** O que a IA "lê" no projeto de demonstração: o ✓ da fachada e o ⚠ da parede. */
const LEITURA: LeituraProjeto = {
  legivel: true,
  motivo_ilegivel: null,
  fachada_cobertura: {
    alteracoes: 'nao',
    descricao: 'Os alçados mantêm-se como existem.',
    referencia: { documento: 1, pagina: 3, folha: '3' },
  },
  paredes: {
    abertura_ou_demolicao: 'sim',
    declarada_nao_estrutural: true,
    descricao: 'Vão de 0,90 × 2,10 m entre a cozinha e a sala.',
    referencia: { documento: 1, pagina: 2, folha: '2' },
  },
  planta_estruturas: { existe: false, referencia: null },
  areas_cerceas: {
    coerentes: 'sem_dados',
    descricao: '',
    referencia: null,
  },
  contradicoes: [],
  medicoes: [],
  elementos: [],
  tecnico_autor: {
    nome: 'Joana Lima',
    ordem: 'OA',
    numero_inscricao: '12345',
    termo_assinado: true,
    referencia: { documento: 2, pagina: 1, folha: null },
  },
};

/** IA falsa: lê o projeto, não escolhe trechos e escreve o parecer. */
class IaFalsa {
  ligada = true;
  leituras: {
    ficheiros: { nome: string; mime: string; ficheiro: Buffer }[];
    conteudo: string;
  }[] = [];
  escritos: { sistema: string; conteudo: string }[] = [];
  resposta: unknown = LEITURA;
  get disponivel() {
    return this.ligada;
  }
  extrair(esquema: unknown, pedido: any) {
    if (esquema === esquemaLeituraProjeto) {
      this.leituras.push(pedido);
      // Os processos da análise por tipo de operação: a leitura de cada um.
      const assunto = /Assunto: (.*)/.exec(pedido.conteudo as string)?.[1];
      const p = PROCESSOS_PERFIS.find((x) => x.assunto === assunto);
      return Promise.resolve(p ? leituraDemo(p.chave) : this.resposta);
    }
    if (esquema === esquemaRegulamentoIa)
      return Promise.resolve({ trechos: [] });
    return Promise.reject(new Error('esquema inesperado'));
  }
  escrever(pedido: { sistema: string; conteudo: string }) {
    this.escritos.push(pedido);
    return Promise.resolve(
      'PARECER TÉCNICO\n\n3. Apreciação\nO projeto identifica a parede como não estrutural. Recomenda-se confirmar com o técnico autor antes da decisão.\n\n4. Proposta\nPropõe-se a admissão da comunicação prévia, condicionada à confirmação referida no ponto 3.\n\nO Técnico',
    );
  }
}

describe('Verificações automáticas (apoio ao técnico)', () => {
  let ctx: Contexto;
  let chefe: Record<string, string>;
  let processoId: string;
  const ia = new IaFalsa();

  beforeAll(async () => {
    ctx = await arrancarApp({
      substituir: (b) => b.overrideProvider(ClaudeService).useValue(ia),
    });
    chefe = await entrarPainel(ctx);
    // As zonas de demonstração do PDM (podem já ter sido carregadas por outro teste).
    const z = await ctx
      .http()
      .post('/v1/painel/ordenamento/demonstracao')
      .set(chefe);
    expect([201, 409]).toContain(z.status);
  });

  afterAll(() => ctx.fechar());

  it('cria o processo de demonstração uma só vez', async () => {
    const r = await ctx
      .http()
      .post('/v1/painel/processos/demonstracao')
      .set(chefe)
      .expect(201);
    // Pode já existir (o "preparar demo" usa o mesmo processo).
    expect(r.body).toMatchObject({
      criado: expect.any(Boolean),
      demonstracao: true,
      tem_zonas_pdm: true,
    });
    expect(r.body.numero).toMatch(/^CP (DEMO-)?412\/\d{4}$/);
    // E os 3 da análise por tipo de operação.
    expect(r.body.outros.map((x: any) => x.chave)).toEqual([
      'ampliacao',
      'piscina',
      'muro',
    ]);
    processoId = r.body.processo_id;
    const r2 = await ctx
      .http()
      .post('/v1/painel/processos/demonstracao')
      .set(chefe)
      .expect(201);
    expect(r2.body).toMatchObject({ criado: false, processo_id: processoId });

    const f = await ctx
      .http()
      .get(`/v1/painel/processos/${processoId}`)
      .set(chefe)
      .expect(200);
    expect(f.body.demonstracao).toBe(true);
    expect(f.body.documentos.map((d: any) => d.tipo_documento)).toEqual([
      'Certidão do registo predial',
      'Termo de responsabilidade',
      'Projeto de arquitetura',
    ]);
    expect(f.body.documentos_resumo.faltam).toEqual([]);
  });

  it('corre as verificações como no design, com a leitura da IA', async () => {
    const r = await ctx
      .http()
      .get(`/v1/painel/processos/${processoId}/verificacoes`)
      .set(chefe)
      .expect(200);
    expect(r.body.em_cache).toBe(false);
    const itens = r.body.itens as any[];
    expect(r.body.perfil).toMatchObject({
      codigo: 'interior',
      nome: 'Alteração interior',
      escolhido_por: 'texto',
      ambiguo: false,
    });
    expect(itens.map((x) => [x.codigo, x.estado, x.origem])).toEqual([
      ['ia_fachada', 'ok', 'ia'],
      ['instrucao', 'ok', 'regra'],
      ['perfil_documentos', 'ok', 'regra'],
      ['termo', 'ok', 'regra'],
      ['ordem', 'ok', 'simulado'],
      ['pdm', 'ok', 'regra'],
      ['ia_paredes', 'atencao', 'ia'],
    ]);
    const [fachada, , , termo, ordem, pdm, parede] = itens;
    expect(itens.map((x) => x.grupo)).toEqual([
      'desenhos',
      'documentos',
      'documentos',
      'documentos',
      'documentos',
      'pdm',
      'desenhos',
    ]);
    expect(fachada).toMatchObject({
      titulo: 'Fachada e cobertura sem alterações',
      detalhe: 'Projeto de arquitetura, folha 3',
      a_confirmar: true,
    });
    expect(fachada.evidencias[0]).toMatchObject({
      tipo: 'documento',
      pagina: 3,
    });
    expect(termo.detalhe).toContain('assinatura verificada');
    expect(ordem).toMatchObject({ a_confirmar: true, demonstracao: true });
    expect(pdm).toMatchObject({
      titulo: 'Sem condicionantes do PDM no local',
      detalhe: 'Espaço residencial consolidado, fora do centro histórico',
      demonstracao: true,
    });
    expect(parede).toMatchObject({
      titulo: 'Parede a abrir: confirmar que não é estrutural',
      detalhe:
        'O projeto diz “não estrutural”, mas não há planta de estruturas',
    });
    expect(r.body.pronto_para_decisao).toBe(false);
    expect(r.body.contagem).toEqual({
      ok: 6,
      atencao: 1,
      falha: 0,
      nao_verificavel: 0,
    });

    // Foram à IA o projeto e o termo, em PDF.
    expect(ia.leituras).toHaveLength(1);
    expect(ia.leituras[0].ficheiros.map((f) => [f.nome, f.mime])).toEqual([
      ['Projeto de arquitetura', 'application/pdf'],
      ['Termo de responsabilidade', 'application/pdf'],
    ]);
    expect(ia.leituras[0].ficheiros[0].ficheiro.subarray(0, 5).toString()).toBe(
      '%PDF-',
    );
    expect(ia.leituras[0].conteudo).toContain(
      '1. Projeto de arquitetura (PDF)',
    );

    const aud = await linha(
      ctx.db,
      `SELECT dados FROM audit_log WHERE acao = 'verificar' AND objeto_id = $1`,
      [processoId],
    );
    expect(aud.dados).toMatchObject({
      leitura_ia: 'nova',
      versao_motor: '2',
      perfil: 'interior',
    });
  });

  it('cache: nada mudou não corre; regras mudadas reaproveitam a leitura; "gerar outra vez" lê de novo', async () => {
    const r = await ctx
      .http()
      .get(`/v1/painel/processos/${processoId}/verificacoes`)
      .set(chefe)
      .expect(200);
    expect(r.body.em_cache).toBe(true);
    expect(ia.leituras).toHaveLength(1);

    // Um tipo de documento novo e opcional muda as regras, não os documentos.
    await ctx.db.query(
      `UPDATE tipo_processo_documentos SET verificacoes = '[{"tipo":"validade","meses":120}]'
       WHERE tipo_processo_id = $1 AND nome = 'Termo de responsabilidade'`,
      [TIPO_CP_ID],
    );
    const r2 = await ctx
      .http()
      .get(`/v1/painel/processos/${processoId}/verificacoes`)
      .set(chefe)
      .expect(200);
    expect(r2.body.em_cache).toBe(false);
    expect(ia.leituras).toHaveLength(1);
    expect(
      r2.body.itens.find((x: any) => x.codigo === 'termo').detalhe,
    ).toContain('válido até');
    await ctx.db.query(
      `UPDATE tipo_processo_documentos SET verificacoes = '[]'
       WHERE tipo_processo_id = $1 AND nome = 'Termo de responsabilidade'`,
      [TIPO_CP_ID],
    );

    await ctx
      .http()
      .get(`/v1/painel/processos/${processoId}/verificacoes?atualizar=true`)
      .set(chefe)
      .expect(200);
    expect(ia.leituras).toHaveLength(2);
    const n = await linha(
      ctx.db,
      'SELECT count(*)::int AS n FROM processo_verificacoes WHERE processo_id = $1',
      [processoId],
    );
    expect(n.n).toBe(3);
  });

  it('o parecer usa as verificações: o ⚠ na apreciação e na proposta; assinado fica interno', async () => {
    const r = await ctx
      .http()
      .post(`/v1/painel/processos/${processoId}/rascunhos`)
      .set(chefe)
      .send({ tipo: 'parecer' })
      .expect(201);
    expect(r.body).toMatchObject({
      tipo: 'parecer',
      tipo_rotulo: 'Parecer técnico',
      estado: 'rascunho',
    });
    const pedido = ia.escritos[ia.escritos.length - 1];
    expect(pedido.sistema).toContain('3. Apreciação');
    expect(pedido.conteudo).toContain('## Verificações automáticas');
    expect(pedido.conteudo).toContain(
      '[ATENÇÃO] Parede a abrir: confirmar que não é estrutural',
    );
    expect(pedido.conteudo).toContain(
      '(consulta simulada, valores de demonstração)',
    );
    expect(r.body.corpo).toContain(
      'condicionada à confirmação referida no ponto 3',
    );

    // Um ofício também leva as verificações.
    await ctx
      .http()
      .post(`/v1/painel/processos/${processoId}/rascunhos`)
      .set(chefe)
      .send({ tipo: 'oficio' })
      .expect(201);
    expect(ia.escritos[ia.escritos.length - 1].conteudo).toContain(
      '## Verificações automáticas',
    );

    const a = await ctx
      .http()
      .post(`/v1/painel/rascunhos/${r.body.id}/aprovar`)
      .set(chefe)
      .send({})
      .expect(200);
    expect(a.body).toMatchObject({ estado: 'aprovado', aviso: null });
    const ev = await linha(
      ctx.db,
      `SELECT interno FROM processo_eventos WHERE processo_id = $1 AND tipo = 'parecer'`,
      [processoId],
    );
    expect(ev.interno).toBe(true);
  });

  it('abre o ficheiro do documento (para a folha da evidência)', async () => {
    const docs = await linhas(
      ctx.db,
      `SELECT id FROM documentos WHERE processo_id = $1 AND descricao = 'Projeto de arquitetura'`,
      [processoId],
    );
    const r = await ctx
      .http()
      .get(
        `/v1/painel/processos/${processoId}/documentos/${docs[0].id}/ficheiro`,
      )
      .set(chefe)
      .buffer(true)
      .parse((res, cb) => {
        const partes: Buffer[] = [];
        res.on('data', (p: Buffer) => partes.push(p));
        res.on('end', () => cb(null, Buffer.concat(partes)));
      })
      .expect(200);
    expect(r.headers['content-type']).toBe('application/pdf');
    expect((r.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('sem IA ou com resposta inválida: a leitura fica não verificável, o resto corre', async () => {
    ia.ligada = false;
    const r = await ctx
      .http()
      .get(`/v1/painel/processos/${processoId}/verificacoes?atualizar=true`)
      .set(chefe)
      .expect(200);
    ia.ligada = true;
    const porCodigo = Object.fromEntries(
      r.body.itens.map((x: any) => [x.codigo, x]),
    );
    expect(porCodigo.ia_leitura).toMatchObject({ estado: 'nao_verificavel' });
    expect(porCodigo.ia_leitura.detalhe).toMatch(/não está configurada/);
    expect(porCodigo.ordem.estado).toBe('nao_verificavel');
    expect(porCodigo.pdm.estado).toBe('ok');
    expect(porCodigo.instrucao.estado).toBe('ok');
    expect(r.body.ia_disponivel).toBe(false);

    ia.resposta = { legivel: 'talvez' };
    const r2 = await ctx
      .http()
      .get(`/v1/painel/processos/${processoId}/verificacoes?atualizar=true`)
      .set(chefe)
      .expect(200);
    ia.resposta = LEITURA;
    expect(
      r2.body.itens.find((x: any) => x.codigo === 'ia_leitura').detalhe,
    ).toMatch(/formato pedido/);
  });

  it('processo sem morada nem documentos: PDM e instrução dizem porquê', async () => {
    const p = await linha(
      ctx.db,
      `INSERT INTO processos (municipio_id, numero, tipo_processo_id, assunto, fase)
       VALUES ($1, 'CP 9001/2026', $2, 'Muro', 'documentos') RETURNING id`,
      [MUNICIPIO_ID, TIPO_CP_ID],
    );
    const r = await ctx
      .http()
      .get(`/v1/painel/processos/${p.id}/verificacoes`)
      .set(chefe)
      .expect(200);
    const porCodigo = Object.fromEntries(
      r.body.itens.map((x: any) => [x.codigo, x]),
    );
    expect(porCodigo.pdm).toMatchObject({
      estado: 'nao_verificavel',
      detalhe: 'O processo não tem morada nem coordenadas.',
    });
    expect(porCodigo.instrucao.estado).toBe('falha');
    expect(porCodigo.termo.estado).toBe('falha');
    expect(porCodigo.ia_leitura.detalhe).toMatch(/Não há projeto/);
  });

  // -------------------------------------------------------------------------
  // Análise por tipo de operação (V4 #2)
  // -------------------------------------------------------------------------

  const perfis: Record<string, string> = {};
  const verificar = (id: string, q = '') =>
    ctx.http().get(`/v1/painel/processos/${id}/verificacoes${q}`).set(chefe);

  it('os 3 processos da análise por tipo de operação: idempotentes, com os documentos', async () => {
    const r = await ctx
      .http()
      .post('/v1/painel/processos/demonstracao/perfis')
      .set(chefe)
      .expect(201);
    expect(r.body).toHaveLength(3);
    for (const x of r.body) {
      expect(x.criado).toBe(false); // já vieram com a rota do "Porta na cozinha"
      perfis[x.chave] = x.processo_id;
    }
    expect(r.body.map((x: any) => x.numero)).toEqual([
      expect.stringMatching(/^CP (DEMO-)?413\/\d{4}$/),
      expect.stringMatching(/^CP (DEMO-)?414\/\d{4}$/),
      expect.stringMatching(/^CP (DEMO-)?415\/\d{4}$/),
    ]);
    const docs = await linhas(
      ctx.db,
      `SELECT coalesce(td.nome, d.descricao) AS nome, d.verificacao_estado
       FROM documentos d LEFT JOIN tipo_processo_documentos td ON td.id = d.tipo_documento_id
       WHERE d.processo_id = $1 ORDER BY d.recebido_em`,
      [perfis.ampliacao],
    );
    expect(docs.map((d) => d.nome)).toEqual([
      'Certidão do registo predial',
      'Termo de responsabilidade',
      'Projeto de arquitetura',
      'Planta de localização',
      'Levantamento topográfico',
      'Projeto de estabilidade',
      'Fotografias do existente',
    ]);
    const req = await linha(
      ctx.db,
      'SELECT dados FROM requerimentos WHERE processo_id = $1',
      [perfis.piscina],
    );
    expect(req.dados).toMatchObject({
      operacao: 'piscina',
      afastamento_extremas_m: 3,
    });
  });

  it('ampliação: a implantação excede o índice da zona (falha), com a tabela', async () => {
    const antes = ia.leituras.length;
    const r = await verificar(perfis.ampliacao).expect(200);
    expect(ia.leituras).toHaveLength(antes + 1);
    const pedido = ia.leituras[ia.leituras.length - 1];
    expect(pedido.conteudo).toContain(
      'Operação a analisar: Ampliação ou anexo.',
    );
    expect(pedido.conteudo).toContain('area_implantacao_m2');
    expect(pedido.ficheiros.map((f) => f.nome)).toEqual([
      'Projeto de arquitetura',
      'Planta de localização',
      'Projeto de estabilidade',
      'Termo de responsabilidade',
    ]);
    expect(r.body.perfil).toMatchObject({
      codigo: 'ampliacao',
      escolhido_por: 'requerimento',
    });
    expect(r.body.perfil.sempre_tecnico.length).toBeGreaterThan(1);
    const v = Object.fromEntries(r.body.itens.map((x: any) => [x.codigo, x]));
    expect(v.pdm_area_implantacao_m2).toMatchObject({
      estado: 'falha',
      grupo: 'pdm',
      origem: 'regra',
      demonstracao: true,
      valor: {
        declarado: 165,
        lido: { valor: 165 },
        permitido: { valor: 150, sentido: 'max' },
      },
    });
    expect(v.pdm_area_implantacao_m2.valor.lido.evidencia).toMatchObject({
      tipo: 'documento',
      pagina: 2,
      folha: '2',
    });
    expect(v.pdm_area_construcao_m2.estado).toBe('atencao');
    expect(v.perfil_documentos.estado).toBe('ok');
    expect(v.ordem).toMatchObject({
      estado: 'ok',
      detalhe: expect.stringContaining('Pedro Sousa'),
    });
    expect(r.body.contagem.falha).toBe(1);
    expect(r.body.pronto_para_decisao).toBe(false);
  });

  it('piscina: a 1,5 m da extrema quando a regra pede 3 m (falha a confirmar)', async () => {
    const r = await verificar(perfis.piscina).expect(200);
    const v = Object.fromEntries(r.body.itens.map((x: any) => [x.codigo, x]));
    expect(r.body.perfil.codigo).toBe('piscina');
    expect(v.pdm_afastamento_extremas_m).toMatchObject({
      estado: 'falha',
      origem: 'ia',
      a_confirmar: true,
      valor: {
        declarado: 3,
        lido: { valor: 1.5 },
        permitido: { valor: 3, sentido: 'min' },
      },
    });
    expect(v.ia_casa_maquinas.estado).toBe('ok');
    expect(v.ia_contradicao_1.estado).toBe('atencao');
    expect(v.ia_paredes).toBeUndefined();
  });

  it('muro: altura certa, tudo verificado e pronto para decisão', async () => {
    const r = await verificar(perfis.muro).expect(200);
    expect(r.body.perfil.codigo).toBe('muro');
    expect(
      r.body.itens
        .filter((x: any) => x.estado !== 'ok')
        .map((x: any) => x.codigo),
    ).toEqual([]);
    expect(r.body.pronto_para_decisao).toBe(true);
    const v = Object.fromEntries(r.body.itens.map((x: any) => [x.codigo, x]));
    expect(v.pdm_altura_muro_m.detalhe).toBe(
      'Declarado 1,5 m · desenhado 1,5 m · máximo 1,5 m',
    );
    expect(v.pdm.estado).toBe('ok');
  });

  it('cache e escolha do técnico: o perfil escolhido fica; perfil inválido dá 400', async () => {
    const antes = ia.leituras.length;
    const c = await verificar(perfis.muro).expect(200);
    expect(c.body.em_cache).toBe(true);
    expect(ia.leituras).toHaveLength(antes);

    // O técnico diz que é uma fachada: corre outra vez com esse perfil (nova leitura).
    const f = await verificar(perfis.muro, '?perfil=fachada').expect(200);
    expect(f.body.em_cache).toBe(false);
    expect(f.body.perfil).toMatchObject({
      codigo: 'fachada',
      escolhido_por: 'tecnico',
    });
    expect(ia.leituras).toHaveLength(antes + 1);
    expect(
      f.body.itens.some(
        (x: any) => x.codigo === 'perfil_documentos' && x.estado === 'falha',
      ),
    ).toBe(true);
    // Sem parâmetro, a escolha mantém-se (da cache).
    const g = await verificar(perfis.muro).expect(200);
    expect(g.body).toMatchObject({
      em_cache: true,
      perfil: { codigo: 'fachada' },
    });
    // Volta ao muro: a leitura com o perfil "muro" ainda é a dos mesmos documentos? Não: lê-se outra vez.
    const m = await verificar(perfis.muro, '?perfil=muro').expect(200);
    expect(m.body).toMatchObject({
      pronto_para_decisao: true,
      perfil: { escolhido_por: 'tecnico' },
    });
    await verificar(perfis.muro, '?perfil=castelo').expect(400);
    const aud = await linha(
      ctx.db,
      `SELECT dados FROM audit_log WHERE acao = 'verificar' AND objeto_id = $1
       ORDER BY em DESC, id DESC LIMIT 1`,
      [perfis.muro],
    );
    expect(aud.dados).toMatchObject({
      perfil: 'muro',
      perfil_escolhido_por: 'tecnico',
    });
  });

  it('sem IA: só as verificações determinísticas (a piscina passa pelo declarado)', async () => {
    ia.ligada = false;
    const r = await verificar(perfis.piscina, '?atualizar=true').expect(200);
    ia.ligada = true;
    const v = Object.fromEntries(r.body.itens.map((x: any) => [x.codigo, x]));
    expect(v.ia_leitura.estado).toBe('nao_verificavel');
    expect(v.ia_casa_maquinas).toBeUndefined();
    expect(v.pdm_afastamento_extremas_m).toMatchObject({
      estado: 'ok',
      origem: 'regra',
      valor: { declarado: 3, lido: null },
    });
    expect(
      r.body.itens
        .filter((x: any) => x.origem === 'ia')
        .map((x: any) => x.codigo),
    ).toEqual(['ia_leitura']);
  });

  it('o ficheiro de um processo novo abre (para a folha da evidência)', async () => {
    const d = await linha(
      ctx.db,
      `SELECT id FROM documentos WHERE processo_id = $1 AND descricao = 'Projeto de arquitetura'`,
      [perfis.piscina],
    );
    const r = await ctx
      .http()
      .get(`/v1/painel/processos/${perfis.piscina}/documentos/${d.id}/ficheiro`)
      .set(chefe)
      .buffer(true)
      .parse((res, cb) => {
        const partes: Buffer[] = [];
        res.on('data', (p: Buffer) => partes.push(p));
        res.on('end', () => cb(null, Buffer.concat(partes)));
      })
      .expect(200);
    expect((r.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('permissões: sem processos não vê nem cria', async () => {
    const atendimento = await entrarPainel(
      ctx,
      await criarUtilizador(ctx, 'atendimento'),
    );
    await ctx
      .http()
      .get(`/v1/painel/processos/${processoId}/verificacoes`)
      .set(atendimento)
      .expect(403);
    await ctx
      .http()
      .post('/v1/painel/processos/demonstracao')
      .set(atendimento)
      .expect(403);
    await ctx
      .http()
      .post('/v1/painel/processos/demonstracao/perfis')
      .set(atendimento)
      .expect(403);
    const tecnico = await entrarPainel(
      ctx,
      await criarUtilizador(ctx, 'tecnico'),
    );
    await ctx
      .http()
      .get(`/v1/painel/processos/${processoId}/verificacoes`)
      .set(tecnico)
      .expect(200);
  });
});
