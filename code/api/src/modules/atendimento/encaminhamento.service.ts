import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service.js';
import { horarioPorExtenso } from './horario.js';
import { HorarioService } from './horario.service.js';

export type TipoContacto =
  'telefone' | 'avarias' | 'email' | 'morada' | 'balcao' | 'site';

export interface LinhaContacto {
  id: string;
  tipo: TipoContacto;
  rotulo: string | null;
  valor: string;
  horario: unknown;
}

export interface ContactoDito {
  tipo: TipoContacto;
  rotulo: string | null;
  valor: string;
  horario: string | null;
  /** null = sem horário conhecido: não dizer que está aberto. */
  aberto_agora: boolean | null;
}

export type ResultadoEncaminhar =
  | { encontrada: false; dizer: string }
  | {
      encontrada: true;
      emergencia: true;
      entidade: string;
      dizer: string;
      instrucao: string;
    }
  | {
      encontrada: true;
      emergencia: false;
      assunto: string;
      entidade: { nome: string; tipo: string; descricao: string | null };
      contacto: ContactoDito | null;
      outros_contactos: ContactoDito[];
      passa_a_pessoa: string | null;
      dizer: string;
      outras_regras: { assunto: string; entidade: string }[];
    };

interface LinhaRegra {
  id: string;
  assunto: string;
  prioridade: number;
  passa_a_pessoa: string | null;
  contacto_id: string | null;
  entidade_id: string;
  entidade: string;
  entidade_tipo: string;
  entidade_descricao: string | null;
  site_url: string | null;
}

// Para dizer ao telefone: primeiro um número, depois o resto.
const ORDEM_CONTACTO: TipoContacto[] = [
  'telefone',
  'avarias',
  'balcao',
  'email',
  'site',
  'morada',
];

/**
 * O contacto a dizer: o da regra, se tiver; senão o primeiro pela ordem
 * acima. Os outros (até 3) vão à parte para o modelo escolher se o
 * munícipe pedir outra forma.
 */
export function escolherContacto<T extends { id: string; tipo: TipoContacto }>(
  contactos: T[],
  contactoId: string | null,
): { principal: T | null; outros: T[] } {
  const ordenados = [...contactos].sort(
    (a, b) => ORDEM_CONTACTO.indexOf(a.tipo) - ORDEM_CONTACTO.indexOf(b.tipo),
  );
  const principal =
    ordenados.find((c) => c.id === contactoId) ?? ordenados[0] ?? null;
  return {
    principal,
    outros: ordenados.filter((c) => c !== principal).slice(0, 3),
  };
}

/** A regra é de emergência: 112 tem prioridade 0 ou a entidade é do tipo emergência. */
export function eEmergencia(r: {
  prioridade: number;
  entidade_tipo: string;
}): boolean {
  return r.prioridade === 0 || r.entidade_tipo === 'emergencia';
}

/** A frase curta que o agente diz. */
export function fraseEncaminhar(
  entidade: string,
  c: ContactoDito | null,
): string {
  if (!c) return `Isso é tratado por ${entidade}.`;
  const como =
    c.tipo === 'email'
      ? `pode escrever para ${c.valor}`
      : c.tipo === 'site'
        ? `tem tudo em ${c.valor}`
        : c.tipo === 'morada' || c.tipo === 'balcao'
          ? `pode ir a ${c.valor}`
          : `pode ligar para o ${c.valor}`;
  const rotulo = c.rotulo ? ` (${c.rotulo})` : '';
  const aberto =
    c.aberto_agora === true
      ? ', que está aberto agora'
      : c.aberto_agora === false && c.horario
        ? `, que agora está fechado; o horário é ${c.horario}`
        : '';
  return `Isso é tratado por ${entidade}: ${como}${rotulo}${aberto}.`;
}

/*
 * A pergunta vem falada ("tenho uma rotura na rua"): parte-se em lexemas
 * portugueses sem acentos e procura-se qualquer um (OU), como no
 * conhecimento, sobre o assunto (peso A), o nome da entidade (B) e a
 * descrição (C). O pg_trgm apanha nomes mal escritos ("vimagua",
 * "vitrus") palavra a palavra. Ordena por relevância e, em empate, pela
 * prioridade (112 = 0 ganha). A tabela é pequena (dezenas de regras por
 * município), não precisa de índice.
 */
const PROCURAR = `
  WITH c AS (
    SELECT string_agg(DISTINCT quote_literal(lexeme), ' | ')::tsquery AS q
    FROM unnest(to_tsvector('pt_unaccent', $2))
  ),
  palavras AS (
    SELECT array_agg(DISTINCT w) AS ws
    FROM regexp_split_to_table(unaccent(lower($2)), '[^a-z0-9]+') w
    WHERE length(w) >= 4
  ),
  r AS (
    SELECT r.id, r.assunto, r.prioridade, r.passa_a_pessoa, r.contacto_id,
           e.id AS entidade_id, e.nome AS entidade, e.tipo AS entidade_tipo,
           e.descricao AS entidade_descricao, e.site_url,
           setweight(to_tsvector('pt_unaccent', r.assunto), 'A')
             || setweight(to_tsvector('pt_unaccent', e.nome), 'B')
             || setweight(to_tsvector('pt_unaccent', coalesce(e.descricao, '')), 'C') AS tsv,
           unaccent(lower(r.assunto || ' ' || e.nome)) AS texto
    FROM regras_encaminhamento r
    JOIN entidades e ON e.id = r.entidade_id
    WHERE r.municipio_id = $1 AND r.ativo AND e.ativo
  ),
  p AS (
    SELECT r.*,
      CASE WHEN c.q IS NULL THEN 0 ELSE ts_rank(r.tsv, c.q) END AS rank,
      coalesce((SELECT max(word_similarity(w, r.texto)) FROM unnest(palavras.ws) w), 0) AS trig,
      c.q IS NOT NULL AND r.tsv @@ c.q AS bate
    FROM r, c, palavras
  )
  SELECT id, assunto, prioridade, passa_a_pessoa, contacto_id, entidade_id,
         entidade, entidade_tipo, entidade_descricao, site_url
  FROM p
  WHERE bate OR trig >= 0.6
  ORDER BY rank + 0.3 * trig DESC, prioridade, assunto
  LIMIT 3`;

/** "Quem trata de quê": água, lixo, finanças, 112... */
@Injectable()
export class EncaminhamentoService {
  constructor(
    private readonly db: DatabaseService,
    private readonly horario: HorarioService,
  ) {}

  async procurar(
    municipioId: string,
    assunto: string,
    em = new Date(),
  ): Promise<ResultadoEncaminhar> {
    const regras = await this.db.query<LinhaRegra>(PROCURAR, [
      municipioId,
      assunto,
    ]);
    const [regra, ...outras] = regras;
    if (!regra) {
      return {
        encontrada: false,
        dizer:
          'Não tenho registo de que entidade trata disso. Procura no conhecimento ou passa a um funcionário.',
      };
    }
    if (eEmergencia(regra)) {
      return {
        encontrada: true,
        emergencia: true,
        entidade: regra.entidade,
        dizer: 'Ligue já para o 112.',
        instrucao:
          'Se há perigo para pessoas ou bens, diz já "ligue já para o 112" e chama a ferramenta emergencia. ' +
          'Se afinal não é uma emergência, ignora e pergunta melhor o que se passa.',
      };
    }

    const [linhas, aberto] = await Promise.all([
      this.db.query<LinhaContacto>(
        `SELECT id, tipo, rotulo, valor, horario FROM entidade_contactos
         WHERE entidade_id = $1 ORDER BY id`,
        [regra.entidade_id],
      ),
      this.horario.verificador(municipioId),
    ]);
    // O site da entidade também é um contacto, se não houver outro do tipo 'site'.
    if (regra.site_url && !linhas.some((l) => l.tipo === 'site')) {
      linhas.push({
        id: 'site',
        tipo: 'site',
        rotulo: null,
        valor: regra.site_url,
        horario: null,
      });
    }
    const dito = (l: LinhaContacto): ContactoDito => ({
      tipo: l.tipo,
      rotulo: l.rotulo,
      valor: l.valor,
      horario: horarioPorExtenso(l.horario),
      aberto_agora:
        l.tipo === 'email' || l.tipo === 'site' ? null : aberto(l.horario, em),
    });
    const { principal, outros } = escolherContacto(linhas, regra.contacto_id);
    const contacto = principal ? dito(principal) : null;
    return {
      encontrada: true,
      emergencia: false,
      assunto: regra.assunto,
      entidade: {
        nome: regra.entidade,
        tipo: regra.entidade_tipo,
        descricao: regra.entidade_descricao,
      },
      contacto,
      outros_contactos: outros.map(dito),
      passa_a_pessoa: regra.passa_a_pessoa,
      dizer: fraseEncaminhar(regra.entidade, contacto),
      outras_regras: outras.map((o) => ({
        assunto: o.assunto,
        entidade: o.entidade,
      })),
    };
  }

  /** Painel "Quem trata de quê": entidades com contactos e regras. */
  async listar(municipioId: string, em = new Date()) {
    const [entidades, aberto] = await Promise.all([
      this.db.query<{
        id: string;
        nome: string;
        tipo: string;
        descricao: string | null;
        site_url: string | null;
        ativo: boolean;
        contactos: LinhaContacto[];
        regras: {
          id: string;
          assunto: string;
          contacto_id: string | null;
          passa_a_pessoa: string | null;
          prioridade: number;
          ativo: boolean;
        }[];
      }>(
        `SELECT e.id, e.nome, e.tipo, e.descricao, e.site_url, e.ativo,
           coalesce((
             SELECT jsonb_agg(jsonb_build_object(
               'id', c.id, 'tipo', c.tipo, 'rotulo', c.rotulo, 'valor', c.valor,
               'horario', c.horario) ORDER BY c.tipo, c.id)
             FROM entidade_contactos c WHERE c.entidade_id = e.id
           ), '[]') AS contactos,
           coalesce((
             SELECT jsonb_agg(jsonb_build_object(
               'id', r.id, 'assunto', r.assunto, 'contacto_id', r.contacto_id,
               'passa_a_pessoa', r.passa_a_pessoa, 'prioridade', r.prioridade,
               'ativo', r.ativo) ORDER BY r.prioridade, r.assunto)
             FROM regras_encaminhamento r WHERE r.entidade_id = e.id
           ), '[]') AS regras
         FROM entidades e
         WHERE e.municipio_id = $1
         ORDER BY e.ativo DESC,
           array_position(ARRAY['emergencia','camara','empresa_municipal','junta','nacional','outra'], e.tipo),
           e.nome`,
        [municipioId],
      ),
      this.horario.verificador(municipioId),
    ]);
    return {
      itens: entidades.map((e) => ({
        ...e,
        contactos: e.contactos.map((c) => ({
          ...c,
          horario_texto: horarioPorExtenso(c.horario),
          aberto_agora:
            c.tipo === 'email' || c.tipo === 'site'
              ? null
              : aberto(c.horario, em),
        })),
      })),
    };
  }
}
