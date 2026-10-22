import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';
import { hojeLisboa } from '../../common/dias-uteis.js';
import { ErroApi } from '../../common/erros.js';
import { proximoNumero } from '../../common/numeracao.js';
import { pagina, type Cursor } from '../../common/paginacao.js';
import type { UtilizadorPainel } from '../../common/pedido.js';
import { DatabaseService } from '../../database/database.service.js';
import type { ContextoFerramenta } from '../../ferramentas/ferramenta.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { MensagensService } from '../comunicacao/mensagens.service.js';
import { ConversasService } from '../conversas/conversas.service.js';
import { MunicipesService } from '../municipes/municipes.service.js';
import {
  type Municipio,
  MunicipiosService,
} from '../municipios/municipios.service.js';
import { GeocodificacaoService } from '../ocorrencias/geocodificacao.js';
import { OcorrenciasService } from '../ocorrencias/ocorrencias.service.js';
import {
  canalDe,
  formatarNumero,
  garantirCategoria,
  precisaIdentificacao,
  quemPede,
  somarDias,
} from '../servicos-municipais/comum.js';
import { ANIMAIS_DEMO } from './demonstracao.js';
import {
  animalDito,
  CANIL_DEMONSTRACAO,
  ESPECIES,
  ESPECIES_REPORTE,
  INFO_REGISTO,
  PERIODOS,
  PORTES,
  SITUACOES_VIA,
  TIPOS_REPORTE,
  tiposCorrespondentes,
  validarVisita,
  visitaDita,
} from './regras.js';

// ---------------------------------------------------------------------------
// Entradas das ações do catálogo
// ---------------------------------------------------------------------------

export const entradaParaAdotar = z.object({
  especie: z
    .enum(ESPECIES)
    .optional()
    .describe('Cão ou gato (vazio = os dois).'),
  porte: z.enum(PORTES).optional().describe('Porte preferido, se tiver.'),
});

export const entradaVisita = z.object({
  nome: z.string().trim().min(3).max(120).describe('O nome de quem vem.'),
  dia: z.iso.date().describe('Que dia quer ir ao canil (AAAA-MM-DD).'),
  periodo: z.enum(PERIODOS).describe('De manhã ou à tarde.'),
  animal: z
    .string()
    .trim()
    .max(80)
    .optional()
    .describe('Que animal quer conhecer (nome), se já escolheu.'),
  observacoes: z
    .string()
    .trim()
    .max(500)
    .optional()
    .describe(
      'Alguma coisa a dizer ao canil (crianças, outros animais em casa…).',
    ),
});

export const entradaReportar = z.object({
  tipo: z
    .enum(TIPOS_REPORTE)
    .describe('Perdeu um animal, encontrou um, ou viu um abandonado.'),
  especie: z.enum(ESPECIES_REPORTE).describe('Cão, gato ou outro.'),
  descricao: z
    .string()
    .trim()
    .min(5)
    .max(500)
    .describe('Como é o animal (cor, tamanho, coleira) e o que aconteceu.'),
  morada: z
    .string()
    .trim()
    .min(3)
    .max(200)
    .describe('Onde: rua e freguesia (onde se perdeu ou onde está).'),
  nome_animal: z
    .string()
    .trim()
    .max(60)
    .optional()
    .describe('O nome do animal, se for seu.'),
  tem_chip: z.boolean().optional().describe('Tem chip?'),
});

export const entradaNaVia = z.object({
  situacao: z
    .enum(SITUACOES_VIA)
    .describe('O animal está ferido ou é agressivo/perigoso.'),
  especie: z.enum(ESPECIES_REPORTE).describe('Cão, gato ou outro.'),
  morada: z
    .string()
    .trim()
    .min(3)
    .max(200)
    .describe(
      'Onde está o animal agora (rua, freguesia, ponto de referência).',
    ),
  descricao: z
    .string()
    .trim()
    .min(5)
    .max(500)
    .describe('O que se passa (está deitado, a atacar, a sangrar…).'),
  pessoas_em_perigo: z
    .boolean()
    .describe('Há pessoas feridas ou em perigo neste momento?'),
});

export const entradaRegisto = z.object({});

// Painel
const ESTADOS_ANIMAL = ['disponivel', 'reservado', 'adotado'] as const;
const ESTADOS_VISITA = [
  'pedida',
  'confirmada',
  'realizada',
  'adotou',
  'cancelada',
] as const;
const ESTADOS_REPORTE = [
  'aberto',
  'recolhido',
  'devolvido',
  'resolvido',
] as const;

export const esquemaNovoAnimal = z.object({
  nome: z.string().trim().min(2).max(60),
  especie: z.enum(ESPECIES),
  sexo: z.enum(['macho', 'femea']).optional(),
  porte: z.enum(PORTES).optional(),
  idade: z.string().trim().max(60).optional(),
  descricao: z.string().trim().min(5).max(500),
  cor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
  esterilizado: z.boolean().default(false),
  vacinado: z.boolean().default(false),
});
export const esquemaEstadoAnimal = z.object({ estado: z.enum(ESTADOS_ANIMAL) });
export const esquemaAlterarVisita = z.object({
  estado: z.enum(ESTADOS_VISITA),
  /** Na confirmação: a mensagem que vai por SMS (ex.: "às 10:30, na receção"). */
  mensagem: z.string().trim().min(3).max(300).optional(),
});
export const esquemaEstadoReporte = z.object({
  estado: z.enum(ESTADOS_REPORTE),
});
export const esquemaFiltroVisitas = z.object({
  estado: z.enum(ESTADOS_VISITA).optional(),
});
export const esquemaFiltroReportados = z.object({
  tipo: z.enum([...TIPOS_REPORTE, ...SITUACOES_VIA]).optional(),
  estado: z.enum(ESTADOS_REPORTE).optional(),
});

/** A categoria das ocorrências urgentes com animais na via. */
export const CATEGORIA_ANIMAL_VIA = 'Animal ferido ou perigoso na via';

const TIPOS_DITOS: Record<string, string> = {
  perdido: 'animal perdido',
  encontrado: 'animal encontrado',
  abandonado: 'animal abandonado',
  ferido: 'animal ferido',
  agressivo: 'animal agressivo',
};

export interface LinhaAnimal {
  id: string;
  nome: string;
  especie: string;
  sexo: string | null;
  porte: string | null;
  idade: string | null;
  descricao: string;
  cor: string | null;
  esterilizado: boolean;
  vacinado: boolean;
  com_chip: boolean;
  estado: string;
  entrada_em: string;
  demonstracao: boolean;
}

const COLUNAS_ANIMAL = `id, nome, especie, sexo, porte, idade, descricao, cor, esterilizado,
  vacinado, com_chip, estado, to_char(entrada_em, 'YYYY-MM-DD') AS entrada_em, demonstracao`;

/**
 * Animais (V4 #9): canil/gatil municipal (adoções e visitas), animais
 * perdidos/encontrados/abandonados e feridos ou agressivos na via (que
 * viram ocorrência urgente). O registo e a vacina são informação: o SIAC é
 * nacional.
 */
@Injectable()
export class AnimaisService {
  constructor(
    private readonly db: DatabaseService,
    private readonly config: ConfigService,
    private readonly municipes: MunicipesService,
    private readonly municipios: MunicipiosService,
    private readonly mensagens: MensagensService,
    private readonly conversas: ConversasService,
    private readonly auditoria: AuditoriaService,
    private readonly geo: GeocodificacaoService,
    private readonly ocorrencias: OcorrenciasService,
  ) {}

  private linkAdotar(): string {
    const web = this.config.get<string>('app.webUrl') ?? '';
    return `${web}/adotar`;
  }

  private async disponiveis(
    municipioId: string,
    f: { especie?: string; porte?: string } = {},
  ): Promise<LinhaAnimal[]> {
    return this.db.query<LinhaAnimal>(
      `SELECT ${COLUNAS_ANIMAL} FROM animais_adocao
       WHERE municipio_id = $1 AND estado <> 'adotado'
         AND ($2::text IS NULL OR especie = $2)
         AND ($3::text IS NULL OR porte = $3)
       ORDER BY (estado = 'disponivel') DESC, entrada_em, nome`,
      [municipioId, f.especie ?? null, f.porte ?? null],
    );
  }

  // ------------------------------------------------------------------
  // Agente
  // ------------------------------------------------------------------

  async paraAdotar(
    ctx: ContextoFerramenta,
    e: z.output<typeof entradaParaAdotar>,
  ) {
    const todos = await this.disponiveis(ctx.municipio.id, e);
    const livres = todos.filter((a) => a.estado === 'disponivel');
    const demonstracao = todos.some((a) => a.demonstracao);
    const link = this.linkAdotar();
    if (!livres.length) {
      return {
        encontrado: false,
        link,
        dizer:
          'Neste momento não tenho animais com essas características para adoção. Os animais mudam todas as semanas: pode ver a lista no site ou ligar mais tarde.',
      };
    }
    const lista = livres.slice(0, 5);
    return {
      encontrado: true,
      total: livres.length,
      animais: lista.map((a) => ({
        nome: a.nome,
        especie: a.especie,
        porte: a.porte,
        idade: a.idade,
        descricao: a.descricao,
        vacinado: a.vacinado,
        esterilizado: a.esterilizado,
        dito: animalDito(a),
      })),
      link,
      canil: {
        nome: CANIL_DEMONSTRACAO.nome,
        visitas: CANIL_DEMONSTRACAO.horario_dito,
      },
      ...(demonstracao ? { demonstracao: true } : {}),
      instrucao:
        'Diz dois ou três e pergunta se quer saber de algum ou marcar uma visita (ação marcar_visita_adocao).',
      dizer: `Há ${livres.length} ${livres.length === 1 ? 'animal' : 'animais'} para adoção, por exemplo: ${lista
        .slice(0, 3)
        .map((a) => animalDito(a))
        .join(
          '; ',
        )}. Pode vê-los todos em ${link}.${demonstracao ? ' Esta lista ainda é de demonstração.' : ''}`,
    };
  }

  async marcarVisita(
    ctx: ContextoFerramenta,
    e: z.output<typeof entradaVisita>,
  ) {
    const m = ctx.municipio;
    const quem = await quemPede(this.db, this.municipes, ctx);
    if (!quem) return precisaIdentificacao(ctx, 'marcar a visita ao canil');
    const v = validarVisita(
      e.dia,
      e.periodo,
      hojeLisboa(),
      await this.municipios.feriados(m.id),
    );
    if (!v.ok) {
      return {
        feito: false,
        motivo: v.motivo,
        visitas: CANIL_DEMONSTRACAO.horario_dito,
        dizer: v.dizer,
      };
    }
    let animal: LinhaAnimal | null = null;
    if (e.animal) {
      const [a] = await this.db.query<LinhaAnimal>(
        `SELECT ${COLUNAS_ANIMAL} FROM animais_adocao
         WHERE municipio_id = $1 AND estado <> 'adotado'
           AND unaccent(lower(nome)) = unaccent(lower($2))
         LIMIT 1`,
        [m.id, e.animal.replace(/^(o|a)\s+/i, '')],
      );
      animal = a ?? null;
    }
    const ano = new Date().getFullYear();
    const r = await this.db.transaction(async (tx) => {
      const numero = formatarNumero(
        'AD',
        ano,
        await proximoNumero(tx, m.id, 'AD', ano),
      );
      const [p] = await tx.query<{ id: string }>(
        `INSERT INTO visitas_adocao (municipio_id, numero, animal_id, animal_dito, nome, telefone,
           municipe_id, conversa_id, canal, dia, periodo, observacoes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
        [
          m.id,
          numero,
          animal?.id ?? null,
          e.animal ?? null,
          e.nome,
          quem.telefone,
          quem.municipeId,
          ctx.conversaId,
          canalDe(ctx),
          e.dia,
          e.periodo,
          e.observacoes ?? null,
        ],
      );
      if (quem.telefone) {
        await this.mensagens.sms(
          {
            municipioId: m.id,
            municipeId: quem.municipeId,
            destino: quem.telefone,
            motivo: 'requerimento',
            corpo: `${m.nome}: pedido de visita ao canil registado (${numero}) para ${visitaDita(e.dia, e.periodo)}${animal ? `, para conhecer ${animal.nome}` : ''}. O canil confirma a hora por SMS.`,
            relacionado: {
              visita_adocao_id: p.id,
              ...(ctx.conversaId ? { conversa_id: ctx.conversaId } : {}),
            },
            chave: `visita_adocao:${p.id}`,
          },
          tx,
        );
      }
      await this.conversas.momento(
        ctx.conversaId,
        'requerimento',
        { tipo: 'visita_adocao', visita_adocao_id: p.id, numero },
        tx,
      );
      return { numero };
    });
    return {
      feito: true,
      numero: r.numero,
      dia: e.dia,
      periodo: e.periodo,
      animal: animal ? animalDito(animal) : null,
      animal_encontrado: e.animal ? !!animal : null,
      sms_enviado: !!quem.telefone,
      dizer:
        `Fica pedida a visita ao canil para ${visitaDita(e.dia, e.periodo)}, com o número ${r.numero}` +
        (animal ? `, para conhecer ${animal.nome}` : '') +
        '. ' +
        (e.animal && !animal
          ? `Não encontrei o animal ${e.animal} na lista, mas a equipa vê consigo na visita. `
          : '') +
        (quem.telefone
          ? 'A equipa do canil confirma a hora por SMS. Leve o Cartão de Cidadão.'
          : 'Guarde o número. Leve o Cartão de Cidadão.'),
    };
  }

  /** Avisos abertos que podem ser o mesmo animal (perdido ↔ encontrado). */
  private async correspondencias(
    municipioId: string,
    tipo: string,
    especie: string,
  ): Promise<number> {
    const tipos = tiposCorrespondentes(tipo);
    if (!tipos.length) return 0;
    const [r] = await this.db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM animais_reportados
       WHERE municipio_id = $1 AND estado = 'aberto' AND tipo = ANY($2::text[])
         AND especie = $3 AND criado_em > now() - interval '30 days'`,
      [municipioId, tipos, especie],
    );
    return r.n;
  }

  private async inserirReporte(
    ctx: ContextoFerramenta,
    d: {
      tipo: string;
      especie: string;
      descricao: string;
      morada: string;
      nome_animal?: string | null;
      com_chip?: boolean | null;
      urgente: boolean;
      ocorrencia_id: string | null;
    },
    quem: { municipeId: string | null; telefone: string | null } | null,
  ) {
    const m = ctx.municipio;
    const coords = await this.geo.geocodificar(d.morada, m.nome);
    const ano = new Date().getFullYear();
    return this.db.transaction(async (tx) => {
      const numero = formatarNumero(
        'AN',
        ano,
        await proximoNumero(tx, m.id, 'AN', ano),
      );
      const [p] = await tx.query<{ id: string }>(
        `INSERT INTO animais_reportados (municipio_id, numero, tipo, especie, nome_animal, descricao,
           morada, lat, lng, com_chip, urgente, ocorrencia_id, telefone, municipe_id,
           conversa_id, canal)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
         RETURNING id`,
        [
          m.id,
          numero,
          d.tipo,
          d.especie,
          d.nome_animal ?? null,
          d.descricao,
          d.morada,
          coords?.lat ?? null,
          coords?.lng ?? null,
          d.com_chip ?? null,
          d.urgente,
          d.ocorrencia_id,
          quem?.telefone ?? null,
          quem?.municipeId ?? null,
          ctx.conversaId,
          canalDe(ctx),
        ],
      );
      await this.conversas.momento(
        ctx.conversaId,
        'requerimento',
        { tipo: 'animal_reportado', animal_reportado_id: p.id, numero },
        tx,
      );
      return { id: p.id, numero, localizado: !!coords };
    });
  }

  async reportar(ctx: ContextoFerramenta, e: z.output<typeof entradaReportar>) {
    const quem = await quemPede(this.db, this.municipes, ctx);
    // Quem perdeu o animal tem de poder ser contactado; quem viu um, não.
    if (e.tipo === 'perdido' && !quem) {
      return precisaIdentificacao(ctx, 'avisar se o animal aparecer no canil');
    }
    const r = await this.inserirReporte(
      ctx,
      {
        tipo: e.tipo,
        especie: e.especie,
        descricao: e.descricao,
        morada: e.morada,
        nome_animal: e.nome_animal,
        com_chip: e.tem_chip,
        urgente: false,
        ocorrencia_id: null,
      },
      quem,
    );
    const parecidos = await this.correspondencias(
      ctx.municipio.id,
      e.tipo,
      e.especie,
    );
    const frase =
      e.tipo === 'perdido'
        ? `Fica registado o aviso do animal perdido, com o número ${r.numero}. Se aparecer no canil ou alguém o encontrar, a equipa contacta-o.${e.tem_chip ? ' Como tem chip, confirme também que os seus contactos no SIAC estão atualizados.' : ''}`
        : e.tipo === 'encontrado'
          ? `Obrigado. Fica registado o animal encontrado, com o número ${r.numero}. A equipa do canil vai ver se alguém o deu como perdido e, se for preciso, vai buscá-lo. Se puder, leve-o a um veterinário para ler o chip: é gratuito ver se tem dono.`
          : `Obrigado. Fica registado o animal abandonado, com o número ${r.numero}. A equipa do canil vai avaliar e recolhê-lo, se for preciso.`;
    return {
      feito: true,
      numero: r.numero,
      tipo: e.tipo,
      localizado_no_mapa: r.localizado,
      possiveis_correspondencias: parecidos,
      dizer:
        frase +
        (parecidos > 0
          ? ` Há ${parecidos === 1 ? 'um aviso parecido' : `${parecidos} avisos parecidos`} nos últimos dias: a equipa vai comparar.`
          : ''),
    };
  }

  async naVia(ctx: ContextoFerramenta, e: z.output<typeof entradaNaVia>) {
    const m = ctx.municipio;
    if (e.pessoas_em_perigo) {
      return {
        feito: false,
        emergencia: true,
        dizer: 'Ligue já para o 112.',
        instrucao:
          'Há pessoas feridas ou em perigo: diz "ligue já para o 112" e chama a ferramenta emergencia. Depois, se a pessoa quiser, regista também o animal com pessoas_em_perigo: não.',
      };
    }
    const categoria = await garantirCategoria(
      this.db,
      m.id,
      CATEGORIA_ANIMAL_VIA,
      'paw-print',
    );
    const descricao = `URGENTE · ${e.situacao === 'ferido' ? 'Animal ferido' : 'Animal agressivo'} (${e.especie === 'cao' ? 'cão' : e.especie}): ${e.descricao}`;
    const oc = (await this.ocorrencias.registar(ctx, {
      categoria,
      descricao,
      morada: e.morada,
    })) as { registada: boolean; numero?: string };
    let ocorrenciaId: string | null = null;
    if (oc.registada && oc.numero) {
      const [o] = await this.db.query<{ id: string }>(
        'SELECT id FROM ocorrencias WHERE municipio_id = $1 AND numero = $2',
        [m.id, oc.numero],
      );
      ocorrenciaId = o?.id ?? null;
    }
    const quem = await quemPede(this.db, this.municipes, ctx);
    const r = await this.inserirReporte(
      ctx,
      {
        tipo: e.situacao,
        especie: e.especie,
        descricao: e.descricao,
        morada: e.morada,
        urgente: true,
        ocorrencia_id: ocorrenciaId,
      },
      quem,
    );
    return {
      feito: true,
      urgente: true,
      numero: r.numero,
      ocorrencia: oc.numero ?? null,
      dizer:
        `Fica registado como urgente, com o número ${oc.numero ?? r.numero}, e segue já para a equipa do canil municipal. ` +
        (e.situacao === 'agressivo'
          ? 'Afaste-se do animal e não tente agarrá-lo. Se ele atacar alguém, ligue para o 112.'
          : 'Se puder, fique por perto a uma distância segura, sem lhe tocar, até a equipa chegar.'),
    };
  }

  registo() {
    return Promise.resolve({
      ...INFO_REGISTO,
      siac_nacional: true,
      dizer: `${INFO_REGISTO.registo} ${INFO_REGISTO.vacina} ${INFO_REGISTO.campanha}`,
      instrucao:
        'Se perguntar as datas da campanha de vacinação, procura no conhecimento (procurar_conhecimento).',
    });
  }

  // ------------------------------------------------------------------
  // Público (/adotar)
  // ------------------------------------------------------------------

  async publico(slug: string) {
    const m = await this.municipios.porSlug(slug);
    const animais = await this.disponiveis(m.id);
    return {
      municipio: { slug: m.slug, nome: m.nome },
      canil: CANIL_DEMONSTRACAO,
      animais: animais.map((a) => ({
        id: a.id,
        nome: a.nome,
        especie: a.especie,
        sexo: a.sexo,
        porte: a.porte,
        idade: a.idade,
        descricao: a.descricao,
        cor: a.cor,
        esterilizado: a.esterilizado,
        vacinado: a.vacinado,
        com_chip: a.com_chip,
        estado: a.estado,
      })),
      demonstracao: animais.some((a) => a.demonstracao),
    };
  }

  // ------------------------------------------------------------------
  // Painel
  // ------------------------------------------------------------------

  async resumo(m: Municipio) {
    const animais = await this.db.query<LinhaAnimal>(
      `SELECT ${COLUNAS_ANIMAL} FROM animais_adocao WHERE municipio_id = $1
       ORDER BY (estado = 'adotado'), entrada_em, nome`,
      [m.id],
    );
    const [c] = await this.db.query<{
      visitas_pedidas: number;
      reportados_abertos: number;
      urgentes_abertos: number;
    }>(
      `SELECT
         (SELECT count(*)::int FROM visitas_adocao WHERE municipio_id = $1 AND estado = 'pedida') AS visitas_pedidas,
         (SELECT count(*)::int FROM animais_reportados WHERE municipio_id = $1 AND estado = 'aberto') AS reportados_abertos,
         (SELECT count(*)::int FROM animais_reportados WHERE municipio_id = $1 AND estado = 'aberto' AND urgente) AS urgentes_abertos`,
      [m.id],
    );
    return { animais, contagens: c, canil: CANIL_DEMONSTRACAO };
  }

  async criarAnimal(
    m: Municipio,
    u: UtilizadorPainel,
    d: z.output<typeof esquemaNovoAnimal>,
  ) {
    const [a] = await this.db.query<LinhaAnimal>(
      `INSERT INTO animais_adocao (municipio_id, nome, especie, sexo, porte, idade, descricao,
         cor, esterilizado, vacinado)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING ${COLUNAS_ANIMAL}`,
      [
        m.id,
        d.nome,
        d.especie,
        d.sexo ?? null,
        d.porte ?? null,
        d.idade ?? null,
        d.descricao,
        d.cor ?? null,
        d.esterilizado,
        d.vacinado,
      ],
    );
    await this.auditoria.registar({
      municipioId: m.id,
      atorTipo: 'utilizador',
      atorId: u.id,
      acao: 'criar',
      objetoTipo: 'animal_adocao',
      objetoId: a.id,
      dados: { nome: a.nome, especie: a.especie },
    });
    return a;
  }

  async mudarEstadoAnimal(
    m: Municipio,
    u: UtilizadorPainel,
    id: string,
    estado: (typeof ESTADOS_ANIMAL)[number],
  ) {
    const [a] = await this.db.query<{ id: string; nome: string }>(
      `UPDATE animais_adocao SET estado = $3, atualizado_em = now()
       WHERE id = $1 AND municipio_id = $2 RETURNING id, nome`,
      [id, m.id, estado],
    );
    if (!a) throw this.naoExiste('Este animal não existe.');
    await this.auditoria.registar({
      municipioId: m.id,
      atorTipo: 'utilizador',
      atorId: u.id,
      acao: 'mudar_animal_adocao',
      objetoTipo: 'animal_adocao',
      objetoId: a.id,
      dados: { nome: a.nome, estado },
    });
    return { id: a.id, estado };
  }

  async visitas(
    m: Municipio,
    f: z.output<typeof esquemaFiltroVisitas>,
    limite: number,
    cursor: Cursor | null,
  ) {
    const linhas = await this.db.query<{ id: string; criado_em: Date }>(
      `SELECT v.id, v.numero, v.nome, v.telefone, v.canal, v.conversa_id,
              to_char(v.dia, 'YYYY-MM-DD') AS dia, v.periodo, v.observacoes, v.estado,
              v.animal_dito, a.nome AS animal, a.especie AS animal_especie,
              v.criado_em, v.atualizado_em, u.nome AS tratado_por_nome
       FROM visitas_adocao v
       LEFT JOIN animais_adocao a ON a.id = v.animal_id
       LEFT JOIN utilizadores u ON u.id = v.tratado_por
       WHERE v.municipio_id = $1
         AND ($2::text IS NULL OR v.estado = $2)
         AND ($3::timestamptz IS NULL OR (v.criado_em, v.id) < ($3, $4))
       ORDER BY v.criado_em DESC, v.id DESC LIMIT $5`,
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

  async alterarVisita(
    m: Municipio,
    u: UtilizadorPainel,
    id: string,
    d: z.output<typeof esquemaAlterarVisita>,
  ) {
    if (d.estado === 'confirmada' && !d.mensagem) {
      throw new ErroApi(
        HttpStatus.BAD_REQUEST,
        'falta_mensagem',
        'Escreva a hora e o local da visita: vão por SMS à pessoa.',
      );
    }
    return this.db.transaction(async (tx) => {
      const [v] = await tx.query<{
        id: string;
        numero: string;
        telefone: string | null;
        municipe_id: string | null;
        animal_id: string | null;
        dia: string;
        periodo: 'manha' | 'tarde';
      }>(
        `UPDATE visitas_adocao SET estado = $3, tratado_por = $4, atualizado_em = now()
         WHERE id = $1 AND municipio_id = $2
         RETURNING id, numero, telefone, municipe_id, animal_id,
                   to_char(dia, 'YYYY-MM-DD') AS dia, periodo`,
        [id, m.id, d.estado, u.id],
      );
      if (!v) throw this.naoExiste('Este pedido de visita não existe.');
      // Adotou: o animal sai da lista.
      if (d.estado === 'adotou' && v.animal_id) {
        await tx.query(
          `UPDATE animais_adocao SET estado = 'adotado', atualizado_em = now()
           WHERE id = $1 AND municipio_id = $2`,
          [v.animal_id, m.id],
        );
      }
      let smsEnviado = false;
      if (
        v.telefone &&
        (d.estado === 'confirmada' || d.estado === 'cancelada')
      ) {
        await this.mensagens.sms(
          {
            municipioId: m.id,
            municipeId: v.municipe_id,
            destino: v.telefone,
            motivo: 'requerimento',
            corpo:
              d.estado === 'confirmada'
                ? `${m.nome}: a sua visita ao canil (${v.numero}) está confirmada para ${visitaDita(v.dia, v.periodo)}. ${d.mensagem}`
                : `${m.nome}: a visita ao canil (${v.numero}) foi desmarcada.${d.mensagem ? ` ${d.mensagem}` : ''}`,
            relacionado: { visita_adocao_id: v.id },
            chave: `visita_adocao:${v.id}:${d.estado}`,
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
          acao: 'tratar_visita_adocao',
          objetoTipo: 'visita_adocao',
          objetoId: v.id,
          dados: { numero: v.numero, estado: d.estado },
        },
        tx,
      );
      return { id: v.id, estado: d.estado, sms_enviado: smsEnviado };
    });
  }

  async reportados(
    m: Municipio,
    f: z.output<typeof esquemaFiltroReportados>,
    limite: number,
    cursor: Cursor | null,
  ) {
    const linhas = await this.db.query<{
      id: string;
      tipo: string;
      especie: string;
      estado: string;
      criado_em: Date;
    }>(
      `SELECT r.id, r.numero, r.tipo, r.especie, r.nome_animal, r.descricao, r.morada, r.lat, r.lng,
              r.com_chip, r.urgente, r.telefone, r.canal, r.conversa_id, r.estado,
              o.numero AS ocorrencia_numero, r.criado_em, r.atualizado_em
       FROM animais_reportados r
       LEFT JOIN ocorrencias o ON o.id = r.ocorrencia_id
       WHERE r.municipio_id = $1
         AND ($2::text IS NULL OR r.tipo = $2)
         AND ($3::text IS NULL OR r.estado = $3)
         AND ($4::timestamptz IS NULL OR (r.criado_em, r.id) < ($4, $5))
       ORDER BY r.criado_em DESC, r.id DESC LIMIT $6`,
      [
        m.id,
        f.tipo ?? null,
        f.estado ?? null,
        cursor?.em ?? null,
        cursor?.id ?? null,
        limite + 1,
      ],
    );
    // Possíveis correspondências entre avisos abertos (perdido ↔ encontrado).
    const abertos = linhas.filter((l) => l.estado === 'aberto');
    const p = pagina(linhas, limite, (l) => ({ em: l.criado_em, id: l.id }));
    return {
      ...p,
      itens: p.itens.map((l) => ({
        ...l,
        tipo_dito: TIPOS_DITOS[l.tipo] ?? l.tipo,
        parecidos:
          l.estado === 'aberto'
            ? abertos.filter(
                (o) =>
                  o.id !== l.id &&
                  o.especie === l.especie &&
                  tiposCorrespondentes(l.tipo).includes(o.tipo),
              ).length
            : 0,
      })),
    };
  }

  async mudarEstadoReporte(
    m: Municipio,
    u: UtilizadorPainel,
    id: string,
    estado: (typeof ESTADOS_REPORTE)[number],
  ) {
    const [r] = await this.db.query<{ id: string; numero: string }>(
      `UPDATE animais_reportados SET estado = $3, tratado_por = $4, atualizado_em = now()
       WHERE id = $1 AND municipio_id = $2 RETURNING id, numero`,
      [id, m.id, estado, u.id],
    );
    if (!r) throw this.naoExiste('Este aviso não existe.');
    await this.auditoria.registar({
      municipioId: m.id,
      atorTipo: 'utilizador',
      atorId: u.id,
      acao: 'tratar_animal_reportado',
      objetoTipo: 'animal_reportado',
      objetoId: r.id,
      dados: { numero: r.numero, estado },
    });
    return { id: r.id, estado };
  }

  private naoExiste(mensagem: string) {
    return new ErroApi(HttpStatus.NOT_FOUND, 'nao_encontrado', mensagem);
  }

  // ------------------------------------------------------------------
  // Demonstração
  // ------------------------------------------------------------------

  /** Idempotente: cria os animais de demonstração que faltam (por nome). */
  async carregarDemonstracao(m: Municipio): Promise<{ criados: number }> {
    const hoje = hojeLisboa();
    let criados = 0;
    for (const a of ANIMAIS_DEMO) {
      const [r] = await this.db.query<{ id: string }>(
        `INSERT INTO animais_adocao (municipio_id, nome, especie, sexo, porte, idade, descricao,
           cor, esterilizado, vacinado, estado, entrada_em, demonstracao)
         SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, true
         WHERE NOT EXISTS (SELECT 1 FROM animais_adocao WHERE municipio_id = $1 AND nome = $2)
         RETURNING id`,
        [
          m.id,
          a.nome,
          a.especie,
          a.sexo,
          a.porte,
          a.idade,
          a.descricao,
          a.cor,
          a.esterilizado,
          a.vacinado,
          a.estado,
          somarDias(hoje, -a.entrou_ha_dias),
        ],
      );
      if (r) criados++;
    }
    // Um pedido de visita e dois avisos (um perdido e um encontrado que
    // podem ser o mesmo gato), só na primeira vez.
    const [{ n }] = await this.db.query<{ n: number }>(
      `SELECT (SELECT count(*) FROM visitas_adocao WHERE municipio_id = $1)
            + (SELECT count(*) FROM animais_reportados WHERE municipio_id = $1) AS n`,
      [m.id],
    );
    if (Number(n) === 0) {
      const ano = new Date().getFullYear();
      await this.db.transaction(async (tx) => {
        const num = async (p: string) =>
          formatarNumero(p, ano, await proximoNumero(tx, m.id, p, ano));
        let dia = somarDias(hoje, 2);
        while (validarVisita(dia, 'manha', hoje, new Set()).ok === false)
          dia = somarDias(dia, 1);
        await tx.query(
          `INSERT INTO visitas_adocao (municipio_id, numero, animal_id, animal_dito, nome, canal,
             dia, periodo, observacoes)
           SELECT $1, $2, id, 'Tejo', 'Rita Exemplo Costa', 'telefone', $3, 'manha',
                  'Tem duas crianças pequenas em casa.'
           FROM animais_adocao WHERE municipio_id = $1 AND nome = 'Tejo' LIMIT 1`,
          [m.id, await num('AD'), dia],
        );
        const avisos: [string, string, string, string][] = [
          [
            'perdido',
            'Gata tigrada, coleira vermelha, muito assustada.',
            'Rua de Santo António, Guimarães',
            'Riscas',
          ],
          [
            'encontrado',
            'Gata tigrada com coleira vermelha, escondida debaixo de um carro.',
            'Largo do Toural, Guimarães',
            '',
          ],
        ];
        for (const [tipo, descricao, morada, nomeAnimal] of avisos) {
          await tx.query(
            `INSERT INTO animais_reportados (municipio_id, numero, tipo, especie, nome_animal,
               descricao, morada, canal)
             VALUES ($1, $2, $3, 'gato', $4, $5, $6, 'telefone')`,
            [
              m.id,
              await num('AN'),
              tipo,
              nomeAnimal || null,
              descricao,
              morada,
            ],
          );
        }
      });
    }
    return { criados };
  }
}
