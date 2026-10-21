import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomInt } from 'crypto';
import { z } from 'zod';
import { ErroApi } from '../../common/erros.js';
import { proximoNumero } from '../../common/numeracao.js';
import type { UtilizadorPainel } from '../../common/pedido.js';
import { DatabaseService, Tx } from '../../database/database.service.js';
import type { ContextoFerramenta } from '../../ferramentas/ferramenta.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { CampanhasService } from '../campanhas/campanhas.service.js';
import type { AlvoCampanha } from '../campanhas/campanhas.service.js';
import { telefoneLigavel } from '../chamadas-saida/regras.js';
import { LinksCurtosService } from '../comunicacao/links-curtos.service.js';
import { MensagensService } from '../comunicacao/mensagens.service.js';
import { ConversasService } from '../conversas/conversas.service.js';
import {
  MunicipesService,
  mascararTelefone,
  normalizarTelefone,
} from '../municipes/municipes.service.js';
import type { Municipio } from '../municipios/municipios.service.js';
import {
  APOIOS_DEMONSTRACAO,
  AvaliacaoApoio,
  avaliarApoios,
  Campo,
  Criterios,
  DadosApoio,
  ESCALOES,
  esquemaApoio,
  Fonte,
  juntarPerfis,
  listaDita,
  Perfil,
  PERGUNTAS,
  perfilGuardado,
  Resultado,
} from './regras.js';

// ---------------------------------------------------------------------
// Entradas
// ---------------------------------------------------------------------

export const entradaQueApoiosTenho = z.object({
  residente_concelho: z
    .boolean()
    .optional()
    .describe('true se a pessoa mora no concelho.'),
  idade: z
    .number()
    .int()
    .min(0)
    .max(120)
    .optional()
    .describe('A idade de quem pede, em anos.'),
  pessoas_agregado: z
    .number()
    .int()
    .min(1)
    .max(30)
    .optional()
    .describe('Quantas pessoas vivem em casa, contando com a própria.'),
  rendimento_mensal_agregado: z
    .number()
    .min(0)
    .max(100_000)
    .optional()
    .describe(
      'Quanto entra por mês em casa, somando todas as pessoas, em euros (aproximado chega). Não é guardado: só o escalão.',
    ),
  filhos_idades: z
    .array(z.number().int().min(0).max(30))
    .max(15)
    .optional()
    .describe(
      'As idades dos filhos a cargo, em anos (um bebé com menos de 1 ano é 0). [] se não tem filhos a cargo.',
    ),
  inquilino: z
    .boolean()
    .optional()
    .describe('true se a casa onde vive é arrendada.'),
  aceita_contacto: z
    .boolean()
    .optional()
    .describe(
      'true se a pessoa disse que aceita que a câmara lhe volte a ligar sobre estes apoios.',
    ),
  fim: z
    .boolean()
    .optional()
    .describe(
      'true quando a pessoa não quer responder a mais perguntas: manda a lista por SMS com o que já se sabe.',
    ),
});
type EntradaQueApoios = z.output<typeof entradaQueApoiosTenho>;

export const entradaPedirApoio = z.object({
  apoio: z
    .string()
    .trim()
    .min(3)
    .max(41)
    .describe(
      'O código do apoio, como veio em que_apoios_tenho (ex.: "apoio_renda").',
    ),
  nome: z
    .string()
    .trim()
    .max(120)
    .optional()
    .describe('O nome de quem pede, se ainda não o disse.'),
});

export const esquemaPedirPublico = z.object({
  apoio: z.string().trim().min(3).max(41),
});

export const esquemaApoioPainel = esquemaApoio;
export const esquemaApoioEditar = esquemaApoio.omit({ codigo: true });

export const esquemaCampanhaApoio = z.object({
  /** De onde vem a lista: as consultas ("tem direito" e não pediu) ou a lista da ação social. */
  origem: z.enum(['consultas', 'contactos_cuidado']),
  mensagem: z.string().trim().min(10).max(600).optional(),
  perguntas: z
    .array(z.string().trim().min(3).max(200))
    .min(1)
    .max(5)
    .optional(),
  sms_recurso: z.string().trim().min(10).max(320).optional(),
  ignorar_horario: z.boolean().default(false),
});

// ---------------------------------------------------------------------

export interface ApoioLinha {
  id: string;
  codigo: string;
  nome: string;
  resumo: string;
  valor: string | null;
  quem_pode: string;
  criterios: Criterios;
  documentos: string[];
  como_pedir: string;
  fonte: Fonte;
  demonstracao: boolean;
  ativo: boolean;
  ordem: number;
  atualizado_em: Date;
  atualizado_por_nome?: string | null;
}

interface ResultadoGuardado extends AvaliacaoApoio {
  apoio_id: string;
}

interface Consulta {
  id: string;
  municipio_id: string;
  conversa_id: string | null;
  municipe_id: string | null;
  canal: string;
  perfil: ReturnType<typeof perfilGuardado>;
  resultados: ResultadoGuardado[];
  aceita_contacto: boolean;
  codigo: string;
  criada_em: Date;
}

const COLUNAS_APOIO = `a.id, a.codigo, a.nome, a.resumo, a.valor, a.quem_pode, a.criterios,
  a.documentos, a.como_pedir, a.fonte, a.demonstracao, a.ativo, a.ordem, a.atualizado_em`;

const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const ROTULO_RESULTADO: Record<Resultado, string> = {
  tem_direito: 'tem direito',
  talvez: 'talvez',
  nao: 'não tem direito',
};

/** Fases em que o pedido já acabou (pode pedir outra vez). */
const FASES_FECHADAS = ['notificado', 'arquivado'];

/**
 * "Tem direito a isto e ainda não pediu": o catálogo de apoios da câmara,
 * a ferramenta que diz a que apoios a pessoa pode ter direito, o pedido
 * (um processo 'APS') e a campanha "ligar a quem pode ter direito".
 */
@Injectable()
export class ApoiosService {
  constructor(
    private readonly db: DatabaseService,
    private readonly config: ConfigService,
    private readonly municipes: MunicipesService,
    private readonly mensagens: MensagensService,
    private readonly links: LinksCurtosService,
    private readonly conversas: ConversasService,
    private readonly campanhas: CampanhasService,
    private readonly auditoria: AuditoriaService,
  ) {}

  async catalogo(
    municipioId: string,
    soAtivos = true,
    q: Pick<Tx, 'query'> = this.db,
  ): Promise<ApoioLinha[]> {
    return q.query<ApoioLinha>(
      `SELECT ${COLUNAS_APOIO}, u.nome AS atualizado_por_nome
       FROM apoios a LEFT JOIN utilizadores u ON u.id = a.atualizado_por
       WHERE a.municipio_id = $1 AND (NOT $2 OR a.ativo)
       ORDER BY a.ordem, a.nome`,
      [municipioId, soAtivos],
    );
  }

  // ------------------------------------------------------------------
  // Ferramentas do agente
  // ------------------------------------------------------------------

  async queApoiosTenho(ctx: ContextoFerramenta, e: EntradaQueApoios) {
    const m = ctx.municipio;
    const apoios = await this.catalogo(m.id);
    if (apoios.length === 0) {
      return {
        respondido: false,
        motivo: 'sem_catalogo',
        dizer:
          'Ainda não tenho a lista de apoios da câmara. Procure com procurar_conhecimento ou passe à ação social.',
      };
    }
    const telefone = normalizarTelefone(ctx.telefone);
    const { fim, aceita_contacto, ...dito } = e;

    const r = await this.db.transaction(async (tx) => {
      const anterior = ctx.conversaId
        ? (
            await tx.query<Consulta>(
              `SELECT * FROM consultas_apoios WHERE conversa_id = $1 FOR UPDATE`,
              [ctx.conversaId],
            )
          )[0]
        : undefined;
      // O rendimento exato não fica guardado: o agente volta a mandá-lo.
      const perfil = juntarPerfis(
        anterior ? perfilDeGuardado(anterior.perfil) : {},
        dito,
      );
      const av = avaliarApoios(perfil, apoios);
      const porCodigo = new Map(apoios.map((a) => [a.codigo, a]));
      const resultados: ResultadoGuardado[] = [
        ...av.tem_direito,
        ...av.talvez,
        ...av.nao,
      ].map((x) => ({ ...x, apoio_id: porCodigo.get(x.codigo)!.id }));
      const municipeId =
        ctx.municipeId ??
        (await this.municipes.porTelefone(m.id, telefone, tx))?.id ??
        null;
      const aceita = aceita_contacto ?? anterior?.aceita_contacto ?? false;
      const guardado = perfilGuardado(perfil);
      let consulta: { id: string; codigo: string };
      if (anterior) {
        await tx.query(
          `UPDATE consultas_apoios SET perfil = $2, resultados = $3, tem_direito = $4, talvez = $5,
             aceita_contacto = $6, municipe_id = coalesce(municipe_id, $7), atualizada_em = now()
           WHERE id = $1`,
          [
            anterior.id,
            JSON.stringify(guardado),
            JSON.stringify(resultados),
            av.tem_direito.map((x) => x.codigo),
            av.talvez.map((x) => x.codigo),
            aceita,
            municipeId,
          ],
        );
        consulta = { id: anterior.id, codigo: anterior.codigo };
      } else {
        const codigo = gerarCodigo();
        const [c] = await tx.query<{ id: string }>(
          `INSERT INTO consultas_apoios (municipio_id, conversa_id, municipe_id, canal, perfil, resultados,
             tem_direito, talvez, aceita_contacto, codigo)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
          [
            m.id,
            ctx.conversaId,
            municipeId,
            ctx.canal,
            JSON.stringify(guardado),
            JSON.stringify(resultados),
            av.tem_direito.map((x) => x.codigo),
            av.talvez.map((x) => x.codigo),
            aceita,
            codigo,
          ],
        );
        consulta = { id: c.id, codigo };
        await this.conversas.momento(
          ctx.conversaId,
          'resposta_com_fonte',
          { consulta_apoios: codigo },
          tx,
        );
      }

      const perguntar = fim ? [] : av.falta_saber;
      const algum = av.tem_direito.length + av.talvez.length > 0;
      // A lista segue por SMS quando já não há nada a perguntar (ou a pessoa
      // não quer responder a mais) e há algum apoio a mostrar. Uma vez por
      // consulta: a página mostra sempre o resultado mais recente.
      let smsEnviado = false;
      if (telefone && algum && perguntar.length === 0) {
        await this.mensagens.sms(
          {
            municipioId: m.id,
            municipeId,
            destino: telefone,
            motivo: 'apoio',
            corpo: `${m.nome}: apoios a que pode ter direito e o que entregar: ${this.url(consulta.codigo)}`,
            relacionado: {
              consulta_apoios: consulta.id,
              ...(ctx.conversaId ? { conversa_id: ctx.conversaId } : {}),
            },
            chave: `apoios:${consulta.id}`,
          },
          tx,
        );
        smsEnviado = true;
      }
      return { av, perguntar, consulta, smsEnviado };
    });

    const { av, perguntar } = r;
    const porCodigo = new Map(apoios.map((a) => [a.codigo, a]));
    const demonstracao = apoios.some((a) => a.demonstracao);
    const nomes = (l: AvaliacaoApoio[]) => l.map((x) => x.nome);
    const proximas = perguntar.slice(0, 2).map((p) => p.pergunta);

    let dizer: string;
    if (perguntar.length > 0) {
      dizer =
        (av.tem_direito.length
          ? `Pelo que me disse, já vejo que pode ter direito a: ${listaDita(nomes(av.tem_direito))}. `
          : '') +
        `Para ver os outros apoios, preciso de saber: ${proximas.join(' ')}`;
    } else if (av.tem_direito.length || av.talvez.length) {
      dizer =
        (av.tem_direito.length
          ? `Pelo que me disse, pode ter direito a: ${listaDita(nomes(av.tem_direito))}. `
          : '') +
        (av.talvez.length
          ? `Talvez também a: ${listaDita(nomes(av.talvez))}, mas falta confirmar alguns dados. `
          : '') +
        (r.smsEnviado
          ? 'Mandei-lhe por SMS a lista, com os documentos a entregar para cada um. '
          : '') +
        'Quer que trate já do pedido de algum?' +
        (demonstracao ? ' (Os critérios são de demonstração.)' : '');
    } else {
      dizer =
        'Pelo que me disse, não encontrei nenhum apoio da câmara a que tenha direito. A ação social pode ver o seu caso com mais calma, se quiser.';
    }

    return {
      respondido: perguntar.length === 0,
      tem_direito: av.tem_direito.map((x) => ({
        apoio: x.codigo,
        nome: x.nome,
        resumo: porCodigo.get(x.codigo)?.resumo,
        valor: porCodigo.get(x.codigo)?.valor,
        porque: x.porque,
      })),
      talvez: av.talvez.map((x) => ({
        apoio: x.codigo,
        nome: x.nome,
        falta_saber: x.falta.map((c) => PERGUNTAS[c]),
      })),
      nao_tem: nomes(av.nao),
      perguntar_a_seguir: proximas,
      sms_enviado: r.smsEnviado,
      link: this.url(r.consulta.codigo),
      valores_de_demonstracao: demonstracao,
      dizer,
    };
  }

  async pedirApoio(
    ctx: ContextoFerramenta,
    e: z.output<typeof entradaPedirApoio>,
  ) {
    const m = ctx.municipio;
    const telefone = normalizarTelefone(ctx.telefone);
    if (!ctx.municipeId && !telefone) {
      return {
        pedido: false,
        motivo: 'precisa_identificacao',
        instrucao:
          ctx.canal === 'chat'
            ? 'Para fazer o pedido a pessoa tem de se identificar no chat com o número de telemóvel (recebe um código por SMS). Depois chama outra vez.'
            : 'Não há um número para onde mandar o pedido. Pede o número de telemóvel e usa identificar_municipe, ou passa à ação social.',
      };
    }
    const apoio = (await this.catalogo(m.id)).find(
      (a) => a.codigo === e.apoio.trim().toLowerCase(),
    );
    if (!apoio) {
      return {
        pedido: false,
        motivo: 'apoio_desconhecido',
        instrucao:
          'Esse apoio não existe. Usa o código que veio em que_apoios_tenho.',
      };
    }
    const r = await this.db.transaction(async (tx) => {
      const municipeId =
        ctx.municipeId ??
        (await this.municipes.porTelefone(m.id, telefone, tx))!.id;
      if (e.nome) {
        await tx.query(
          'UPDATE municipes SET nome = coalesce(nome, $2) WHERE id = $1',
          [municipeId, e.nome],
        );
      }
      const [consulta] = ctx.conversaId
        ? await tx.query<Consulta>(
            'SELECT * FROM consultas_apoios WHERE conversa_id = $1',
            [ctx.conversaId],
          )
        : await tx.query<Consulta>(
            `SELECT * FROM consultas_apoios WHERE municipe_id = $1
             ORDER BY criada_em DESC LIMIT 1`,
            [municipeId],
          );
      return this.criarPedido(tx, m, {
        apoio,
        municipeId,
        consulta: consulta ?? null,
        origem:
          ctx.canal === 'telefone' && (await this.emCampanha(tx, ctx))
            ? 'campanha'
            : 'agente',
        conversaId: ctx.conversaId,
        atorTipo: 'agente',
      });
    });
    return {
      pedido: true,
      ja_existia: r.ja_existia,
      numero: r.numero,
      documentos: apoio.documentos,
      sms_enviado: r.sms_enviado,
      dizer: r.ja_existia
        ? `Já tem um pedido de ${apoio.nome} em curso, com o número ${r.numero}. Pode acompanhá-lo pelo link que recebeu por SMS.`
        : `Fiz o pedido de ${apoio.nome}, com o número ${r.numero}. ` +
          (apoio.documentos.length
            ? `Para avançar, a ação social precisa de: ${listaDita(apoio.documentos.map((d) => d.toLowerCase()))}. `
            : '') +
          (r.sms_enviado
            ? 'Mandei-lhe por SMS o número do pedido e o link para o acompanhar.'
            : ''),
    };
  }

  // ------------------------------------------------------------------
  // Público (o link do SMS)
  // ------------------------------------------------------------------

  async publico(codigo: string) {
    const c = await this.consultaPorCodigo(codigo);
    const [apoios, pedidos, municipio] = await Promise.all([
      this.catalogo(c.municipio_id, false),
      this.pedidosDe(c),
      this.db.query<{ nome: string }>(
        'SELECT nome FROM municipios WHERE id = $1',
        [c.municipio_id],
      ),
    ]);
    const porId = new Map(apoios.map((a) => [a.id, a]));
    const linha = (x: ResultadoGuardado) => {
      const a = porId.get(x.apoio_id);
      const p = pedidos.get(x.apoio_id);
      return {
        apoio: x.codigo,
        nome: a?.nome ?? x.nome,
        resultado: x.resultado,
        porque: x.porque,
        falta_saber: x.falta.map((f) => PERGUNTAS[f]),
        resumo: a?.resumo ?? null,
        valor: a?.valor ?? null,
        quem_pode: a?.quem_pode ?? null,
        documentos: a?.documentos ?? [],
        como_pedir: a?.como_pedir ?? null,
        fonte: a?.fonte ?? null,
        demonstracao: a?.demonstracao ?? false,
        pedido: p ?? null,
        pode_pedir: !!a?.ativo && !!c.municipe_id && !p,
      };
    };
    const visiveis = c.resultados.filter((x) => porId.get(x.apoio_id)?.ativo);
    return {
      municipio: municipio[0]?.nome ?? '',
      criada_em: c.criada_em.toISOString(),
      tem_direito: visiveis
        .filter((x) => x.resultado === 'tem_direito')
        .map(linha),
      talvez: visiveis.filter((x) => x.resultado === 'talvez').map(linha),
      nao: visiveis
        .filter((x) => x.resultado === 'nao')
        .map((x) => ({ apoio: x.codigo, nome: x.nome, porque: x.porque })),
      identificado: !!c.municipe_id,
      demonstracao: apoios.some((a) => a.demonstracao),
    };
  }

  async pedirPublico(codigo: string, apoioCodigo: string) {
    const c = await this.consultaPorCodigo(codigo);
    if (!c.municipe_id) {
      throw new ErroApi(
        HttpStatus.CONFLICT,
        'precisa_identificacao',
        'Para pedir, ligue para a câmara ou fale connosco no chat com o seu número de telemóvel.',
      );
    }
    const r = c.resultados.find((x) => x.codigo === apoioCodigo);
    if (!r || r.resultado === 'nao') {
      throw new ErroApi(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'apoio_fora_da_lista',
        'Este apoio não está na sua lista. Fale com a ação social.',
      );
    }
    const apoio = (await this.catalogo(c.municipio_id)).find(
      (a) => a.id === r.apoio_id,
    );
    if (!apoio) {
      throw new ErroApi(
        HttpStatus.NOT_FOUND,
        'apoio_desconhecido',
        'Este apoio já não está disponível.',
      );
    }
    const [municipio] = await this.db.query<Municipio>(
      'SELECT * FROM municipios WHERE id = $1',
      [c.municipio_id],
    );
    await this.db.transaction((tx) =>
      this.criarPedido(tx, municipio, {
        apoio,
        municipeId: c.municipe_id!,
        consulta: c,
        origem: 'pagina',
        conversaId: c.conversa_id,
        atorTipo: 'municipe',
      }),
    );
    return this.publico(codigo);
  }

  // ------------------------------------------------------------------
  // Painel
  // ------------------------------------------------------------------

  async painel(m: Municipio) {
    const [apoios, porApoio, consultas, campanhas, [totais]] =
      await Promise.all([
        this.catalogo(m.id, false),
        this.db.query<{
          apoio_id: string;
          tem_direito: number;
          talvez: number;
          pedidos: number;
          sem_pedido: number;
          sem_pedido_contactaveis: number;
        }>(
          `WITH ultima AS (
             -- A consulta mais recente de cada pessoa (ou cada consulta anónima).
             SELECT DISTINCT ON (coalesce(c.municipe_id, c.id)) c.*
             FROM consultas_apoios c WHERE c.municipio_id = $1
             ORDER BY coalesce(c.municipe_id, c.id), c.atualizada_em DESC
           )
           SELECT a.id AS apoio_id,
             (SELECT count(*) FROM ultima u WHERE a.codigo = ANY(u.tem_direito))::int AS tem_direito,
             (SELECT count(*) FROM ultima u WHERE a.codigo = ANY(u.talvez))::int AS talvez,
             (SELECT count(*) FROM pedidos_apoio p WHERE p.apoio_id = a.id)::int AS pedidos,
             (SELECT count(*) FROM ultima u WHERE a.codigo = ANY(u.tem_direito)
                AND NOT EXISTS (SELECT 1 FROM pedidos_apoio p
                                WHERE p.apoio_id = a.id AND p.municipe_id = u.municipe_id))::int AS sem_pedido,
             (SELECT count(*) FROM ultima u JOIN municipes mu ON mu.id = u.municipe_id
              WHERE a.codigo = ANY(u.tem_direito) AND u.aceita_contacto AND mu.aceita_chamadas
                AND mu.anonimizado_em IS NULL AND mu.telefone_e164 IS NOT NULL
                AND NOT EXISTS (SELECT 1 FROM pedidos_apoio p
                                WHERE p.apoio_id = a.id AND p.municipe_id = u.municipe_id))::int
               AS sem_pedido_contactaveis
           FROM apoios a WHERE a.municipio_id = $1`,
          [m.id],
        ),
        this.db.query<{
          id: string;
          canal: string;
          criada_em: Date;
          atualizada_em: Date;
          tem_direito: string[];
          talvez: string[];
          aceita_contacto: boolean;
          perfil: ReturnType<typeof perfilGuardado>;
          telefone: string | null;
          nome: string | null;
          pedidos: string[];
          conversa_id: string | null;
        }>(
          `SELECT c.id, c.canal, c.criada_em, c.atualizada_em, c.tem_direito, c.talvez,
                  c.aceita_contacto, c.perfil, mu.telefone_e164 AS telefone, mu.nome, c.conversa_id,
                  coalesce((SELECT array_agg(a.codigo) FROM pedidos_apoio p JOIN apoios a ON a.id = p.apoio_id
                            WHERE p.municipe_id = c.municipe_id), '{}') AS pedidos
           FROM consultas_apoios c LEFT JOIN municipes mu ON mu.id = c.municipe_id
           WHERE c.municipio_id = $1
           ORDER BY c.atualizada_em DESC LIMIT 100`,
          [m.id],
        ),
        this.db.query<{
          id: string;
          titulo: string;
          estado: string;
          criada_em: Date;
          apoio_id: string;
          origem: string;
          destinatarios: number;
        }>(
          `SELECT c.id, c.titulo, c.estado, c.criada_em, ac.apoio_id, ac.origem,
                  (SELECT count(*) FROM campanha_destinatarios d WHERE d.campanha_id = c.id)::int AS destinatarios
           FROM apoio_campanhas ac JOIN campanhas c ON c.id = ac.campanha_id
           WHERE c.municipio_id = $1 ORDER BY c.criada_em DESC LIMIT 20`,
          [m.id],
        ),
        this.db.query<{
          consultas: number;
          pessoas: number;
          com_direito_sem_pedido: number;
          pedidos: number;
        }>(
          `SELECT
             (SELECT count(*) FROM consultas_apoios WHERE municipio_id = $1)::int AS consultas,
             (SELECT count(DISTINCT coalesce(municipe_id, id)) FROM consultas_apoios WHERE municipio_id = $1)::int AS pessoas,
             (SELECT count(DISTINCT c.municipe_id) FROM consultas_apoios c JOIN apoios a
                ON a.municipio_id = c.municipio_id AND a.codigo = ANY(c.tem_direito)
              WHERE c.municipio_id = $1 AND NOT EXISTS (
                SELECT 1 FROM pedidos_apoio p WHERE p.apoio_id = a.id AND p.municipe_id = c.municipe_id))::int
               AS com_direito_sem_pedido,
             (SELECT count(*) FROM pedidos_apoio WHERE municipio_id = $1)::int AS pedidos`,
          [m.id],
        ),
      ]);
    const stats = new Map(porApoio.map((x) => [x.apoio_id, x]));
    const nomeDe = new Map(apoios.map((a) => [a.codigo, a.nome]));
    const nomeId = new Map(apoios.map((a) => [a.id, a.nome]));
    return {
      apoios: apoios.map((a) => ({
        ...a,
        atualizado_em: a.atualizado_em.toISOString(),
        numeros: stats.get(a.id) ?? {
          tem_direito: 0,
          talvez: 0,
          pedidos: 0,
          sem_pedido: 0,
          sem_pedido_contactaveis: 0,
        },
      })),
      totais,
      consultas: consultas.map((c) => ({
        id: c.id,
        canal: c.canal,
        criada_em: c.criada_em.toISOString(),
        atualizada_em: c.atualizada_em.toISOString(),
        conversa_id: c.conversa_id,
        quem: c.nome ?? mascararTelefone(c.telefone),
        telefone: mascararTelefone(c.telefone),
        aceita_contacto: c.aceita_contacto,
        perfil: resumoPerfil(c.perfil),
        tem_direito: c.tem_direito.map((x) => nomeDe.get(x) ?? x),
        talvez: c.talvez.map((x) => nomeDe.get(x) ?? x),
        sem_pedido: c.tem_direito
          .filter((x) => !c.pedidos.includes(x))
          .map((x) => nomeDe.get(x) ?? x),
        pedidos: c.pedidos.map((x) => nomeDe.get(x) ?? x),
      })),
      campanhas: campanhas.map((c) => ({
        ...c,
        apoio: nomeId.get(c.apoio_id) ?? null,
        criada_em: c.criada_em.toISOString(),
      })),
      // De onde vêm as listas para ligar (para o ecrã dizer).
      fontes_da_lista: {
        consultas:
          'Pessoas que perguntaram ao agente, cujas respostas deram "tem direito", que ainda não pediram o apoio e que aceitaram que a câmara lhes voltasse a ligar.',
        contactos_cuidado:
          'A lista de pessoas inscritas na ação social (com autorização para receberem chamadas). Não sabemos se têm direito: o agente faz as perguntas na chamada.',
        nota: 'A câmara não tem rendimentos nem idades na base de dados: as listas vêm só do que as pessoas disseram ao agente ou da lista da ação social.',
      },
    };
  }

  async criar(m: Municipio, u: UtilizadorPainel, d: DadosApoio) {
    const [existe] = await this.db.query(
      'SELECT 1 FROM apoios WHERE municipio_id = $1 AND codigo = $2',
      [m.id, d.codigo],
    );
    if (existe) {
      throw new ErroApi(
        HttpStatus.CONFLICT,
        'codigo_repetido',
        'Já existe um apoio com este código.',
      );
    }
    const id = await this.db.transaction(async (tx) => {
      const id = await this.inserir(tx, m.id, d, u.id);
      await this.auditoria.registar(
        {
          municipioId: m.id,
          atorTipo: 'utilizador',
          atorId: u.id,
          acao: 'criar_apoio',
          objetoTipo: 'apoio',
          objetoId: id,
          dados: { codigo: d.codigo },
        },
        tx,
      );
      return id;
    });
    return this.apoio(m.id, id);
  }

  async editar(
    m: Municipio,
    u: UtilizadorPainel,
    id: string,
    d: z.output<typeof esquemaApoioEditar>,
  ) {
    const [a] = await this.db.query<{ id: string }>(
      `UPDATE apoios SET nome = $3, resumo = $4, valor = $5, quem_pode = $6, criterios = $7,
         documentos = $8, como_pedir = $9, fonte = $10, demonstracao = $11, ativo = $12,
         atualizado_por = $13, atualizado_em = now()
       WHERE id = $1 AND municipio_id = $2 RETURNING id`,
      [
        id,
        m.id,
        d.nome,
        d.resumo,
        d.valor,
        d.quem_pode,
        JSON.stringify(d.criterios),
        JSON.stringify(d.documentos),
        d.como_pedir,
        JSON.stringify(d.fonte),
        d.demonstracao,
        d.ativo,
        u.id,
      ],
    );
    if (!a) throw apoioDesconhecido();
    await this.auditoria.registar({
      municipioId: m.id,
      atorTipo: 'utilizador',
      atorId: u.id,
      acao: 'mudar_apoio',
      objetoTipo: 'apoio',
      objetoId: id,
      dados: { criterios: d.criterios, ativo: d.ativo },
    });
    return this.apoio(m.id, id);
  }

  /** Carrega os apoios de demonstração (só se o município ainda não tiver apoios). */
  async carregarDemonstracao(m: Municipio, u: UtilizadorPainel) {
    const existentes = await this.catalogo(m.id, false);
    if (existentes.length) {
      throw new ErroApi(
        HttpStatus.CONFLICT,
        'ja_tem_apoios',
        'Este município já tem apoios no catálogo.',
      );
    }
    await this.db.transaction(async (tx) => {
      for (const [i, a] of APOIOS_DEMONSTRACAO.entries()) {
        await this.inserir(tx, m.id, a, u.id, i);
      }
      await this.auditoria.registar(
        {
          municipioId: m.id,
          atorTipo: 'utilizador',
          atorId: u.id,
          acao: 'carregar_apoios_demonstracao',
          objetoTipo: 'apoios',
          objetoId: m.id,
        },
        tx,
      );
    });
    return this.painel(m);
  }

  /** Quantas pessoas a campanha teria (antes de carregar no botão). */
  async preVisualizarCampanha(
    m: Municipio,
    id: string,
    origem: 'consultas' | 'contactos_cuidado',
  ) {
    const apoio = await this.apoio(m.id, id);
    const alvo = await this.alvoCampanha(this.db, m, apoio, origem);
    const ligaveis = alvo.filter(
      (a) => telefoneLigavel(a.telefone) && a.aceita_chamadas,
    );
    return {
      origem,
      destinatarios: alvo.length,
      a_ligar: ligaveis.length,
      minutos_estimados: Math.max(1, Math.ceil(ligaveis.length / 20)),
      ...textosCampanha(m, apoio, origem),
    };
  }

  /** "Ligar a quem pode ter direito": uma campanha do módulo campanhas. */
  async lancarCampanha(
    m: Municipio,
    u: UtilizadorPainel,
    id: string,
    d: z.output<typeof esquemaCampanhaApoio>,
  ) {
    const apoio = await this.apoio(m.id, id);
    if (!apoio.ativo) {
      throw new ErroApi(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'apoio_inativo',
        'Este apoio está desligado.',
      );
    }
    return this.db.transaction(async (tx) => {
      const alvo = await this.alvoCampanha(tx, m, apoio, d.origem);
      if (alvo.length === 0) {
        throw new ErroApi(
          HttpStatus.UNPROCESSABLE_ENTITY,
          'sem_destinatarios',
          d.origem === 'consultas'
            ? 'Não há ninguém que tenha direito, não tenha pedido e tenha aceitado que lhe liguem.'
            : 'Não há pessoas inscritas na lista da ação social.',
        );
      }
      const t = textosCampanha(m, apoio, d.origem);
      const r = await this.campanhas.lancar(
        tx,
        m,
        u,
        {
          tipo: 'outro',
          titulo: `Apoios: ${apoio.nome}`.slice(0, 120),
          mensagem: d.mensagem ?? t.mensagem,
          perguntas: d.perguntas ?? t.perguntas,
          sms_recurso: d.sms_recurso ?? t.sms_recurso,
          freguesias: undefined,
          ignorar_horario: d.ignorar_horario,
        },
        alvo,
      );
      await tx.query(
        `INSERT INTO apoio_campanhas (campanha_id, apoio_id, origem) VALUES ($1, $2, $3)`,
        [r.id, apoio.id, d.origem],
      );
      await this.auditoria.registar(
        {
          municipioId: m.id,
          atorTipo: 'utilizador',
          atorId: u.id,
          acao: 'ligar_quem_tem_direito',
          objetoTipo: 'apoio',
          objetoId: apoio.id,
          dados: {
            campanha_id: r.id,
            origem: d.origem,
            destinatarios: r.destinatarios,
          },
        },
        tx,
      );
      return { ...r, campanha_id: r.id, origem: d.origem };
    });
  }

  // ------------------------------------------------------------------

  private async apoio(municipioId: string, id: string): Promise<ApoioLinha> {
    const [a] = await this.db.query<ApoioLinha>(
      `SELECT ${COLUNAS_APOIO} FROM apoios a WHERE a.id = $1 AND a.municipio_id = $2`,
      [id, municipioId],
    );
    if (!a) throw apoioDesconhecido();
    return a;
  }

  private async inserir(
    tx: Tx,
    municipioId: string,
    d: DadosApoio,
    utilizadorId: string,
    ordem = 100,
  ): Promise<string> {
    const [a] = await tx.query<{ id: string }>(
      `INSERT INTO apoios (municipio_id, codigo, nome, resumo, valor, quem_pode, criterios, documentos,
         como_pedir, fonte, demonstracao, ativo, ordem, atualizado_por)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING id`,
      [
        municipioId,
        d.codigo,
        d.nome,
        d.resumo,
        d.valor,
        d.quem_pode,
        JSON.stringify(d.criterios),
        JSON.stringify(d.documentos),
        d.como_pedir,
        JSON.stringify(d.fonte),
        d.demonstracao,
        d.ativo,
        ordem,
        utilizadorId,
      ],
    );
    return a.id;
  }

  /** As pessoas a quem ligar, com o contexto de cada uma para o agente. */
  private async alvoCampanha(
    q: Pick<Tx, 'query'>,
    m: Municipio,
    apoio: ApoioLinha,
    origem: 'consultas' | 'contactos_cuidado',
  ): Promise<AlvoCampanha[]> {
    if (origem === 'contactos_cuidado') {
      const l = await q.query<{
        contacto_id: string;
        municipe_id: string;
        telefone: string | null;
        aceita_chamadas: boolean;
      }>(
        `SELECT c.id AS contacto_id, c.municipe_id, mu.telefone_e164 AS telefone, mu.aceita_chamadas
         FROM contactos_cuidado c JOIN municipes mu ON mu.id = c.municipe_id
         WHERE c.municipio_id = $1 AND c.ativo AND mu.anonimizado_em IS NULL
           AND NOT EXISTS (SELECT 1 FROM pedidos_apoio p WHERE p.apoio_id = $2 AND p.municipe_id = c.municipe_id)
         ORDER BY c.nome`,
        [m.id, apoio.id],
      );
      return l.map((x) => ({
        ...x,
        nota:
          `A câmara liga para dar a conhecer o apoio "${apoio.nome}" (código ${apoio.codigo}). Não sabemos se esta pessoa tem direito: ` +
          'faz as perguntas com que_apoios_tenho e, se tiver direito e quiser, faz o pedido com pedir_apoio.',
      }));
    }
    const l = await q.query<{
      municipe_id: string;
      telefone: string | null;
      aceita_chamadas: boolean;
      codigo: string;
      criada_em: Date;
    }>(
      `SELECT DISTINCT ON (c.municipe_id) c.municipe_id, mu.telefone_e164 AS telefone,
              mu.aceita_chamadas, c.codigo, c.criada_em
       FROM consultas_apoios c JOIN municipes mu ON mu.id = c.municipe_id
       WHERE c.municipio_id = $1 AND $2 = ANY(c.tem_direito) AND c.aceita_contacto
         AND mu.anonimizado_em IS NULL
         AND NOT EXISTS (SELECT 1 FROM pedidos_apoio p WHERE p.apoio_id = $3 AND p.municipe_id = c.municipe_id)
         -- Não volta a ligar a quem já está numa campanha deste apoio.
         AND NOT EXISTS (SELECT 1 FROM campanha_destinatarios d
                         JOIN apoio_campanhas ac ON ac.campanha_id = d.campanha_id
                         WHERE ac.apoio_id = $3 AND d.municipe_id = c.municipe_id
                           AND d.estado NOT IN ('cancelado'))
       ORDER BY c.municipe_id, c.atualizada_em DESC`,
      [m.id, apoio.codigo, apoio.id],
    );
    return l.map((x) => ({
      contacto_id: null,
      municipe_id: x.municipe_id,
      telefone: x.telefone,
      aceita_chamadas: x.aceita_chamadas,
      link: this.url(x.codigo),
      nota:
        `Em ${diaCurto(x.criada_em)} esta pessoa perguntou ao agente pelos apoios e, pelo que disse, tem direito ao "${apoio.nome}" (código ${apoio.codigo}), mas ainda não o pediu. ` +
        `Se quiser pedir, usa pedir_apoio com apoio="${apoio.codigo}".`,
    }));
  }

  /** Cria o pedido: um processo 'APS', com os documentos a entregar e o SMS. */
  private async criarPedido(
    tx: Tx,
    m: Municipio,
    p: {
      apoio: ApoioLinha;
      municipeId: string;
      consulta: Consulta | null;
      origem: 'agente' | 'pagina' | 'campanha';
      conversaId: string | null;
      atorTipo: 'agente' | 'municipe';
    },
  ): Promise<{ numero: string; ja_existia: boolean; sms_enviado: boolean }> {
    const { apoio } = p;
    await tx.query('SELECT 1 FROM municipes WHERE id = $1 FOR UPDATE', [
      p.municipeId,
    ]);
    const [existente] = await tx.query<{ numero: string }>(
      `SELECT pr.numero FROM pedidos_apoio pa JOIN processos pr ON pr.id = pa.processo_id
       WHERE pa.apoio_id = $1 AND pa.municipe_id = $2 AND pr.fase::text <> ALL($3::text[])
       ORDER BY pa.criado_em DESC LIMIT 1`,
      [apoio.id, p.municipeId, FASES_FECHADAS],
    );
    if (existente) {
      return { numero: existente.numero, ja_existia: true, sms_enviado: false };
    }
    const tipoId = await this.tipoAps(tx, m.id);
    const ano = new Date().getFullYear();
    const numero = `APS ${await proximoNumero(tx, m.id, 'APS', ano)}/${ano}`;
    const [pr] = await tx.query<{ id: string }>(
      `INSERT INTO processos (municipio_id, numero, tipo_processo_id, municipe_id, conversa_origem_id,
         assunto, fase)
       VALUES ($1, $2, $3, $4, $5, $6, 'entrada') RETURNING id`,
      [
        m.id,
        numero,
        tipoId,
        p.municipeId,
        p.conversaId,
        `Pedido de apoio: ${apoio.nome}`,
      ],
    );
    const r = p.consulta?.resultados.find((x) => x.apoio_id === apoio.id);
    const onde = {
      agente: 'na conversa com o agente',
      pagina: 'na página dos apoios (link do SMS)',
      campanha: 'quando a câmara ligou a quem podia ter direito',
    }[p.origem];
    await tx.query(
      `INSERT INTO processo_eventos (processo_id, tipo, descricao, ator_tipo, dados)
       VALUES ($1, 'criado', $2, $3, $4)`,
      [
        pr.id,
        `Pedido de ${apoio.nome} feito ${onde}.` +
          (apoio.documentos.length
            ? ` Documentos a entregar: ${apoio.documentos.join('; ')}.`
            : ''),
        p.atorTipo,
        JSON.stringify({ apoio: apoio.codigo }),
      ],
    );
    // Para o técnico: o que as regras indicaram e porquê (não é a decisão).
    await tx.query(
      `INSERT INTO processo_eventos (processo_id, tipo, descricao, ator_tipo, interno, dados)
       VALUES ($1, 'nota_interna', $2, 'sistema', true, $3)`,
      [
        pr.id,
        r
          ? `Indicação das regras (${ROTULO_RESULTADO[r.resultado]}), pelo que a pessoa disse: ${r.porque.join(' ')}` +
            (r.falta.length
              ? ` Falta confirmar: ${r.falta.map((f) => PERGUNTAS[f]).join(' ')}`
              : '') +
            (p.consulta ? ` ${resumoPerfil(p.consulta.perfil)}` : '')
          : 'Pedido feito sem consulta prévia das regras: confirmar se tem direito.',
        JSON.stringify({ consulta_apoios: p.consulta?.id ?? null }),
      ],
    );
    const [pa] = await tx.query<{ id: string }>(
      `INSERT INTO pedidos_apoio (municipio_id, apoio_id, municipe_id, consulta_id, processo_id, origem)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [m.id, apoio.id, p.municipeId, p.consulta?.id ?? null, pr.id, p.origem],
    );
    await this.conversas.momento(
      p.conversaId,
      'requerimento',
      { pedido_apoio: pa.id, numero, apoio: apoio.codigo },
      tx,
    );
    await this.auditoria.registar(
      {
        municipioId: m.id,
        atorTipo: p.atorTipo,
        atorId: p.atorTipo === 'municipe' ? p.municipeId : null,
        acao: 'pedir_apoio',
        objetoTipo: 'pedido_apoio',
        objetoId: pa.id,
        dados: { apoio: apoio.codigo, processo_id: pr.id, origem: p.origem },
      },
      tx,
    );
    const [mu] = await tx.query<{ telefone_e164: string | null }>(
      'SELECT telefone_e164 FROM municipes WHERE id = $1',
      [p.municipeId],
    );
    let sms = false;
    if (mu?.telefone_e164) {
      const link = await this.links.criar(m.id, 'processo', pr.id, { tx });
      await this.mensagens.sms(
        {
          municipioId: m.id,
          municipeId: p.municipeId,
          destino: mu.telefone_e164,
          motivo: 'apoio',
          corpo: `${m.nome}: recebemos o pedido de ${apoio.nome} (${numero}). Acompanhe e veja o que entregar: ${link.url}`,
          relacionado: { processo_id: pr.id, pedido_apoio: pa.id },
          chave: `pedido_apoio:${pa.id}`,
        },
        tx,
      );
      sms = true;
    }
    return { numero, ja_existia: false, sms_enviado: sms };
  }

  /** É uma chamada de campanha de apoios (a câmara ligou)? */
  private async emCampanha(tx: Tx, ctx: ContextoFerramenta): Promise<boolean> {
    if (!ctx.conversaId) return false;
    const [r] = await tx.query(
      `SELECT 1 FROM campanha_destinatarios d
       JOIN apoio_campanhas ac ON ac.campanha_id = d.campanha_id
       JOIN chamadas_saida cs ON cs.id = d.chamada_saida_id
       JOIN conversas cv ON cv.provider_id = cs.provider_conversa_ref
       WHERE cv.id = $1`,
      [ctx.conversaId],
    );
    return !!r;
  }

  /** O tipo de processo 'APS' do município (cria-o no primeiro pedido). */
  private async tipoAps(tx: Tx, municipioId: string): Promise<string> {
    const [t] = await tx.query<{ id: string }>(
      `INSERT INTO tipos_processo (municipio_id, codigo, nome, prazo_dias_uteis, formulario, frase_do_agente)
       VALUES ($1, 'APS', 'Pedido de apoio social', 20, '[]',
         'Vejo a que apoios pode ter direito e faço o pedido logo; a ação social confirma com os documentos.')
       ON CONFLICT (municipio_id, codigo) DO UPDATE SET codigo = EXCLUDED.codigo
       RETURNING id`,
      [municipioId],
    );
    return t.id;
  }

  private async pedidosDe(c: Consulta) {
    const m = new Map<string, { numero: string; fase: string }>();
    if (!c.municipe_id) return m;
    const l = await this.db.query<{
      apoio_id: string;
      numero: string;
      fase: string;
    }>(
      `SELECT DISTINCT ON (pa.apoio_id) pa.apoio_id, pr.numero, pr.fase::text AS fase
       FROM pedidos_apoio pa JOIN processos pr ON pr.id = pa.processo_id
       WHERE pa.municipe_id = $1 ORDER BY pa.apoio_id, pa.criado_em DESC`,
      [c.municipe_id],
    );
    for (const x of l) m.set(x.apoio_id, { numero: x.numero, fase: x.fase });
    return m;
  }

  private async consultaPorCodigo(codigo: string): Promise<Consulta> {
    const c = codigo.trim().toUpperCase();
    const [r] = /^[A-Z0-9]{8}$/.test(c)
      ? await this.db.query<Consulta>(
          'SELECT * FROM consultas_apoios WHERE codigo = $1',
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

  private url(codigo: string): string {
    return `${this.config.get<string>('app.webUrl') ?? ''}/apoios/${codigo}`;
  }
}

// ---------------------------------------------------------------------

function gerarCodigo(): string {
  return Array.from(
    { length: 8 },
    () => ALFABETO[randomInt(ALFABETO.length)],
  ).join('');
}

function apoioDesconhecido() {
  return new ErroApi(
    HttpStatus.NOT_FOUND,
    'apoio_desconhecido',
    'Este apoio não existe.',
  );
}

/** Do que ficou guardado, o que se pode reaproveitar (sem o rendimento). */
function perfilDeGuardado(g: ReturnType<typeof perfilGuardado>): Perfil {
  return {
    idade: g.idade,
    pessoas_agregado: g.pessoas_agregado,
    filhos_idades: g.filhos_idades,
    inquilino: g.inquilino,
    residente_concelho: g.residente_concelho,
  };
}

/** "72 anos · 1 pessoa em casa · até 300 € por pessoa · inquilino" */
export function resumoPerfil(g: ReturnType<typeof perfilGuardado>): string {
  const p: string[] = [];
  if (g.idade !== null) p.push(`${g.idade} anos`);
  if (g.pessoas_agregado !== null)
    p.push(
      `${g.pessoas_agregado} ${g.pessoas_agregado === 1 ? 'pessoa' : 'pessoas'} em casa`,
    );
  if (g.rendimento_escalao)
    p.push(
      ESCALOES.find((e) => e.id === g.rendimento_escalao)?.texto ??
        g.rendimento_escalao,
    );
  if (g.filhos_idades)
    p.push(
      g.filhos_idades.length
        ? `filhos com ${g.filhos_idades.join(', ')} anos`
        : 'sem filhos a cargo',
    );
  if (g.inquilino !== null)
    p.push(g.inquilino ? 'inquilino' : 'não é inquilino');
  if (g.residente_concelho === false) p.push('não mora no concelho');
  return p.join(' · ');
}

function textosCampanha(
  m: Municipio,
  apoio: ApoioLinha,
  origem: 'consultas' | 'contactos_cuidado',
) {
  return origem === 'consultas'
    ? {
        mensagem: `Estamos a ligar da Câmara de ${m.nome} porque, pelo que nos disse há uns dias, pode ter direito ao ${apoio.nome} e ainda não o pediu. ${apoio.resumo}`,
        perguntas: [
          `Ainda quer pedir o ${apoio.nome}?`,
          'Quer que trate já do pedido?',
        ],
        sms_recurso: `${m.nome}: ligamos porque pode ter direito ao ${apoio.nome}. Para pedir, ligue-nos.`,
      }
    : {
        mensagem: `Estamos a ligar da Câmara de ${m.nome} para lhe dar a conhecer o ${apoio.nome}. ${apoio.resumo}`,
        perguntas: [
          'Posso fazer-lhe duas ou três perguntas para ver se tem direito?',
          'Quer que trate já do pedido?',
        ],
        sms_recurso: `${m.nome}: ligamos para falar do ${apoio.nome}. Para saber se tem direito, ligue-nos.`,
      };
}

function diaCurto(d: Date): string {
  return new Intl.DateTimeFormat('pt-PT', {
    timeZone: 'Europe/Lisbon',
    day: 'numeric',
    month: 'long',
  }).format(d);
}

export type { Campo };
