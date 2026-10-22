import { Global, Injectable, Module } from '@nestjs/common';
import type { UtilizadorPainel } from '../../common/pedido.js';
import { DatabaseService, Tx } from '../../database/database.service.js';

export type AmbitoRegras = 'licenca' | 'zona';

export interface AlteracaoVersao {
  campo: string;
  rotulo: string;
  antes: string;
  depois: string;
}

export interface VersaoRegras {
  versao: number;
  config: unknown;
  vigor_desde: string;
  /** O cargo de quem mudou (público); null nos valores iniciais. */
  cargo: string | null;
  alteracoes: AlteracaoVersao[];
  nota: string | null;
  /** Ainda não gravada: os valores por omissão (ou os da zona ao carregar). */
  inicial: boolean;
}

/** O cargo que aparece na página pública: o nome de quem mudou não é público. */
export const CARGOS: Record<UtilizadorPainel['perfil'], string> = {
  atendimento: 'Atendimento da câmara',
  tecnico: 'Técnico(a) da câmara',
  chefe_divisao: 'Chefe de divisão',
  vereador: 'Vereador(a)',
  admin: 'Administração do sistema da câmara',
  equipa_toucamara: 'Equipa técnica do Tou, Câmara?',
};

/** Muda quando há uma versão nova: as caches das páginas públicas usam-no. */
let geracao = 0;
export function geracaoRegras(): number {
  return geracao;
}
/** Para quem muda regras sem versão nova (ex.: carregar as zonas de demonstração). */
export function invalidarRegras(): void {
  geracao++;
}

interface LinhaVersao {
  versao: number;
  config: unknown;
  vigor_desde: Date;
  cargo: string | null;
  alteracoes: AlteracaoVersao[];
  nota: string | null;
}

function paraVersao(l: LinhaVersao): VersaoRegras {
  return {
    versao: l.versao,
    config: l.config,
    vigor_desde: l.vigor_desde.toISOString(),
    cargo: l.cargo,
    alteracoes: l.alteracoes ?? [],
    nota: l.nota,
    inicial: l.cargo === null,
  };
}

/**
 * O histórico das regras (licenças e zonas do PDM): cada gravação no painel
 * é uma versão nova, com o que mudou, quando e o cargo de quem mudou. Antes
 * da primeira gravação, as regras em vigor são a "versão 1 · valores
 * iniciais" (não gravada; materializa-se na primeira mudança).
 */
@Injectable()
export class RegrasVersoesService {
  constructor(private readonly db: DatabaseService) {}

  /**
   * Grava a versão nova (dentro da transação de quem grava as regras). Se
   * ainda não havia versões, grava primeiro as regras de antes como versão
   * 1, em vigor desde `inicialDesde`. Devolve o número da versão nova.
   */
  async registar(
    tx: Tx,
    v: {
      municipioId: string;
      ambito: AmbitoRegras;
      chave: string;
      antes: unknown;
      depois: unknown;
      alteracoes: AlteracaoVersao[];
      utilizador: UtilizadorPainel;
      inicialDesde: Date;
      nota?: string | null;
    },
  ): Promise<number> {
    await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
      `regras:${v.municipioId}:${v.ambito}:${v.chave}`,
    ]);
    const [ultima] = await tx.query<{ n: number | null }>(
      `SELECT max(versao)::int AS n FROM regras_versoes
       WHERE municipio_id = $1 AND ambito = $2 AND chave = $3`,
      [v.municipioId, v.ambito, v.chave],
    );
    let n = ultima?.n ?? 0;
    if (n === 0) {
      await tx.query(
        `INSERT INTO regras_versoes (municipio_id, ambito, chave, versao, config, vigor_desde, nota)
         VALUES ($1, $2, $3, 1, $4, $5, 'Valores iniciais.')`,
        [
          v.municipioId,
          v.ambito,
          v.chave,
          JSON.stringify(v.antes),
          v.inicialDesde,
        ],
      );
      n = 1;
    }
    const cargo = await this.cargoDe(tx, v.utilizador);
    await tx.query(
      `INSERT INTO regras_versoes (municipio_id, ambito, chave, versao, config, alterado_por, cargo,
         alteracoes, nota, vigor_desde)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, greatest(now(), $10::timestamptz + interval '1 millisecond'))`,
      [
        v.municipioId,
        v.ambito,
        v.chave,
        n + 1,
        JSON.stringify(v.depois),
        v.utilizador.id,
        cargo,
        JSON.stringify(v.alteracoes),
        v.nota ?? null,
        v.inicialDesde,
      ],
    );
    geracao++;
    return n + 1;
  }

  /** O número da versão em vigor agora (1 se ainda não houve mudanças). */
  async atual(
    q: Pick<Tx, 'query'>,
    municipioId: string,
    ambito: AmbitoRegras,
    chave: string,
  ): Promise<number> {
    const [r] = await q.query<{ n: number | null }>(
      `SELECT max(versao)::int AS n FROM regras_versoes
       WHERE municipio_id = $1 AND ambito = $2 AND chave = $3`,
      [municipioId, ambito, chave],
    );
    return r?.n ?? 1;
  }

  /**
   * As versões de um tipo ou zona, da mais recente para a mais antiga. Sem
   * nenhuma gravada, a versão 1 são as regras de agora (`atuais`), em vigor
   * desde `inicialDesde`.
   */
  async historico(
    municipioId: string,
    ambito: AmbitoRegras,
    chave: string,
    atuais: unknown,
    inicialDesde: Date,
  ): Promise<VersaoRegras[]> {
    const linhas = await this.db.query<LinhaVersao>(
      `SELECT versao, config, vigor_desde, cargo, alteracoes, nota FROM regras_versoes
       WHERE municipio_id = $1 AND ambito = $2 AND chave = $3 ORDER BY versao DESC`,
      [municipioId, ambito, chave],
    );
    if (linhas.length) return linhas.map(paraVersao);
    return [
      {
        versao: 1,
        config: atuais,
        vigor_desde: inicialDesde.toISOString(),
        cargo: null,
        alteracoes: [],
        nota: 'Valores iniciais.',
        inicial: true,
      },
    ];
  }

  /** Todas as versões gravadas do município, por "ambito:chave" (para o export). */
  async todas(municipioId: string): Promise<Map<string, VersaoRegras[]>> {
    const linhas = await this.db.query<
      LinhaVersao & { ambito: string; chave: string }
    >(
      `SELECT ambito, chave, versao, config, vigor_desde, cargo, alteracoes, nota FROM regras_versoes
       WHERE municipio_id = $1 ORDER BY ambito, chave, versao DESC`,
      [municipioId],
    );
    const m = new Map<string, VersaoRegras[]>();
    for (const l of linhas) {
      const k = `${l.ambito}:${l.chave}`;
      m.set(k, [...(m.get(k) ?? []), paraVersao(l)]);
    }
    return m;
  }

  /** "Técnico(a) da câmara · Divisão de Urbanismo". */
  private async cargoDe(tx: Tx, u: UtilizadorPainel): Promise<string> {
    const base = CARGOS[u.perfil] ?? 'Câmara municipal';
    if (!u.servicoId) return base;
    const [s] = await tx.query<{ nome: string }>(
      'SELECT nome FROM servicos WHERE id = $1',
      [u.servicoId],
    );
    return s ? `${base} · ${s.nome}` : base;
  }
}

/** Global: as licenças e o ordenamento gravam versões; as páginas públicas leem-nas. */
@Global()
@Module({ providers: [RegrasVersoesService], exports: [RegrasVersoesService] })
export class RegrasVersoesModule {}
