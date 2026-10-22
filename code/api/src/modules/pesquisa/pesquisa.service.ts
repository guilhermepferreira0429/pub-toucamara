import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import type { UtilizadorPainel } from '../../common/pedido.js';
import { DatabaseService } from '../../database/database.service.js';
import { pode, type Recurso } from '../auth/permissoes.js';
import {
  mascararTelefone,
  normalizarTelefone,
} from '../municipes/municipes.service.js';
import type { Municipio } from '../municipios/municipios.service.js';
import {
  encurtar,
  escaparLike,
  normalizar,
  numeroDe,
  pareceTelefone,
  termosDe,
  type Numero,
} from './termos.js';

export const esquemaPesquisa = z.object({
  q: z.string().trim().min(1).max(100),
});

export type TipoResultado =
  | 'municipe'
  | 'conversa'
  | 'processo'
  | 'ocorrencia'
  | 'reclamacao'
  | 'fonte'
  | 'resposta'
  | 'multa'
  | 'reserva';

export interface Resultado {
  tipo: TipoResultado;
  id: string;
  titulo: string;
  subtitulo: string;
  href: string;
}

export interface Grupo {
  tipo: TipoResultado;
  rotulo: string;
  itens: Resultado[];
}

/** Por grupo: o ⌘K é para saltar, não para listar (as listas têm filtros). */
const POR_GRUPO = 5;

/** O que se procura, já preparado para o SQL. */
interface Consulta {
  municipio: Municipio;
  /** Texto normalizado inteiro (para a semelhança). */
  texto: string;
  /** Padrões LIKE, um por palavra ('%palavra%'). */
  padroes: string[];
  numero: Numero | null;
  telefone: string | null;
}

/**
 * Os parâmetros de uma consulta, numerados à medida que se usam: o Postgres
 * recusa parâmetros que a consulta não refere ("could not determine data
 * type"), e cada área usa só alguns.
 */
class Params {
  readonly valores: unknown[] = [];
  p(v: unknown): string {
    this.valores.push(v);
    return `$${this.valores.length}`;
  }
}

/** O mesmo que compactarNumero (termos.ts), sobre a coluna. */
const compacto = (col: string) =>
  `regexp_replace(regexp_replace(pesquisavel(${col}), '[^a-z0-9/]', '', 'g'), '(^|[^0-9])0+([0-9])', '\\1\\2', 'g')`;

/**
 * Todas as palavras em alguma das colunas: `(a LIKE $n OR b LIKE $n)` por
 * palavra. Cada coluna tem índice de trigramas (migração 0091).
 */
function condicaoTexto(colunas: string[], c: Consulta, ps: Params): string {
  if (!c.padroes.length) return 'false';
  return c.padroes
    .map((padrao) => {
      const p = ps.p(padrao);
      return `(${colunas.map((col) => `pesquisavel(${col}) LIKE ${p}`).join(' OR ')})`;
    })
    .join(' AND ');
}

/** Bate com o número? Sem prefixo ('412/2026', '381') serve qualquer série. */
function condicaoNumero(col: string, c: Consulta, ps: Params): string {
  if (!c.numero) return 'false';
  const p = ps.p(c.numero.compacto);
  const igual = `${compacto(col)} = ${p}::text`;
  if (!c.numero.semPrefixo) return `(${igual})`;
  return `(${igual} OR ${compacto(col)} ~ ('^[a-z]*' || ${p}::text || '(/[0-9]+)?$'))`;
}

/** O número exato à frente na ordenação (um `false` constante o Postgres recusa no ORDER BY). */
const primeiro = (num: string) => (num === 'false' ? '' : `${num} DESC,`);

/**
 * Pesquisa global do painel (⌘K): munícipes, conversas, processos,
 * ocorrências, reclamações e conhecimento do município atual. Cada área só
 * entra se o perfil a puder ver (as mesmas permissões da barra lateral); o
 * número exato vem primeiro, depois o texto sem acentos por semelhança.
 */
@Injectable()
export class PesquisaService {
  constructor(private readonly db: DatabaseService) {}

  async pesquisar(
    m: Municipio,
    u: UtilizadorPainel,
    q: string,
  ): Promise<{ q: string; grupos: Grupo[] }> {
    const numero = numeroDe(q);
    const telefone = pareceTelefone(q) ? normalizarTelefone(q) : null;
    const texto = normalizar(q);
    // Uma letra só dava meio concelho: espera-se pela segunda.
    if (!numero && !telefone && texto.length < 2) return { q, grupos: [] };
    const c: Consulta = {
      municipio: m,
      texto,
      padroes: termosDe(q).map((t) => `%${escaparLike(t)}%`),
      numero,
      telefone,
    };

    const areas: [
      Recurso,
      TipoResultado,
      string,
      () => Promise<Resultado[]>,
    ][] = [
      ['processos', 'processo', 'Processos', () => this.processos(c)],
      [
        'ocorrencias_ver',
        'ocorrencia',
        'Ocorrências',
        () => this.ocorrencias(c),
      ],
      ['reclamacoes', 'reclamacao', 'Reclamações', () => this.reclamacoes(c)],
      ['conversas', 'municipe', 'Munícipes', () => this.municipes(c)],
      ['conversas', 'conversa', 'Conversas', () => this.conversas(c)],
      [
        'conhecimento_ver',
        'resposta',
        'Respostas curadas',
        () => this.respostas(c),
      ],
      ['conhecimento_ver', 'fonte', 'Fontes', () => this.fontes(c)],
      [
        'estacionamento',
        'multa',
        'Multas de estacionamento',
        () => this.multas(c),
      ],
      ['reservas', 'reserva', 'Reservas e bilhetes', () => this.reservas(c)],
    ];
    const permitidas = areas.filter(([r]) => pode(u.perfil, r));
    const listas = await Promise.all(permitidas.map(([, , , f]) => f()));
    const grupos = permitidas
      .map(([, tipo, rotulo], i) => ({ tipo, rotulo, itens: listas[i] }))
      .filter((g) => g.itens.length > 0);
    return { q, grupos };
  }

  private async processos(c: Consulta): Promise<Resultado[]> {
    const ps = new Params();
    const mun = ps.p(c.municipio.id);
    const num = condicaoNumero('p.numero', c, ps);
    const txt = condicaoTexto(['p.assunto', 'p.numero'], c, ps);
    const sem = ps.p(c.texto);
    const linhas = await this.db.query<{
      id: string;
      numero: string;
      assunto: string;
      fase: string;
      tipo: string;
    }>(
      `SELECT p.id, p.numero, p.assunto, p.fase::text AS fase, tp.nome AS tipo
       FROM processos p
       JOIN tipos_processo tp ON tp.id = p.tipo_processo_id
       WHERE p.municipio_id = ${mun} AND (${num} OR ${txt})
       ORDER BY ${primeiro(num)} similarity(pesquisavel(p.assunto), ${sem}) DESC,
                p.atualizado_em DESC
       LIMIT ${POR_GRUPO}`,
      ps.valores,
    );
    return linhas.map((l) => ({
      tipo: 'processo',
      id: l.id,
      titulo: `${l.numero} · ${encurtar(l.assunto, 70)}`,
      subtitulo: `${encurtar(l.tipo, 60)} · ${FASES[l.fase] ?? l.fase}`,
      href: `/painel/processos/${l.id}`,
    }));
  }

  private async ocorrencias(c: Consulta): Promise<Resultado[]> {
    const ps = new Params();
    const mun = ps.p(c.municipio.id);
    const num = condicaoNumero('o.numero', c, ps);
    const txt = condicaoTexto(['o.morada', 'o.descricao', 'o.numero'], c, ps);
    const sem = ps.p(c.texto);
    const linhas = await this.db.query<{
      id: string;
      numero: string;
      descricao: string;
      morada: string;
      categoria: string;
    }>(
      `SELECT o.id, o.numero, o.descricao, o.morada, co.nome AS categoria
       FROM ocorrencias o
       JOIN categorias_ocorrencia co ON co.id = o.categoria_id
       WHERE o.municipio_id = ${mun} AND o.oculto_em IS NULL AND (${num} OR ${txt})
       ORDER BY ${primeiro(num)}
                greatest(similarity(pesquisavel(o.morada), ${sem}),
                         similarity(pesquisavel(o.descricao), ${sem})) DESC,
                o.criada_em DESC
       LIMIT ${POR_GRUPO}`,
      ps.valores,
    );
    return linhas.map((l) => ({
      tipo: 'ocorrencia',
      id: l.id,
      titulo: `${l.numero} · ${l.categoria}`,
      subtitulo: encurtar(`${l.morada} — ${l.descricao}`),
      href: `/painel/ocorrencias/${l.id}`,
    }));
  }

  private async reclamacoes(c: Consulta): Promise<Resultado[]> {
    const ps = new Params();
    const mun = ps.p(c.municipio.id);
    const num = condicaoNumero('r.numero', c, ps);
    const txt = condicaoTexto(['r.descricao', 'r.numero'], c, ps);
    const sem = ps.p(c.texto);
    const linhas = await this.db.query<{
      id: string;
      numero: string;
      descricao: string;
      servico_visado: string | null;
      estado: string;
    }>(
      `SELECT r.id, r.numero, r.descricao, r.servico_visado, r.estado
       FROM reclamacoes r
       WHERE r.municipio_id = ${mun} AND (${num} OR ${txt})
       ORDER BY ${primeiro(num)} similarity(pesquisavel(r.descricao), ${sem}) DESC,
                r.criada_em DESC
       LIMIT ${POR_GRUPO}`,
      ps.valores,
    );
    return linhas.map((l) => ({
      tipo: 'reclamacao',
      id: l.id,
      titulo: `${l.numero}${l.servico_visado ? ` · ${encurtar(l.servico_visado, 50)}` : ''}`,
      subtitulo: `${ESTADOS_RECLAMACAO[l.estado] ?? l.estado} · ${encurtar(l.descricao, 70)}`,
      href: `/painel/reclamacoes?id=${l.id}`,
    }));
  }

  /** Multas de estacionamento pelo número do auto ou pela matrícula (sem hífenes). */
  private async multas(c: Consulta): Promise<Resultado[]> {
    const ps = new Params();
    const mun = ps.p(c.municipio.id);
    const chave = ps.p(c.texto.toUpperCase().replace(/[^A-Z0-9]/g, ''));
    const linhas = await this.db.query<{
      id: string;
      numero_auto: string;
      matricula: string;
      local: string;
      estado: string;
    }>(
      `SELECT m.id, m.numero_auto, m.matricula, m.local, m.estado
       FROM estacionamento_multas m
       WHERE m.municipio_id = ${mun} AND length(${chave}) >= 3
         AND (regexp_replace(upper(m.numero_auto), '[^A-Z0-9]', '', 'g') LIKE '%' || ${chave} || '%'
              OR replace(m.matricula, '-', '') LIKE '%' || ${chave} || '%')
       ORDER BY m.verificada_em DESC
       LIMIT ${POR_GRUPO}`,
      ps.valores,
    );
    return linhas.map((l) => ({
      tipo: 'multa',
      id: l.id,
      titulo: `${l.numero_auto} · ${l.matricula}`,
      subtitulo: `${l.estado.replace(/_/g, ' ')} · ${encurtar(l.local, 60)}`,
      href: `/painel/estacionamento?multa=${l.id}`,
    }));
  }

  /** Reservas e bilhetes pelo código, pelo nome de quem reservou ou pelo equipamento. */
  private async reservas(c: Consulta): Promise<Resultado[]> {
    const ps = new Params();
    const mun = ps.p(c.municipio.id);
    const cod = ps.p(c.texto.toUpperCase().replace(/[^A-Z0-9]/g, ''));
    const txt = condicaoTexto(['r.nome', 'e.nome', 's.titulo'], c, ps);
    const linhas = await this.db.query<{
      id: string;
      codigo: string;
      nome: string | null;
      titulo: string;
      estado: string;
    }>(
      `SELECT r.id, r.codigo, r.nome, coalesce(e.nome, s.titulo) AS titulo, r.estado
       FROM reservas r
       LEFT JOIN reserva_equipamentos e ON e.id = r.equipamento_id
       LEFT JOIN reserva_sessoes s ON s.id = r.sessao_id
       WHERE r.municipio_id = ${mun} AND (r.codigo = ${cod} OR ${txt})
       ORDER BY (r.codigo = ${cod}) DESC, r.criada_em DESC
       LIMIT ${POR_GRUPO}`,
      ps.valores,
    );
    return linhas.map((l) => ({
      tipo: 'reserva',
      id: l.id,
      titulo: `${encurtar(l.titulo, 60)} · ${l.codigo}`,
      subtitulo: `${l.estado.replace(/_/g, ' ')}${l.nome ? ` · ${l.nome}` : ''}`,
      href: `/painel/reservas?reserva=${l.id}`,
    }));
  }

  /**
   * Munícipes pelo nome ou pelo telefone inteiro. Dados pessoais: os
   * anonimizados não aparecem, o telefone vai mascarado e o NIF nunca. Não
   * há ficha do munícipe no painel: o resultado abre a última conversa (e
   * quem não tem conversas visíveis não aparece).
   */
  private async municipes(c: Consulta): Promise<Resultado[]> {
    if (!c.telefone && !c.padroes.length) return [];
    const ps = new Params();
    const mun = ps.p(c.municipio.id);
    const tel = c.telefone ? `m.telefone_e164 = ${ps.p(c.telefone)}` : 'false';
    // Pelo telefone não se mistura com nomes: '912…' não é texto.
    const txt = c.telefone ? 'false' : condicaoTexto(['m.nome'], c, ps);
    const sem = ps.p(c.texto);
    const linhas = await this.db.query<{
      id: string;
      nome: string | null;
      telefone: string | null;
      conversas: number;
      ultima: string;
    }>(
      `SELECT m.id, m.nome, m.telefone_e164 AS telefone, cv.conversas, cv.ultima
       FROM municipes m
       JOIN LATERAL (
         SELECT count(*)::int AS conversas,
                (array_agg(x.id ORDER BY x.iniciada_em DESC))[1] AS ultima
         FROM conversas x
         WHERE x.municipe_id = m.id AND x.oculto_em IS NULL
       ) cv ON cv.conversas > 0
       WHERE m.municipio_id = ${mun} AND m.anonimizado_em IS NULL
         AND (${tel} OR ${txt})
       ORDER BY similarity(pesquisavel(m.nome), ${sem}) DESC NULLS LAST,
                m.criado_em DESC
       LIMIT ${POR_GRUPO}`,
      ps.valores,
    );
    return linhas.map((l) => ({
      tipo: 'municipe',
      id: l.id,
      titulo: l.nome ?? 'Munícipe sem nome',
      subtitulo: `${mascararTelefone(l.telefone)} · ${l.conversas} ${l.conversas === 1 ? 'conversa' : 'conversas'}`,
      href: `/painel/conversas/${l.ultima}`,
    }));
  }

  private async conversas(c: Consulta): Promise<Resultado[]> {
    if (!c.padroes.length || c.telefone) return [];
    const ps = new Params();
    const mun = ps.p(c.municipio.id);
    const txt = condicaoTexto(['c.resumo'], c, ps);
    const sem = ps.p(c.texto);
    const fuso = ps.p(c.municipio.fuso);
    const linhas = await this.db.query<{
      id: string;
      resumo: string;
      canal: string;
      dia: string;
      tema: string | null;
    }>(
      `SELECT c.id, c.resumo, c.canal::text AS canal, t.nome AS tema,
              to_char(c.iniciada_em AT TIME ZONE ${fuso}, 'DD/MM/YYYY') AS dia
       FROM conversas c
       LEFT JOIN temas t ON t.id = c.tema_id
       WHERE c.municipio_id = ${mun} AND c.oculto_em IS NULL
         AND c.resumo IS NOT NULL AND ${txt}
       ORDER BY similarity(pesquisavel(c.resumo), ${sem}) DESC, c.iniciada_em DESC
       LIMIT ${POR_GRUPO}`,
      ps.valores,
    );
    return linhas.map((l) => ({
      tipo: 'conversa',
      id: l.id,
      titulo: encurtar(l.resumo, 80),
      subtitulo: [CANAIS[l.canal] ?? l.canal, l.tema, l.dia]
        .filter(Boolean)
        .join(' · '),
      href: `/painel/conversas/${l.id}`,
    }));
  }

  private async respostas(c: Consulta): Promise<Resultado[]> {
    if (!c.padroes.length || c.telefone) return [];
    const ps = new Params();
    const mun = ps.p(c.municipio.id);
    const txt = condicaoTexto(['r.pergunta_tipo'], c, ps);
    const sem = ps.p(c.texto);
    const linhas = await this.db.query<{
      id: string;
      pergunta_tipo: string;
      estado: string;
      tema: string | null;
    }>(
      `SELECT r.id, r.pergunta_tipo, r.estado, t.nome AS tema
       FROM respostas r
       LEFT JOIN temas t ON t.id = r.tema_id
       WHERE r.municipio_id = ${mun} AND ${txt}
       ORDER BY (r.estado = 'arquivada'),
                similarity(pesquisavel(r.pergunta_tipo), ${sem}) DESC
       LIMIT ${POR_GRUPO}`,
      ps.valores,
    );
    return linhas.map((l) => ({
      tipo: 'resposta',
      id: l.id,
      titulo: encurtar(l.pergunta_tipo, 80),
      subtitulo: [ESTADOS_RESPOSTA[l.estado] ?? l.estado, l.tema]
        .filter(Boolean)
        .join(' · '),
      href: `/painel/conhecimento/respostas?id=${l.id}`,
    }));
  }

  /** As fontes não têm página própria: abre a lista das fontes. */
  private async fontes(c: Consulta): Promise<Resultado[]> {
    if (!c.padroes.length || c.telefone) return [];
    const ps = new Params();
    const mun = ps.p(c.municipio.id);
    const txt = condicaoTexto(['f.titulo'], c, ps);
    const sem = ps.p(c.texto);
    const linhas = await this.db.query<{
      id: string;
      titulo: string;
      tipo: string;
      entidade: string;
    }>(
      `SELECT f.id, f.titulo, f.tipo, e.nome AS entidade
       FROM fontes f
       JOIN entidades e ON e.id = f.entidade_id
       WHERE f.municipio_id = ${mun} AND ${txt}
       ORDER BY similarity(pesquisavel(f.titulo), ${sem}) DESC, f.titulo
       LIMIT ${POR_GRUPO}`,
      ps.valores,
    );
    return linhas.map((l) => ({
      tipo: 'fonte',
      id: l.id,
      titulo: encurtar(l.titulo, 80),
      subtitulo: `${TIPOS_FONTE[l.tipo] ?? l.tipo} · ${l.entidade}`,
      href: '/painel/conhecimento/fontes',
    }));
  }
}

const FASES: Record<string, string> = {
  entrada: 'Entrada',
  documentos: 'Documentos',
  apreciacao: 'Apreciação',
  pareceres_externos: 'Pareceres externos',
  decisao: 'Decisão',
  notificado: 'Notificado',
  arquivado: 'Arquivado',
};

const ESTADOS_RECLAMACAO: Record<string, string> = {
  recebida: 'Recebida',
  em_analise: 'Em análise',
  respondida: 'Respondida',
  encerrada: 'Encerrada',
};

const ESTADOS_RESPOSTA: Record<string, string> = {
  rascunho: 'Rascunho',
  em_teste: 'Em teste',
  no_ar: 'No ar',
  arquivada: 'Arquivada',
};

const CANAIS: Record<string, string> = {
  telefone: 'Telefone',
  chat: 'Chat',
  sms: 'SMS',
  whatsapp: 'WhatsApp',
  email: 'Email',
  balcao: 'Balcão',
  ia: 'IA',
};

const TIPOS_FONTE: Record<string, string> = {
  lei: 'Lei',
  regulamento: 'Regulamento',
  tabela: 'Tabela',
  pagina: 'Página',
  formulario: 'Formulário',
  plano: 'Plano',
  contactos: 'Contactos',
};
