import { HttpStatus, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { hojeLisboa } from '../../common/dias-uteis.js';
import { ErroApi } from '../../common/erros.js';
import { proximoNumero } from '../../common/numeracao.js';
import { pagina, type Cursor } from '../../common/paginacao.js';
import type { UtilizadorPainel } from '../../common/pedido.js';
import { DatabaseService } from '../../database/database.service.js';
import type { ContextoFerramenta } from '../../ferramentas/ferramenta.js';
import { estaAberto, lerHorario } from '../atendimento/horario.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { MensagensService } from '../comunicacao/mensagens.service.js';
import { ConversasService } from '../conversas/conversas.service.js';
import { MunicipesService } from '../municipes/municipes.service.js';
import {
  type Municipio,
  MunicipiosService,
} from '../municipios/municipios.service.js';
import {
  canalDe,
  dataDita,
  formatarNumero,
  precisaIdentificacao,
  quemPede,
} from '../servicos-municipais/comum.js';
import { CEMITERIOS_DEMO, SEPULTURAS_DEMO } from './demonstracao.js';
import {
  estadoConcessao,
  FONTE_TAXAS,
  fraseConcessao,
  fraseTaxa,
  horarioDito,
  lerReferencia,
  localDito,
  mascararNome,
  SERVICOS_TAXA,
  taxasDe,
  TAXAS_DEMONSTRACAO,
} from './regras.js';

// ---------------------------------------------------------------------------
// Entradas das ações do catálogo (cada campo: a pergunta a fazer)
// ---------------------------------------------------------------------------

export const entradaProcurar = z.object({
  nome: z
    .string()
    .trim()
    .min(3)
    .max(120)
    .describe('Nome da pessoa falecida (o mais completo que souber).'),
  ano_falecimento: z
    .number()
    .int()
    .min(1900)
    .max(2100)
    .optional()
    .describe('Ano em que faleceu, se souber.'),
  cemiterio: z
    .string()
    .trim()
    .max(80)
    .optional()
    .describe('Cemitério ou freguesia, se souber.'),
});

export const entradaConcessao = z.object({
  referencia: z
    .string()
    .trim()
    .min(2)
    .max(200)
    .describe(
      'Nome de quem lá está sepultado, ou o talhão e o número da sepultura ou jazigo.',
    ),
  cemiterio: z
    .string()
    .trim()
    .max(80)
    .optional()
    .describe('Cemitério ou freguesia, se souber.'),
});

export const TIPOS_PEDIDO = [
  'renovacao',
  'averbamento',
  'segunda_via_alvara',
] as const;

export const entradaPedir = z.object({
  tipo: z
    .enum(TIPOS_PEDIDO)
    .describe(
      'O que pede: renovacao da concessão, averbamento (mudar o titular) ou segunda_via_alvara.',
    ),
  referencia: z
    .string()
    .trim()
    .min(2)
    .max(200)
    .describe(
      'Que sepultura ou jazigo: nome de quem lá está, ou cemitério, talhão e número.',
    ),
  nome: z.string().trim().min(3).max(120).describe('O nome de quem pede.'),
  relacao: z
    .string()
    .trim()
    .max(80)
    .optional()
    .describe(
      'A relação com o titular ou com quem está sepultado (filha, viúvo…).',
    ),
  observacoes: z
    .string()
    .trim()
    .max(500)
    .optional()
    .describe('Mais alguma coisa que a equipa deva saber.'),
});

export const entradaTaxas = z.object({
  servico: z
    .enum(SERVICOS_TAXA)
    .optional()
    .describe('Que taxa (vazio = todas).'),
});

export const entradaHorarios = z.object({
  cemiterio: z
    .string()
    .trim()
    .max(80)
    .optional()
    .describe('Que cemitério ou freguesia (vazio = todos).'),
});

export const esquemaAlterarPedido = z.object({
  estado: z.enum(['recebido', 'em_analise', 'concluido', 'recusado']),
  resposta: z.string().trim().min(3).max(1000).optional(),
});

const ESTADOS_PEDIDO = [
  'recebido',
  'em_analise',
  'concluido',
  'recusado',
] as const;

export const esquemaFiltroPedidos = z.object({
  estado: z.enum(ESTADOS_PEDIDO).optional(),
});

export const esquemaFiltroSepulturas = z.object({
  q: z.string().trim().max(120).optional(),
  cemiterio_id: z.uuid().optional(),
});

const NOMES_PEDIDO: Record<(typeof TIPOS_PEDIDO)[number], string> = {
  renovacao: 'renovação da concessão',
  averbamento: 'averbamento (mudança de titular)',
  segunda_via_alvara: '2.ª via do alvará',
};

const INSTRUCAO_TOM =
  'Fala com calma e cuidado: a pessoa pode estar de luto. Frases curtas, sem pressa.';

interface LinhaSepultura {
  sepultura_id: string;
  cemiterio: string;
  cemiterio_id: string;
  tipo: string;
  talhao: string;
  numero: string;
  concessao: 'temporaria' | 'perpetua';
  titular_nome: string | null;
  concessao_inicio: string | null;
  concessao_fim: string | null;
  conservacao_divida_cent: number;
  conservacao_divida_desde: number | null;
  demonstracao: boolean;
}

interface LinhaInumado extends LinhaSepultura {
  nome: string;
  data_falecimento: string | null;
  sim: number;
}

const COLUNAS_SEPULTURA = `
  s.id AS sepultura_id, c.nome AS cemiterio, c.id AS cemiterio_id, s.tipo,
  s.talhao, s.numero, s.concessao, s.titular_nome,
  to_char(s.concessao_inicio, 'YYYY-MM-DD') AS concessao_inicio,
  to_char(s.concessao_fim, 'YYYY-MM-DD') AS concessao_fim,
  s.conservacao_divida_cent, s.conservacao_divida_desde,
  (s.demonstracao OR c.demonstracao) AS demonstracao`;

/** O cemitério dito ("Azurém") contra o nome ou a freguesia. */
const FILTRO_CEMITERIO = (p: string) =>
  `(${p}::text IS NULL OR unaccent(lower(c.nome || ' ' || coalesce(c.freguesia, ''))) LIKE '%' || unaccent(lower(${p})) || '%')`;

/** Semelhança mínima do nome dito com o nome registado. */
const SEMELHANCA_MIN = 0.5;

/**
 * Cemitérios (V4 #8): procurar sepulturas, consultar concessões, pedidos
 * de renovação/averbamento, taxas e horários, para o agente (catálogo de
 * serviços) e o painel.
 */
@Injectable()
export class CemiteriosService {
  constructor(
    private readonly db: DatabaseService,
    private readonly municipes: MunicipesService,
    private readonly municipios: MunicipiosService,
    private readonly mensagens: MensagensService,
    private readonly conversas: ConversasService,
    private readonly auditoria: AuditoriaService,
  ) {}

  // ------------------------------------------------------------------
  // Agente
  // ------------------------------------------------------------------

  private async porNome(
    municipioId: string,
    nome: string,
    ano: number | null,
    cemiterio: string | null,
  ): Promise<LinhaInumado[]> {
    return this.db.query<LinhaInumado>(
      `SELECT i.nome, to_char(i.data_falecimento, 'YYYY-MM-DD') AS data_falecimento,
              word_similarity(unaccent(lower($2)), unaccent(lower(i.nome))) AS sim,
              ${COLUNAS_SEPULTURA}
       FROM inumados i
       JOIN sepulturas s ON s.id = i.sepultura_id
       JOIN cemiterios c ON c.id = s.cemiterio_id
       WHERE i.municipio_id = $1
         AND ($3::int IS NULL OR extract(year FROM i.data_falecimento)::int = $3)
         AND ${FILTRO_CEMITERIO('$4')}
         AND word_similarity(unaccent(lower($2)), unaccent(lower(i.nome))) >= ${SEMELHANCA_MIN}
       ORDER BY sim DESC, i.nome
       LIMIT 5`,
      [municipioId, nome, ano, cemiterio],
    );
  }

  private async porLocal(
    municipioId: string,
    talhao: string,
    numero: string,
    cemiterio: string | null,
  ): Promise<LinhaSepultura[]> {
    return this.db.query<LinhaSepultura>(
      `SELECT ${COLUNAS_SEPULTURA}
       FROM sepulturas s JOIN cemiterios c ON c.id = s.cemiterio_id
       WHERE s.municipio_id = $1 AND upper(s.talhao) = $2 AND upper(s.numero) = $3
         AND ${FILTRO_CEMITERIO('$4')}
       ORDER BY c.nome LIMIT 5`,
      [municipioId, talhao, numero, cemiterio],
    );
  }

  /** As sepulturas que a referência dita pode ser (pelo local, senão pelo nome). */
  private async localizar(
    municipioId: string,
    referencia: string,
    cemiterio: string | null,
  ): Promise<LinhaSepultura[]> {
    const r = lerReferencia(referencia);
    if (r.talhao && r.numero) {
      return this.porLocal(municipioId, r.talhao, r.numero, cemiterio);
    }
    const porNome = await this.porNome(
      municipioId,
      referencia,
      null,
      cemiterio,
    );
    // Várias pessoas na mesma sepultura contam uma vez.
    const vistas = new Set<string>();
    return porNome.filter((l) => {
      if (vistas.has(l.sepultura_id)) return false;
      vistas.add(l.sepultura_id);
      return true;
    });
  }

  async procurar(ctx: ContextoFerramenta, e: z.output<typeof entradaProcurar>) {
    const linhas = await this.porNome(
      ctx.municipio.id,
      e.nome,
      e.ano_falecimento ?? null,
      e.cemiterio ?? null,
    );
    const demonstracao = linhas.some((l) => l.demonstracao);
    if (!linhas.length) {
      return {
        encontrado: false,
        instrucao: INSTRUCAO_TOM,
        dizer: `Não encontrei ninguém com o nome ${e.nome} nos registos dos cemitérios municipais. Pode ser que esteja num cemitério paroquial, que não é da câmara, ou que o nome esteja registado de outra forma. Quer tentar com outro nome ou o ano em que faleceu?`,
      };
    }
    const resultados = linhas.map((l) => ({
      nome: l.nome,
      faleceu_em: dataDita(l.data_falecimento),
      onde: localDito(l),
      cemiterio: l.cemiterio,
      talhao: l.talhao,
      numero: l.numero,
      tipo: l.tipo,
    }));
    if (linhas.length > 1) {
      return {
        encontrado: true,
        precisa_escolher: true,
        resultados,
        ...(demonstracao ? { demonstracao: true } : {}),
        instrucao: `${INSTRUCAO_TOM} Há mais de uma pessoa com nome parecido: diz os nomes e os anos e pergunta qual é.`,
        dizer: `Encontrei ${linhas.length} pessoas com nome parecido: ${resultados
          .map(
            (r) =>
              `${r.nome}${r.faleceu_em ? `, que faleceu a ${r.faleceu_em}` : ''}`,
          )
          .join('; ')}. Qual delas procura?`,
      };
    }
    const r = resultados[0];
    return {
      encontrado: true,
      ...r,
      ...(demonstracao ? { demonstracao: true } : {}),
      instrucao: INSTRUCAO_TOM,
      dizer: `A sepultura de ${r.nome} fica no ${r.onde}.${demonstracao ? ' Estes registos ainda são de demonstração.' : ''}`,
    };
  }

  async concessao(
    ctx: ContextoFerramenta,
    e: z.output<typeof entradaConcessao>,
  ) {
    const linhas = await this.localizar(
      ctx.municipio.id,
      e.referencia,
      e.cemiterio ?? null,
    );
    if (!linhas.length) {
      return {
        encontrado: false,
        instrucao: INSTRUCAO_TOM,
        dizer:
          'Não encontrei essa sepultura nos registos. Pode dizer-me o nome de quem lá está sepultado, ou o cemitério, o talhão e o número que vêm no alvará?',
      };
    }
    if (linhas.length > 1) {
      return {
        encontrado: true,
        precisa_escolher: true,
        opcoes: linhas.map((l) => localDito(l)),
        instrucao: `${INSTRUCAO_TOM} Pergunta qual destas é e chama outra vez com o cemitério.`,
        dizer: `Encontrei mais de uma: ${linhas.map((l) => localDito(l)).join('; ')}. Qual é?`,
      };
    }
    const s = linhas[0];
    const hoje = hojeLisboa();
    const estado = estadoConcessao(s, hoje);
    return {
      encontrado: true,
      onde: localDito(s),
      concessao: s.concessao,
      estado,
      valida_ate: s.concessao_fim,
      valida_ate_dito: dataDita(s.concessao_fim),
      // Ao telefone não se sabe quem fala: o titular vai abreviado.
      titular: mascararNome(s.titular_nome),
      conservacao_em_divida_cent: s.conservacao_divida_cent,
      ...(s.demonstracao ? { demonstracao: true } : {}),
      instrucao: `${INSTRUCAO_TOM}${
        estado === 'a_terminar' || estado === 'terminada'
          ? ' Pergunta se quer pedir já a renovação (ação pedir_concessao).'
          : ''
      }`,
      dizer: `No ${localDito(s)}, o titular da concessão é ${mascararNome(s.titular_nome) ?? 'desconhecido'}. ${fraseConcessao(s, hoje)}${s.demonstracao ? ' Estes registos ainda são de demonstração.' : ''}`,
    };
  }

  async pedir(ctx: ContextoFerramenta, e: z.output<typeof entradaPedir>) {
    const m = ctx.municipio;
    const quem = await quemPede(this.db, this.municipes, ctx);
    if (!quem) return precisaIdentificacao(ctx, 'registar o pedido');
    const candidatas = await this.localizar(m.id, e.referencia, null);
    const sepultura = candidatas.length === 1 ? candidatas[0] : null;
    const ano = new Date().getFullYear();
    const r = await this.db.transaction(async (tx) => {
      const numero = formatarNumero(
        'CM',
        ano,
        await proximoNumero(tx, m.id, 'CM', ano),
      );
      const [p] = await tx.query<{ id: string }>(
        `INSERT INTO pedidos_cemiterio (municipio_id, numero, tipo, sepultura_id, referencia,
           requerente_nome, relacao, observacoes, telefone, municipe_id, conversa_id, canal)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
        [
          m.id,
          numero,
          e.tipo,
          sepultura?.sepultura_id ?? null,
          e.referencia,
          e.nome,
          e.relacao ?? null,
          e.observacoes ?? null,
          quem.telefone,
          quem.municipeId,
          ctx.conversaId,
          canalDe(ctx),
        ],
      );
      if (quem.telefone) {
        await this.mensagens.sms(
          {
            municipioId: m.id,
            municipeId: quem.municipeId,
            destino: quem.telefone,
            motivo: 'requerimento',
            corpo: `${m.nome}: recebemos o seu pedido de ${NOMES_PEDIDO[e.tipo]} (${numero}). A equipa dos cemitérios vai analisá-lo e responde-lhe por SMS.`,
            relacionado: {
              pedido_cemiterio_id: p.id,
              ...(ctx.conversaId ? { conversa_id: ctx.conversaId } : {}),
            },
            chave: `pedido_cemiterio:${p.id}`,
          },
          tx,
        );
      }
      await this.conversas.momento(
        ctx.conversaId,
        'requerimento',
        { tipo: 'pedido_cemiterio', pedido_cemiterio_id: p.id, numero },
        tx,
      );
      return { id: p.id, numero };
    });
    const taxa = taxasDe(
      e.tipo === 'segunda_via_alvara' ? 'segunda_via_alvara' : e.tipo,
    )[0];
    return {
      feito: true,
      numero: r.numero,
      sepultura: sepultura ? localDito(sepultura) : null,
      sepultura_identificada: !!sepultura,
      taxa: taxa ? fraseTaxa(taxa) : null,
      valores_de_demonstracao: true,
      sms_enviado: !!quem.telefone,
      instrucao: INSTRUCAO_TOM,
      dizer:
        `Fica registado o pedido de ${NOMES_PEDIDO[e.tipo]}, com o número ${r.numero}. ` +
        (sepultura ? `É para o ${localDito(sepultura)}. ` : '') +
        (taxa
          ? `A taxa é de ${fraseTaxa(taxa).split(': ')[1]}, um valor ainda por confirmar pela câmara. `
          : '') +
        (quem.telefone
          ? 'Vai receber um SMS com o número, e a equipa dos cemitérios responde-lhe por SMS.'
          : 'Guarde o número: com ele pode perguntar pelo pedido.'),
    };
  }

  taxas(_ctx: ContextoFerramenta, e: z.output<typeof entradaTaxas>) {
    const lista = taxasDe(e.servico);
    return Promise.resolve({
      taxas: lista.map((t) => ({ ...t, frase: fraseTaxa(t) })),
      fonte: FONTE_TAXAS.titulo,
      valores_de_demonstracao: true,
      dizer: `${lista.map(fraseTaxa).join('; ')}. São valores de demonstração, ainda por confirmar pela câmara.`,
    });
  }

  async horarios(ctx: ContextoFerramenta, e: z.output<typeof entradaHorarios>) {
    const m = ctx.municipio;
    const linhas = await this.db.query<{
      nome: string;
      morada: string | null;
      horario: unknown;
      nota_horario: string | null;
      demonstracao: boolean;
    }>(
      `SELECT c.nome, c.morada, c.horario, c.nota_horario, c.demonstracao
       FROM cemiterios c WHERE c.municipio_id = $1 AND ${FILTRO_CEMITERIO('$2')}
       ORDER BY c.nome`,
      [m.id, e.cemiterio ?? null],
    );
    if (!linhas.length) {
      return {
        encontrado: false,
        dizer: e.cemiterio
          ? `Não tenho o horário do cemitério de ${e.cemiterio}. Pode ser um cemitério paroquial, que não é da câmara.`
          : 'Ainda não tenho os horários dos cemitérios.',
        instrucao:
          'Procura no conhecimento (procurar_conhecimento) ou passa a um funcionário.',
      };
    }
    const feriados = await this.municipios.feriados(m.id);
    const agora = new Date();
    const cemiterios = linhas.map((c) => {
      const h = lerHorario(c.horario);
      return {
        nome: c.nome,
        morada: c.morada,
        horario: horarioDito(c.horario),
        aberto_agora: h ? estaAberto(h, agora, m.fuso, feriados) : null,
        nota: c.nota_horario,
      };
    });
    const demonstracao = linhas.some((c) => c.demonstracao);
    return {
      encontrado: true,
      cemiterios,
      ...(demonstracao ? { demonstracao: true } : {}),
      dizer:
        cemiterios
          .map(
            (c) =>
              `${c.nome}: ${c.horario ?? 'sem horário registado'}${c.aberto_agora === true ? ' (está aberto agora)' : c.aberto_agora === false ? ' (agora está fechado)' : ''}.${c.nota ? ` ${c.nota}` : ''}`,
          )
          .join(' ') +
        (demonstracao ? ' Estes horários ainda são de demonstração.' : ''),
    };
  }

  // ------------------------------------------------------------------
  // Painel
  // ------------------------------------------------------------------

  async resumo(m: Municipio) {
    const cemiterios = await this.db.query<{
      id: string;
      nome: string;
      freguesia: string | null;
      morada: string | null;
      horario: unknown;
      nota_horario: string | null;
      demonstracao: boolean;
      sepulturas: number;
    }>(
      `SELECT c.id, c.nome, c.freguesia, c.morada, c.horario, c.nota_horario, c.demonstracao,
              (SELECT count(*)::int FROM sepulturas s WHERE s.cemiterio_id = c.id) AS sepulturas
       FROM cemiterios c WHERE c.municipio_id = $1 ORDER BY c.nome`,
      [m.id],
    );
    const contagens = await this.db.query<{ estado: string; n: number }>(
      `SELECT estado, count(*)::int AS n FROM pedidos_cemiterio
       WHERE municipio_id = $1 GROUP BY estado`,
      [m.id],
    );
    const [alertas] = await this.db.query<{
      a_terminar: number;
      terminadas: number;
      com_divida: number;
    }>(
      `SELECT
         count(*) FILTER (WHERE concessao = 'temporaria' AND concessao_fim >= current_date
                          AND concessao_fim <= current_date + 180)::int AS a_terminar,
         count(*) FILTER (WHERE concessao = 'temporaria' AND concessao_fim < current_date)::int AS terminadas,
         count(*) FILTER (WHERE conservacao_divida_cent > 0)::int AS com_divida
       FROM sepulturas WHERE municipio_id = $1`,
      [m.id],
    );
    return {
      cemiterios: cemiterios.map((c) => ({
        ...c,
        horario_dito: horarioDito(c.horario),
      })),
      pedidos: Object.fromEntries(contagens.map((c) => [c.estado, c.n])),
      concessoes: alertas,
      taxas: TAXAS_DEMONSTRACAO,
      fonte_taxas: FONTE_TAXAS,
    };
  }

  async sepulturas(m: Municipio, f: z.output<typeof esquemaFiltroSepulturas>) {
    const linhas = await this.db.query<
      LinhaSepultura & {
        inumados: { nome: string; data_falecimento: string | null }[];
      }
    >(
      `SELECT ${COLUNAS_SEPULTURA},
              coalesce((SELECT json_agg(json_build_object('nome', i.nome,
                         'data_falecimento', to_char(i.data_falecimento, 'YYYY-MM-DD'))
                         ORDER BY i.data_falecimento)
                        FROM inumados i WHERE i.sepultura_id = s.id), '[]') AS inumados
       FROM sepulturas s JOIN cemiterios c ON c.id = s.cemiterio_id
       WHERE s.municipio_id = $1
         AND ($2::uuid IS NULL OR s.cemiterio_id = $2)
         AND ($3::text IS NULL
              OR unaccent(lower(coalesce(s.titular_nome, ''))) LIKE '%' || unaccent(lower($3)) || '%'
              OR upper(s.talhao || ' ' || s.numero) LIKE '%' || upper($3) || '%'
              OR EXISTS (SELECT 1 FROM inumados i WHERE i.sepultura_id = s.id
                         AND unaccent(lower(i.nome)) LIKE '%' || unaccent(lower($3)) || '%'))
       ORDER BY c.nome, s.talhao, s.numero
       LIMIT 200`,
      [m.id, f.cemiterio_id ?? null, f.q || null],
    );
    const hoje = hojeLisboa();
    return {
      sepulturas: linhas.map((s) => ({
        ...s,
        estado_concessao: estadoConcessao(s, hoje),
      })),
    };
  }

  async pedidos(
    m: Municipio,
    f: z.output<typeof esquemaFiltroPedidos>,
    limite: number,
    cursor: Cursor | null,
  ) {
    const linhas = await this.db.query<{
      id: string;
      numero: string;
      criado_em: Date;
    }>(
      `SELECT p.id, p.numero, p.tipo, p.referencia, p.requerente_nome, p.relacao,
              p.observacoes, p.telefone, p.canal, p.estado, p.resposta, p.conversa_id,
              p.criado_em, p.atualizado_em, u.nome AS tratado_por_nome,
              CASE WHEN s.id IS NULL THEN NULL
                   ELSE c.nome || ', talhão ' || s.talhao || ', n.º ' || s.numero END AS sepultura
       FROM pedidos_cemiterio p
       LEFT JOIN sepulturas s ON s.id = p.sepultura_id
       LEFT JOIN cemiterios c ON c.id = s.cemiterio_id
       LEFT JOIN utilizadores u ON u.id = p.tratado_por
       WHERE p.municipio_id = $1
         AND ($2::text IS NULL OR p.estado = $2)
         AND ($3::timestamptz IS NULL OR (p.criado_em, p.id) < ($3, $4))
       ORDER BY p.criado_em DESC, p.id DESC
       LIMIT $5`,
      [
        m.id,
        f.estado ?? null,
        cursor?.em ?? null,
        cursor?.id ?? null,
        limite + 1,
      ],
    );
    return pagina(linhas, limite, (l) => ({ em: l.criado_em, id: l.id }));
  }

  async alterarPedido(
    m: Municipio,
    u: UtilizadorPainel,
    id: string,
    d: z.output<typeof esquemaAlterarPedido>,
  ) {
    return this.db.transaction(async (tx) => {
      const [p] = await tx.query<{
        id: string;
        numero: string;
        tipo: (typeof TIPOS_PEDIDO)[number];
        telefone: string | null;
        municipe_id: string | null;
        estado: string;
      }>(
        `SELECT id, numero, tipo, telefone, municipe_id, estado FROM pedidos_cemiterio
         WHERE id = $1 AND municipio_id = $2 FOR UPDATE`,
        [id, m.id],
      );
      if (!p) {
        throw new ErroApi(
          HttpStatus.NOT_FOUND,
          'pedido_nao_encontrado',
          'Este pedido não existe.',
        );
      }
      const fecha = d.estado === 'concluido' || d.estado === 'recusado';
      if (fecha && !d.resposta) {
        throw new ErroApi(
          HttpStatus.BAD_REQUEST,
          'falta_resposta',
          'Escreva a resposta que vai por SMS à pessoa.',
        );
      }
      await tx.query(
        `UPDATE pedidos_cemiterio SET estado = $3, resposta = coalesce($4, resposta),
           tratado_por = $5, atualizado_em = now()
         WHERE id = $1 AND municipio_id = $2`,
        [id, m.id, d.estado, d.resposta ?? null, u.id],
      );
      let smsEnviado = false;
      if (fecha && p.telefone && d.resposta) {
        await this.mensagens.sms(
          {
            municipioId: m.id,
            municipeId: p.municipe_id,
            destino: p.telefone,
            motivo: 'requerimento',
            corpo: `${m.nome}: o seu pedido ${p.numero} (${NOMES_PEDIDO[p.tipo]}) foi ${d.estado === 'concluido' ? 'tratado' : 'recusado'}. ${d.resposta}`,
            relacionado: { pedido_cemiterio_id: p.id },
            chave: `pedido_cemiterio:${p.id}:${d.estado}`,
          },
          tx,
        );
        smsEnviado = true;
      }
      await this.auditoria.registar(
        {
          municipioId: m.id,
          atorTipo: 'utilizador',
          atorId: u.id,
          acao: 'tratar_pedido_cemiterio',
          objetoTipo: 'pedido_cemiterio',
          objetoId: p.id,
          dados: { numero: p.numero, de: p.estado, para: d.estado },
        },
        tx,
      );
      return { id: p.id, estado: d.estado, sms_enviado: smsEnviado };
    });
  }

  // ------------------------------------------------------------------
  // Demonstração
  // ------------------------------------------------------------------

  /** Idempotente: só cria os cemitérios e sepulturas que faltam (por nome/local). */
  async carregarDemonstracao(m: Municipio): Promise<{ criadas: number }> {
    return this.db.transaction(async (tx) => {
      let criadas = 0;
      const ids = new Map<string, string>();
      for (const c of CEMITERIOS_DEMO) {
        const [r] = await tx.query<{ id: string; novo: boolean }>(
          `INSERT INTO cemiterios (municipio_id, nome, freguesia, morada, horario, nota_horario, demonstracao)
           VALUES ($1, $2, $3, $4, $5, $6, true)
           ON CONFLICT (municipio_id, nome) DO UPDATE SET nome = EXCLUDED.nome
           RETURNING id, (xmax = 0) AS novo`,
          [
            m.id,
            c.nome,
            c.freguesia,
            c.morada,
            JSON.stringify(c.horario),
            c.nota_horario,
          ],
        );
        ids.set(c.chave, r.id);
        if (r.novo) criadas++;
      }
      const hoje = hojeLisboa();
      const somar = (dias: number) => {
        const d = new Date(`${hoje}T12:00:00Z`);
        d.setUTCDate(d.getUTCDate() + dias);
        return d.toISOString().slice(0, 10);
      };
      const sepulturas = new Map<string, string>();
      for (const s of SEPULTURAS_DEMO) {
        const cemiterioId = ids.get(s.cemiterio)!;
        const [r] = await tx.query<{ id: string; novo: boolean }>(
          `INSERT INTO sepulturas (municipio_id, cemiterio_id, tipo, talhao, numero, concessao,
             titular_nome, concessao_inicio, concessao_fim, conservacao_divida_cent,
             conservacao_divida_desde, demonstracao)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, true)
           ON CONFLICT (cemiterio_id, talhao, numero) DO UPDATE SET talhao = EXCLUDED.talhao
           RETURNING id, (xmax = 0) AS novo`,
          [
            m.id,
            cemiterioId,
            s.tipo,
            s.talhao,
            s.numero,
            s.concessao,
            s.titular,
            somar(-365 * s.inicio_ha_anos),
            s.fim_em_dias === null ? null : somar(s.fim_em_dias),
            s.divida_cent,
            s.divida_desde,
          ],
        );
        sepulturas.set(`${s.cemiterio}:${s.talhao}:${s.numero}`, r.id);
        if (!r.novo) continue;
        criadas++;
        for (const i of s.inumados) {
          const dia = `${i.ano}-${String(i.mes).padStart(2, '0')}-${String(i.dia).padStart(2, '0')}`;
          await tx.query(
            `INSERT INTO inumados (municipio_id, sepultura_id, nome, data_falecimento,
               data_inumacao, demonstracao)
             VALUES ($1, $2, $3, $4, $4::date + 2, true)`,
            [m.id, r.id, i.nome, dia],
          );
        }
      }
      // Dois pedidos para o painel não abrir vazio (só na primeira vez).
      const [{ n }] = await tx.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM pedidos_cemiterio WHERE municipio_id = $1`,
        [m.id],
      );
      if (n === 0) {
        const ano = new Date().getFullYear();
        const pedidos: [string, string, string, string, string][] = [
          [
            'renovacao',
            'central:3:120',
            'Talhão 3, sepultura 120',
            'Maria Exemplo Fernandes',
            'recebido',
          ],
          [
            'averbamento',
            'azurem:A:7',
            'Gavetão 7 do talhão A, em Azurém',
            'Paulo Fictício Lopes',
            'em_analise',
          ],
        ];
        for (const [tipo, chave, referencia, nome, estado] of pedidos) {
          const numero = formatarNumero(
            'CM',
            ano,
            await proximoNumero(tx, m.id, 'CM', ano),
          );
          await tx.query(
            `INSERT INTO pedidos_cemiterio (municipio_id, numero, tipo, sepultura_id, referencia,
               requerente_nome, relacao, canal, estado)
             VALUES ($1, $2, $3, $4, $5, $6, $7, 'telefone', $8)`,
            [
              m.id,
              numero,
              tipo,
              sepulturas.get(chave) ?? null,
              referencia,
              nome,
              tipo === 'averbamento' ? 'filho do titular' : 'titular',
              estado,
            ],
          );
        }
      }
      return { criadas };
    });
  }
}
