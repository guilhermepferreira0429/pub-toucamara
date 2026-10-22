/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call -- os corpos do supertest são `any`; as asserções do jest verificam a forma. */
import { randomUUID } from 'crypto';
import { hojeLisboa } from '../../src/common/dias-uteis';
import { AguaService } from '../../src/modules/agua/agua.service';
import { AnimaisService } from '../../src/modules/animais/animais.service';
import { validarVisita } from '../../src/modules/animais/regras';
import { CemiteriosService } from '../../src/modules/cemiterios/cemiterios.service';
import { somarDias } from '../../src/modules/servicos-municipais/comum';
import {
  arrancarApp,
  Chamada,
  Contexto,
  criarUtilizador,
  entrarPainel,
  ferramenta,
  linha,
  linhas,
  MUNICIPIO,
  MUNICIPIO_ID,
  novaChamada,
  smsPara,
} from './app';

const M = {
  id: MUNICIPIO_ID,
  slug: MUNICIPIO,
  nome: 'Município de Teste',
  fuso: 'Europe/Lisbon',
};

/** Os campos como o agente os manda: texto. */
function dados(o: Record<string, string | number | boolean>) {
  return Object.entries(o).map(([campo, v]) => ({ campo, valor: String(v) }));
}

/**
 * Catálogo de serviços (V4): cemitérios (#8), animais (#9) e água (#6),
 * pelas ferramentas outros_servicos/pedir_servico, mais as rotas do
 * painel, a página pública /adotar e as permissões.
 */
describe('Cemitérios, animais e água (e2e)', () => {
  let ctx: Contexto;
  let chefe: Record<string, string>;
  let atendimento: Record<string, string>;
  let vereador: Record<string, string>;
  const pedir = (
    chamada: Chamada | undefined,
    area: string,
    acao: string,
    o: Record<string, string | number | boolean> = {},
  ) =>
    ferramenta(ctx, chamada, 'pedir_servico', {
      area,
      acao,
      dados: dados(o),
    }).expect(200);

  beforeAll(async () => {
    ctx = await arrancarApp();
    chefe = await entrarPainel(ctx);
    atendimento = await entrarPainel(
      ctx,
      await criarUtilizador(ctx, 'atendimento'),
    );
    vereador = await entrarPainel(ctx, await criarUtilizador(ctx, 'vereador'));
    // Os dados de demonstração destas áreas (idempotente).
    await ctx.app.get(CemiteriosService).carregarDemonstracao(M);
    await ctx.app.get(AnimaisService).carregarDemonstracao(M);
  });
  afterAll(() => ctx.fechar());

  it('outros_servicos: as três áreas e os campos de cada ação', async () => {
    const r = await ferramenta(ctx, undefined, 'outros_servicos', {}).expect(
      200,
    );
    const areas = r.body.areas.map((a: { area: string }) => a.area);
    expect(areas).toEqual(
      expect.arrayContaining(['cemiterios', 'animais', 'agua']),
    );
    const c = await ferramenta(ctx, undefined, 'outros_servicos', {
      area: 'cemiterios',
    }).expect(200);
    expect(c.body.acoes.map((a: { acao: string }) => a.acao)).toEqual([
      'procurar_sepultura',
      'ver_concessao',
      'pedir_concessao',
      'taxas',
      'horarios',
    ]);
    const pedirConcessao = c.body.acoes.find(
      (a: { acao: string }) => a.acao === 'pedir_concessao',
    );
    expect(pedirConcessao.altera).toBe(true);
  });

  describe('cemitérios', () => {
    it('procurar_sepultura: uma pessoa, várias parecidas, ninguém', async () => {
      const um = await pedir(undefined, 'cemiterios', 'procurar_sepultura', {
        nome: 'Joaquim Exemplo Fernandes',
      });
      expect(um.body).toMatchObject({
        encontrado: true,
        talhao: '3',
        numero: '120',
        demonstracao: true,
      });
      expect(um.body.instrucao).toContain('luto');
      expect(um.body.dizer).toContain('talhão 3');

      const varios = await pedir(
        undefined,
        'cemiterios',
        'procurar_sepultura',
        {
          nome: 'Joaquim',
        },
      );
      expect(varios.body).toMatchObject({
        encontrado: true,
        precisa_escolher: true,
      });
      expect(varios.body.resultados.length).toBeGreaterThanOrEqual(2);

      const comAno = await pedir(
        undefined,
        'cemiterios',
        'procurar_sepultura',
        { nome: 'Joaquim', ano_falecimento: 2010 },
      );
      expect(comAno.body).toMatchObject({ encontrado: true, numero: '121' });

      const nada = await pedir(undefined, 'cemiterios', 'procurar_sepultura', {
        nome: 'Xpto Inexistente Zzz',
      });
      expect(nada.body.encontrado).toBe(false);

      const falta = await pedir(
        undefined,
        'cemiterios',
        'procurar_sepultura',
        {},
      );
      expect(falta.body).toMatchObject({
        feito: false,
        motivo: 'faltam_dados',
      });
    });

    it('ver_concessao: a terminar, titular abreviado, taxas por pagar', async () => {
      const r = await pedir(undefined, 'cemiterios', 'ver_concessao', {
        referencia: 'talhão 3, número 120',
      });
      expect(r.body).toMatchObject({
        encontrado: true,
        estado: 'a_terminar',
        titular: 'Maria F.',
        conservacao_em_divida_cent: 4500,
      });
      expect(r.body.dizer).toContain('45 €');
      expect(r.body.instrucao).toContain('pedir_concessao');

      const porNome = await pedir(undefined, 'cemiterios', 'ver_concessao', {
        referencia: 'Isabel Fictícia Lopes',
      });
      expect(porNome.body).toMatchObject({ estado: 'terminada' });
    });

    it('pedir_concessao: sem contacto pede identificação; depois regista e manda SMS', async () => {
      const sem = await pedir(
        { conversa: novaChamada('cem').conversa, telefone: '' },
        'cemiterios',
        'pedir_concessao',
        {
          tipo: 'renovacao',
          referencia: 'talhão 3 número 120',
          nome: 'Maria Exemplo Fernandes',
        },
      );
      expect(sem.body).toMatchObject({
        feito: false,
        precisa_identificacao: true,
      });

      const chamada = novaChamada('cem');
      const r = await pedir(chamada, 'cemiterios', 'pedir_concessao', {
        tipo: 'renovacao',
        referencia: 'talhão 3 número 120',
        nome: 'Maria Exemplo Fernandes',
        relacao: 'titular',
      });
      expect(r.body).toMatchObject({
        feito: true,
        sepultura_identificada: true,
        valores_de_demonstracao: true,
        sms_enviado: true,
      });
      expect(r.body.numero).toMatch(/^CM-\d{4}-\d{4}$/);
      const sms = await smsPara(ctx, chamada.telefone, 'requerimento');
      expect(sms[0].corpo).toContain(r.body.numero);
    });

    it('taxas e horários (valores de demonstração)', async () => {
      const t = await pedir(undefined, 'cemiterios', 'taxas', {
        servico: 'exumacao',
      });
      expect(t.body).toMatchObject({ valores_de_demonstracao: true });
      expect(t.body.taxas).toHaveLength(1);
      expect(t.body.fonte).toContain('411/98');

      const h = await pedir(undefined, 'cemiterios', 'horarios', {
        cemiterio: 'Azurém',
      });
      expect(h.body.cemiterios).toHaveLength(1);
      expect(h.body.cemiterios[0].horario).toContain('domingo');
    });

    it('painel: resumo, sepulturas, pedidos e tratar com resposta por SMS', async () => {
      const r = await ctx
        .http()
        .get('/v1/painel/cemiterios')
        .set(chefe)
        .expect(200);
      expect(r.body.cemiterios.length).toBeGreaterThanOrEqual(2);
      expect(r.body.fonte_taxas.demonstracao).toBe(true);

      const s = await ctx
        .http()
        .get('/v1/painel/cemiterios/sepulturas?q=Joaquim')
        .set(atendimento)
        .expect(200);
      expect(s.body.sepulturas.length).toBeGreaterThanOrEqual(2);

      const chamada = novaChamada('cem');
      const novo = await pedir(chamada, 'cemiterios', 'pedir_concessao', {
        tipo: 'averbamento',
        referencia: 'Manuel Exemplo Martins',
        nome: 'Rosa Exemplo Martins',
      });
      const p = await linha<{ id: string }>(
        ctx.db,
        'SELECT id FROM pedidos_cemiterio WHERE numero = $1 AND municipio_id = $2',
        [novo.body.numero, MUNICIPIO_ID],
      );
      const lista = await ctx
        .http()
        .get('/v1/painel/cemiterios/pedidos?estado=recebido&limite=200')
        .set(chefe)
        .expect(200);
      expect(lista.body.itens.map((i: { id: string }) => i.id)).toContain(
        p!.id,
      );

      await ctx
        .http()
        .patch(`/v1/painel/cemiterios/pedidos/${p!.id}`)
        .set(chefe)
        .send({ estado: 'concluido' })
        .expect(400);
      const ok = await ctx
        .http()
        .patch(`/v1/painel/cemiterios/pedidos/${p!.id}`)
        .set(chefe)
        .send({
          estado: 'concluido',
          resposta: 'O averbamento está feito; pode levantar o alvará.',
        })
        .expect(200);
      expect(ok.body).toMatchObject({ estado: 'concluido', sms_enviado: true });
      const sms = await smsPara(ctx, chamada.telefone, 'requerimento');
      expect(sms.map((x) => x.corpo).join(' ')).toContain('averbamento');
      await ctx
        .http()
        .patch(`/v1/painel/cemiterios/pedidos/${randomUUID()}`)
        .set(chefe)
        .send({ estado: 'em_analise' })
        .expect(404);
    });

    it('permissões: o vereador não entra; quem atende entra', async () => {
      await ctx.http().get('/v1/painel/cemiterios').set(vereador).expect(403);
      await ctx.http().get('/v1/painel/animais').set(vereador).expect(403);
      await ctx.http().get('/v1/painel/agua').set(vereador).expect(403);
      await ctx.http().get('/v1/painel/agua').set(atendimento).expect(200);
      await ctx.http().get('/v1/painel/cemiterios').expect(401);
    });
  });

  describe('animais', () => {
    async function proximoDiaDeVisita(): Promise<string> {
      const feriados = new Set(
        (
          await linhas<{ dia: string }>(
            ctx.db,
            `SELECT to_char(data, 'YYYY-MM-DD') AS dia FROM feriados
             WHERE municipio_id IS NULL OR municipio_id = $1`,
            [MUNICIPIO_ID],
          )
        ).map((f) => f.dia),
      );
      const hoje = hojeLisboa();
      let dia = somarDias(hoje, 1);
      while (!validarVisita(dia, 'manha', hoje, feriados).ok)
        dia = somarDias(dia, 1);
      return dia;
    }

    it('animais_para_adotar e a página pública /adotar', async () => {
      const r = await pedir(undefined, 'animais', 'animais_para_adotar', {
        especie: 'gato',
      });
      expect(r.body.encontrado).toBe(true);
      expect(
        r.body.animais.every((a: { especie: string }) => a.especie === 'gato'),
      ).toBe(true);
      expect(r.body.link).toMatch(/\/adotar$/);

      const p = await ctx
        .http()
        .get(`/v1/public/animais/${MUNICIPIO}/adocao`)
        .expect(200);
      expect(p.body.demonstracao).toBe(true);
      expect(p.body.animais.map((a: { nome: string }) => a.nome)).toEqual(
        expect.arrayContaining(['Tejo', 'Pimenta']),
      );
      await ctx.http().get('/v1/public/animais/nao-existe/adocao').expect(404);
    });

    it('marcar_visita_adocao: dia inválido; depois pede, painel confirma e marca adotado', async () => {
      const chamada = novaChamada('ani');
      const passado = await pedir(chamada, 'animais', 'marcar_visita_adocao', {
        nome: 'Rita Teste',
        dia: hojeLisboa(),
        periodo: 'manha',
      });
      expect(passado.body).toMatchObject({ feito: false, motivo: 'passado' });

      const dia = await proximoDiaDeVisita();
      const r = await pedir(chamada, 'animais', 'marcar_visita_adocao', {
        nome: 'Rita Teste',
        dia,
        periodo: 'manha',
        animal: 'o Trovão',
      });
      expect(r.body).toMatchObject({
        feito: true,
        animal_encontrado: true,
        sms_enviado: true,
      });
      const v = await linha<{ id: string }>(
        ctx.db,
        'SELECT id FROM visitas_adocao WHERE numero = $1 AND municipio_id = $2',
        [r.body.numero, MUNICIPIO_ID],
      );
      const lista = await ctx
        .http()
        .get('/v1/painel/animais/visitas?limite=200')
        .set(atendimento)
        .expect(200);
      expect(lista.body.itens.map((i: { id: string }) => i.id)).toContain(
        v!.id,
      );
      await ctx
        .http()
        .patch(`/v1/painel/animais/visitas/${v!.id}`)
        .set(atendimento)
        .send({ estado: 'confirmada' })
        .expect(400);
      await ctx
        .http()
        .patch(`/v1/painel/animais/visitas/${v!.id}`)
        .set(atendimento)
        .send({ estado: 'confirmada', mensagem: 'Às 10:30, na receção.' })
        .expect(200);
      const sms = await smsPara(ctx, chamada.telefone, 'requerimento');
      expect(sms.map((s) => s.corpo).join(' ')).toContain('10:30');
      await ctx
        .http()
        .patch(`/v1/painel/animais/visitas/${v!.id}`)
        .set(atendimento)
        .send({ estado: 'adotou' })
        .expect(200);
      const a = await linha<{ estado: string }>(
        ctx.db,
        `SELECT estado FROM animais_adocao WHERE municipio_id = $1 AND nome = 'Trovão'`,
        [MUNICIPIO_ID],
      );
      expect(a!.estado).toBe('adotado');
    });

    it('reportar_animal: perdido precisa de contacto; encontrado não, e junta os parecidos', async () => {
      const sem = await pedir(
        { conversa: novaChamada('ani').conversa, telefone: '' },
        'animais',
        'reportar_animal',
        {
          tipo: 'perdido',
          especie: 'cao',
          descricao: 'Cão castanho, coleira azul',
          morada: 'Rua Nova, Azurém',
        },
      );
      expect(sem.body.precisa_identificacao).toBe(true);

      await pedir(novaChamada('ani'), 'animais', 'reportar_animal', {
        tipo: 'perdido',
        especie: 'cao',
        descricao: 'Cão castanho, coleira azul',
        morada: 'Rua Nova, Azurém',
        nome_animal: 'Faísca',
        tem_chip: 'sim',
      });
      const enc = await pedir(
        { conversa: novaChamada('ani').conversa, telefone: '' },
        'animais',
        'reportar_animal',
        {
          tipo: 'encontrado',
          especie: 'cao',
          descricao: 'Cão castanho com coleira azul, assustado',
          morada: 'Largo do Toural',
        },
      );
      expect(enc.body).toMatchObject({ feito: true, tipo: 'encontrado' });
      expect(enc.body.possiveis_correspondencias).toBeGreaterThanOrEqual(1);

      const lista = await ctx
        .http()
        .get('/v1/painel/animais/reportados?tipo=encontrado&limite=200')
        .set(chefe)
        .expect(200);
      const item = lista.body.itens.find(
        (i: { numero: string }) => i.numero === enc.body.numero,
      );
      expect(item.parecidos).toBeGreaterThanOrEqual(1);
      await ctx
        .http()
        .patch(`/v1/painel/animais/reportados/${item.id}`)
        .set(chefe)
        .send({ estado: 'devolvido' })
        .expect(200);
    });

    it('animal_na_via: pessoas em perigo → 112; senão ocorrência urgente', async () => {
      const perigo = await pedir(
        novaChamada('ani'),
        'animais',
        'animal_na_via',
        {
          situacao: 'agressivo',
          especie: 'cao',
          morada: 'Rua de Santo António',
          descricao: 'Cão a atacar quem passa',
          pessoas_em_perigo: 'sim',
        },
      );
      expect(perigo.body).toMatchObject({ emergencia: true, feito: false });

      const r = await pedir(novaChamada('ani'), 'animais', 'animal_na_via', {
        situacao: 'ferido',
        especie: 'gato',
        morada: 'Avenida de Londres',
        descricao: 'Gato atropelado, ainda mexe',
        pessoas_em_perigo: 'não',
      });
      expect(r.body).toMatchObject({ feito: true, urgente: true });
      const oc = await linha<{ descricao: string; categoria: string }>(
        ctx.db,
        `SELECT o.descricao, c.nome AS categoria FROM ocorrencias o
         JOIN categorias_ocorrencia c ON c.id = o.categoria_id
         WHERE o.municipio_id = $1 AND o.numero = $2`,
        [MUNICIPIO_ID, r.body.ocorrencia],
      );
      expect(oc!.categoria).toBe('Animal ferido ou perigoso na via');
      expect(oc!.descricao).toMatch(/^URGENTE/);
      const rep = await linha<{ ocorrencia_id: string | null }>(
        ctx.db,
        'SELECT ocorrencia_id FROM animais_reportados WHERE numero = $1 AND municipio_id = $2',
        [r.body.numero, MUNICIPIO_ID],
      );
      expect(rep!.ocorrencia_id).not.toBeNull();
    });

    it('registo_e_vacina: informação com as fontes (SIAC nacional)', async () => {
      const r = await pedir(undefined, 'animais', 'registo_e_vacina');
      expect(r.body.siac_nacional).toBe(true);
      expect(r.body.fontes.join(' ')).toContain('82/2019');
    });

    it('painel: criar um animal e mudar o estado', async () => {
      const a = await ctx
        .http()
        .post('/v1/painel/animais')
        .set(chefe)
        .send({
          nome: `Teste ${randomUUID().slice(0, 4)}`,
          especie: 'cao',
          descricao: 'Cão de teste muito simpático',
        })
        .expect(201);
      await ctx
        .http()
        .patch(`/v1/painel/animais/${a.body.id}`)
        .set(chefe)
        .send({ estado: 'reservado' })
        .expect(200);
      const r = await ctx
        .http()
        .get('/v1/painel/animais')
        .set(chefe)
        .expect(200);
      expect(
        r.body.animais.find((x: { id: string }) => x.id === a.body.id).estado,
      ).toBe('reservado');
    });
  });

  describe('água (Vimágua, adaptador simulado)', () => {
    it('contacto: a entidade da água dos dados, com a linha de avarias', async () => {
      const r = await pedir(undefined, 'agua', 'contacto');
      expect(r.body.entidade).toBe('Águas do Concelho');
      expect(r.body.contacto_avarias.valor).toBe('800 000 000');
    });

    it('comunicar_leitura: regista, envia (simulado) e manda o contacto por SMS', async () => {
      const chamada = novaChamada('agua');
      const r = await pedir(chamada, 'agua', 'comunicar_leitura', {
        leitura_m3: '1234,5',
        morada: 'Rua de Santa Maria, 12',
      });
      expect(r.body).toMatchObject({
        feito: true,
        enviado: true,
        envio_simulado: true,
        encaminhado_para: 'Águas do Concelho',
      });
      expect(r.body.referencia_entidade).toMatch(/^VIM-SIM-\d{4}-\d{6}$/);
      const p = await linha<{ leitura_m3: string; envio_estado: string }>(
        ctx.db,
        'SELECT leitura_m3::text, envio_estado FROM pedidos_agua WHERE numero = $1 AND municipio_id = $2',
        [r.body.numero, MUNICIPIO_ID],
      );
      expect(p).toMatchObject({
        leitura_m3: '1234.500',
        envio_estado: 'enviado',
      });
      const sms = await smsPara(ctx, chamada.telefone, 'requerimento');
      expect(sms[0].corpo).toContain('Águas do Concelho');
    });

    it('fatura sem contacto pede identificação', async () => {
      const r = await pedir(
        { conversa: novaChamada('agua').conversa, telefone: '' },
        'agua',
        'fatura',
        { motivo: 'segunda_via', morada: 'Rua X, 1' },
      );
      expect(r.body.precisa_identificacao).toBe(true);
    });

    it('rotura com água na via: urgente e também ocorrência na câmara', async () => {
      const r = await pedir(novaChamada('agua'), 'agua', 'reportar_avaria', {
        tipo: 'rotura',
        morada: 'Rua Dr. Avelino Germano',
        descricao: 'Cano rebentado, água a correr pela rua',
        agua_na_via: 'sim',
      });
      expect(r.body).toMatchObject({ feito: true, urgente: true });
      expect(r.body.ocorrencia_camara).toBeTruthy();
      expect(r.body.contacto.valor).toBe('800 000 000');
      const p = await linha<{ ocorrencia_id: string | null; urgente: boolean }>(
        ctx.db,
        'SELECT ocorrencia_id, urgente FROM pedidos_agua WHERE numero = $1 AND municipio_id = $2',
        [r.body.numero, MUNICIPIO_ID],
      );
      expect(p!.ocorrencia_id).not.toBeNull();
    });

    it('painel: pedidos com o estado do envio e reenviar o que falhou', async () => {
      const r = await pedir(novaChamada('agua'), 'agua', 'reportar_avaria', {
        tipo: 'avaria',
        morada: 'Rua Y, 3',
        descricao: 'Contador a pingar',
        agua_na_via: 'não',
      });
      const p = await linha<{ id: string }>(
        ctx.db,
        'SELECT id FROM pedidos_agua WHERE numero = $1 AND municipio_id = $2',
        [r.body.numero, MUNICIPIO_ID],
      );
      await ctx.db.query(
        `UPDATE pedidos_agua SET envio_estado = 'falhou', envio_erro = 'teste' WHERE id = $1`,
        [p!.id],
      );
      const falhados = await ctx
        .http()
        .get('/v1/painel/agua/pedidos?envio=falhou&limite=200')
        .set(chefe)
        .expect(200);
      expect(falhados.body.itens.map((i: { id: string }) => i.id)).toContain(
        p!.id,
      );
      const re = await ctx
        .http()
        .post(`/v1/painel/agua/pedidos/${p!.id}/reenviar`)
        .set(chefe)
        .expect(200);
      expect(re.body).toMatchObject({ enviado: true, simulado: true });
      const resumo = await ctx
        .http()
        .get('/v1/painel/agua')
        .set(chefe)
        .expect(200);
      expect(resumo.body.integracao).toEqual({
        nome: 'Vimágua (simulada)',
        simulado: true,
      });
      const aud = await linha<{ n: number }>(
        ctx.db,
        `SELECT count(*)::int AS n FROM audit_log WHERE acao = 'reenviar_pedido_agua' AND objeto_id = $1`,
        [p!.id],
      );
      expect(aud!.n).toBe(1);
    });

    it('demonstração: três pedidos, um deles falhado para reenviar', async () => {
      const agua = ctx.app.get(AguaService);
      const antes = await linha<{ n: number }>(
        ctx.db,
        'SELECT count(*)::int AS n FROM pedidos_agua WHERE municipio_id = $1',
        [MUNICIPIO_ID],
      );
      const r = await agua.carregarDemonstracao(M);
      // Já há pedidos dos testes acima: não cria nada.
      expect(antes!.n).toBeGreaterThan(0);
      expect(r.criados).toBe(0);
    });
  });
});
