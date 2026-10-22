import { HttpStatus, Injectable } from '@nestjs/common';
import { randomInt } from 'crypto';
import { z } from 'zod';
import { ErroApi } from '../../common/erros.js';
import type { UtilizadorPainel } from '../../common/pedido.js';
import { DatabaseService, Tx } from '../../database/database.service.js';
import type { ContextoFerramenta } from '../../ferramentas/ferramenta.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { MensagensService } from '../comunicacao/mensagens.service.js';
import {
  Municipio,
  MunicipiosService,
} from '../municipios/municipios.service.js';
import {
  ATIVIDADES_DEMO,
  ALUNOS_DEMO,
  ESCOLAS_DEMO,
} from './escolas.conteudo.js';
import {
  agoraLisboa,
  Ano,
  avaliarTransporte,
  contaDoMes,
  diaDeAulas,
  Escalao,
  escalaoDoAbono,
  escolherPorNome,
  eurosTexto,
  podeAlterarRefeicao,
  precoRefeicao,
  REGRAS_ESCOLAS,
  ROTULO_ANO,
  ROTULO_ESCALAO,
  somarDias,
} from './regras.js';

// ---------------------------------------------------------------------------
// Entradas das ações do catálogo (área "escolas")
// ---------------------------------------------------------------------------

const nomeAluno = z
  .string()
  .trim()
  .min(2)
  .max(120)
  .describe('Nome da criança (o aluno).');
const ano = z
  .enum(['pre', '1', '2', '3', '4'])
  .describe('Ano que frequenta: pre (pré-escolar) ou 1 a 4.');

export const entradaInscreverCantina = z.object({
  nome_aluno: nomeAluno,
  escola: z.string().trim().min(2).max(120).describe('Escola que frequenta.'),
  ano,
  escalao_abono: z
    .number()
    .int()
    .min(1)
    .max(6)
    .optional()
    .describe('Escalão do abono de família, se souber (1 a 6).'),
  alergias: z
    .string()
    .trim()
    .max(300)
    .optional()
    .describe(
      'Alergias ou dieta especial (fica só para a escola e a cozinha).',
    ),
});

export const entradaMarcarRefeicao = z.object({
  nome_aluno: nomeAluno,
  dia: z.iso.date().describe('Dia da refeição.'),
  marcar: z.boolean().describe('Marcar (sim) ou desmarcar (não) a refeição?'),
});

export const entradaSituacaoAluno = z.object({ nome_aluno: nomeAluno });

export const entradaPedirTransporte = z.object({
  nome_aluno: nomeAluno,
  morada: z.string().trim().min(5).max(200).describe('Morada de casa.'),
  escola: z
    .string()
    .trim()
    .min(2)
    .max(120)
    .optional()
    .describe('Escola (se não for a que já conhecemos).'),
  distancia_km: z
    .number()
    .min(0)
    .max(100)
    .optional()
    .describe('Distância aproximada de casa à escola, em km, se souber.'),
});

export const entradaAtividades = z.object({
  tipo: z
    .enum(['aec', 'ferias'])
    .optional()
    .describe(
      'aec (atividades depois das aulas) ou ferias (férias desportivas).',
    ),
  escola: z.string().trim().min(2).max(120).optional().describe('Escola.'),
});

export const entradaInscreverAtividade = z.object({
  nome_aluno: nomeAluno,
  atividade: z
    .string()
    .trim()
    .min(2)
    .max(120)
    .describe('Código ou nome da atividade (de atividades).'),
});

export const entradaPreInscricao = z.object({
  nome_crianca: nomeAluno.describe('Nome da criança.'),
  data_nascimento: z.iso.date().describe('Data de nascimento da criança.'),
  escolas_preferidas: z
    .array(z.string().trim().min(2))
    .min(1)
    .max(5)
    .describe('Jardins de infância preferidos, por ordem.'),
});

// ---------------------------------------------------------------------------

const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function novoCodigo(): string {
  return `ESC-${Array.from({ length: 6 }, () => ALFABETO[randomInt(ALFABETO.length)]).join('')}`;
}

const DIA_EXTENSO = new Intl.DateTimeFormat('pt-PT', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  timeZone: 'UTC',
});
function porExtenso(dia: string): string {
  return DIA_EXTENSO.format(new Date(`${dia}T12:00:00Z`));
}

interface Encarregado {
  id: string;
  nome: string | null;
  telefone: string | null;
}

export interface EscolaLinha {
  id: string;
  nome: string;
  agrupamento: string | null;
  nivel: 'pre_escolar' | '1_ciclo' | 'ambos';
  tem_cantina: boolean;
  demonstracao: boolean;
}

interface AlunoLinha {
  id: string;
  nome: string;
  escola_id: string | null;
  escola: string | null;
  ano: Ano | null;
  escalao: Escalao;
  saldo_cent: number;
}

export interface AtividadeLinha {
  id: string;
  codigo: string;
  tipo: 'aec' | 'ferias';
  nome: string;
  descricao: string | null;
  escola_id: string | null;
  escola: string | null;
  anos: string[];
  horario: string | null;
  inicio: string | null;
  fim: string | null;
  vagas: number;
  inscritos: number;
  preco_cent: number;
  demonstracao: boolean;
}

const SQL_ATIVIDADES = `
  SELECT a.id, a.codigo, a.tipo, a.nome, a.descricao, a.escola_id, e.nome AS escola,
         a.anos, a.horario, a.inicio::text, a.fim::text, a.vagas, a.preco_cent, a.demonstracao,
         (SELECT count(*)::int FROM escolas_inscricoes i
          WHERE i.atividade_id = a.id AND i.estado = 'ativa') AS inscritos
  FROM escolas_atividades a LEFT JOIN escolas e ON e.id = a.escola_id
  WHERE a.municipio_id = $1`;

export const esquemaDecidirTransporte = z.object({
  decisao: z.enum(['aprovar', 'recusar']),
  motivo: z.string().trim().max(500).optional(),
});

/**
 * Escolas (V4 #3): refeições, transporte escolar, atividades e pré-escolar.
 * As ações do agente estão no catálogo de serviços (área "escolas"); o
 * painel vê alunos, inscrições, pedidos de transporte e as refeições do dia.
 */
@Injectable()
export class EscolasService {
  constructor(
    private readonly db: DatabaseService,
    private readonly auditoria: AuditoriaService,
    private readonly mensagens: MensagensService,
    private readonly municipios: MunicipiosService,
  ) {}

  // -------------------------------------------------------------------
  // Agente: quem é o encarregado e qual é o aluno
  // -------------------------------------------------------------------

  /** O encarregado identificado pelo NIF (na porta das IAs, pela chave pessoal). */
  private async encarregado(
    ctx: ContextoFerramenta,
  ): Promise<Encarregado | null> {
    if (!ctx.municipeId) return null;
    const [mu] = await this.db.query<Encarregado & { tem_nif: boolean }>(
      `SELECT id, nome, telefone_e164 AS telefone, nif_hash IS NOT NULL AS tem_nif
       FROM municipes WHERE id = $1 AND municipio_id = $2 AND anonimizado_em IS NULL`,
      [ctx.municipeId, ctx.municipio.id],
    );
    if (!mu || !(mu.tem_nif || ctx.canal === 'ia')) return null;
    return { id: mu.id, nome: mu.nome, telefone: mu.telefone };
  }

  private semIdentificacao() {
    return {
      feito: false,
      motivo: 'precisa_identificacao',
      instrucao:
        'Os dados dos alunos são de menores: só o encarregado de educação pode tratar disto. Pede o NIF do encarregado e usa identificar_municipe; depois chama outra vez pedir_servico com os mesmos dados.',
    };
  }

  private async alunosDe(encarregadoId: string): Promise<AlunoLinha[]> {
    return this.db.query<AlunoLinha>(
      `SELECT a.id, a.nome, a.escola_id, e.nome AS escola, a.ano, a.escalao, a.saldo_cent
       FROM escolas_alunos a LEFT JOIN escolas e ON e.id = a.escola_id
       WHERE a.encarregado_id = $1 ORDER BY a.nome`,
      [encarregadoId],
    );
  }

  /** O aluno pelo nome dito, entre os educandos deste encarregado. */
  private async aluno(
    encarregadoId: string,
    nome: string,
  ): Promise<{ aluno: AlunoLinha } | { resposta: Record<string, unknown> }> {
    const lista = await this.alunosDe(encarregadoId);
    const r = escolherPorNome(lista, nome);
    if ('um' in r) return { aluno: r.um };
    if ('varios' in r) {
      return {
        resposta: {
          feito: false,
          motivo: 'precisa_escolher',
          opcoes: r.varios.map((a) => a.nome),
          dizer: `Qual deles: ${r.varios.map((a) => a.nome).join(' ou ')}?`,
        },
      };
    }
    return {
      resposta: {
        feito: false,
        motivo: 'aluno_nao_encontrado',
        educandos: lista.map((a) => a.nome),
        dizer: lista.length
          ? `Não encontro ${nome} entre os seus educandos (${lista.map((a) => a.nome).join(', ')}). Pode dizer o nome como está na escola?`
          : 'Ainda não tem nenhum educando registado na câmara. Comece por inscrevê-lo na cantina, no transporte ou no pré-escolar.',
      },
    };
  }

  private async escolasDe(m: string): Promise<EscolaLinha[]> {
    return this.db.query<EscolaLinha>(
      `SELECT id, nome, agrupamento, nivel, tem_cantina, demonstracao
       FROM escolas WHERE municipio_id = $1 ORDER BY nome`,
      [m],
    );
  }

  private async escola(
    m: string,
    nome: string,
    filtro: (e: EscolaLinha) => boolean = () => true,
  ): Promise<{ escola: EscolaLinha } | { resposta: Record<string, unknown> }> {
    const lista = (await this.escolasDe(m)).filter(filtro);
    const r = escolherPorNome(lista, nome);
    if ('um' in r) return { escola: r.um };
    const opcoes = ('varios' in r ? r.varios : lista)
      .slice(0, 8)
      .map((e) => e.nome);
    return {
      resposta: {
        feito: false,
        motivo: 'precisa_escolher',
        campo: 'escola',
        opcoes,
        dizer: opcoes.length
          ? `Qual é a escola? ${opcoes.join('; ')}.`
          : 'Não tenho a lista das escolas do concelho. Passe a um funcionário da educação.',
      },
    };
  }

  private async feriados(m: string): Promise<Set<string>> {
    return this.municipios.feriados(m);
  }

  private async proximoDiaDeAulas(m: string, hoje: string): Promise<string> {
    const fer = await this.feriados(m);
    let d = somarDias(hoje, 1);
    while (!diaDeAulas(d, fer)) d = somarDias(d, 1);
    return d;
  }

  // -------------------------------------------------------------------
  // Agente: as ações
  // -------------------------------------------------------------------

  async inscreverCantina(
    ctx: ContextoFerramenta,
    e: z.output<typeof entradaInscreverCantina>,
  ) {
    const enc = await this.encarregado(ctx);
    if (!enc) return this.semIdentificacao();
    const m = ctx.municipio;
    const es = await this.escola(m.id, e.escola, (x) => x.tem_cantina);
    if ('resposta' in es) return es.resposta;
    const escola = es.escola;
    const escalaoNovo =
      e.escalao_abono !== undefined ? escalaoDoAbono(e.escalao_abono) : null;
    const desde = await this.proximoDiaDeAulas(m.id, agoraLisboa().dia);

    const r = await this.db.transaction(async (tx) => {
      const alunoId = await this.guardarAluno(tx, m.id, enc.id, {
        nome: e.nome_aluno,
        escolaId: escola.id,
        ano: e.ano,
        escalao: escalaoNovo,
        alergias: e.alergias ?? null,
      });
      const [ja] = await tx.query<{ codigo: string; desde: string }>(
        `SELECT codigo, desde::text FROM escolas_inscricoes
         WHERE aluno_id = $1 AND tipo = 'cantina' AND estado = 'ativa'`,
        [alunoId],
      );
      if (ja) return { alunoId, codigo: ja.codigo, desde: ja.desde, ja: true };
      const codigo = novoCodigo();
      await tx.query(
        `INSERT INTO escolas_inscricoes (municipio_id, aluno_id, tipo, estado, codigo, desde, conversa_id)
         VALUES ($1, $2, 'cantina', 'ativa', $3, $4, $5)`,
        [m.id, alunoId, codigo, desde, ctx.conversaId],
      );
      await this.auditoria.registar(
        {
          municipioId: m.id,
          atorTipo: 'agente',
          acao: 'inscrever_cantina',
          objetoTipo: 'aluno_escola',
          objetoId: alunoId,
          dados: { codigo, escola: escola.nome },
        },
        tx,
      );
      return { alunoId, codigo, desde, ja: false };
    });

    const [a] = await this.db.query<{ escalao: Escalao }>(
      'SELECT escalao FROM escolas_alunos WHERE id = $1',
      [r.alunoId],
    );
    const preco = precoRefeicao(a.escalao);
    const precoTxt = preco === 0 ? 'é gratuita' : `custa ${eurosTexto(preco)}`;
    return {
      feito: true,
      ja_estava_inscrito: r.ja || undefined,
      codigo: r.codigo,
      aluno: e.nome_aluno,
      escola: escola.nome,
      escalao: ROTULO_ESCALAO[a.escalao],
      preco_refeicao: eurosTexto(preco),
      desde: r.desde,
      // A informação de saúde não volta: diz-se só que ficou registada.
      saude_registada: e.alergias ? true : undefined,
      valores_de_demonstracao: true,
      dizer: [
        r.ja
          ? `${e.nome_aluno} já estava inscrito na cantina da ${escola.nome}.`
          : `Inscrevi ${e.nome_aluno} na cantina da ${escola.nome} a partir de ${porExtenso(r.desde)}.`,
        `Com ${ROTULO_ESCALAO[a.escalao]}, cada refeição ${precoTxt}.`,
        e.alergias
          ? 'A informação sobre alergias ficou registada para a escola e a cozinha.'
          : '',
        `O código é ${r.codigo}. Os preços ainda estão por confirmar pela câmara.`,
      ]
        .filter(Boolean)
        .join(' '),
    };
  }

  /** Cria o aluno do encarregado ou atualiza o que veio (pelo nome). */
  private async guardarAluno(
    tx: Tx,
    municipioId: string,
    encarregadoId: string,
    a: {
      nome: string;
      escolaId: string | null;
      ano: Ano;
      escalao: Escalao | null;
      alergias: string | null;
      dataNascimento?: string | null;
    },
  ): Promise<string> {
    const lista = await tx.query<{ id: string; nome: string }>(
      'SELECT id, nome FROM escolas_alunos WHERE encarregado_id = $1',
      [encarregadoId],
    );
    const r = escolherPorNome(lista, a.nome);
    if ('um' in r) {
      await tx.query(
        `UPDATE escolas_alunos SET
           escola_id = coalesce($2, escola_id), ano = $3,
           escalao = coalesce($4, escalao), alergias = coalesce($5, alergias),
           data_nascimento = coalesce($6, data_nascimento)
         WHERE id = $1`,
        [
          r.um.id,
          a.escolaId,
          a.ano,
          a.escalao,
          a.alergias,
          a.dataNascimento ?? null,
        ],
      );
      return r.um.id;
    }
    const [n] = await tx.query<{ id: string }>(
      `INSERT INTO escolas_alunos (municipio_id, encarregado_id, nome, escola_id, ano, escalao, alergias, data_nascimento)
       VALUES ($1, $2, $3, $4, $5, coalesce($6, 'sem'), $7, $8) RETURNING id`,
      [
        municipioId,
        encarregadoId,
        a.nome,
        a.escolaId,
        a.ano,
        a.escalao,
        a.alergias,
        a.dataNascimento ?? null,
      ],
    );
    return n.id;
  }

  async marcarRefeicao(
    ctx: ContextoFerramenta,
    e: z.output<typeof entradaMarcarRefeicao>,
  ) {
    const enc = await this.encarregado(ctx);
    if (!enc) return this.semIdentificacao();
    const al = await this.aluno(enc.id, e.nome_aluno);
    if ('resposta' in al) return al.resposta;
    const a = al.aluno;
    const [cantina] = await this.db.query<{ desde: string }>(
      `SELECT desde::text FROM escolas_inscricoes
       WHERE aluno_id = $1 AND tipo = 'cantina' AND estado = 'ativa'`,
      [a.id],
    );
    if (!cantina || !a.escola_id) {
      return {
        feito: false,
        motivo: 'sem_cantina',
        dizer: `${a.nome} não está inscrito na cantina. Quer que o inscreva?`,
      };
    }
    const pode = podeAlterarRefeicao(
      e.dia,
      await this.feriados(ctx.municipio.id),
    );
    if (!pode.ok)
      return { feito: false, motivo: pode.motivo, dizer: pode.dizer };
    await this.db.query(
      `INSERT INTO escolas_refeicoes (aluno_id, dia, marcada) VALUES ($1, $2, $3)
       ON CONFLICT (aluno_id, dia) DO UPDATE SET marcada = EXCLUDED.marcada, alterada_em = now()`,
      [a.id, e.dia, e.marcar],
    );
    return {
      feito: true,
      aluno: a.nome,
      dia: e.dia,
      marcada: e.marcar,
      dizer: `Ficou ${e.marcar ? 'marcada' : 'desmarcada'} a refeição de ${a.nome} de ${porExtenso(e.dia)}.`,
    };
  }

  async situacaoAluno(
    ctx: ContextoFerramenta,
    e: z.output<typeof entradaSituacaoAluno>,
  ) {
    const enc = await this.encarregado(ctx);
    if (!enc) return this.semIdentificacao();
    const al = await this.aluno(enc.id, e.nome_aluno);
    if ('resposta' in al) return al.resposta;
    const a = al.aluno;
    const hoje = agoraLisboa().dia;
    const mes = hoje.slice(0, 7);
    const [cantina] = await this.db.query<{ desde: string }>(
      `SELECT desde::text FROM escolas_inscricoes
       WHERE aluno_id = $1 AND tipo = 'cantina' AND estado = 'ativa'`,
      [a.id],
    );
    const excecoes = await this.db.query<{ dia: string; marcada: boolean }>(
      `SELECT dia::text, marcada FROM escolas_refeicoes
       WHERE aluno_id = $1 AND dia >= $2::date - 40`,
      [a.id, hoje],
    );
    const conta = contaDoMes({
      mes,
      desde: cantina?.desde ?? null,
      escalao: a.escalao,
      excecoes: new Map(excecoes.map((x) => [x.dia, x.marcada])),
      feriados: await this.feriados(ctx.municipio.id),
    });
    const desmarcadas = excecoes
      .filter((x) => !x.marcada && x.dia > hoje)
      .map((x) => x.dia)
      .sort();
    const [transporte] = await this.db.query<{
      codigo: string;
      estado: string;
      motivo: string | null;
    }>(
      `SELECT codigo, estado, motivo FROM escolas_transporte
       WHERE aluno_id = $1 ORDER BY criado_em DESC LIMIT 1`,
      [a.id],
    );
    const inscricoes = await this.db.query<{
      tipo: string;
      estado: string;
      atividade: string | null;
      codigo: string;
    }>(
      `SELECT i.tipo, i.estado, t.nome AS atividade, i.codigo
       FROM escolas_inscricoes i LEFT JOIN escolas_atividades t ON t.id = i.atividade_id
       WHERE i.aluno_id = $1 AND i.tipo <> 'cantina' AND i.estado <> 'cancelada'
       ORDER BY i.criado_em`,
      [a.id],
    );
    const ESTADO_TRANSPORTE: Record<string, string> = {
      pendente: 'está a ser analisado',
      aprovado: 'foi aprovado',
      recusado: 'foi recusado',
    };
    const partes = [
      `${a.nome}${a.escola ? `, ${a.escola}` : ''}${a.ano ? `, ${ROTULO_ANO[a.ano]}` : ''}, ${ROTULO_ESCALAO[a.escalao]}.`,
      cantina
        ? `Este mês tem ${conta.refeicoes} refeições a ${eurosTexto(conta.preco_cent)}, ${eurosTexto(conta.total_cent)} no total; saldo da conta ${eurosTexto(a.saldo_cent)}.`
        : 'Não está inscrito na cantina.',
      desmarcadas.length
        ? `Refeições desmarcadas: ${desmarcadas.map(porExtenso).join(', ')}.`
        : '',
      transporte
        ? `O pedido de transporte ${ESTADO_TRANSPORTE[transporte.estado]}${transporte.motivo ? ` (${transporte.motivo})` : ''}.`
        : '',
      inscricoes.length
        ? `Inscrições: ${inscricoes
            .map((i) =>
              i.tipo === 'pre_escolar'
                ? `pré-escolar (${i.estado === 'pendente' ? 'à espera da decisão do agrupamento' : i.estado.replace('_', ' ')})`
                : `${i.atividade}${i.estado === 'pendente' ? ' (lista de espera)' : ''}`,
            )
            .join('; ')}.`
        : '',
      'Os valores ainda estão por confirmar pela câmara.',
    ];
    return {
      encontrado: true,
      aluno: a.nome,
      escola: a.escola,
      ano: a.ano ? ROTULO_ANO[a.ano] : null,
      escalao: ROTULO_ESCALAO[a.escalao],
      cantina: cantina
        ? {
            desde: cantina.desde,
            mes,
            refeicoes: conta.refeicoes,
            preco: eurosTexto(conta.preco_cent),
            total: eurosTexto(conta.total_cent),
            saldo: eurosTexto(a.saldo_cent),
            desmarcadas,
          }
        : null,
      transporte: transporte
        ? {
            codigo: transporte.codigo,
            estado: transporte.estado,
            motivo: transporte.motivo,
          }
        : null,
      inscricoes: inscricoes.map((i) => ({
        tipo: i.tipo,
        atividade: i.atividade ?? undefined,
        estado: i.estado,
        codigo: i.codigo,
      })),
      valores_de_demonstracao: true,
      dizer: partes.filter(Boolean).join(' '),
    };
  }

  async pedirTransporte(
    ctx: ContextoFerramenta,
    e: z.output<typeof entradaPedirTransporte>,
  ) {
    const enc = await this.encarregado(ctx);
    if (!enc) return this.semIdentificacao();
    const al = await this.aluno(enc.id, e.nome_aluno);
    if ('resposta' in al) return al.resposta;
    const a = al.aluno;
    const m = ctx.municipio;
    let escola: { id: string; nome: string } | null =
      a.escola_id && a.escola ? { id: a.escola_id, nome: a.escola } : null;
    if (e.escola) {
      const es = await this.escola(m.id, e.escola);
      if ('resposta' in es) return es.resposta;
      escola = es.escola;
    }
    if (!escola) {
      return {
        feito: false,
        motivo: 'faltam_dados',
        em_falta: [{ campo: 'escola', pergunta: 'Qual é a escola?' }],
        dizer: 'Preciso de saber: qual é a escola.',
      };
    }
    const [aberto] = await this.db.query<{ codigo: string }>(
      `SELECT codigo FROM escolas_transporte WHERE aluno_id = $1 AND estado = 'pendente'`,
      [a.id],
    );
    if (aberto) {
      return {
        feito: false,
        motivo: 'ja_pedido',
        codigo: aberto.codigo,
        dizer: `Já há um pedido de transporte de ${a.nome} em análise (código ${aberto.codigo}). A câmara avisa por SMS quando decidir.`,
      };
    }
    const av = avaliarTransporte(e.distancia_km);
    const codigo = novoCodigo();
    await this.db.transaction(async (tx) => {
      const [t] = await tx.query<{ id: string }>(
        `INSERT INTO escolas_transporte (municipio_id, aluno_id, escola_id, morada, distancia_km,
           proposta, codigo, conversa_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [
          m.id,
          a.id,
          escola.id,
          e.morada,
          e.distancia_km ?? null,
          av.proposta,
          codigo,
          ctx.conversaId,
        ],
      );
      await this.auditoria.registar(
        {
          municipioId: m.id,
          atorTipo: 'agente',
          acao: 'pedir_transporte_escolar',
          objetoTipo: 'transporte_escolar',
          objetoId: t.id,
          dados: { codigo, proposta: av.proposta },
        },
        tx,
      );
    });
    return {
      feito: true,
      codigo,
      aluno: a.nome,
      escola: escola.nome,
      proposta: av.proposta,
      distancia_minima_km: REGRAS_ESCOLAS.distancia_minima_km,
      valores_de_demonstracao: true,
      dizer: `Registei o pedido de transporte escolar de ${a.nome} para a ${escola.nome}, com o código ${codigo}. ${av.porque} A câmara decide e avisa por SMS. A distância mínima ainda está por confirmar pela câmara.`,
    };
  }

  async atividades(
    ctx: ContextoFerramenta,
    e: z.output<typeof entradaAtividades>,
  ) {
    const m = ctx.municipio;
    let escolaId: string | null = null;
    if (e.escola) {
      const es = await this.escola(m.id, e.escola);
      if ('resposta' in es) return es.resposta;
      escolaId = es.escola.id;
    }
    const lista = await this.db.query<AtividadeLinha>(
      `${SQL_ATIVIDADES}
         AND ($2::text IS NULL OR a.tipo = $2)
         AND ($3::uuid IS NULL OR a.escola_id IS NULL OR a.escola_id = $3)
         AND (a.fim IS NULL OR a.fim >= current_date)
       ORDER BY a.tipo, a.inicio NULLS FIRST, a.nome`,
      [m.id, e.tipo ?? null, escolaId],
    );
    if (!lista.length) {
      return {
        encontrado: false,
        atividades: [],
        dizer: 'Não encontro atividades abertas com esses dados.',
      };
    }
    const itens = lista.map((a) => ({
      codigo: a.codigo,
      nome: a.nome,
      tipo: a.tipo === 'aec' ? 'depois das aulas (AEC)' : 'férias desportivas',
      escola: a.escola ?? 'todas as escolas',
      anos: a.anos.map((x) => ROTULO_ANO[x as Ano] ?? x).join(', '),
      horario: a.horario ?? undefined,
      datas: a.inicio ? `${a.inicio}${a.fim ? ` a ${a.fim}` : ''}` : undefined,
      vagas_livres: Math.max(0, a.vagas - a.inscritos),
      preco: a.preco_cent ? eurosTexto(a.preco_cent) : 'gratuita',
    }));
    return {
      encontrado: true,
      atividades: itens,
      valores_de_demonstracao: true,
      dizer: `Há ${itens.length} ${itens.length === 1 ? 'atividade' : 'atividades'}: ${itens
        .map((i) => `${i.nome} (${i.preco}, ${i.vagas_livres} vagas)`)
        .join(
          '; ',
        )}. A oferta e os preços ainda estão por confirmar pela câmara.`,
    };
  }

  async inscreverAtividade(
    ctx: ContextoFerramenta,
    e: z.output<typeof entradaInscreverAtividade>,
  ) {
    const enc = await this.encarregado(ctx);
    if (!enc) return this.semIdentificacao();
    const al = await this.aluno(enc.id, e.nome_aluno);
    if ('resposta' in al) return al.resposta;
    const a = al.aluno;
    const m = ctx.municipio;
    const todas = await this.db.query<AtividadeLinha>(
      `${SQL_ATIVIDADES} AND (a.fim IS NULL OR a.fim >= current_date) ORDER BY a.nome`,
      [m.id],
    );
    const porCodigo = todas.find(
      (t) => t.codigo.toLowerCase() === e.atividade.toLowerCase(),
    );
    const r = porCodigo
      ? { um: porCodigo }
      : escolherPorNome(todas, e.atividade);
    if (!('um' in r)) {
      const opcoes = ('varios' in r ? r.varios : todas).slice(0, 8);
      return {
        feito: false,
        motivo: 'precisa_escolher',
        campo: 'atividade',
        opcoes: opcoes.map((t) => ({ codigo: t.codigo, nome: t.nome })),
        dizer: `Qual das atividades? ${opcoes.map((t) => t.nome).join('; ')}.`,
      };
    }
    const t = r.um;
    if (a.ano && !t.anos.includes(a.ano)) {
      return {
        feito: false,
        motivo: 'nao_e_para_este_ano',
        dizer: `${t.nome} não é para alunos do ${ROTULO_ANO[a.ano]}.`,
      };
    }
    if (t.escola_id && t.escola_id !== a.escola_id) {
      return {
        feito: false,
        motivo: 'outra_escola',
        dizer: `${t.nome} é só para alunos da ${t.escola}.`,
      };
    }
    const cheia = t.inscritos >= t.vagas;
    const codigo = novoCodigo();
    const ja = await this.db.transaction(async (tx) => {
      const [existe] = await tx.query<{ codigo: string }>(
        `SELECT codigo FROM escolas_inscricoes
         WHERE aluno_id = $1 AND atividade_id = $2 AND estado <> 'cancelada'`,
        [a.id, t.id],
      );
      if (existe) return existe.codigo;
      const [i] = await tx.query<{ id: string }>(
        `INSERT INTO escolas_inscricoes (municipio_id, aluno_id, tipo, atividade_id, estado, codigo, conversa_id)
         VALUES ($1, $2, 'atividade', $3, $4, $5, $6) RETURNING id`,
        [
          m.id,
          a.id,
          t.id,
          cheia ? 'pendente' : 'ativa',
          codigo,
          ctx.conversaId,
        ],
      );
      await this.auditoria.registar(
        {
          municipioId: m.id,
          atorTipo: 'agente',
          acao: 'inscrever_atividade_escolar',
          objetoTipo: 'inscricao_escolar',
          objetoId: i.id,
          dados: { codigo, atividade: t.codigo, lista_espera: cheia },
        },
        tx,
      );
      return null;
    });
    if (ja) {
      return {
        feito: true,
        ja_estava_inscrito: true,
        codigo: ja,
        dizer: `${a.nome} já está inscrito em ${t.nome} (código ${ja}).`,
      };
    }
    return {
      feito: true,
      codigo,
      aluno: a.nome,
      atividade: t.nome,
      lista_de_espera: cheia || undefined,
      preco: t.preco_cent ? eurosTexto(t.preco_cent) : 'gratuita',
      valores_de_demonstracao: true,
      dizer: cheia
        ? `${t.nome} já não tem vagas: ${a.nome} ficou em lista de espera (código ${codigo}). A câmara avisa se abrir vaga.`
        : `Inscrevi ${a.nome} em ${t.nome}${t.preco_cent ? `, que custa ${eurosTexto(t.preco_cent)}` : ', que é gratuita'}. O código é ${codigo}. Os preços ainda estão por confirmar pela câmara.`,
    };
  }

  async preInscricao(
    ctx: ContextoFerramenta,
    e: z.output<typeof entradaPreInscricao>,
  ) {
    const enc = await this.encarregado(ctx);
    if (!enc) return this.semIdentificacao();
    const m = ctx.municipio;
    const hoje = agoraLisboa().dia;
    const anoAtual = Number(hoje.slice(0, 4));
    const anoLetivo = `${anoAtual}/${anoAtual + 1}`;
    // Pré-escolar: dos 3 anos à idade da escolaridade obrigatória (6).
    const idade = anoAtual - Number(e.data_nascimento.slice(0, 4));
    if (idade < 3 || idade > 6) {
      return {
        feito: false,
        motivo: 'idade_fora_do_pre_escolar',
        dizer:
          idade < 3
            ? 'O pré-escolar é a partir dos 3 anos (feitos até 31 de dezembro). Para creche fale com a ação social.'
            : 'Com essa idade a criança já é do 1.º ciclo: a matrícula faz-se no agrupamento de escolas.',
      };
    }
    const escolas = (await this.escolasDe(m.id)).filter(
      (x) => x.nivel !== '1_ciclo',
    );
    const preferidas = e.escolas_preferidas.map((dito) => {
      const r = escolherPorNome(escolas, dito);
      return 'um' in r ? r.um.nome : dito;
    });
    const codigo = novoCodigo();
    const r = await this.db.transaction(async (tx) => {
      const alunoId = await this.guardarAluno(tx, m.id, enc.id, {
        nome: e.nome_crianca,
        escolaId: null,
        ano: 'pre',
        escalao: null,
        alergias: null,
        dataNascimento: e.data_nascimento,
      });
      const [ja] = await tx.query<{ codigo: string }>(
        `SELECT codigo FROM escolas_inscricoes
         WHERE aluno_id = $1 AND tipo = 'pre_escolar' AND estado <> 'cancelada'`,
        [alunoId],
      );
      if (ja) return { ja: ja.codigo };
      const [i] = await tx.query<{ id: string }>(
        `INSERT INTO escolas_inscricoes (municipio_id, aluno_id, tipo, estado, codigo, dados, conversa_id)
         VALUES ($1, $2, 'pre_escolar', 'pendente', $3, $4, $5) RETURNING id`,
        [
          m.id,
          alunoId,
          codigo,
          JSON.stringify({
            escolas_preferidas: preferidas,
            ano_letivo: anoLetivo,
          }),
          ctx.conversaId,
        ],
      );
      await this.auditoria.registar(
        {
          municipioId: m.id,
          atorTipo: 'agente',
          acao: 'pre_inscricao_escolar',
          objetoTipo: 'inscricao_escolar',
          objetoId: i.id,
          dados: { codigo, ano_letivo: anoLetivo },
        },
        tx,
      );
      return { ja: null };
    });
    if (r.ja) {
      return {
        feito: true,
        ja_estava_inscrito: true,
        codigo: r.ja,
        dizer: `${e.nome_crianca} já tem uma pré-inscrição no pré-escolar (código ${r.ja}). Quem decide a colocação é o agrupamento de escolas.`,
      };
    }
    return {
      feito: true,
      codigo,
      crianca: e.nome_crianca,
      ano_letivo: anoLetivo,
      escolas_preferidas: preferidas,
      quem_decide: 'o agrupamento de escolas',
      dizer: `Registei a pré-inscrição de ${e.nome_crianca} no pré-escolar para ${anoLetivo}, com preferência por ${preferidas.join(', ')}. O código é ${codigo}. Atenção: isto não garante a vaga, quem decide a colocação é o agrupamento de escolas; a câmara envia o pedido e avisa por SMS quando houver resposta.`,
    };
  }

  // -------------------------------------------------------------------
  // Painel
  // -------------------------------------------------------------------

  async painel(m: Municipio) {
    const hoje = agoraLisboa().dia;
    const escolas = await this.db.query<
      EscolaLinha & {
        alunos: number;
        cantina: number;
        transporte_pendente: number;
      }
    >(
      `SELECT e.id, e.nome, e.agrupamento, e.nivel, e.tem_cantina, e.demonstracao,
         (SELECT count(*)::int FROM escolas_alunos a WHERE a.escola_id = e.id) AS alunos,
         (SELECT count(*)::int FROM escolas_alunos a JOIN escolas_inscricoes i
            ON i.aluno_id = a.id AND i.tipo = 'cantina' AND i.estado = 'ativa'
          WHERE a.escola_id = e.id) AS cantina,
         (SELECT count(*)::int FROM escolas_transporte t
          WHERE t.escola_id = e.id AND t.estado = 'pendente') AS transporte_pendente
       FROM escolas e WHERE e.municipio_id = $1 ORDER BY e.nome`,
      [m.id],
    );
    const atividades = await this.db.query<AtividadeLinha>(
      `${SQL_ATIVIDADES} ORDER BY a.tipo, a.inicio NULLS FIRST, a.nome`,
      [m.id],
    );
    const [contagens] = await this.db.query<{
      alunos: number;
      pre_escolar_pendentes: number;
      transporte_pendentes: number;
    }>(
      `SELECT
         (SELECT count(*)::int FROM escolas_alunos WHERE municipio_id = $1) AS alunos,
         (SELECT count(*)::int FROM escolas_inscricoes
          WHERE municipio_id = $1 AND tipo = 'pre_escolar' AND estado = 'pendente') AS pre_escolar_pendentes,
         (SELECT count(*)::int FROM escolas_transporte
          WHERE municipio_id = $1 AND estado = 'pendente') AS transporte_pendentes`,
      [m.id],
    );
    return {
      hoje,
      escolas,
      atividades,
      contagens,
      regras: {
        ...REGRAS_ESCOLAS,
        precos_cent: {
          A: precoRefeicao('A'),
          B: precoRefeicao('B'),
          sem: precoRefeicao('sem'),
        },
      },
    };
  }

  async alunos(m: Municipio, escolaId?: string) {
    const alunos = await this.db.query(
      `SELECT a.id, a.nome, a.ano, a.escalao, a.alergias, a.saldo_cent, a.demonstracao,
              a.data_nascimento::text, e.id AS escola_id, e.nome AS escola,
              mu.nome AS encarregado, mu.telefone_e164 AS telefone,
              (SELECT i.desde::text FROM escolas_inscricoes i
               WHERE i.aluno_id = a.id AND i.tipo = 'cantina' AND i.estado = 'ativa') AS cantina_desde,
              (SELECT t.estado FROM escolas_transporte t WHERE t.aluno_id = a.id
               ORDER BY t.criado_em DESC LIMIT 1) AS transporte,
              coalesce((SELECT json_agg(json_build_object('tipo', i.tipo, 'estado', i.estado,
                          'codigo', i.codigo, 'atividade', t.nome, 'dados', i.dados) ORDER BY i.criado_em)
                        FROM escolas_inscricoes i LEFT JOIN escolas_atividades t ON t.id = i.atividade_id
                        WHERE i.aluno_id = a.id AND i.tipo <> 'cantina' AND i.estado <> 'cancelada'), '[]') AS inscricoes
       FROM escolas_alunos a
       LEFT JOIN escolas e ON e.id = a.escola_id
       JOIN municipes mu ON mu.id = a.encarregado_id
       WHERE a.municipio_id = $1 AND ($2::uuid IS NULL OR a.escola_id = $2)
       ORDER BY e.nome NULLS FIRST, a.nome LIMIT 500`,
      [m.id, escolaId ?? null],
    );
    return { alunos };
  }

  async transporte(m: Municipio, estado?: string) {
    const pedidos = await this.db.query(
      `SELECT t.id, t.codigo, t.morada, t.distancia_km::float AS distancia_km, t.proposta, t.estado,
              t.motivo, t.criado_em, t.decidido_em, u.nome AS decidido_por,
              a.nome AS aluno, a.ano, e.nome AS escola, mu.nome AS encarregado,
              mu.telefone_e164 AS telefone
       FROM escolas_transporte t
       JOIN escolas_alunos a ON a.id = t.aluno_id
       JOIN escolas e ON e.id = t.escola_id
       JOIN municipes mu ON mu.id = a.encarregado_id
       LEFT JOIN utilizadores u ON u.id = t.decidido_por
       WHERE t.municipio_id = $1 AND ($2::text IS NULL OR t.estado = $2)
       ORDER BY (t.estado = 'pendente') DESC, t.criado_em DESC LIMIT 300`,
      [m.id, estado ?? null],
    );
    return {
      pedidos,
      regras: {
        distancia_minima_km: REGRAS_ESCOLAS.distancia_minima_km,
        demonstracao: true,
      },
    };
  }

  async decidirTransporte(
    m: Municipio,
    u: UtilizadorPainel,
    id: string,
    d: z.output<typeof esquemaDecidirTransporte>,
  ) {
    if (d.decisao === 'recusar' && !d.motivo) {
      throw new ErroApi(
        HttpStatus.BAD_REQUEST,
        'falta_motivo',
        'Para recusar, escreva o motivo (vai no SMS ao encarregado).',
      );
    }
    return this.db.transaction(async (tx) => {
      const [t] = await tx.query<{
        id: string;
        codigo: string;
        estado: string;
        aluno: string;
        escola: string;
        encarregado_id: string;
        telefone: string | null;
      }>(
        `SELECT t.id, t.codigo, t.estado, a.nome AS aluno, e.nome AS escola,
                a.encarregado_id, mu.telefone_e164 AS telefone
         FROM escolas_transporte t
         JOIN escolas_alunos a ON a.id = t.aluno_id
         JOIN escolas e ON e.id = t.escola_id
         JOIN municipes mu ON mu.id = a.encarregado_id
         WHERE t.id = $1 AND t.municipio_id = $2 FOR UPDATE OF t`,
        [id, m.id],
      );
      if (!t) {
        throw new ErroApi(
          HttpStatus.NOT_FOUND,
          'nao_encontrado',
          'Pedido de transporte não encontrado.',
        );
      }
      if (t.estado !== 'pendente') {
        throw new ErroApi(
          HttpStatus.CONFLICT,
          'ja_decidido',
          'Este pedido já foi decidido.',
        );
      }
      const estado = d.decisao === 'aprovar' ? 'aprovado' : 'recusado';
      await tx.query(
        `UPDATE escolas_transporte SET estado = $2, motivo = $3, decidido_por = $4, decidido_em = now()
         WHERE id = $1`,
        [id, estado, d.motivo ?? null, u.id],
      );
      let sms = false;
      if (t.telefone) {
        const corpo =
          estado === 'aprovado'
            ? `${m.nome}: o transporte escolar de ${t.aluno} para a ${t.escola} foi aprovado (pedido ${t.codigo}). A escola informa o horario e a paragem.`
            : `${m.nome}: o pedido de transporte escolar de ${t.aluno} (${t.codigo}) nao foi aprovado. Motivo: ${d.motivo}. Pode pedir esclarecimentos pela linha da camara.`;
        await this.mensagens.sms(
          {
            municipioId: m.id,
            municipeId: t.encarregado_id,
            destino: t.telefone,
            motivo: 'processo',
            corpo,
            relacionado: { transporte_escolar_id: id },
            chave: `transporte_escolar:${id}`,
          },
          tx,
        );
        sms = true;
      }
      await this.auditoria.registar(
        {
          municipioId: m.id,
          atorTipo: 'utilizador',
          atorId: u.id,
          acao:
            d.decisao === 'aprovar'
              ? 'aprovar_transporte_escolar'
              : 'recusar_transporte_escolar',
          objetoTipo: 'transporte_escolar',
          objetoId: id,
          dados: { codigo: t.codigo, motivo: d.motivo ?? null },
        },
        tx,
      );
      return { id, estado, sms_enviado: sms };
    });
  }

  /** As refeições de um dia por escola: a contagem para a cozinha. */
  async refeicoesDoDia(m: Municipio, dia: string) {
    const aulas = diaDeAulas(dia, await this.feriados(m.id));
    const linhas = aulas
      ? await this.db.query<{
          escola_id: string;
          escola: string;
          aluno: string;
          escalao: Escalao;
          alergias: string | null;
        }>(
          `SELECT e.id AS escola_id, e.nome AS escola, a.nome AS aluno, a.escalao, a.alergias
           FROM escolas_alunos a
           JOIN escolas e ON e.id = a.escola_id
           LEFT JOIN escolas_refeicoes r ON r.aluno_id = a.id AND r.dia = $2
           WHERE a.municipio_id = $1
             AND coalesce(r.marcada, EXISTS (
                   SELECT 1 FROM escolas_inscricoes i
                   WHERE i.aluno_id = a.id AND i.tipo = 'cantina' AND i.estado = 'ativa'
                     AND i.desde <= $2))
           ORDER BY e.nome, a.nome`,
          [m.id, dia],
        )
      : [];
    const [desm] = await this.db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM escolas_refeicoes r
       JOIN escolas_alunos a ON a.id = r.aluno_id
       WHERE a.municipio_id = $1 AND r.dia = $2 AND NOT r.marcada`,
      [m.id, dia],
    );
    const porEscola = new Map<
      string,
      {
        escola_id: string;
        escola: string;
        total: number;
        por_escalao: Record<Escalao, number>;
        dietas: { aluno: string; alergias: string }[];
      }
    >();
    for (const l of linhas) {
      let e = porEscola.get(l.escola_id);
      if (!e) {
        e = {
          escola_id: l.escola_id,
          escola: l.escola,
          total: 0,
          por_escalao: { A: 0, B: 0, sem: 0 },
          dietas: [],
        };
        porEscola.set(l.escola_id, e);
      }
      e.total++;
      e.por_escalao[l.escalao]++;
      if (l.alergias) e.dietas.push({ aluno: l.aluno, alergias: l.alergias });
    }
    return {
      dia,
      dia_de_aulas: aulas,
      total: linhas.length,
      desmarcadas: desm.n,
      escolas: [...porEscola.values()],
    };
  }

  // -------------------------------------------------------------------
  // Demonstração
  // -------------------------------------------------------------------

  /**
   * Escolas e atividades de demonstração; com encarregados (munícipes da
   * demonstração), também alunos, inscrições e pedidos de transporte.
   */
  async carregarDemonstracao(
    m: Municipio,
    u: UtilizadorPainel | null,
    encarregados: string[] = [],
  ) {
    return this.db.transaction(async (tx) => {
      let escolas = 0;
      for (const e of ESCOLAS_DEMO) {
        const r = await tx.query(
          `INSERT INTO escolas (municipio_id, nome, agrupamento, nivel, freguesia, morada, tem_cantina, demonstracao)
           VALUES ($1, $2, $3, $4, $5, $6, $7, true)
           ON CONFLICT (municipio_id, nome) DO NOTHING RETURNING id`,
          [
            m.id,
            e.nome,
            e.agrupamento,
            e.nivel,
            e.freguesia,
            e.morada,
            e.tem_cantina,
          ],
        );
        escolas += r.length;
      }
      const ids = new Map(
        (
          await tx.query<{ id: string; nome: string }>(
            'SELECT id, nome FROM escolas WHERE municipio_id = $1',
            [m.id],
          )
        ).map((x) => [x.nome, x.id]),
      );
      const hoje = agoraLisboa().dia;
      let atividades = 0;
      for (const a of ATIVIDADES_DEMO) {
        const r = await tx.query(
          `INSERT INTO escolas_atividades (municipio_id, codigo, tipo, nome, descricao, escola_id, anos,
             horario, inicio, fim, vagas, preco_cent, demonstracao)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, true)
           ON CONFLICT (municipio_id, codigo) DO NOTHING RETURNING id`,
          [
            m.id,
            a.codigo,
            a.tipo,
            a.nome,
            a.descricao,
            a.escola ? (ids.get(a.escola) ?? null) : null,
            a.anos,
            a.horario,
            a.inicio_dias === undefined ? null : somarDias(hoje, a.inicio_dias),
            a.fim_dias === undefined ? null : somarDias(hoje, a.fim_dias),
            a.vagas,
            a.preco_cent,
          ],
        );
        atividades += r.length;
      }
      let alunos = 0;
      const desde = somarDias(hoje, -30);
      for (const a of ALUNOS_DEMO) {
        const enc = encarregados[a.encarregado];
        if (!enc) continue;
        const [novo] = await tx.query<{ id: string }>(
          `INSERT INTO escolas_alunos (municipio_id, encarregado_id, nome, data_nascimento, escola_id,
             ano, escalao, alergias, saldo_cent, demonstracao)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, true)
           ON CONFLICT (encarregado_id, lower(nome)) DO NOTHING RETURNING id`,
          [
            m.id,
            enc,
            a.nome,
            a.data_nascimento,
            a.escola ? (ids.get(a.escola) ?? null) : null,
            a.ano,
            a.escalao,
            a.alergias ?? null,
            a.saldo_cent ?? 0,
          ],
        );
        if (!novo) continue;
        alunos++;
        if (a.cantina) {
          await tx.query(
            `INSERT INTO escolas_inscricoes (municipio_id, aluno_id, tipo, estado, codigo, desde)
             VALUES ($1, $2, 'cantina', 'ativa', $3, $4)`,
            [m.id, novo.id, novoCodigo(), desde],
          );
        }
        if (a.desmarcar_amanha) {
          const fer = await this.feriados(m.id);
          let d = somarDias(hoje, 1);
          while (!diaDeAulas(d, fer)) d = somarDias(d, 1);
          await tx.query(
            `INSERT INTO escolas_refeicoes (aluno_id, dia, marcada) VALUES ($1, $2, false)
             ON CONFLICT DO NOTHING`,
            [novo.id, d],
          );
        }
        for (const cod of a.atividades ?? []) {
          await tx.query(
            `INSERT INTO escolas_inscricoes (municipio_id, aluno_id, tipo, atividade_id, estado, codigo)
             SELECT $1, $2, 'atividade', id, 'ativa', $3 FROM escolas_atividades
             WHERE municipio_id = $1 AND codigo = $4`,
            [m.id, novo.id, novoCodigo(), cod],
          );
        }
        if (a.pre_escolar) {
          await tx.query(
            `INSERT INTO escolas_inscricoes (municipio_id, aluno_id, tipo, estado, codigo, dados)
             VALUES ($1, $2, 'pre_escolar', 'pendente', $3, $4)`,
            [
              m.id,
              novo.id,
              novoCodigo(),
              JSON.stringify({
                escolas_preferidas: a.pre_escolar,
                ano_letivo: `${hoje.slice(0, 4)}/${Number(hoje.slice(0, 4)) + 1}`,
              }),
            ],
          );
        }
        if (a.transporte && a.escola) {
          const av = avaliarTransporte(a.transporte.distancia_km);
          await tx.query(
            `INSERT INTO escolas_transporte (municipio_id, aluno_id, escola_id, morada, distancia_km, proposta, codigo)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [
              m.id,
              novo.id,
              ids.get(a.escola),
              a.transporte.morada,
              a.transporte.distancia_km,
              av.proposta,
              novoCodigo(),
            ],
          );
        }
      }
      if (u) {
        await this.auditoria.registar(
          {
            municipioId: m.id,
            atorTipo: 'utilizador',
            atorId: u.id,
            acao: 'carregar_escolas_demonstracao',
            objetoTipo: 'escolas',
            objetoId: m.id,
            dados: { escolas, atividades, alunos },
          },
          tx,
        );
      }
      return { escolas, atividades, alunos };
    });
  }
}
