import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { ErroApi } from '../../common/erros.js';
import type { UtilizadorPainel } from '../../common/pedido.js';
import { DatabaseService, Tx } from '../../database/database.service.js';
import { RegistoFerramentas } from '../../ferramentas/registo-ferramentas.service.js';
import { ClaudeService } from '../../ia/claude.service.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import type { ResultadoPesquisa } from '../conhecimento/conhecimento.service.js';
import { ContratacaoService } from '../contratacao/contratacao.service.js';
import type { Municipio } from '../municipios/municipios.service.js';
import {
  conteudoAssistente,
  esquemaRespostaAssistente,
  SISTEMA_ASSISTENTE,
} from './ia.js';
import { Encontrado, ProcedimentosService } from './procedimentos.service.js';
import { TrechoProcedimento } from './regras.js';

export const esquemaPerguntar = z.object({
  pergunta: z.string().trim().min(3).max(500),
});

export const esquemaTratar = z.object({
  procedimento_id: z.uuid().nullable().optional(),
});

export type FonteAssistente =
  | {
      tipo: 'procedimento';
      etiqueta: string;
      citada: boolean;
      procedimento_id: string;
      titulo: string;
      area: string;
      versao: number;
      autor_nome: string | null;
      publicado_em: string | null;
      trechos: TrechoProcedimento[];
    }
  | {
      tipo: 'conhecimento';
      etiqueta: string;
      citada: boolean;
      titulo: string;
      referencia: string | null;
      entidade: string;
      url: string;
      texto: string;
    }
  | {
      tipo: 'resposta_curada';
      etiqueta: string;
      citada: boolean;
      titulo: string;
      texto: string;
    };

export interface QuemPerguntar {
  utilizador_id: string | null;
  nome: string;
  motivo: string;
}

const MAX_PROCEDIMENTOS = 3;
const MAX_CONHECIMENTO = 3;

/**
 * Assistente interno para funcionários novos: "como trato um pedido de X?".
 * Responde com os procedimentos internos publicados + o conhecimento oficial
 * (a mesma pesquisa do agente, `procurar_conhecimento`), sempre com a fonte.
 * Se não souber, diz e sugere a quem perguntar (o autor do procedimento mais
 * próximo, ou a chefia). Sem IA mostra os procedimentos e trechos
 * encontrados. Todas as perguntas ficam registadas; as sem resposta são a
 * lista de procedimentos em falta.
 */
@Injectable()
export class AssistenteService {
  private readonly logger = new Logger(AssistenteService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly registo: RegistoFerramentas,
    private readonly claude: ClaudeService,
    private readonly auditoria: AuditoriaService,
    private readonly procedimentos: ProcedimentosService,
    private readonly contratacao: ContratacaoService,
  ) {}

  async perguntar(
    m: Municipio,
    u: UtilizadorPainel,
    { pergunta }: z.output<typeof esquemaPerguntar>,
  ) {
    // "Cabe no ajuste direto?" com um valor: responde o motor da contratação
    // pública (regras do município, sem IA), não os procedimentos escritos.
    const contratacao = await this.contratacao.responderPergunta(m, pergunta);
    if (contratacao)
      return this.registarContratacao(m, u, pergunta, contratacao);

    const [procs, pesquisa] = await Promise.all([
      this.procedimentos.procurar(m.id, pergunta, MAX_PROCEDIMENTOS),
      this.conhecimento(m, pergunta),
    ]);
    const trechos = (pesquisa?.trechos ?? []).slice(0, MAX_CONHECIMENTO);
    const curadas = (pesquisa?.respostas ?? []).slice(0, 2);

    const fontes: FonteAssistente[] = [
      ...procs.map((p, i) => ({
        tipo: 'procedimento' as const,
        etiqueta: `P${i + 1}`,
        citada: false,
        procedimento_id: p.id,
        titulo: p.titulo,
        area: p.area,
        versao: p.versao,
        autor_nome: p.autor_nome,
        publicado_em: p.publicado_em,
        trechos: p.trechos,
      })),
      ...curadas.map((r, i) => ({
        tipo: 'resposta_curada' as const,
        etiqueta: `C${i + 1}`,
        citada: false,
        titulo: r.pergunta,
        texto: r.texto,
      })),
      ...trechos.map((t, i) => ({
        tipo: 'conhecimento' as const,
        etiqueta: `C${curadas.length + i + 1}`,
        citada: false,
        titulo: t.titulo,
        referencia: t.referencia,
        entidade: t.entidade,
        url: t.url,
        texto: t.texto.length > 420 ? `${t.texto.slice(0, 419)}…` : t.texto,
      })),
    ];
    const encontrou = fontes.length > 0;

    let resposta: string | null = null;
    let sabe = encontrou;
    let modo: 'ia' | 'sem_ia' = 'sem_ia';
    let motivoSemIa: string | null = null;
    let perguntarIa: string | null = null;

    if (!this.claude.disponivel) {
      motivoSemIa =
        'O assistente de IA não está configurado: mostram-se os procedimentos e as regras encontrados.';
    } else if (!encontrou) {
      motivoSemIa = null;
      modo = 'ia';
    } else {
      try {
        const r = await this.claude.extrair(esquemaRespostaAssistente, {
          tarefa: 'assistente_procedimentos',
          sistema: SISTEMA_ASSISTENTE,
          conteudo: conteudoAssistente(
            pergunta,
            procs.map((p, i) => ({
              etiqueta: `P${i + 1}`,
              titulo: p.titulo,
              area: p.area,
              autor: p.autor_nome,
              conteudo: p.conteudo,
            })),
            fontes.flatMap((f) =>
              f.tipo === 'conhecimento'
                ? [
                    {
                      etiqueta: f.etiqueta,
                      titulo: f.titulo,
                      referencia: f.referencia,
                      texto: f.texto,
                    },
                  ]
                : f.tipo === 'resposta_curada'
                  ? [
                      {
                        etiqueta: f.etiqueta,
                        titulo: `Resposta aprovada: ${f.titulo}`,
                        referencia: null,
                        texto: f.texto,
                      },
                    ]
                  : [],
            ),
          ),
          esforco: 'medium',
          maxTokens: 3000,
        });
        modo = 'ia';
        const citadas = new Set(r.fontes.map((x) => x.trim().toUpperCase()));
        for (const f of fontes) f.citada = citadas.has(f.etiqueta);
        // Resposta sem nenhuma fonte citada não conta como resposta.
        sabe = r.sabe && fontes.some((f) => f.citada);
        resposta = r.resposta.trim().slice(0, 1500) || null;
        perguntarIa = r.perguntar_a;
      } catch (e) {
        this.logger.warn(
          `Assistente interno: ${e instanceof Error ? e.message : String(e)}`,
        );
        motivoSemIa =
          'Não foi possível responder com IA agora: mostram-se os procedimentos e as regras encontrados.';
      }
    }

    const estado = sabe ? 'respondida' : 'sem_resposta';
    const perguntarA = sabe
      ? []
      : await this.quemPerguntar(m, pergunta, procs, perguntarIa);

    const [linha] = await this.db.query<{ id: string; criada_em: string }>(
      `INSERT INTO assistente_perguntas (municipio_id, utilizador_id, pergunta, resposta, modo, fontes, estado, perguntar_a)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id, criada_em`,
      [
        m.id,
        u.id,
        pergunta,
        resposta,
        modo,
        JSON.stringify(
          fontes.map((f) => ({
            tipo: f.tipo,
            etiqueta: f.etiqueta,
            titulo: f.titulo,
            citada: f.citada,
            ...(f.tipo === 'procedimento'
              ? { procedimento_id: f.procedimento_id, versao: f.versao }
              : {}),
            ...(f.tipo === 'conhecimento'
              ? { referencia: f.referencia, url: f.url }
              : {}),
          })),
        ),
        estado,
        JSON.stringify(perguntarA),
      ],
    );

    return {
      id: linha.id,
      pergunta,
      modo,
      ia: modo === 'ia' && resposta !== null,
      motivo_sem_ia: motivoSemIa,
      estado,
      resposta,
      fontes,
      perguntar_a: perguntarA,
      criada_em: linha.criada_em,
    };
  }

  private async registarContratacao(
    m: Municipio,
    u: UtilizadorPainel,
    pergunta: string,
    c: NonNullable<
      Awaited<ReturnType<ContratacaoService['responderPergunta']>>
    >,
  ) {
    const [linha] = await this.db.query<{ id: string; criada_em: string }>(
      `INSERT INTO assistente_perguntas (municipio_id, utilizador_id, pergunta, resposta, modo, fontes, estado, perguntar_a)
       VALUES ($1, $2, $3, $4, 'sem_ia', '[]', 'respondida', '[]') RETURNING id, criada_em`,
      [m.id, u.id, pergunta, c.resposta],
    );
    return {
      id: linha.id,
      pergunta,
      modo: 'sem_ia' as const,
      ia: false,
      motivo_sem_ia: null,
      estado: 'respondida' as const,
      resposta: c.resposta,
      fontes: [] as FonteAssistente[],
      perguntar_a: [] as QuemPerguntar[],
      contratacao: c.contratacao,
      criada_em: linha.criada_em,
    };
  }

  /** As minhas perguntas recentes (o histórico do chat). */
  historico(m: Municipio, u: UtilizadorPainel) {
    return this.db
      .query(
        `SELECT id, pergunta, resposta, modo, estado, fontes, perguntar_a, criada_em
         FROM assistente_perguntas WHERE municipio_id = $1 AND utilizador_id = $2
         ORDER BY criada_em DESC LIMIT 20`,
        [m.id, u.id],
      )
      .then((itens) => ({ itens }));
  }

  /** Procedimentos em falta: as perguntas que ficaram sem resposta. */
  lacunas(m: Municipio, incluirTratadas = false) {
    return this.db
      .query(
        `SELECT a.id, a.pergunta, a.estado, a.perguntar_a, a.criada_em, u.nome AS perguntou_nome,
                a.procedimento_id, p.titulo AS procedimento_titulo, t.nome AS tratada_por_nome, a.tratada_em
         FROM assistente_perguntas a
         LEFT JOIN utilizadores u ON u.id = a.utilizador_id
         LEFT JOIN utilizadores t ON t.id = a.tratada_por
         LEFT JOIN procedimentos p ON p.id = a.procedimento_id
         WHERE a.municipio_id = $1
           AND (a.estado = 'sem_resposta' OR ($2 AND a.estado = 'tratada'))
         ORDER BY a.criada_em DESC LIMIT 200`,
        [m.id, incluirTratadas],
      )
      .then((itens) => ({ itens }));
  }

  /** Escrever o procedimento em falta: um rascunho com a pergunta como título. */
  async escrever(m: Municipio, u: UtilizadorPainel, id: string) {
    const l = await this.lacuna(m.id, id);
    return this.db.transaction(async (tx) => {
      const p = await this.procedimentos.criar(
        m,
        u,
        {
          titulo: l.pergunta.slice(0, 200),
          area: 'Por definir',
          servico_id: null,
          resumo: '',
          passos: [],
          onde_esta: [],
          contactos: [],
          excecoes: [],
          erros_comuns: [],
          notas: '',
        },
        {
          origem: 'lacuna',
          nota: 'Rascunho aberto a partir de uma pergunta sem resposta.',
        },
        tx,
      );
      await this.marcar(tx, m, u, id, p.id);
      return { procedimento_id: p.id, estado: 'tratada' };
    });
  }

  /** Marcar como tratada (opcionalmente com o procedimento que a resolve). */
  async tratar(
    m: Municipio,
    u: UtilizadorPainel,
    id: string,
    d: z.output<typeof esquemaTratar>,
  ) {
    await this.lacuna(m.id, id);
    if (d.procedimento_id) {
      const [p] = await this.db.query(
        `SELECT 1 FROM procedimentos WHERE id = $1 AND municipio_id = $2`,
        [d.procedimento_id, m.id],
      );
      if (!p)
        throw new ErroApi(
          HttpStatus.BAD_REQUEST,
          'procedimento_invalido',
          'Esse procedimento não existe.',
        );
    }
    await this.db.transaction((tx) =>
      this.marcar(tx, m, u, id, d.procedimento_id ?? null),
    );
    return { id, estado: 'tratada' };
  }

  private async marcar(
    tx: Tx,
    m: Municipio,
    u: UtilizadorPainel,
    id: string,
    procedimentoId: string | null,
  ) {
    await tx.query(
      `UPDATE assistente_perguntas SET estado = 'tratada', tratada_por = $2, tratada_em = now(),
         procedimento_id = $3 WHERE id = $1`,
      [id, u.id, procedimentoId],
    );
    await this.auditoria.registar(
      {
        municipioId: m.id,
        atorTipo: 'utilizador',
        atorId: u.id,
        acao: 'tratar_lacuna',
        objetoTipo: 'assistente_pergunta',
        objetoId: id,
        dados: { procedimento_id: procedimentoId },
      },
      tx,
    );
  }

  private async lacuna(municipioId: string, id: string) {
    const [l] = await this.db.query<{
      id: string;
      pergunta: string;
      estado: string;
    }>(
      `SELECT id, pergunta, estado FROM assistente_perguntas WHERE id = $1 AND municipio_id = $2`,
      [id, municipioId],
    );
    if (!l)
      throw new ErroApi(
        HttpStatus.NOT_FOUND,
        'nao_encontrado',
        'Pergunta não existe.',
      );
    if (l.estado !== 'sem_resposta') {
      throw new ErroApi(
        HttpStatus.CONFLICT,
        'estado_invalido',
        'Esta pergunta já não está por responder.',
      );
    }
    return l;
  }

  /** A mesma pesquisa que o agente usa (só o conhecimento oficial público). */
  private async conhecimento(
    m: Municipio,
    pergunta: string,
  ): Promise<ResultadoPesquisa | null> {
    try {
      return (await this.registo.executar(
        'procurar_conhecimento',
        {
          municipio: m,
          canal: 'chat',
          conversaId: null,
          municipeId: null,
          telefone: null,
        },
        { pergunta, limite: MAX_CONHECIMENTO },
      )) as ResultadoPesquisa;
    } catch (e) {
      this.logger.warn(
        `Pesquisa do assistente: ${e instanceof Error ? e.message : String(e)}`,
      );
      return null;
    }
  }

  /**
   * A quem perguntar quando não se sabe: os autores dos procedimentos mais
   * próximos (mesmo em rascunho), a pessoa que a IA leu nas fontes e, por
   * fim, a chefia de divisão.
   */
  private async quemPerguntar(
    m: Municipio,
    pergunta: string,
    publicados: Encontrado[],
    daIa: string | null,
  ): Promise<QuemPerguntar[]> {
    const lista: QuemPerguntar[] = [];
    const vistos = new Set<string>();
    if (daIa?.trim())
      lista.push({
        utilizador_id: null,
        nome: daIa.trim().slice(0, 200),
        motivo: 'indicado nas fontes',
      });
    const proximos = publicados.length
      ? publicados
      : await this.procedimentos.procurar(m.id, pergunta, 3, [
          'rascunho',
          'publicado',
          'arquivado',
        ]);
    for (const p of proximos) {
      if (p.autor_id && p.autor_nome && !vistos.has(p.autor_id)) {
        vistos.add(p.autor_id);
        lista.push({
          utilizador_id: p.autor_id,
          nome: p.autor_nome,
          motivo: `escreveu "${p.titulo}"`,
        });
      }
    }
    if (lista.length < 2) {
      const chefes = await this.db.query<{ id: string; nome: string }>(
        `SELECT id, nome FROM utilizadores
         WHERE municipio_id = $1 AND perfil = 'chefe_divisao' AND ativo
         ORDER BY nome LIMIT 2`,
        [m.id],
      );
      for (const c of chefes) {
        if (!vistos.has(c.id)) {
          vistos.add(c.id);
          lista.push({
            utilizador_id: c.id,
            nome: c.nome,
            motivo: 'chefe de divisão',
          });
        }
      }
    }
    return lista.slice(0, 3);
  }
}
