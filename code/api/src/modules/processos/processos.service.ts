import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  diasUteisEntre,
  hojeLisboa,
  somarDiasUteis,
} from '../../common/dias-uteis.js';
import { ErroApi } from '../../common/erros.js';
import { proximoNumero } from '../../common/numeracao.js';
import { DatabaseService, Tx } from '../../database/database.service.js';
import { ContextoFerramenta } from '../../ferramentas/ferramenta.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { LinksCurtosService } from '../comunicacao/links-curtos.service.js';
import { MensagensService } from '../comunicacao/mensagens.service.js';
import { MunicipiosService } from '../municipios/municipios.service.js';
import { Dados, primeiroDoTipo } from './formulario.js';
import {
  correspondeNumero,
  Fase,
  FASE_EM_PALAVRAS,
  FASE_ROTULO,
  FASES_FECHADAS,
  formatarNumero,
  lerNumero,
  resumirDocumentos,
} from './regras.js';
import {
  TipoProcesso,
  TiposProcessoService,
} from './tipos-processo.service.js';

type Q = Pick<Tx, 'query'>;

export interface RequerimentoAEntregar {
  id: string;
  municipio_id: string;
  municipe_id: string | null;
  conversa_id: string | null;
  dados: Dados;
}

export interface ProcessoCriado {
  processo_id: string;
  numero: string;
  fase: Fase;
  prazo_fim: string | null;
  documentos_em_falta: string[];
  link: string;
}

/** 'AAAA-MM-DD' → 'DD/MM' (o que se diz e se escreve num SMS). */
export function diaMes(iso: string): string {
  const [, m, d] = iso.split('-');
  return `${d}/${m}`;
}

/**
 * Processos: criados quando o requerimento é entregue, consultados pelo
 * agente (estado_processo) e pela página do link do SMS.
 */
@Injectable()
export class ProcessosService {
  constructor(
    private readonly db: DatabaseService,
    private readonly config: ConfigService,
    private readonly tipos: TiposProcessoService,
    private readonly municipios: MunicipiosService,
    private readonly links: LinksCurtosService,
    private readonly mensagens: MensagensService,
    private readonly auditoria: AuditoriaService,
  ) {}

  /** O link curto do processo: reaproveita um válido, senão cria. */
  async linkProcesso(
    municipioId: string,
    processoId: string,
    tx?: Tx,
  ): Promise<string> {
    const q = tx ?? this.db;
    const [l] = await q.query<{ codigo: string }>(
      `SELECT codigo FROM links_curtos
       WHERE destino_tipo = 'processo' AND destino_id = $1 AND expira_em > now() + interval '7 days'
       ORDER BY expira_em DESC LIMIT 1`,
      [processoId],
    );
    if (l)
      return `${this.config.get<string>('app.webUrl') ?? ''}/r/${l.codigo}`;
    return (await this.links.criar(municipioId, 'processo', processoId, { tx }))
      .url;
  }

  /**
   * O que falta da parte do munícipe: obrigatórios do tipo por entregar e
   * documentos pedidos pelo técnico depois dos quais ainda não chegou nada.
   */
  async emFalta(
    processo: { id: string; tipo_processo_id: string },
    q: Q = this.db,
  ): Promise<{ tem: string[]; faltam: string[] }> {
    const [exigidos, pedidos] = await Promise.all([
      this.tipos.documentos(
        processo.tipo_processo_id,
        { processoId: processo.id },
        q,
      ),
      q.query<{ nome: string; satisfeito: boolean }>(
        `SELECT e.dados->>'nome' AS nome,
                EXISTS (
                  SELECT 1 FROM documentos x
                  WHERE x.processo_id = e.processo_id AND x.recebido_em > e.em
                    AND x.verificacao_estado NOT IN ('documento_errado', 'ilegivel', 'fora_de_prazo')
                    AND x.tipo_documento_id IS NOT DISTINCT FROM (e.dados->>'tipo_documento_id')::uuid
                ) AS satisfeito
         FROM processo_eventos e
         WHERE e.processo_id = $1 AND e.tipo = 'documento_pedido'
         ORDER BY e.em`,
        [processo.id],
      ),
    ]);
    const r = resumirDocumentos(exigidos);
    for (const p of pedidos) {
      if (!p.satisfeito && p.nome && !r.faltam.includes(p.nome))
        r.faltam.push(p.nome);
    }
    return r;
  }

  /**
   * Entrega do requerimento assinado, dentro da transação de quem chama:
   * número da série do tipo, fase 'entrada' (ou 'documentos' se faltarem
   * obrigatórios), prazo só com o processo completo, documentos passam para
   * o processo, evento 'criado' e SMS com o link do processo.
   */
  async criarDeRequerimento(
    tx: Tx,
    req: RequerimentoAEntregar,
    tipo: TipoProcesso,
  ): Promise<ProcessoCriado> {
    const municipio = await this.municipios.porId(req.municipio_id);
    const hoje = hojeLisboa();
    const ano = Number(hoje.slice(0, 4));
    const n = await proximoNumero(tx, req.municipio_id, tipo.codigo, ano);
    const numero = formatarNumero(tipo.codigo, n, ano);

    const docs = await this.tipos.documentos(
      tipo.id,
      { requerimentoId: req.id },
      tx,
    );
    const { faltam } = resumirDocumentos(docs);
    const completo = faltam.length === 0;
    const fase: Fase = completo ? 'entrada' : 'documentos';
    const prazoFim = completo
      ? somarDiasUteis(
          hoje,
          tipo.prazo_dias_uteis,
          await this.municipios.feriados(req.municipio_id),
        )
      : null;

    const assunto =
      (typeof req.dados.assunto === 'string' && req.dados.assunto) ||
      (typeof req.dados.descricao === 'string' &&
        req.dados.descricao.slice(0, 200)) ||
      tipo.nome;
    const morada = primeiroDoTipo(tipo.formulario, req.dados, 'morada');
    const freguesia =
      typeof req.dados.freguesia === 'string' ? req.dados.freguesia : null;

    const [p] = await tx.query<{ id: string }>(
      `INSERT INTO processos (municipio_id, numero, tipo_processo_id, municipe_id, conversa_origem_id,
         assunto, morada, freguesia, fase, prazo_inicio, prazo_fim)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING id`,
      [
        req.municipio_id,
        numero,
        tipo.id,
        req.municipe_id,
        req.conversa_id,
        assunto,
        morada,
        freguesia,
        fase,
        completo ? hoje : null,
        prazoFim,
      ],
    );
    await tx.query(
      `UPDATE requerimentos SET processo_id = $2, estado = 'entregue', atualizado_em = now() WHERE id = $1`,
      [req.id, p.id],
    );
    await tx.query(
      `UPDATE documentos SET processo_id = $2 WHERE requerimento_id = $1`,
      [req.id, p.id],
    );
    await tx.query(
      `INSERT INTO processo_eventos (processo_id, tipo, descricao, ator_tipo, ator_id, dados)
       VALUES ($1, 'criado', $2, 'municipe', $3, $4)`,
      [
        p.id,
        completo
          ? `Requerimento entregue. Processo ${numero} aberto.`
          : `Requerimento entregue. Processo ${numero} aberto, à espera de: ${faltam.join(', ')}.`,
        req.municipe_id,
        JSON.stringify({ requerimento_id: req.id, faltam }),
      ],
    );

    const link = await this.linkProcesso(req.municipio_id, p.id, tx);
    const telefone = await this.telefoneDe(req.municipe_id, tx);
    if (telefone) {
      await this.mensagens.sms(
        {
          municipioId: req.municipio_id,
          municipeId: req.municipe_id,
          destino: telefone,
          motivo: 'processo',
          corpo:
            `${municipio.nome}: o seu pedido deu entrada como processo ${numero}. ` +
            (completo
              ? `Resposta até ${diaMes(prazoFim!)}. `
              : `Falta entregar: ${faltam.join(', ')}. `) +
            `Acompanhe aqui: ${link}`,
          relacionado: { processo_id: p.id, requerimento_id: req.id },
          chave: `processo_criado:${p.id}`,
        },
        tx,
      );
    }
    return {
      processo_id: p.id,
      numero,
      fase,
      prazo_fim: prazoFim,
      documentos_em_falta: faltam,
      link,
    };
  }

  async telefoneDe(
    municipeId: string | null,
    q: Q = this.db,
  ): Promise<string | null> {
    if (!municipeId) return null;
    const [m] = await q.query<{ telefone_e164: string | null }>(
      'SELECT telefone_e164 FROM municipes WHERE id = $1 AND anonimizado_em IS NULL',
      [municipeId],
    );
    return m?.telefone_e164 ?? null;
  }

  /** Dias úteis até ao fim do prazo (null sem prazo ou com o processo fechado). */
  async diasRestantes(
    municipioId: string,
    prazoFim: string | null,
    fase: Fase,
  ): Promise<number | null> {
    if (!prazoFim || FASES_FECHADAS.includes(fase)) return null;
    return diasUteisEntre(
      hojeLisboa(),
      prazoFim,
      await this.municipios.feriados(municipioId),
    );
  }

  /** A ferramenta estado_processo: os processos do munícipe da conversa. */
  async estadoParaAgente(ctx: ContextoFerramenta, numero?: string) {
    const precisaIdentificacao = {
      precisa_identificacao: true,
      instrucao:
        'Para dar informação sobre processos é preciso identificar a pessoa: peça o NIF e use identificar_municipe; depois volte a chamar esta ferramenta.',
    };
    if (!ctx.municipeId) return precisaIdentificacao;

    const [municipe] = await this.db.query<{ tem_nif: boolean }>(
      'SELECT nif_hash IS NOT NULL AS tem_nif FROM municipes WHERE id = $1',
      [ctx.municipeId],
    );
    const linhas = await this.db.query<{
      id: string;
      numero: string;
      tipo: string;
      tipo_processo_id: string;
      fase: Fase;
      decisao: string | null;
      prazo_fim: string | null;
      ultimo_evento: { descricao: string; em: string } | null;
    }>(
      `SELECT p.id, p.numero, t.nome AS tipo, p.tipo_processo_id, p.fase, p.decisao,
              to_char(p.prazo_fim, 'YYYY-MM-DD') AS prazo_fim,
              (SELECT jsonb_build_object('descricao', e.descricao, 'em', e.em)
               FROM processo_eventos e
               WHERE e.processo_id = p.id AND NOT e.interno
               ORDER BY e.em DESC, e.id DESC LIMIT 1) AS ultimo_evento
       FROM processos p
       JOIN tipos_processo t ON t.id = p.tipo_processo_id
       WHERE p.municipio_id = $1 AND p.municipe_id = $2
       ORDER BY p.criado_em DESC
       LIMIT 20`,
      [ctx.municipio.id, ctx.municipeId],
    );
    // Só pelo número de telefone pode não ser a mesma pessoa dos processos.
    if (linhas.length === 0 && !municipe?.tem_nif) return precisaIdentificacao;
    if (linhas.length === 0) {
      return {
        encontrado: false,
        mensagem: 'Esta pessoa não tem processos na câmara.',
      };
    }

    let escolhidos = linhas;
    if (numero) {
      const dito = lerNumero(numero);
      escolhidos = dito
        ? linhas.filter((l) => correspondeNumero(l.numero, dito))
        : [];
      if (escolhidos.length === 0) {
        return {
          encontrado: false,
          mensagem: `Não há nenhum processo "${numero}" em nome desta pessoa.`,
          processos_da_pessoa: linhas.map((l) => l.numero),
        };
      }
    } else {
      const abertos = linhas.filter((l) => l.fase !== 'arquivado');
      escolhidos = (abertos.length ? abertos : linhas).slice(0, 3);
    }

    const processos = await Promise.all(
      escolhidos.map(async (l) => {
        const [dias, docs] = await Promise.all([
          this.diasRestantes(ctx.municipio.id, l.prazo_fim, l.fase),
          this.emFalta(l),
        ]);
        return {
          numero: l.numero,
          tipo: l.tipo,
          fase: FASE_ROTULO[l.fase],
          dias_uteis_restantes: dias,
          prazo_fim: l.prazo_fim,
          falta_da_sua_parte: docs.faltam,
          ultimo_evento: l.ultimo_evento,
          decisao: l.decisao,
          resumo: resumoFalado(
            l.numero,
            l.fase,
            l.prazo_fim,
            dias,
            docs.faltam,
            l.decisao,
          ),
        };
      }),
    );
    // Cada consulta pelo agente conta em "o que o agente tratou esta semana"
    // (mv_trabalho_feito_semana lê o audit_log).
    await Promise.all(
      escolhidos.map((l) =>
        this.auditoria.registar({
          municipioId: ctx.municipio.id,
          atorTipo: 'agente',
          acao: 'consultar',
          objetoTipo: 'processo',
          objetoId: l.id,
          dados: { canal: ctx.canal, conversa_id: ctx.conversaId },
        }),
      ),
    );
    return { encontrado: true, processos };
  }

  /** GET /public/processos/:codigo — página "O seu processo". */
  async publico(codigo: string) {
    const { destinoId, municipioId } = await this.links.resolver(
      codigo,
      'processo',
    );
    const [p] = await this.db.query<{
      id: string;
      numero: string;
      tipo_processo_id: string;
      tipo: string;
      assunto: string;
      fase: Fase;
      decisao: string | null;
      decidido_em: Date | null;
      prazo_inicio: string | null;
      prazo_fim: string | null;
      criado_em: Date;
      requerimento_token: string | null;
      municipio: string;
    }>(
      `SELECT p.id, p.numero, p.tipo_processo_id, t.nome AS tipo, p.assunto, p.fase, p.decisao,
              p.decidido_em, to_char(p.prazo_inicio, 'YYYY-MM-DD') AS prazo_inicio,
              to_char(p.prazo_fim, 'YYYY-MM-DD') AS prazo_fim, p.criado_em,
              (SELECT r.token_publico FROM requerimentos r WHERE r.processo_id = p.id LIMIT 1) AS requerimento_token,
              m.nome AS municipio
       FROM processos p
       JOIN tipos_processo t ON t.id = p.tipo_processo_id
       JOIN municipios m ON m.id = p.municipio_id
       WHERE p.id = $1 AND p.municipio_id = $2`,
      [destinoId, municipioId],
    );
    if (!p) {
      throw new ErroApi(
        HttpStatus.NOT_FOUND,
        'nao_encontrado',
        'Processo não existe.',
      );
    }
    const [eventos, docs, dias] = await Promise.all([
      this.db.query<{ em: Date; tipo: string; descricao: string }>(
        `SELECT em, tipo, descricao FROM processo_eventos
         WHERE processo_id = $1 AND NOT interno ORDER BY em, id`,
        [p.id],
      ),
      this.emFalta(p),
      this.diasRestantes(municipioId, p.prazo_fim, p.fase),
    ]);
    return {
      municipio: p.municipio,
      numero: p.numero,
      tipo: p.tipo,
      assunto: p.assunto,
      fase: p.fase,
      fase_rotulo: FASE_ROTULO[p.fase],
      fase_em_palavras: FASE_EM_PALAVRAS[p.fase],
      decisao: p.decisao,
      decidido_em: p.decidido_em,
      criado_em: p.criado_em,
      prazo: {
        inicio: p.prazo_inicio,
        fim: p.prazo_fim,
        dias_uteis_restantes: dias,
        // Sem início: o prazo só começa a contar com os documentos todos.
        a_contar: p.prazo_inicio !== null,
      },
      documentos: docs,
      linha_do_tempo: eventos,
      // A página envia documentos pelo token do requerimento (POST /public/requerimentos/:token/documentos).
      requerimento_token: p.requerimento_token,
    };
  }
}

/** A frase que o agente diz sobre um processo. */
export function resumoFalado(
  numero: string,
  fase: Fase,
  prazoFim: string | null,
  dias: number | null,
  faltam: string[],
  decisao: string | null,
): string {
  const partes = [`O processo ${numero} ${FASE_EM_PALAVRAS[fase]}.`];
  if (decisao && FASES_FECHADAS.includes(fase)) {
    partes.push(
      `A decisão foi: ${decisao === 'admitido' ? 'admitido' : 'indeferido'}.`,
    );
  } else if (prazoFim && dias !== null) {
    if (dias > 0) {
      partes.push(
        `${dias === 1 ? 'Falta 1 dia útil' : `Faltam ${dias} dias úteis`} para o fim do prazo, a ${diaMes(prazoFim)}.`,
      );
    } else if (dias === 0) {
      partes.push('O prazo de resposta termina hoje.');
    } else {
      partes.push(
        `O prazo de resposta da câmara terminou a ${diaMes(prazoFim)}.`,
      );
    }
  } else if (!prazoFim) {
    partes.push('O prazo ainda não começou a contar.');
  }
  if (faltam.length)
    partes.push(`Da sua parte falta entregar: ${faltam.join(', ')}.`);
  return partes.join(' ');
}
