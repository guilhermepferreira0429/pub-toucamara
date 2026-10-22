import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Observable } from 'rxjs';
import { hojeLisboa } from '../../common/dias-uteis.js';
import { ErroApi } from '../../common/erros.js';
import { DatabaseService, Tx } from '../../database/database.service.js';
import { ContextoFerramenta } from '../../ferramentas/ferramenta.js';
import { ClaudeService } from '../../ia/claude.service.js';
import { MimeVisao, VisaoService } from '../../ia/visao.service.js';
import { JobsService } from '../../jobs/jobs.service.js';
import { ArmazenamentoService } from '../armazenamento/armazenamento.service.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { LinksCurtosService } from '../comunicacao/links-curtos.service.js';
import { MensagensService } from '../comunicacao/mensagens.service.js';
import { ConversasService } from '../conversas/conversas.service.js';
import { MunicipesService, nifValido } from '../municipes/municipes.service.js';
import { MunicipiosService } from '../municipios/municipios.service.js';
import {
  camposEmFalta,
  dadosComRotulos,
  Dados,
  formatarValor,
  NIF_REGISTADO,
  perguntaDe,
  proximaPergunta,
  validarValor,
  Valor,
} from '../processos/formulario.js';
import { ProcessosService } from '../processos/processos.service.js';
import {
  TipoProcesso,
  TiposProcessoService,
} from '../processos/tipos-processo.service.js';
import { gerarPdfRequerimento } from './requerimento-pdf.js';
import {
  aplicarTraducao,
  camposATraduzir,
  esquemaTraducao,
  idiomaCanonico,
  linhaSmsNaLingua,
  precisaTraducao,
  SISTEMA_TRADUCAO,
} from './traducao.js';
import {
  avaliarDocumento,
  DocumentoComEstado,
  fraseVerificacao,
  lerVerificacoes,
  MAXIMO_IMAGEM_BYTES,
  MAXIMO_PDF_BYTES,
  mimePelosBytes,
  resumirEntregas,
  resumirParaAgente,
  verificacoesEmPalavras,
} from './verificacao-documentos.js';

export const JOB_PDF = 'gerar_pdf_requerimento';
export const JOB_TRADUZIR = 'traduzir_requerimento';

type Estado = 'a_preencher' | 'pronto' | 'assinado' | 'entregue' | 'cancelado';

interface LinhaRequerimento {
  id: string;
  municipio_id: string;
  municipe_id: string | null;
  conversa_id: string | null;
  tipo_processo_id: string;
  dados: Dados;
  dados_originais: Dados | null;
  idioma_conversa: string;
  campos_em_falta: string[];
  estado: Estado;
  assinatura: string | null;
  assinado_em: Date | null;
  pdf_key: string | null;
  token_publico: string;
  processo_id: string | null;
  criado_em: Date;
  atualizado_em: Date;
}

const COLUNAS = `r.id, r.municipio_id, r.municipe_id, r.conversa_id, r.tipo_processo_id, r.dados,
  r.dados_originais, r.idioma_conversa, r.campos_em_falta, r.estado, r.assinatura, r.assinado_em, r.pdf_key, r.token_publico,
  r.processo_id, r.criado_em, r.atualizado_em`;

/** Ficheiros aceites no envio de documentos (fotografia ou PDF). */
export const MIMES_DOCUMENTO: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'application/pdf': 'pdf',
};

const ESPERA_AO_VIVO_MS = 800;
const DURACAO_AO_VIVO_MS = 30 * 60_000;
const PING_AO_VIVO_MS = 15_000;

export interface MensagemAoVivo {
  type?: string;
  data: unknown;
}

/**
 * O requerimento preenchido durante a chamada (o momento uau): o agente
 * inicia, preenche campo a campo e conclui; o munícipe revê e assina pelo
 * link do SMS; ao assinar é entregue e nasce o processo.
 */
@Injectable()
export class RequerimentosService {
  private readonly logger = new Logger(RequerimentosService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly config: ConfigService,
    private readonly tipos: TiposProcessoService,
    private readonly processos: ProcessosService,
    private readonly municipes: MunicipesService,
    private readonly municipios: MunicipiosService,
    private readonly conversas: ConversasService,
    private readonly links: LinksCurtosService,
    private readonly mensagens: MensagensService,
    private readonly armazenamento: ArmazenamentoService,
    private readonly auditoria: AuditoriaService,
    private readonly jobs: JobsService,
    private readonly claude: ClaudeService,
    private readonly visao: VisaoService,
  ) {}

  /**
   * Documentos exigidos pelo tipo com o melhor estado do que já chegou
   * (no requerimento ou no processo). Ver `resumirEntregas`.
   */
  private documentosComEstado(
    tipoId: string,
    requerimentoId: string,
    processoId: string | null,
    q: Pick<Tx, 'query'> = this.db,
  ): Promise<DocumentoComEstado[]> {
    return q.query<DocumentoComEstado>(
      `SELECT d.id, d.nome, d.obrigatorio, d.gerado_pelo_sistema,
              (SELECT x.verificacao_estado FROM documentos x
               WHERE x.tipo_documento_id = d.id
                 AND (x.requerimento_id = $2 OR x.processo_id = $3)
               ORDER BY (x.verificacao_estado = 'valido') DESC,
                        (x.verificacao_estado = 'por_verificar') DESC,
                        x.recebido_em DESC
               LIMIT 1) AS estado
       FROM tipo_processo_documentos d
       WHERE d.tipo_processo_id = $1
       ORDER BY d.ordem`,
      [tipoId, requerimentoId, processoId],
    );
  }

  // ---------------------------------------------------------------- agente

  async iniciar(ctx: ContextoFerramenta, textoTipo: string, idioma?: string) {
    const lingua = idiomaCanonico(idioma);
    const r = await this.tipos.resolver(ctx.municipio.id, textoTipo);
    if (!('tipo' in r)) {
      return {
        encontrado: false,
        opcoes: r.opcoes,
        instrucao: r.opcoes.length
          ? 'Não é claro qual o pedido. Pergunte ao munícipe qual destas opções é a dele e volte a chamar com o código.'
          : 'Esta câmara ainda não tem requerimentos configurados para fazer por aqui. Passe a um funcionário.',
      };
    }
    const tipo = r.tipo;

    const municipe = ctx.municipeId
      ? await this.municipes.porId(ctx.municipeId)
      : await this.municipes.porTelefone(ctx.municipio.id, ctx.telefone);

    // O ElevenLabs pode repetir a chamada: na mesma conversa reaproveita-se.
    let req: LinhaRequerimento | undefined;
    if (ctx.conversaId) {
      [req] = await this.db.query<LinhaRequerimento>(
        `SELECT ${COLUNAS} FROM requerimentos r
         WHERE r.conversa_id = $1 AND r.tipo_processo_id = $2 AND r.estado = 'a_preencher'
         ORDER BY r.criado_em DESC LIMIT 1`,
        [ctx.conversaId, tipo.id],
      );
    }
    if (!req) {
      const dados: Dados = municipe?.tem_nif ? { [NIF_REGISTADO]: true } : {};
      [req] = await this.db.query<LinhaRequerimento>(
        `INSERT INTO requerimentos (municipio_id, municipe_id, conversa_id, tipo_processo_id,
           dados, campos_em_falta, idioma_conversa)
         VALUES ($1, $2, $3, $4, $5, $6,
           coalesce($7, (SELECT idioma FROM conversas WHERE id = $3), 'pt-PT'))
         RETURNING ${COLUNAS.replace(/r\./g, '')}`,
        [
          ctx.municipio.id,
          municipe?.id ?? null,
          ctx.conversaId,
          tipo.id,
          JSON.stringify(dados),
          camposEmFalta(tipo.formulario, dados),
          lingua,
        ],
      );
      await this.conversas.momento(ctx.conversaId, 'requerimento', {
        requerimento_id: req.id,
        tipo: tipo.codigo,
        acao: 'iniciado',
      });
    } else if (lingua && lingua !== req.idioma_conversa) {
      // A pessoa mudou de língua a meio: o que conta é a última.
      await this.db.query(
        'UPDATE requerimentos SET idioma_conversa = $2 WHERE id = $1',
        [req.id, lingua],
      );
      req.idioma_conversa = lingua;
    }

    const docs = await this.documentosComEstado(tipo.id, req.id, null);
    const emFalta = camposEmFalta(tipo.formulario, req.dados);
    return {
      requerimento_id: req.id,
      idioma: req.idioma_conversa,
      tipo: { codigo: tipo.codigo, nome: tipo.nome },
      frase_do_agente: tipo.frase_do_agente,
      campos: tipo.formulario.map((c) => ({
        chave: c.chave,
        rotulo: c.rotulo,
        tipo: c.tipo,
        obrigatorio: c.obrigatorio,
        pergunta: perguntaDe(c),
        ...(c.opcoes ? { opcoes: c.opcoes } : {}),
        ja_preenchido: formatarValor(c, req.dados) !== null,
      })),
      proxima_pergunta:
        proximaPergunta(tipo.formulario, emFalta)?.pergunta ?? null,
      documentos_exigidos: docs
        .filter((d) => !d.gerado_pelo_sistema)
        .map((d) => ({ nome: d.nome, obrigatorio: d.obrigatorio })),
      documentos: resumirParaAgente(docs),
      ...(precisaTraducao(req.idioma_conversa)
        ? {
            nota_idioma:
              'Fale com o munícipe na língua dele e grave as respostas como ele as disse: o requerimento é traduzido para português ao concluir.',
          }
        : {}),
    };
  }

  /** O requerimento da ferramenta: pelo id ou, sem id, o que está aberto na conversa. */
  private async paraFerramenta(
    tx: Tx,
    ctx: ContextoFerramenta,
    id: string | undefined,
  ): Promise<LinhaRequerimento> {
    const [req] = id
      ? await tx.query<LinhaRequerimento>(
          `SELECT ${COLUNAS} FROM requerimentos r
           WHERE r.id = $1 AND r.municipio_id = $2 FOR UPDATE`,
          [id, ctx.municipio.id],
        )
      : ctx.conversaId
        ? await tx.query<LinhaRequerimento>(
            `SELECT ${COLUNAS} FROM requerimentos r
             WHERE r.conversa_id = $1 AND r.estado IN ('a_preencher', 'pronto')
             ORDER BY r.atualizado_em DESC LIMIT 1 FOR UPDATE`,
            [ctx.conversaId],
          )
        : [];
    if (!req) {
      throw new ErroApi(
        HttpStatus.NOT_FOUND,
        'requerimento_nao_encontrado',
        'Não há requerimento aberto: chame iniciar_requerimento primeiro.',
      );
    }
    if (
      req.conversa_id &&
      ctx.conversaId &&
      req.conversa_id !== ctx.conversaId
    ) {
      throw new ErroApi(
        HttpStatus.FORBIDDEN,
        'requerimento_de_outra_conversa',
        'Este requerimento foi iniciado noutra conversa.',
      );
    }
    return req;
  }

  private fechado(req: LinhaRequerimento): never {
    throw new ErroApi(
      HttpStatus.CONFLICT,
      'requerimento_fechado',
      req.estado === 'cancelado'
        ? 'Este requerimento foi cancelado.'
        : 'Este requerimento já foi assinado e não pode ser alterado.',
      { estado: req.estado },
    );
  }

  async preencher(
    ctx: ContextoFerramenta,
    id: string | undefined,
    campos: Record<string, Valor | null>,
  ) {
    return this.db.transaction(async (tx) => {
      const req = await this.paraFerramenta(tx, ctx, id);
      if (req.estado !== 'a_preencher' && req.estado !== 'pronto')
        this.fechado(req);
      const tipo = await this.tipos.porId(
        ctx.municipio.id,
        req.tipo_processo_id,
        tx,
      );

      const dados: Dados = { ...req.dados };
      let municipeId = req.municipe_id;
      const gravados: string[] = [];
      const erros: { chave: string; mensagem: string }[] = [];

      for (const [chave, bruto] of Object.entries(campos)) {
        const campo = tipo.formulario.find((c) => c.chave === chave);
        if (!campo) {
          erros.push({
            chave,
            mensagem: `Campo desconhecido. Campos: ${tipo.formulario.map((c) => c.chave).join(', ')}.`,
          });
          continue;
        }
        // null = o munícipe corrigiu-se e o valor dito antes já não vale.
        if (bruto === null && campo.tipo !== 'nif') {
          delete dados[chave];
          gravados.push(chave);
          continue;
        }
        const v = validarValor(campo, bruto);
        if (!v.ok) {
          erros.push({ chave, mensagem: v.erro });
          continue;
        }
        if (campo.tipo === 'nif') {
          // O NIF vai cifrado para o munícipe; no requerimento só a marca.
          municipeId ??=
            (
              await this.municipes.porTelefone(
                ctx.municipio.id,
                ctx.telefone,
                tx,
              )
            )?.id ?? null;
          if (!municipeId) {
            erros.push({
              chave,
              mensagem:
                'Sem número de telefone não há onde guardar o NIF: use identificar_municipe.',
            });
            continue;
          }
          await this.municipes.atualizar(
            municipeId,
            { nif: String(v.valor) },
            tx,
          );
          dados[NIF_REGISTADO] = true;
        } else {
          dados[chave] = v.valor;
        }
        gravados.push(chave);
      }

      const emFalta = camposEmFalta(tipo.formulario, dados);
      const estado: Estado = emFalta.length ? 'a_preencher' : req.estado;
      if (gravados.length) {
        // Um campo dito de novo perde o original antigo (volta a traduzir-se).
        await tx.query(
          `UPDATE requerimentos SET dados = $2, campos_em_falta = $3, estado = $4,
             municipe_id = $5, atualizado_em = now(),
             dados_originais = nullif(dados_originais - $6::text[], '{}'::jsonb)
           WHERE id = $1`,
          [
            req.id,
            JSON.stringify(dados),
            emFalta,
            estado,
            municipeId,
            gravados,
          ],
        );
      }
      const docs = await this.documentosComEstado(
        tipo.id,
        req.id,
        req.processo_id,
        tx,
      );
      const proxima = proximaPergunta(tipo.formulario, emFalta);
      return {
        requerimento_id: req.id,
        estado,
        gravados,
        ...(erros.length ? { erros } : {}),
        campos_em_falta: emFalta,
        proxima_pergunta: proxima?.pergunta ?? null,
        documentos: resumirParaAgente(docs),
        ...(emFalta.length === 0
          ? {
              instrucao:
                'Está tudo preenchido: confirme com o munícipe e chame concluir_requerimento.',
            }
          : {}),
      };
    });
  }

  /** O link curto do requerimento: reaproveita um válido, senão cria. */
  private async linkRequerimento(municipioId: string, id: string, tx: Tx) {
    const [l] = await tx.query<{ codigo: string }>(
      `SELECT codigo FROM links_curtos
       WHERE destino_tipo = 'requerimento' AND destino_id = $1 AND expira_em > now() + interval '1 day'
       ORDER BY expira_em DESC LIMIT 1`,
      [id],
    );
    if (l)
      return `${this.config.get<string>('app.webUrl') ?? ''}/r/${l.codigo}`;
    return (await this.links.criar(municipioId, 'requerimento', id, { tx }))
      .url;
  }

  async concluir(ctx: ContextoFerramenta, id: string | undefined) {
    const r = await this.db.transaction(async (tx) => {
      const req = await this.paraFerramenta(tx, ctx, id);
      if (req.estado === 'cancelado') this.fechado(req);
      const tipo = await this.tipos.porId(
        ctx.municipio.id,
        req.tipo_processo_id,
        tx,
      );
      const emFalta = camposEmFalta(tipo.formulario, req.dados);
      if (emFalta.length) {
        throw new ErroApi(
          HttpStatus.UNPROCESSABLE_ENTITY,
          'campos_em_falta',
          'Ainda faltam campos obrigatórios: pergunte-os antes de concluir.',
          {
            campos_em_falta: emFalta,
            proxima_pergunta:
              proximaPergunta(tipo.formulario, emFalta)?.pergunta ?? null,
          },
        );
      }
      if (req.estado === 'a_preencher') {
        await tx.query(
          `UPDATE requerimentos SET estado = 'pronto', campos_em_falta = '{}', atualizado_em = now()
           WHERE id = $1`,
          [req.id],
        );
      }
      const link = await this.linkRequerimento(ctx.municipio.id, req.id, tx);
      const { faltam } = resumirParaAgente(
        await this.documentosComEstado(tipo.id, req.id, req.processo_id, tx),
      );
      const telefone =
        (await this.processos.telefoneDe(req.municipe_id, tx)) ?? ctx.telefone;
      // O SMS vai em português; noutra língua, mais uma linha curta na dele.
      const linhaLingua = linhaSmsNaLingua(req.idioma_conversa);
      if (telefone && req.estado !== 'entregue') {
        await this.mensagens.sms(
          {
            municipioId: ctx.municipio.id,
            municipeId: req.municipe_id,
            destino: telefone,
            motivo: 'requerimento',
            corpo:
              `${ctx.municipio.nome}: o seu pedido de ${tipo.nome} está pronto. ` +
              `Reveja e assine aqui: ${link}` +
              (faltam.length ? `. Falta entregar: ${faltam.join(', ')}.` : '') +
              (linhaLingua ? `\n${linhaLingua}` : ''),
            relacionado: {
              requerimento_id: req.id,
              ...(ctx.conversaId ? { conversa_id: ctx.conversaId } : {}),
            },
            chave: `requerimento_pronto:${req.id}`,
          },
          tx,
        );
      }
      if (req.estado === 'a_preencher') {
        await this.conversas.momento(
          ctx.conversaId,
          'requerimento',
          { requerimento_id: req.id, tipo: tipo.codigo, acao: 'pronto' },
          tx,
        );
      }
      return { req, link, faltam, sms: !!telefone };
    });

    // Depois do COMMIT: o job tem de ver o requerimento já 'pronto'. Noutra
    // língua, primeiro a tradução; é ela que põe o PDF na fila.
    if (precisaTraducao(r.req.idioma_conversa)) {
      await this.jobs.enviar(
        JOB_TRADUZIR,
        { requerimentoId: r.req.id },
        { singletonKey: `traduzir:${r.req.id}` },
      );
    } else {
      await this.jobs.enviar(
        JOB_PDF,
        { requerimentoId: r.req.id },
        { singletonKey: `pdf:${r.req.id}:pronto` },
      );
    }

    const ja = r.req.estado === 'assinado' || r.req.estado === 'entregue';
    return {
      requerimento_id: r.req.id,
      estado: ja ? r.req.estado : 'pronto',
      link: r.link,
      sms_enviado: r.sms,
      documentos_em_falta: r.faltam,
      o_que_dizer: ja
        ? 'Este requerimento já foi assinado e entregue.'
        : (r.sms
            ? 'Ficou tudo registado. Vou mandar-lhe agora um SMS com um link para rever o requerimento e assinar.'
            : `Ficou tudo registado. Pode rever e assinar no link: ${r.link}.`) +
          (r.faltam.length
            ? ` Depois ainda tem de entregar: ${r.faltam.join(', ')}; pode fazê-lo pelo mesmo link, com uma fotografia.`
            : ''),
    };
  }

  // ---------------------------------------------------------- ecrã ao vivo

  /** O que o ecrã "requerimento ao vivo" e a página pública mostram. */
  async estadoVivo(municipioId: string, id: string) {
    const [req] = await this.db.query<
      LinhaRequerimento & { numero: string | null }
    >(
      `SELECT ${COLUNAS}, p.numero FROM requerimentos r
       LEFT JOIN processos p ON p.id = r.processo_id
       WHERE r.id = $1 AND r.municipio_id = $2`,
      [id, municipioId],
    );
    if (!req) {
      throw new ErroApi(
        HttpStatus.NOT_FOUND,
        'nao_encontrado',
        'Requerimento não existe.',
      );
    }
    const tipo = await this.tipos.porId(municipioId, req.tipo_processo_id);
    return this.vista(req, tipo, req.numero);
  }

  private async vista(
    req: LinhaRequerimento,
    tipo: TipoProcesso,
    numero: string | null,
  ) {
    const docs = await this.documentosComEstado(
      tipo.id,
      req.id,
      req.processo_id,
    );
    const emFalta = camposEmFalta(tipo.formulario, req.dados);
    // Os valores como foram ditos, ao lado dos traduzidos (se houve tradução).
    const originais = req.dados_originais
      ? dadosComRotulos(tipo.formulario, req.dados_originais).filter(
          (c) => c.valor !== null && c.chave in req.dados_originais!,
        )
      : [];
    return {
      id: req.id,
      estado: req.estado,
      tipo: { codigo: tipo.codigo, nome: tipo.nome },
      idioma_conversa: req.idioma_conversa,
      campos: dadosComRotulos(tipo.formulario, req.dados),
      campos_originais: originais.length
        ? originais.map((c) => ({
            chave: c.chave,
            rotulo: c.rotulo,
            valor: c.valor,
          }))
        : null,
      campos_em_falta: tipo.formulario
        .filter((c) => emFalta.includes(c.chave))
        .map((c) => ({ chave: c.chave, rotulo: c.rotulo })),
      proxima_pergunta:
        proximaPergunta(tipo.formulario, emFalta)?.pergunta ?? null,
      documentos: resumirEntregas(docs),
      assinatura: {
        tipo: req.assinatura,
        simulada: req.assinatura === 'simulada',
        assinado_em: req.assinado_em,
      },
      processo: numero ? { numero } : null,
      conversa_id: req.conversa_id,
      criado_em: req.criado_em,
      atualizado_em: req.atualizado_em,
    };
  }

  /** O requerimento mais relevante da conversa (o que está a ser preenchido primeiro). */
  async daConversa(municipioId: string, conversaId: string) {
    const [c] = await this.db.query<{ id: string }>(
      'SELECT id FROM conversas WHERE id = $1 AND municipio_id = $2',
      [conversaId, municipioId],
    );
    if (!c)
      throw new ErroApi(
        HttpStatus.NOT_FOUND,
        'nao_encontrado',
        'Conversa não existe.',
      );
    const [r] = await this.db.query<{ id: string }>(
      `SELECT id FROM requerimentos WHERE conversa_id = $1
       ORDER BY (estado = 'a_preencher') DESC, atualizado_em DESC LIMIT 1`,
      [conversaId],
    );
    return {
      requerimento: r ? await this.estadoVivo(municipioId, r.id) : null,
    };
  }

  /**
   * SSE do ecrã ao vivo: um poll leve (só `atualizado_em` e `estado`) e o
   * estado completo quando muda. Termina quando deixa 'a_preencher' ou ao
   * fim de 30 minutos; um ping a cada 15 s mantém o proxy acordado.
   */
  async aoVivo(
    municipioId: string,
    id: string,
  ): Promise<Observable<MensagemAoVivo>> {
    const primeiro = await this.estadoVivo(municipioId, id); // 404 antes de abrir o stream
    return new Observable<MensagemAoVivo>((sub) => {
      let parado = false;
      let timer: NodeJS.Timeout | undefined;
      let marca = `${primeiro.atualizado_em.toISOString()}|${primeiro.estado}`;
      let ultimoEnvio = Date.now();
      const fim = Date.now() + DURACAO_AO_VIVO_MS;
      sub.next({ data: primeiro });
      if (primeiro.estado !== 'a_preencher') {
        sub.complete();
        return;
      }

      const passo = async () => {
        try {
          const [r] = await this.db.query<{
            atualizado_em: Date;
            estado: Estado;
          }>('SELECT atualizado_em, estado FROM requerimentos WHERE id = $1', [
            id,
          ]);
          if (parado) return;
          if (!r) return sub.complete();
          const nova = `${r.atualizado_em.toISOString()}|${r.estado}`;
          if (nova !== marca) {
            marca = nova;
            const e = await this.estadoVivo(municipioId, id);
            if (parado) return;
            sub.next({ data: e });
            ultimoEnvio = Date.now();
          } else if (Date.now() - ultimoEnvio > PING_AO_VIVO_MS) {
            sub.next({ type: 'ping', data: { em: new Date().toISOString() } });
            ultimoEnvio = Date.now();
          }
          if (r.estado !== 'a_preencher' || Date.now() > fim)
            return sub.complete();
          timer = setTimeout(() => void passo(), ESPERA_AO_VIVO_MS);
        } catch (e) {
          if (!parado) sub.error(e);
        }
      };
      timer = setTimeout(() => void passo(), ESPERA_AO_VIVO_MS);
      return () => {
        parado = true;
        clearTimeout(timer);
      };
    });
  }

  // --------------------------------------------------------------- público

  private async porToken(
    token: string,
    q: Pick<Tx, 'query'> = this.db,
    bloquear = false,
  ) {
    const [req] = await q.query<LinhaRequerimento>(
      `SELECT ${COLUNAS} FROM requerimentos r
       WHERE r.token_publico = $1 AND r.estado <> 'cancelado' ${bloquear ? 'FOR UPDATE' : ''}`,
      [token],
    );
    if (!req) {
      throw new ErroApi(
        HttpStatus.NOT_FOUND,
        'link_invalido',
        'Este requerimento não existe ou foi cancelado.',
      );
    }
    return req;
  }

  /** GET /public/requerimentos/:token — "Rever e assinar". */
  async publico(token: string) {
    const req = await this.porToken(token);
    const [tipo, municipio, extra] = await Promise.all([
      this.tipos.porId(req.municipio_id, req.tipo_processo_id),
      this.municipios.porId(req.municipio_id),
      this.db.query<{ numero: string | null; nome: string | null }>(
        `SELECT (SELECT numero FROM processos WHERE id = $1) AS numero,
                (SELECT nome FROM municipes WHERE id = $2) AS nome`,
        [req.processo_id, req.municipe_id],
      ),
    ]);
    const v = await this.vista(req, tipo, extra[0]?.numero ?? null);
    // Ids internos ficam de fora da página pública.
    const resto: Partial<typeof v> = { ...v };
    delete resto.id;
    delete resto.conversa_id;
    return {
      municipio: municipio.nome,
      requerente: { nome: extra[0]?.nome ?? null },
      ...resto,
      pode_assinar: req.estado === 'pronto',
      // Simulado à vista: a página tem de o dizer antes de a pessoa carregar em assinar.
      assinatura_disponivel: 'simulada',
      aviso: 'Assinatura simulada: demonstração, sem valor legal.',
      pdf_pronto: !!req.pdf_key,
    };
  }

  /**
   * Assinatura (simulada) e entrega, numa transação: 'pronto' → 'assinado'
   * → processo criado → 'entregue'. Repetir devolve o mesmo resultado.
   */
  async assinar(token: string, ip: string | null) {
    const r = await this.db.transaction(async (tx) => {
      const req = await this.porToken(token, tx, true);
      if (req.estado === 'entregue' && req.processo_id) {
        const [p] = await tx.query<{
          numero: string;
          fase: string;
          prazo_fim: string | null;
        }>(
          `SELECT numero, fase, to_char(prazo_fim, 'YYYY-MM-DD') AS prazo_fim FROM processos WHERE id = $1`,
          [req.processo_id],
        );
        const link = await this.processos.linkProcesso(
          req.municipio_id,
          req.processo_id,
          tx,
        );
        return { req, ja_estava: true, processo: { ...p, link } };
      }
      if (req.estado === 'a_preencher') {
        throw new ErroApi(
          HttpStatus.CONFLICT,
          'requerimento_incompleto',
          'O requerimento ainda tem campos por preencher.',
          { campos_em_falta: req.campos_em_falta },
        );
      }
      await tx.query(
        `UPDATE requerimentos SET estado = 'assinado', assinatura = 'simulada',
           assinado_em = coalesce(assinado_em, now()), atualizado_em = now()
         WHERE id = $1`,
        [req.id],
      );
      const tipo = await this.tipos.porId(
        req.municipio_id,
        req.tipo_processo_id,
        tx,
      );
      const p = await this.processos.criarDeRequerimento(tx, req, tipo);
      await this.auditoria.registar(
        {
          municipioId: req.municipio_id,
          atorTipo: 'municipe',
          atorId: req.municipe_id,
          acao: 'assinar',
          objetoTipo: 'requerimento',
          objetoId: req.id,
          dados: { assinatura: 'simulada', processo_id: p.processo_id },
          ip,
        },
        tx,
      );
      return {
        req,
        ja_estava: false,
        processo: {
          numero: p.numero,
          fase: p.fase,
          prazo_fim: p.prazo_fim,
          link: p.link,
          documentos_em_falta: p.documentos_em_falta,
        },
      };
    });

    if (!r.ja_estava) {
      await this.jobs.enviar(
        JOB_PDF,
        { requerimentoId: r.req.id },
        { singletonKey: `pdf:${r.req.id}:assinado` },
      );
    }
    return {
      estado: 'entregue',
      assinatura: 'simulada',
      assinatura_simulada: true,
      ja_estava_entregue: r.ja_estava,
      processo: r.processo,
    };
  }

  /**
   * URL de envio assinada para um documento (fotografia ou PDF) e a linha em
   * `documentos`, por verificar. Depois de entregue, o documento vai também
   * para o processo.
   */
  async novoDocumento(
    token: string,
    b: { tipo_documento_id?: string | null; mime: string; nome: string },
  ) {
    const req = await this.porToken(token);
    if (b.tipo_documento_id) {
      const [d] = await this.db.query<{ id: string }>(
        'SELECT id FROM tipo_processo_documentos WHERE id = $1 AND tipo_processo_id = $2',
        [b.tipo_documento_id, req.tipo_processo_id],
      );
      if (!d) {
        throw new ErroApi(
          HttpStatus.BAD_REQUEST,
          'documento_desconhecido',
          'Esse documento não é pedido neste requerimento.',
        );
      }
    }
    const municipio = await this.municipios.porId(req.municipio_id);
    const chave = this.armazenamento.chave(
      municipio.slug,
      'documentos',
      MIMES_DOCUMENTO[b.mime],
    );
    // Primeiro a URL: sem armazenamento dá 503 antes de se gravar a linha.
    const url = await this.armazenamento.urlEnvio(chave, b.mime);
    const [doc] = await this.db.transaction(async (tx) => {
      const linhas = await tx.query<{ id: string }>(
        `INSERT INTO documentos (municipio_id, processo_id, requerimento_id, tipo_documento_id,
           ficheiro_key, mime, origem)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [
          req.municipio_id,
          req.processo_id,
          req.id,
          b.tipo_documento_id ?? null,
          chave,
          b.mime,
          b.mime.startsWith('image/') ? 'foto' : 'upload',
        ],
      );
      // Acorda o ecrã ao vivo.
      await tx.query(
        'UPDATE requerimentos SET atualizado_em = now() WHERE id = $1',
        [req.id],
      );
      return linhas;
    });
    return {
      documento_id: doc.id,
      verificacao_estado: 'por_verificar',
      envio: {
        url,
        metodo: 'PUT',
        headers: { 'Content-Type': b.mime },
        expira_em_segundos: 600,
      },
    };
  }

  /**
   * "Tira a foto e o sistema diz o que está mal": a IA lê o documento, as
   * regras de `tipo_processo_documentos.verificacoes` decidem o estado. Com
   * armazenamento, a foto fica guardada e a linha em `documentos` criada (ou
   * atualizada, se a última foto deste documento tinha sido rejeitada). Sem
   * armazenamento devolve só o resultado (`guardado: false`): `ficheiro_key`
   * é obrigatório e não se finge que se guardou.
   */
  async verificarDocumento(
    token: string,
    b: { tipo_documento_id: string; mime: MimeVisao; imagem_base64: string },
  ) {
    const req = await this.porToken(token);
    const [esperado] = await this.db.query<{
      id: string;
      nome: string;
      verificacoes: unknown;
    }>(
      `SELECT id, nome, verificacoes FROM tipo_processo_documentos
       WHERE id = $1 AND tipo_processo_id = $2 AND NOT gerado_pelo_sistema`,
      [b.tipo_documento_id, req.tipo_processo_id],
    );
    if (!esperado) {
      throw new ErroApi(
        HttpStatus.BAD_REQUEST,
        'documento_desconhecido',
        'Esse documento não é pedido neste requerimento.',
      );
    }

    const ficheiro = Buffer.from(b.imagem_base64, 'base64');
    const maximo =
      b.mime === 'application/pdf' ? MAXIMO_PDF_BYTES : MAXIMO_IMAGEM_BYTES;
    if (ficheiro.length > maximo) {
      throw new ErroApi(
        HttpStatus.PAYLOAD_TOO_LARGE,
        'imagem_grande',
        'O ficheiro é demasiado grande: tire outra fotografia com menos resolução.',
        { maximo_bytes: maximo },
      );
    }
    if (mimePelosBytes(ficheiro) !== b.mime) {
      throw new ErroApi(
        HttpStatus.BAD_REQUEST,
        'ficheiro_invalido',
        'O ficheiro não é uma imagem (JPEG, PNG, WebP, GIF) ou PDF válido.',
      );
    }

    const verificacoes = lerVerificacoes(esperado.verificacoes);
    const leitura = await this.visao.lerDocumento({
      ficheiro,
      mime: b.mime,
      esperado: esperado.nome,
      verificacoes: verificacoesEmPalavras(verificacoes),
    });

    // NIF: compara-se pelo hash (porNif), nunca se decifra o do requerente
    // nem se guarda o lido. Sem NIF do requerente → null (por confirmar).
    const nifLido = leitura.nif_visivel?.replace(/\D/g, '') ?? '';
    let nifCorresponde: boolean | null = null;
    if (
      verificacoes.some((v) => v.tipo === 'nif_requerente') &&
      nifValido(nifLido) &&
      req.municipe_id
    ) {
      const requerente = await this.municipes.porId(req.municipe_id);
      if (requerente?.tem_nif) {
        const dono = await this.municipes.porNif(req.municipio_id, nifLido);
        nifCorresponde = dono?.id === req.municipe_id;
      }
    }
    const avaliacao = avaliarDocumento({
      leitura,
      verificacoes,
      hoje: hojeLisboa(),
      nifVisivel: nifValido(nifLido),
      nifCorresponde,
    });

    let documentoId: string | null = null;
    if (this.armazenamento.disponivel) {
      const municipio = await this.municipios.porId(req.municipio_id);
      const chave = this.armazenamento.chave(
        municipio.slug,
        'documentos',
        MIMES_DOCUMENTO[b.mime],
      );
      await this.armazenamento.guardar(chave, ficheiro, b.mime);
      documentoId = await this.db.transaction(async (tx) => {
        const valores = [
          chave,
          b.mime,
          ficheiro.length,
          avaliacao.estado,
          JSON.stringify(avaliacao.regras),
          avaliacao.emitido_em,
        ];
        // A foto anterior rejeitada deste documento dá lugar à nova.
        const [atualizado] = await tx.query<{ id: string }>(
          `UPDATE documentos SET ficheiro_key = $3, mime = $4, tamanho = $5,
             verificacao_estado = $6, verificacao = $7, emitido_em = $8,
             processo_id = coalesce(processo_id, $9), recebido_em = now()
           WHERE id = (
             SELECT id FROM documentos
             WHERE requerimento_id = $1 AND tipo_documento_id = $2 AND origem = 'foto'
               AND verificacao_estado IN ('fora_de_prazo', 'documento_errado', 'ilegivel')
             ORDER BY recebido_em DESC LIMIT 1)
           RETURNING id`,
          [req.id, esperado.id, ...valores, req.processo_id],
        );
        const [doc] = atualizado
          ? [atualizado]
          : await tx.query<{ id: string }>(
              `INSERT INTO documentos (requerimento_id, tipo_documento_id, ficheiro_key, mime,
                 tamanho, verificacao_estado, verificacao, emitido_em, processo_id,
                 municipio_id, origem)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'foto') RETURNING id`,
              [
                req.id,
                esperado.id,
                ...valores,
                req.processo_id,
                req.municipio_id,
              ],
            );
        // Acorda o ecrã ao vivo.
        await tx.query(
          'UPDATE requerimentos SET atualizado_em = now() WHERE id = $1',
          [req.id],
        );
        return doc.id;
      });
    }

    const docs = await this.documentosComEstado(
      req.tipo_processo_id,
      req.id,
      req.processo_id,
    );
    return {
      documento: { id: esperado.id, nome: esperado.nome },
      estado: avaliacao.estado,
      valido: avaliacao.estado === 'valido',
      mensagem: fraseVerificacao(esperado.nome, avaliacao),
      regras: avaliacao.regras,
      lido: {
        tipo_reconhecido: leitura.tipo_reconhecido,
        emitido_em: avaliacao.emitido_em,
        entidade_emissora: leitura.entidade_emissora,
        observacoes: leitura.observacoes,
      },
      guardado: documentoId !== null,
      documento_id: documentoId,
      ...(documentoId
        ? {}
        : {
            aviso:
              'A fotografia foi verificada mas não ficou guardada: entregue este documento mais tarde.',
          }),
      documentos: resumirEntregas(docs),
    };
  }

  // ------------------------------------------------------------------- job

  /**
   * O trabalho `traduzir_requerimento`: os campos de texto (e moradas,
   * normalizadas) para português de Portugal, guardando os originais. No fim
   * põe o PDF na fila. Sem IA, ou se a IA falhar, segue sem traduzir.
   */
  async traduzir(requerimentoId: string): Promise<void> {
    const [req] = await this.db.query<LinhaRequerimento>(
      `SELECT ${COLUNAS} FROM requerimentos r WHERE r.id = $1`,
      [requerimentoId],
    );
    if (!req) {
      this.logger.warn(`Tradução: requerimento ${requerimentoId} não existe.`);
      return;
    }
    const tipo = await this.tipos.porId(req.municipio_id, req.tipo_processo_id);
    const pedidos = camposATraduzir(
      tipo.formulario,
      req.dados,
      req.dados_originais,
    );
    if (pedidos.length && !this.claude.disponivel) {
      this.logger.warn(
        `Requerimento ${req.id} (${req.idioma_conversa}) não traduzido: IA não configurada.`,
      );
    } else if (pedidos.length) {
      try {
        const traducao = await this.claude.extrair(esquemaTraducao, {
          tarefa: 'traduzir_requerimento',
          sistema: SISTEMA_TRADUCAO,
          conteudo: JSON.stringify({
            idioma_origem: req.idioma_conversa,
            campos: pedidos,
          }),
          esforco: 'low',
        });
        const r = aplicarTraducao(
          tipo.formulario,
          req.dados,
          req.dados_originais,
          pedidos,
          traducao,
        );
        if (r.traduzidos.length) {
          // Só se ninguém mexeu entretanto (o agente pode ter corrigido um campo).
          await this.db.query(
            `UPDATE requerimentos SET dados = $2, dados_originais = $3, atualizado_em = now()
             WHERE id = $1 AND dados = $4::jsonb`,
            [
              req.id,
              JSON.stringify(r.dados),
              JSON.stringify(r.originais),
              JSON.stringify(req.dados),
            ],
          );
        }
      } catch (e) {
        this.logger.warn(
          `Requerimento ${req.id} não traduzido: ${(e as Error).message}`,
        );
      }
    }
    await this.jobs.enviar(
      JOB_PDF,
      { requerimentoId: req.id },
      { singletonKey: `pdf:${req.id}:traduzido` },
    );
  }

  /** O trabalho `gerar_pdf_requerimento`. Sem armazenamento: avisa e termina. */
  async gerarPdf(requerimentoId: string): Promise<void> {
    if (!this.armazenamento.disponivel) {
      this.logger.warn(
        `PDF do requerimento ${requerimentoId} não gerado: sem S3_BUCKET.`,
      );
      return;
    }
    const [req] = await this.db.query<
      LinhaRequerimento & {
        numero: string | null;
        municipe_nome: string | null;
        telefone: string | null;
        email: string | null;
      }
    >(
      `SELECT ${COLUNAS}, p.numero, mu.nome AS municipe_nome, mu.telefone_e164 AS telefone, mu.email
       FROM requerimentos r
       LEFT JOIN processos p ON p.id = r.processo_id
       LEFT JOIN municipes mu ON mu.id = r.municipe_id
       WHERE r.id = $1`,
      [requerimentoId],
    );
    if (!req) {
      this.logger.warn(`PDF: requerimento ${requerimentoId} não existe.`);
      return;
    }
    const [tipo, municipio, nif, docs] = await Promise.all([
      this.tipos.porId(req.municipio_id, req.tipo_processo_id),
      this.municipios.porId(req.municipio_id),
      req.municipe_id
        ? this.municipes.nifEmClaro(req.municipe_id)
        : Promise.resolve(null),
      this.documentosComEstado(req.tipo_processo_id, req.id, req.processo_id),
    ]);
    const entregas = resumirParaAgente(docs);
    const pdf = await gerarPdfRequerimento({
      municipio: municipio.nome,
      tipo: { codigo: tipo.codigo, nome: tipo.nome },
      numeroProcesso: req.numero,
      criadoEm: req.criado_em,
      requerente: {
        nome: req.municipe_nome,
        nif,
        telefone: req.telefone,
        email: req.email,
      },
      campos: dadosComRotulos(tipo.formulario, req.dados),
      documentos: {
        tem: entregas.tem.map((n) =>
          entregas.por_verificar.includes(n) ? `${n} (por verificar)` : n,
        ),
        faltam: entregas.faltam,
      },
      assinatura: { tipo: req.assinatura, em: req.assinado_em },
    });
    const chave = this.armazenamento.chave(
      municipio.slug,
      'requerimentos',
      'pdf',
    );
    await this.armazenamento.guardar(chave, pdf, 'application/pdf');
    await this.db.query('UPDATE requerimentos SET pdf_key = $2 WHERE id = $1', [
      req.id,
      chave,
    ]);
  }
}
