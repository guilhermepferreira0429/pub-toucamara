import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomInt } from 'crypto';
import { z } from 'zod';
import { hojeLisboa } from '../../common/dias-uteis.js';
import { ErroApi } from '../../common/erros.js';
import type { UtilizadorPainel } from '../../common/pedido.js';
import { DatabaseService, type Tx } from '../../database/database.service.js';
import type { ContextoFerramenta } from '../../ferramentas/ferramenta.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { MensagensService } from '../comunicacao/mensagens.service.js';
import { ConversasService } from '../conversas/conversas.service.js';
import { dataPorExtenso } from '../licencas/comum.js';
import { avisosDe, DEFS, TIPOS, type TipoLicenca } from '../licencas/tipos.js';
import {
  MunicipesService,
  nifValido,
  normalizarTelefone,
} from '../municipes/municipes.service.js';
import {
  type Municipio,
  MunicipiosService,
} from '../municipios/municipios.service.js';
import { PagamentosService } from '../pagamentos/pagamentos.service.js';
import {
  ATIVIDADES,
  type Calendario,
  calendario,
  type ContextoTaxas,
  definicaoPerguntas,
  esquemaPerfil,
  esquemaRequisito,
  type ItemLista,
  juntarCatalogo,
  juntarPerfis,
  type LicencaTitular,
  type Lista,
  listaPara,
  type Perfil,
  PERIODICIDADES,
  perguntasEmFalta,
  principais,
  type Requisito,
  ROTULOS_FLAG,
} from './balcao-empresas.regras.js';
import { CATALOGO_OMISSAO } from './catalogo.js';
import { gerarIcs } from './ics.js';

const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
/** O calendário de uma empresa identificada mostra licenças: expira. */
const DIAS_OBRIGACOES = 30;

/** POST público: o perfil, com a atividade obrigatória. */
export const esquemaPerfilPublico = esquemaPerfil.extend({
  atividade: esquemaPerfil.shape.atividade.unwrap(),
});

export const entradaOQueAEmpresaPrecisa = esquemaPerfil.extend({
  fim: z
    .boolean()
    .optional()
    .describe('true se não quer responder a mais perguntas.'),
});

export const entradaObrigacoes = z.object({});

export const esquemaObrigacoesPainel = z
  .object({
    nif: z.string().trim().optional(),
    municipe_id: z.uuid().optional(),
  })
  .refine((o) => !!o.nif || !!o.municipe_id, {
    message: 'Indique o NIF ou o munícipe.',
  });

interface LinhaLista {
  id: string;
  municipio_id: string;
  tipo: 'lista' | 'obrigacoes';
  codigo: string;
  canal: string;
  conversa_id: string | null;
  municipe_id: string | null;
  perfil: Perfil;
  resultado: {
    lista: Lista | null;
    calendario: Calendario;
    titular?: string | null;
  };
  criada_em: Date;
  expira_em: Date | null;
  municipio: string;
}

/** O resultado completo (página, painel e ferramenta). */
export interface Montagem {
  lista: Lista | null;
  calendario: Calendario;
  licencas: (LicencaTitular & { nome: string })[];
}

function gerarCodigo(): string {
  return Array.from(
    { length: 8 },
    () => ALFABETO[randomInt(ALFABETO.length)],
  ).join('');
}

/** "a, b e c". */
function listaDita(l: string[]): string {
  return l.length <= 1
    ? (l[0] ?? '')
    : `${l.slice(0, -1).join(', ')} e ${l[l.length - 1]}`;
}

/** O que o cartão do chat e a ferramenta mostram de cada item. */
function itemResumido(i: ItemLista) {
  return {
    chave: i.chave,
    titulo: i.titulo,
    onde: i.onde,
    entidade: i.entidade,
    porque: i.porque[0] ?? null,
    prazo: i.prazo,
    taxa: i.taxa?.texto ?? null,
    pedir_com:
      i.como.tipo === 'agente'
        ? `${i.como.ferramenta} (tipo ${i.como.tipo_licenca})`
        : null,
    estado: i.estado,
  };
}

/**
 * Balcão para empresas: a lista do que a empresa precisa (pelo perfil) e o
 * calendário de obrigações (pelas licenças que já tem), na página pública,
 * no agente e no painel, onde a câmara afina o catálogo.
 */
@Injectable()
export class EmpresasService {
  constructor(
    private readonly db: DatabaseService,
    private readonly config: ConfigService,
    private readonly municipios: MunicipiosService,
    private readonly municipes: MunicipesService,
    private readonly mensagens: MensagensService,
    private readonly conversas: ConversasService,
    private readonly pagamentos: PagamentosService,
    private readonly auditoria: AuditoriaService,
  ) {}

  // ------------------------------------------------------------------
  // Catálogo
  // ------------------------------------------------------------------

  private async alterados(municipioId: string): Promise<Requisito[]> {
    const linhas = await this.db.query<{ requisito: unknown }>(
      `SELECT requisito FROM empresa_requisitos WHERE municipio_id = $1`,
      [municipioId],
    );
    return linhas
      .map((l) => esquemaRequisito.safeParse(l.requisito))
      .filter((r) => r.success)
      .map((r) => r.data);
  }

  async catalogo(municipioId: string) {
    return juntarCatalogo(CATALOGO_OMISSAO, await this.alterados(municipioId));
  }

  /** As regras em vigor de cada tipo de licença, a tabela de taxas e os tipos de processo. */
  private async contextoTaxas(m: Municipio): Promise<ContextoTaxas> {
    const [regras, tipos, tabela] = await Promise.all([
      this.db.query<{ tipo: TipoLicenca; config: unknown }>(
        `SELECT tipo, config FROM licenca_regras WHERE municipio_id = $1`,
        [m.id],
      ),
      this.db.query<{ codigo: string; id: string }>(
        `SELECT upper(codigo) AS codigo, id FROM tipos_processo WHERE municipio_id = $1`,
        [m.id],
      ),
      this.pagamentos.tabelaEmVigor(m).catch(() => null),
    ]);
    const porTipo = new Map(regras.map((r) => [r.tipo, r.config]));
    return {
      configs: Object.fromEntries(
        TIPOS.map((t) => [t, DEFS[t].ler(porTipo.get(t))]),
      ),
      tabela: tabela
        ? {
            taxas: tabela.taxas,
            ano: tabela.ano,
            fonte: tabela.fonte?.titulo ?? null,
          }
        : null,
      tiposProcesso: Object.fromEntries(tipos.map((t) => [t.codigo, t.id])),
    };
  }

  // ------------------------------------------------------------------
  // Licenças de um titular (calendário)
  // ------------------------------------------------------------------

  /**
   * As licenças do munícipe e das outras fichas com o mesmo NIF (a mesma
   * empresa pode ter ligado de números diferentes). As já renovadas não
   * contam (conta a renovação).
   */
  private async licencasDe(
    m: Municipio,
    municipeId: string,
    ctx: ContextoTaxas,
  ): Promise<Montagem['licencas']> {
    const linhas = await this.db.query<{
      numero: string;
      tipo: TipoLicenca;
      estado: LicencaTitular['estado'];
      valida_ate: string | null;
      taxa_cent: number;
      dados: Record<string, unknown>;
      config_usada: unknown;
      emitida: string | null;
    }>(
      `SELECT p.numero, l.tipo, l.estado, to_char(l.valida_ate, 'YYYY-MM-DD') AS valida_ate,
              l.taxa_cent, l.dados, l.config_usada,
              to_char(l.decidida_em AT TIME ZONE 'Europe/Lisbon', 'YYYY-MM-DD') AS emitida
       FROM licencas l
       JOIN processos p ON p.id = l.processo_id
       WHERE l.municipio_id = $1
         AND l.municipe_id IN (
           SELECT mu.id FROM municipes mu
           WHERE mu.municipio_id = $1 AND mu.anonimizado_em IS NULL
             AND (mu.id = $2 OR (mu.nif_hash IS NOT NULL
               AND mu.nif_hash = (SELECT nif_hash FROM municipes WHERE id = $2))))
         AND NOT EXISTS (SELECT 1 FROM licencas r
                         WHERE r.renova_licenca_id = l.id AND r.estado = 'emitida')
       ORDER BY l.criada_em DESC
       LIMIT 50`,
      [m.id, municipeId],
    );
    return linhas.map((l) => {
      const def = DEFS[l.tipo];
      // Emitidas antes de o job preencher a validade: a conta da página.
      let valida = l.valida_ate;
      if (!valida && l.estado === 'emitida') {
        try {
          valida = def.resumo(
            l.dados,
            def.ler(l.config_usada),
            l.emitida,
          ).valida_ate;
        } catch {
          valida = null;
        }
      }
      const avisos = avisosDe(l.tipo, ctx.configs[l.tipo]);
      return {
        numero: l.numero,
        tipo: l.tipo,
        estado: l.estado,
        valida_ate: valida,
        taxa_cent: l.taxa_cent,
        aviso_dias: avisos?.aviso_1_dias || null,
        nome: def.nome,
      };
    });
  }

  /** A lista (se houver perfil) e o calendário. */
  async montar(
    m: Municipio,
    perfil: Perfil | null,
    municipeId: string | null,
  ): Promise<Montagem> {
    const [ctx, catalogo, feriados] = await Promise.all([
      this.contextoTaxas(m),
      this.catalogo(m.id),
      this.municipios.feriados(m.id),
    ]);
    const lista = perfil?.atividade ? listaPara(perfil, catalogo, ctx) : null;
    const licencas = municipeId
      ? await this.licencasDe(m, municipeId, ctx)
      : [];
    return {
      lista,
      licencas,
      calendario: calendario({
        hoje: hojeLisboa(),
        lista: lista?.itens ?? [],
        licencas,
        abertura: perfil?.abertura ?? null,
        feriados,
      }),
    };
  }

  // ------------------------------------------------------------------
  // Público
  // ------------------------------------------------------------------

  /** As perguntas da página, para uma atividade (todas, com as condicionais). */
  async perguntas(slug: string) {
    const m = await this.municipios.porSlug(slug);
    return {
      municipio: m.nome,
      atividades: Object.entries(ATIVIDADES).map(([valor, rotulo]) => ({
        valor,
        rotulo,
      })),
      perguntas: definicaoPerguntas(),
    };
  }

  /** POST público: o perfil → a lista e o calendário (guarda só o perfil). */
  async listaPublica(slug: string, perfil: Perfil) {
    const m = await this.municipios.porSlug(slug);
    const r = await this.montar(m, perfil, null);
    const codigo = gerarCodigo();
    await this.db.query(
      `INSERT INTO empresa_listas (municipio_id, tipo, codigo, canal, perfil, resultado)
       VALUES ($1, 'lista', $2, 'web', $3, $4)`,
      [
        m.id,
        codigo,
        JSON.stringify(perfil),
        JSON.stringify({ lista: r.lista, calendario: r.calendario }),
      ],
    );
    return this.pagina({
      codigo,
      tipo: 'lista',
      municipio: m.nome,
      perfil,
      resultado: { lista: r.lista, calendario: r.calendario },
      criada_em: new Date(),
    });
  }

  private async porCodigo(codigo: string): Promise<LinhaLista> {
    const c = codigo.trim().toUpperCase();
    const [r] = /^[A-Z0-9]{8}$/.test(c)
      ? await this.db.query<LinhaLista>(
          `SELECT l.*, m.nome AS municipio FROM empresa_listas l
           JOIN municipios m ON m.id = l.municipio_id
           WHERE l.codigo = $1 AND (l.expira_em IS NULL OR l.expira_em > now())`,
          [c],
        )
      : [];
    if (!r) {
      throw new ErroApi(
        HttpStatus.NOT_FOUND,
        'link_invalido',
        'Este link não existe ou já expirou.',
      );
    }
    return r;
  }

  private pagina(l: {
    codigo: string;
    tipo: 'lista' | 'obrigacoes';
    municipio: string;
    perfil: Perfil;
    resultado: LinhaLista['resultado'];
    criada_em: Date;
  }) {
    const lista = l.resultado.lista;
    return {
      codigo: l.codigo,
      tipo: l.tipo,
      municipio: l.municipio,
      titular: l.resultado.titular ?? null,
      perfil: l.perfil,
      atividade: l.perfil.atividade ? ATIVIDADES[l.perfil.atividade] : null,
      lista,
      calendario: l.resultado.calendario,
      valores_de_demonstracao:
        (lista?.demonstracao ?? false) ||
        l.resultado.calendario.eventos.some((e) => e.demonstracao),
      link: this.url(l.codigo),
      ics: `/v1/public/empresas/listas/${l.codigo}/calendario.ics`,
      criada_em: l.criada_em.toISOString(),
    };
  }

  async publico(codigo: string) {
    const l = await this.porCodigo(codigo);
    return this.pagina(l);
  }

  async ics(codigo: string): Promise<{ nome: string; ics: string }> {
    const l = await this.porCodigo(codigo);
    const titulo =
      l.tipo === 'obrigacoes'
        ? `Obrigações · ${l.municipio}`
        : `Empresa · ${l.municipio}`;
    return {
      nome: `obrigacoes-${l.codigo}.ics`,
      ics: gerarIcs(l.resultado.calendario.eventos, {
        nome: titulo,
        dominio: 'toucamara.pt',
      }),
    };
  }

  private url(codigo: string): string {
    return `${this.config.get<string>('app.webUrl') ?? ''}/empresas/${codigo}`;
  }

  // ------------------------------------------------------------------
  // Agente
  // ------------------------------------------------------------------

  async oQueAEmpresaPrecisa(
    ctx: ContextoFerramenta,
    e: z.output<typeof entradaOQueAEmpresaPrecisa>,
  ) {
    const m = ctx.municipio;
    const { fim, ...dito } = e;
    const telefone = normalizarTelefone(ctx.telefone);

    const anterior = ctx.conversaId
      ? (
          await this.db.query<{ id: string; codigo: string; perfil: Perfil }>(
            `SELECT id, codigo, perfil FROM empresa_listas
             WHERE conversa_id = $1 AND tipo = 'lista'
             ORDER BY criada_em DESC LIMIT 1`,
            [ctx.conversaId],
          )
        )[0]
      : undefined;
    const perfil = juntarPerfis(anterior?.perfil ?? {}, dito);
    const faltam = perguntasEmFalta(perfil);

    if (!perfil.atividade) {
      return {
        respondido: false,
        em_falta: ['atividade'],
        perguntar_a_seguir: faltam.map((p) => p.pergunta),
        dizer: faltam[0].pergunta,
      };
    }
    const perguntar = fim ? [] : faltam.slice(0, 2).map((p) => p.pergunta);
    if (perguntar.length > 0) {
      // Guarda já o que sabe (o perfil junta-se de chamada em chamada).
      await this.guardarDaConversa(ctx, anterior, perfil, null);
      return {
        respondido: false,
        perguntar_a_seguir: perguntar,
        faltam: faltam.length,
        dizer: `Para lhe dizer o que precisa, só mais umas perguntas: ${perguntar.join(' ')}`,
      };
    }

    const r = await this.montar(m, perfil, ctx.municipeId);
    const lista = r.lista!;
    const { codigo, smsEnviado } = await this.db.transaction(async (tx) => {
      const g = await this.guardarDaConversa(ctx, anterior, perfil, r, tx);
      let sms = false;
      if (telefone && lista.itens.length) {
        await this.mensagens.sms(
          {
            municipioId: m.id,
            municipeId: ctx.municipeId,
            destino: telefone,
            motivo: 'fim_chamada',
            corpo: `${m.nome}: o que a sua empresa precisa (${lista.itens.length} pontos), com prazos, taxas e calendário: ${this.url(g.codigo)}`,
            relacionado: {
              empresa_lista: g.id,
              ...(ctx.conversaId ? { conversa_id: ctx.conversaId } : {}),
            },
            chave: `empresa_lista:${g.id}`,
          },
          tx,
        );
        sms = true;
      }
      await this.conversas.momento(
        ctx.conversaId,
        'resposta_com_fonte',
        { empresa_lista: g.codigo },
        tx,
      );
      return { codigo: g.codigo, smsEnviado: sms };
    });

    const top = principais(lista.itens, 6);
    const titulos = top.map((i) => i.titulo.toLowerCase());
    const naCamara = top.filter((i) => i.como.tipo === 'agente');
    const proximos = r.calendario.eventos.slice(0, 3);
    const dizer =
      `Para ${ATIVIDADES[perfil.atividade].toLowerCase()}, o principal é: ${listaDita(titulos)}. ` +
      (naCamara.length
        ? `Posso tratar já consigo ${naCamara.length === 1 ? 'do pedido' : 'dos pedidos'} da câmara (${listaDita(naCamara.map((i) => i.titulo.toLowerCase()))}). `
        : '') +
      (lista.itens.length > top.length
        ? `Há mais ${lista.itens.length - top.length} na lista completa. `
        : '') +
      (smsEnviado
        ? 'Mandei-lhe por SMS o link com a lista toda, os prazos, as taxas e o calendário. '
        : `A lista completa está em ${this.url(codigo)}. `) +
      (lista.demonstracao ? '(Alguns valores são de demonstração.)' : '');

    return {
      respondido: true,
      atividade: ATIVIDADES[perfil.atividade],
      itens: top.map(itemResumido),
      total: lista.itens.length,
      na_camara: lista.na_camara,
      fora_da_camara: lista.fora_da_camara,
      proximas_datas: proximos.map((x) => ({
        data: x.data,
        dito: dataPorExtenso(x.data),
        titulo: x.titulo,
      })),
      link: this.url(codigo),
      sms_enviado: smsEnviado,
      valores_de_demonstracao: lista.demonstracao,
      dizer,
    };
  }

  /** Cria ou atualiza a lista desta conversa (uma por conversa). */
  private async guardarDaConversa(
    ctx: ContextoFerramenta,
    anterior: { id: string; codigo: string } | undefined,
    perfil: Perfil,
    r: Montagem | null,
    tx?: Tx,
  ): Promise<{ id: string; codigo: string }> {
    const q = tx ?? this.db;
    const resultado = JSON.stringify({
      lista: r?.lista ?? null,
      calendario: r?.calendario ?? { eventos: [], lembretes: [] },
    });
    if (anterior) {
      await q.query(
        `UPDATE empresa_listas SET perfil = $2, resultado = $3,
           municipe_id = coalesce(municipe_id, $4), atualizada_em = now()
         WHERE id = $1`,
        [anterior.id, JSON.stringify(perfil), resultado, ctx.municipeId],
      );
      return anterior;
    }
    const codigo = gerarCodigo();
    const [c] = await q.query<{ id: string }>(
      `INSERT INTO empresa_listas (municipio_id, tipo, codigo, canal, conversa_id, municipe_id, perfil, resultado)
       VALUES ($1, 'lista', $2, $3, $4, $5, $6, $7) RETURNING id`,
      [
        ctx.municipio.id,
        codigo,
        ctx.canal,
        ctx.conversaId,
        ctx.municipeId,
        JSON.stringify(perfil),
        resultado,
      ],
    );
    return { id: c.id, codigo };
  }

  /** O calendário da empresa identificada (as licenças que tem, as datas reais). */
  async obrigacoesDaEmpresa(ctx: ContextoFerramenta) {
    const precisa = {
      precisa_identificacao: true,
      instrucao:
        'Para ver as licenças e as datas da empresa é preciso identificar a pessoa: peça o NIF e use identificar_municipe; depois volte a chamar esta ferramenta.',
    };
    if (!ctx.municipeId) return precisa;
    const m = ctx.municipio;
    const [municipe] = await this.db.query<{ tem_nif: boolean }>(
      'SELECT nif_hash IS NOT NULL AS tem_nif FROM municipes WHERE id = $1',
      [ctx.municipeId],
    );
    const r = await this.montar(m, null, ctx.municipeId);
    // Só pelo número de telefone pode não ser a mesma pessoa das licenças.
    if (r.licencas.length === 0 && !municipe?.tem_nif) return precisa;
    if (r.licencas.length === 0) {
      return {
        encontrado: false,
        dizer:
          'Não encontrei licenças da câmara em seu nome. Se quiser, digo-lhe o que uma empresa como a sua precisa (o_que_a_empresa_precisa).',
      };
    }
    const telefone = normalizarTelefone(ctx.telefone);
    const codigo = gerarCodigo();
    const sms = !!telefone && r.calendario.eventos.length > 0;
    await this.db.transaction(async (tx) => {
      const [c] = await tx.query<{ id: string }>(
        `INSERT INTO empresa_listas (municipio_id, tipo, codigo, canal, conversa_id, municipe_id,
           perfil, resultado, expira_em)
         VALUES ($1, 'obrigacoes', $2, $3, $4, $5, '{}', $6, now() + make_interval(days => $7))
         RETURNING id`,
        [
          m.id,
          codigo,
          ctx.canal,
          ctx.conversaId,
          ctx.municipeId,
          JSON.stringify({ lista: null, calendario: r.calendario }),
          DIAS_OBRIGACOES,
        ],
      );
      if (sms) {
        await this.mensagens.sms(
          {
            municipioId: m.id,
            municipeId: ctx.municipeId,
            destino: telefone,
            motivo: 'fim_chamada',
            corpo: `${m.nome}: o calendário das suas licenças (renovações e prazos), para pôr no telemóvel: ${this.url(codigo)}`,
            relacionado: {
              empresa_lista: c.id,
              ...(ctx.conversaId ? { conversa_id: ctx.conversaId } : {}),
            },
            chave: `empresa_obrigacoes:${c.id}`,
          },
          tx,
        );
      }
    });
    const proximos = r.calendario.eventos.slice(0, 4);
    const dizer =
      (proximos.length
        ? `As próximas datas: ${listaDita(proximos.map((x) => `${x.titulo.charAt(0).toLowerCase()}${x.titulo.slice(1)}, a ${dataPorExtenso(x.data)}`))}. `
        : 'Não há renovações nem prazos nos próximos meses. ') +
      (sms
        ? 'Mandei-lhe por SMS o calendário, que pode pôr no telemóvel.'
        : `O calendário está em ${this.url(codigo)}.`);
    return {
      encontrado: true,
      licencas: r.licencas.map((l) => ({
        numero: l.numero,
        nome: l.nome,
        estado: l.estado,
        valida_ate: l.valida_ate,
      })),
      proximas_datas: proximos.map((x) => ({
        data: x.data,
        dito: dataPorExtenso(x.data),
        titulo: x.titulo,
        tipo: x.tipo,
      })),
      lembretes: r.calendario.lembretes.map((x) => x.titulo),
      link: this.url(codigo),
      sms_enviado: sms,
      dizer,
    };
  }

  // ------------------------------------------------------------------
  // Painel
  // ------------------------------------------------------------------

  async painel(m: Municipio) {
    const [itens, uso] = await Promise.all([
      this.catalogo(m.id),
      this.db.query<{ atividade: string | null; n: number }>(
        `SELECT perfil->>'atividade' AS atividade, count(*)::int AS n
         FROM empresa_listas
         WHERE municipio_id = $1 AND tipo = 'lista' AND criada_em > now() - interval '30 days'
         GROUP BY 1 ORDER BY 2 DESC`,
        [m.id],
      ),
    ]);
    const omissao = new Map(CATALOGO_OMISSAO.map((r) => [r.chave, r]));
    return {
      itens: itens.map((i) => ({
        ...i,
        omissao: i.alterado && !i.novo ? omissao.get(i.chave) : null,
      })),
      atividades: ATIVIDADES,
      flags: ROTULOS_FLAG,
      periodicidades: PERIODICIDADES,
      tipos_licenca: Object.fromEntries(TIPOS.map((t) => [t, DEFS[t].nome])),
      uso: {
        listas_30_dias: uso.reduce((s, x) => s + x.n, 0),
        por_atividade: uso
          .filter((x) => x.atividade)
          .map((x) => ({
            atividade: x.atividade,
            nome:
              ATIVIDADES[x.atividade as keyof typeof ATIVIDADES] ?? x.atividade,
            n: x.n,
          })),
      },
    };
  }

  /** Grava um requisito (altera o do código ou acrescenta um novo). */
  async gravarRequisito(
    m: Municipio,
    u: UtilizadorPainel,
    chave: string,
    r: Requisito,
  ) {
    if (r.chave !== chave) {
      throw new ErroApi(
        HttpStatus.BAD_REQUEST,
        'pedido_invalido',
        'A chave do requisito não pode mudar.',
      );
    }
    const antes =
      (await this.catalogo(m.id)).find((x) => x.chave === chave) ?? null;
    await this.db.transaction(async (tx) => {
      await tx.query(
        `INSERT INTO empresa_requisitos (municipio_id, chave, requisito, atualizado_por)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (municipio_id, chave) DO UPDATE
           SET requisito = EXCLUDED.requisito, atualizado_por = EXCLUDED.atualizado_por,
               atualizado_em = now()`,
        [m.id, chave, JSON.stringify(r), u.id],
      );
      await this.auditoria.registar(
        {
          municipioId: m.id,
          atorTipo: 'utilizador',
          atorId: u.id,
          acao: antes ? 'mudar_requisito_empresa' : 'criar_requisito_empresa',
          objetoTipo: 'empresa_requisito',
          objetoId: chave,
          dados: {
            titulo: r.titulo,
            antes: antes ? semMarcas(antes) : null,
            depois: r,
          },
        },
        tx,
      );
    });
    return this.painel(m);
  }

  /** Repõe o requisito do código (ou apaga um requisito novo). */
  async reporRequisito(m: Municipio, u: UtilizadorPainel, chave: string) {
    const [antes] = await this.db.query<{ requisito: Requisito }>(
      `SELECT requisito FROM empresa_requisitos WHERE municipio_id = $1 AND chave = $2`,
      [m.id, chave],
    );
    if (!antes) {
      throw new ErroApi(
        HttpStatus.NOT_FOUND,
        'requisito_sem_alteracoes',
        'Este requisito não tem alterações da câmara.',
      );
    }
    await this.db.transaction(async (tx) => {
      await tx.query(
        `DELETE FROM empresa_requisitos WHERE municipio_id = $1 AND chave = $2`,
        [m.id, chave],
      );
      await this.auditoria.registar(
        {
          municipioId: m.id,
          atorTipo: 'utilizador',
          atorId: u.id,
          acao: 'repor_requisito_empresa',
          objetoTipo: 'empresa_requisito',
          objetoId: chave,
          dados: { antes: antes.requisito },
        },
        tx,
      );
    });
    return this.painel(m);
  }

  /** Testar o catálogo com um perfil (não guarda nada). */
  async preVisualizar(m: Municipio, perfil: Perfil) {
    const r = await this.montar(m, perfil, null);
    return { lista: r.lista, calendario: r.calendario };
  }

  /** O calendário de obrigações de uma empresa, pelo NIF (ou pela ficha). */
  async obrigacoesPainel(
    m: Municipio,
    u: UtilizadorPainel,
    q: z.output<typeof esquemaObrigacoesPainel>,
  ) {
    let municipeId = q.municipe_id ?? null;
    if (!municipeId && q.nif) {
      const nif = q.nif.replace(/\s/g, '');
      if (!nifValido(nif)) {
        throw new ErroApi(
          HttpStatus.BAD_REQUEST,
          'nif_invalido',
          'Este NIF não é válido.',
        );
      }
      municipeId = (await this.municipes.porNif(m.id, nif))?.id ?? null;
    }
    if (!municipeId) {
      throw new ErroApi(
        HttpStatus.NOT_FOUND,
        'municipe_nao_encontrado',
        'Não há nenhum munícipe ou empresa com esse NIF.',
      );
    }
    const [mu] = await this.db.query<{ nome: string | null }>(
      `SELECT nome FROM municipes WHERE id = $1 AND municipio_id = $2`,
      [municipeId, m.id],
    );
    if (!mu) {
      throw new ErroApi(
        HttpStatus.NOT_FOUND,
        'municipe_nao_encontrado',
        'Não há nenhum munícipe ou empresa com esse NIF.',
      );
    }
    const r = await this.montar(m, null, municipeId);
    await this.auditoria.registar({
      municipioId: m.id,
      atorTipo: 'utilizador',
      atorId: u.id,
      acao: 'ver_obrigacoes_empresa',
      objetoTipo: 'municipe',
      objetoId: municipeId,
      dados: { licencas: r.licencas.length },
    });
    return {
      municipe_id: municipeId,
      titular: mu.nome,
      licencas: r.licencas,
      calendario: r.calendario,
    };
  }
}

/** O requisito sem as marcas do catálogo (alterado, novo). */
function semMarcas(r: Requisito & { alterado?: boolean; novo?: boolean }) {
  const { alterado: _a, novo: _n, ...resto } = r;
  void _a;
  void _n;
  return resto;
}
