import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'crypto';
import { z } from 'zod';
import { ErroApi } from '../../common/erros.js';
import type { UtilizadorPainel } from '../../common/pedido.js';
import { DatabaseService, Tx } from '../../database/database.service.js';
import { ContextoFerramenta } from '../../ferramentas/ferramenta.js';
import { JobsService } from '../../jobs/jobs.service.js';
import { AuditoriaService, Registo } from '../auditoria/auditoria.service.js';
import { MensagensService } from '../comunicacao/mensagens.service.js';
import { MunicipesService } from '../municipes/municipes.service.js';
import { MunicipiosService } from '../municipios/municipios.service.js';
import { Dados, dadosComRotulos } from '../processos/formulario.js';
import { ProcessosService } from '../processos/processos.service.js';
import { resumirDocumentos } from '../processos/regras.js';
import { TiposProcessoService } from '../processos/tipos-processo.service.js';
import { JOB_PDF } from '../requerimentos/requerimentos.service.js';
import {
  AutenticacaoCidadao,
  AutenticacaoCmd,
  AutenticacaoSimulada,
  ConfigCmd,
  erroPorConfigurar,
  PIN_DEMONSTRACAO,
} from './autenticacao-cidadao.js';
import { gerarPdfComprovativo } from './comprovativo-pdf.js';
import {
  AUTENTICACAO_MINUTOS,
  AVISO_SIMULACAO,
  codigoResumo,
  confereIdentidade,
  confirmacaoClara,
  ESTADO_ROTULO,
  EstadoEntrega,
  estadoEfetivo,
  IdentidadeCidadao,
  mascararNif,
  mascararTelefone,
  MAX_TENTATIVAS_AUTENTICACAO,
  mensagemErro,
  podePassar,
  ResumoPedido,
  resumoFalado,
  validadeHoras,
} from './regras.js';
import {
  Comprovativo,
  ErroSubmissao,
  SubmissaoBalcao,
  SubmissaoBalcaoOnline,
  SubmissaoSimulada,
} from './submissao-balcao.js';

export const FILA_EXPIRAR_ENTREGAS = 'expirar_entregas';

export const entradaEntregar = z.object({
  requerimento_id: z
    .uuid()
    .optional()
    .describe('De iniciar_requerimento (sem ele, o desta conversa).'),
  confirmado: z
    .boolean()
    .optional()
    .describe('true só depois de ler o resumo e de um sim claro.'),
  codigo_resumo: z
    .string()
    .trim()
    .max(20)
    .optional()
    .describe('O da primeira chamada.'),
  palavras_do_municipe: z
    .string()
    .trim()
    .max(500)
    .optional()
    .describe('Como a pessoa confirmou, tal como disse.'),
});
export type EntradaEntregar = z.output<typeof entradaEntregar>;

interface LinhaRequerimento {
  id: string;
  municipio_id: string;
  municipe_id: string | null;
  conversa_id: string | null;
  tipo_processo_id: string;
  dados: Dados;
  estado: string;
  processo_id: string | null;
}

interface LinhaEntrega {
  id: string;
  municipio_id: string;
  requerimento_id: string;
  processo_id: string | null;
  municipe_id: string | null;
  conversa_id: string | null;
  estado: EstadoEntrega;
  resumo: ResumoPedido;
  resumo_hash: string;
  confirmacao: string;
  confirmado_em: Date;
  canal: string;
  token_publico: string;
  expira_em: Date;
  autenticacao_modo: string;
  submissao_modo: string;
  simulado: boolean;
  auth_state_hash: Buffer | null;
  auth_verificador: string | null;
  auth_nonce: string | null;
  auth_iniciada_em: Date | null;
  tentativas_autenticacao: number;
  consentimento_em: Date | null;
  identidade:
    (Omit<IdentidadeCidadao, 'nif'> & { nif_mascarado: string | null }) | null;
  autorizado_em: Date | null;
  numero_entrada: string | null;
  comprovativo: Comprovativo | null;
  entregue_em: Date | null;
  tentativas: number;
  erro: string | null;
  criado_em: Date;
  atualizado_em: Date;
}

const sha256 = (s: string) => createHash('sha256').update(s).digest();
const aleatorio = () => randomBytes(32).toString('base64url');

function dataHora(d: Date): string {
  return d.toLocaleString('pt-PT', {
    timeZone: 'Europe/Lisbon',
    day: 'numeric',
    month: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const ESTADOS_REQUERIMENTO_ENTREGAVEIS = ['pronto', 'assinado', 'entregue'];

/**
 * Entregar o pedido em nome da pessoa: o agente confirma o resumo, manda o
 * link de autorização por SMS, a pessoa autentica-se (Chave Móvel Digital,
 * simulada enquanto não houver credenciação na AMA) e o pedido é submetido
 * no balcão online (simulado). Tudo na auditoria.
 */
@Injectable()
export class EntregasService {
  private readonly logger = new Logger(EntregasService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly config: ConfigService,
    private readonly tipos: TiposProcessoService,
    private readonly processos: ProcessosService,
    private readonly municipes: MunicipesService,
    private readonly municipios: MunicipiosService,
    private readonly mensagens: MensagensService,
    private readonly auditoria: AuditoriaService,
    private readonly jobs: JobsService,
  ) {}

  // ------------------------------------------------------------ adaptadores

  private env(nome: string): string {
    return (this.config.get<string>(nome) ?? '').trim();
  }

  private get webUrl(): string {
    return this.config.get<string>('app.webUrl') ?? '';
  }

  private configCmd(): ConfigCmd {
    return {
      protocolo: this.env('CMD_PROTOCOLO'),
      urlBase: this.env('CMD_URL_BASE'),
      clientId: this.env('CMD_CLIENT_ID'),
      samlEntityId: this.env('CMD_SAML_ENTITY_ID'),
      samlCertificado: this.env('CMD_SAML_CERTIFICADO'),
      samlChavePrivada: this.env('CMD_SAML_CHAVE_PRIVADA'),
      atributos: this.env('CMD_ATRIBUTOS'),
      urlRetorno: `${this.config.get<string>('app.apiUrl') ?? ''}/v1/public/entregas/autenticacao/retorno`,
    };
  }

  /** O adaptador de autenticação escolhido (ENTREGA_AUTENTICACAO; simulada por omissão). */
  autenticacao(): AutenticacaoCidadao {
    const modo = this.env('ENTREGA_AUTENTICACAO') || 'simulada';
    if (modo === 'simulada') return new AutenticacaoSimulada();
    if (modo === 'cmd') return new AutenticacaoCmd(this.configCmd());
    throw erroPorConfigurar([
      `ENTREGA_AUTENTICACAO (valor desconhecido: ${modo})`,
    ]);
  }

  /** O adaptador de submissão escolhido (ENTREGA_SUBMISSAO; simulada por omissão). */
  submissao(): SubmissaoBalcao {
    const modo = this.env('ENTREGA_SUBMISSAO') || 'simulada';
    if (modo === 'balcao') {
      return new SubmissaoBalcaoOnline({
        url: this.env('BALCAO_URL'),
        credencial: this.env('BALCAO_CREDENCIAL'),
      });
    }
    const taxa = Number(this.env('ENTREGA_SUBMISSAO_TAXA_FALHA') || '0');
    return new SubmissaoSimulada(
      Number.isFinite(taxa) ? Math.min(1, Math.max(0, taxa)) : 0,
    );
  }

  /** Para o painel: o modo atual e o que falta para a entrega real. */
  modo() {
    const modoAuth = this.env('ENTREGA_AUTENTICACAO') || 'simulada';
    const modoSub = this.env('ENTREGA_SUBMISSAO') || 'simulada';
    let auth: { modo: string; simulada: boolean; em_falta: string[] };
    try {
      const a = this.autenticacao();
      auth = { modo: a.modo, simulada: a.simulada, em_falta: a.emFalta() };
    } catch {
      auth = {
        modo: modoAuth,
        simulada: false,
        em_falta: ['ENTREGA_AUTENTICACAO'],
      };
    }
    const s = this.submissao();
    const sub = { modo: s.modo, simulada: s.simulada, em_falta: s.emFalta() };
    const simulado = auth.simulada || sub.simulada;
    const pronto = auth.em_falta.length === 0 && sub.em_falta.length === 0;
    return {
      simulado,
      estado: simulado ? 'simulado' : pronto ? 'real' : 'real_por_configurar',
      autenticacao: {
        ...auth,
        rotulo:
          auth.modo === 'cmd'
            ? 'Chave Móvel Digital (autenticacao.gov)'
            : 'Chave Móvel Digital simulada',
        configurada: auth.em_falta.length === 0,
      },
      submissao: {
        ...sub,
        modo_pedido: modoSub,
        rotulo:
          sub.modo === 'balcao'
            ? 'Balcão online da câmara'
            : 'Balcão online simulado',
        configurada: sub.em_falta.length === 0,
      },
      validade_horas: validadeHoras(this.env('ENTREGA_VALIDADE_HORAS')),
      aviso: simulado ? AVISO_SIMULACAO : null,
      o_que_falta: [
        ...(auth.modo === 'simulada' || auth.em_falta.length
          ? [
              'Credenciação na AMA: adesão ao Fornecedor de Autenticação do Estado (autenticacao.gov) para a Chave Móvel Digital e o Cartão de Cidadão, com o protocolo da câmara, os certificados e o URL de retorno registado.',
              'Testar no ambiente de testes da AMA e ligar a validação da resposta da Chave Móvel Digital.',
            ]
          : []),
        ...(sub.modo === 'simulada' || sub.em_falta.length
          ? [
              'Acesso de submissão ao balcão online da câmara (ou ao ePortugal): documentação, credenciais e ambiente de testes.',
            ]
          : []),
      ],
      documento: 'docs/CREDENCIAIS_EXTERNAS.md',
    };
  }

  // ------------------------------------------------------------- comuns

  urlWeb(): string {
    return this.webUrl;
  }

  /** O token da entrega de um pedido de autenticação (para voltar à página certa). */
  async tokenDoState(state: string): Promise<string | null> {
    if (!state) return null;
    const [e] = await this.db.query<{ token_publico: string }>(
      'SELECT token_publico FROM entregas_em_nome WHERE auth_state_hash = $1',
      [sha256(state)],
    );
    return e?.token_publico ?? null;
  }

  private linkPublico(token: string): string {
    return `${this.webUrl}/entrega/${token}`;
  }

  private async resumoDe(
    req: LinhaRequerimento,
    q: Pick<Tx, 'query'>,
  ): Promise<ResumoPedido> {
    const tipo = await this.tipos.porId(
      req.municipio_id,
      req.tipo_processo_id,
      q,
    );
    const [mu] = req.municipe_id
      ? await q.query<{ nome: string | null }>(
          'SELECT nome FROM municipes WHERE id = $1',
          [req.municipe_id],
        )
      : [];
    const docs = await this.tipos.documentos(
      tipo.id,
      { requerimentoId: req.id, processoId: req.processo_id },
      q,
    );
    const { tem, faltam } = resumirDocumentos(docs);
    return {
      tipo: { codigo: tipo.codigo, nome: tipo.nome },
      requerente: mu?.nome ?? null,
      campos: dadosComRotulos(tipo.formulario, req.dados)
        // O NIF não se lê em voz alta (fica no requerente, cifrado).
        .filter((c) => c.valor !== null && c.tipo !== 'nif')
        .map((c) => ({ rotulo: c.rotulo, valor: c.valor! })),
      documentos: { entregues: tem, em_falta: faltam },
    };
  }

  private async registar(r: Omit<Registo, 'objetoTipo'>, tx?: Tx) {
    await this.auditoria.registar({ ...r, objetoTipo: 'entrega_em_nome' }, tx);
  }

  /** Passa a 'expirado' o que ficou à espera para lá da validade (e regista). */
  async expirarVencidas(filtro: { municipioId?: string; id?: string } = {}) {
    const r = await this.db.query<{ id: string; municipio_id: string }>(
      `UPDATE entregas_em_nome SET estado = 'expirado', atualizado_em = now(),
         auth_state_hash = NULL, auth_verificador = NULL, auth_nonce = NULL
       WHERE estado IN ('preparado','a_espera_autorizacao') AND expira_em <= now()
         AND ($1::uuid IS NULL OR municipio_id = $1) AND ($2::uuid IS NULL OR id = $2)
       RETURNING id, municipio_id`,
      [filtro.municipioId ?? null, filtro.id ?? null],
    );
    for (const e of r) {
      await this.registar({
        municipioId: e.municipio_id,
        atorTipo: 'sistema',
        acao: 'expirar_entrega',
        objetoId: e.id,
        dados: { motivo: 'link de autorização fora da validade' },
      });
    }
    return r.length;
  }

  // ------------------------------------------------------------ ferramenta

  private async requerimentoDaFerramenta(
    ctx: ContextoFerramenta,
    id: string | undefined,
  ): Promise<LinhaRequerimento> {
    const colunas = `r.id, r.municipio_id, r.municipe_id, r.conversa_id, r.tipo_processo_id,
      r.dados, r.estado::text AS estado, r.processo_id`;
    const [req] = id
      ? await this.db.query<LinhaRequerimento>(
          `SELECT ${colunas} FROM requerimentos r WHERE r.id = $1 AND r.municipio_id = $2`,
          [id, ctx.municipio.id],
        )
      : ctx.conversaId
        ? await this.db.query<LinhaRequerimento>(
            `SELECT ${colunas} FROM requerimentos r
             WHERE r.conversa_id = $1 AND r.estado <> 'cancelado'
             ORDER BY r.atualizado_em DESC LIMIT 1`,
            [ctx.conversaId],
          )
        : [];
    if (!req) {
      throw new ErroApi(
        HttpStatus.NOT_FOUND,
        'requerimento_nao_encontrado',
        'Não há requerimento nesta conversa: preencha-o primeiro com iniciar_requerimento.',
      );
    }
    const mesmaConversa =
      !req.conversa_id || !ctx.conversaId || req.conversa_id === ctx.conversaId;
    const mesmaPessoa = !!ctx.municipeId && ctx.municipeId === req.municipe_id;
    if (!mesmaConversa && !mesmaPessoa) {
      throw new ErroApi(
        HttpStatus.FORBIDDEN,
        'requerimento_de_outra_conversa',
        'Este requerimento foi iniciado noutra conversa.',
      );
    }
    if (req.estado === 'cancelado') {
      throw new ErroApi(
        HttpStatus.CONFLICT,
        'requerimento_fechado',
        'Este requerimento foi cancelado.',
      );
    }
    if (!ESTADOS_REQUERIMENTO_ENTREGAVEIS.includes(req.estado)) {
      throw new ErroApi(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'requerimento_por_concluir',
        'O requerimento ainda não está pronto: complete os campos e chame concluir_requerimento antes de entregar.',
      );
    }
    return req;
  }

  /** A entrega viva deste requerimento, se houver (já com a expiração aplicada). */
  private async entregaViva(
    requerimentoId: string,
  ): Promise<LinhaEntrega | null> {
    const [e] = await this.db.query<LinhaEntrega>(
      `SELECT * FROM entregas_em_nome
       WHERE requerimento_id = $1 AND estado IN ('preparado','a_espera_autorizacao','autorizado','entregue','falhou')`,
      [requerimentoId],
    );
    if (e && estadoEfetivo(e.estado, e.expira_em, new Date()) === 'expirado') {
      await this.expirarVencidas({ id: e.id });
      return null;
    }
    return e ?? null;
  }

  private respostaEntregaExistente(e: LinhaEntrega) {
    const link = this.linkPublico(e.token_publico);
    switch (e.estado) {
      case 'entregue':
        return {
          estado: e.estado,
          numero_entrada: e.numero_entrada,
          simulado: e.simulado,
          link,
          dizer: `Este pedido já foi entregue no balcão online, com o número de entrada ${e.numero_entrada}.${e.simulado ? ' Foi uma entrega de demonstração, sem validade legal.' : ''}`,
        };
      case 'falhou':
        return {
          estado: e.estado,
          simulado: e.simulado,
          dizer:
            'A pessoa já autorizou, mas o balcão online não respondeu. A câmara vai tentar outra vez; não é preciso fazer nada.',
        };
      default:
        return {
          estado: e.estado,
          simulado: e.simulado,
          link,
          expira_em: e.expira_em,
          dizer:
            'Já mandei o link para autorizar a entrega. Basta abrir o SMS, confirmar o pedido e autorizar com a Chave Móvel Digital.',
        };
    }
  }

  /**
   * A ferramenta `entregar_pedido`. Primeira chamada (sem `confirmado`):
   * devolve o resumo para ler e o código dessa versão. Segunda, com
   * `confirmado: true`, o código e as palavras da pessoa: prepara a entrega
   * e manda o SMS com o link de autorização.
   */
  async entregarPedido(ctx: ContextoFerramenta, e: EntradaEntregar) {
    const req = await this.requerimentoDaFerramenta(ctx, e.requerimento_id);
    const existente = await this.entregaViva(req.id);
    if (existente) return this.respostaEntregaExistente(existente);

    const resumo = await this.resumoDe(req, this.db);
    const codigo = codigoResumo(resumo);
    const porConfirmar = (motivo?: string) => ({
      estado: 'por_confirmar',
      ...(motivo ? { motivo } : {}),
      resumo,
      resumo_para_ler: resumoFalado(resumo),
      codigo_resumo: codigo,
      simulado: true,
      dizer:
        'Antes de entregar, vou ler-lhe o resumo do pedido. ' +
        resumoFalado(resumo) +
        ' Confirma que quer que eu entregue este pedido em seu nome no balcão online da câmara? Nesta demonstração a entrega é simulada e não tem validade legal.',
      instrucao:
        'Leia o resumo à pessoa e espere um sim claro. Só então chame entregar_pedido outra vez com confirmado: true, o codigo_resumo e as palavras_do_municipe. Se a pessoa hesitar ou disser que não, não entregue.',
    });

    if (e.confirmado !== true) return porConfirmar();
    if (!e.codigo_resumo || !e.palavras_do_municipe) {
      throw new ErroApi(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'confirmacao_em_falta',
        'Para entregar em nome da pessoa é preciso o codigo_resumo e as palavras com que ela confirmou: leia o resumo primeiro (chame sem confirmado).',
      );
    }
    if (e.codigo_resumo !== codigo) {
      return porConfirmar(
        'O pedido mudou desde que leu o resumo: leia-o outra vez e confirme de novo.',
      );
    }
    if (!confirmacaoClara(e.palavras_do_municipe)) {
      throw new ErroApi(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'confirmacao_pouco_clara',
        'As palavras da pessoa não são uma confirmação clara. Pergunte de novo se quer que entregue o pedido em nome dela; sem um sim claro, não entregue.',
      );
    }

    // O modo tem de servir antes de se mandar um link que não leva a lado nenhum.
    const auth = this.autenticacao();
    const falta = auth.emFalta();
    if (falta.length) throw erroPorConfigurar(falta);
    const sub = this.submissao();
    const simulado = auth.simulada || sub.simulada;
    const horas = validadeHoras(this.env('ENTREGA_VALIDADE_HORAS'));

    const r = await this.db.transaction(async (tx) => {
      const [nova] = await tx.query<LinhaEntrega>(
        `INSERT INTO entregas_em_nome (municipio_id, requerimento_id, processo_id, municipe_id,
           conversa_id, resumo, resumo_hash, confirmacao, canal, expira_em,
           autenticacao_modo, submissao_modo, simulado)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now() + make_interval(hours => $10), $11, $12, $13)
         ON CONFLICT (requerimento_id)
           WHERE estado IN ('preparado','a_espera_autorizacao','autorizado','entregue','falhou')
           DO NOTHING
         RETURNING *`,
        [
          req.municipio_id,
          req.id,
          req.processo_id,
          req.municipe_id,
          ctx.conversaId ?? req.conversa_id,
          JSON.stringify(resumo),
          codigo,
          e.palavras_do_municipe,
          ctx.canal,
          horas,
          auth.modo,
          sub.modo,
          simulado,
        ],
      );
      if (!nova) return null; // outra chamada ganhou: idempotente
      await this.registar(
        {
          municipioId: req.municipio_id,
          atorTipo: 'municipe',
          atorId: req.municipe_id,
          acao: 'confirmar_entrega',
          objetoId: nova.id,
          dados: {
            requerimento_id: req.id,
            palavras: e.palavras_do_municipe,
            resumo_hash: codigo,
            canal: ctx.canal,
            conversa_id: ctx.conversaId,
            simulado,
          },
        },
        tx,
      );

      const telefone =
        (await this.processos.telefoneDe(req.municipe_id, tx)) ?? ctx.telefone;
      const link = this.linkPublico(nova.token_publico);
      if (telefone) {
        await this.mensagens.sms(
          {
            municipioId: req.municipio_id,
            municipeId: req.municipe_id,
            destino: telefone,
            motivo: 'requerimento',
            corpo:
              `${ctx.municipio.nome}: para entregarmos em seu nome o pedido de ${resumo.tipo.nome} no balcão online, ` +
              `confirme e autorize aqui: ${link} (válido até ${dataHora(nova.expira_em)}).` +
              (simulado ? ' DEMONSTRAÇÃO: sem validade legal.' : ''),
            relacionado: {
              requerimento_id: req.id,
              entrega_id: nova.id,
              ...(ctx.conversaId ? { conversa_id: ctx.conversaId } : {}),
            },
            chave: `entrega_autorizar:${nova.id}`,
          },
          tx,
        );
      }
      await tx.query(
        `UPDATE entregas_em_nome SET estado = 'a_espera_autorizacao', atualizado_em = now() WHERE id = $1`,
        [nova.id],
      );
      await this.registar(
        {
          municipioId: req.municipio_id,
          atorTipo: 'agente',
          acao: 'pedir_autorizacao_entrega',
          objetoId: nova.id,
          dados: {
            sms: !!telefone,
            expira_em: nova.expira_em,
            autenticacao: auth.modo,
            submissao: sub.modo,
            simulado,
          },
        },
        tx,
      );
      return { entrega: nova, link, sms: !!telefone };
    });

    if (!r) {
      const outra = await this.entregaViva(req.id);
      if (outra) return this.respostaEntregaExistente(outra);
      throw new ErroApi(HttpStatus.CONFLICT, 'conflito', 'Tente outra vez.');
    }
    return {
      estado: 'a_espera_autorizacao',
      sms_enviado: r.sms,
      link: r.link,
      expira_em: r.entrega.expira_em,
      validade_horas: horas,
      simulado,
      dizer:
        (r.sms
          ? 'Combinado. Mandei-lhe um SMS com um link: abra-o, confira o pedido e autorize a entrega com a Chave Móvel Digital.'
          : `Combinado. Abra este link, confira o pedido e autorize a entrega com a Chave Móvel Digital: ${r.link}.`) +
        ` O link vale ${horas} horas.` +
        (simulado
          ? ' Nesta demonstração a autorização e a entrega são simuladas e não têm validade legal.'
          : ''),
    };
  }

  // -------------------------------------------------------------- público

  private async porToken(
    token: string,
    q: Pick<Tx, 'query'> = this.db,
    bloquear = false,
  ) {
    const [e] = await q.query<LinhaEntrega>(
      `SELECT * FROM entregas_em_nome WHERE token_publico = $1 ${bloquear ? 'FOR UPDATE' : ''}`,
      [token],
    );
    if (!e) {
      throw new ErroApi(
        HttpStatus.NOT_FOUND,
        'link_invalido',
        'Este link de entrega não existe.',
      );
    }
    return e;
  }

  /** GET /public/entregas/:token — rever o pedido e autorizar. */
  async publico(token: string) {
    let e = await this.porToken(token);
    if (estadoEfetivo(e.estado, e.expira_em, new Date()) !== e.estado) {
      await this.expirarVencidas({ id: e.id });
      e = await this.porToken(token);
    }
    return this.vistaPublica(e);
  }

  private async vistaPublica(e: LinhaEntrega) {
    const [municipio, mu, proc] = await Promise.all([
      this.municipios.porId(e.municipio_id),
      e.municipe_id
        ? this.municipes.porId(e.municipe_id)
        : Promise.resolve(null),
      e.processo_id
        ? this.db.query<{ numero: string }>(
            'SELECT numero FROM processos WHERE id = $1',
            [e.processo_id],
          )
        : Promise.resolve([] as { numero: string }[]),
    ]);
    const simuladaAuth = e.autenticacao_modo === 'simulada';
    return {
      municipio: municipio.nome,
      estado: e.estado,
      estado_rotulo: ESTADO_ROTULO[e.estado],
      resumo: e.resumo,
      confirmado_em: e.confirmado_em,
      expira_em: e.expira_em,
      simulado: e.simulado,
      aviso: e.simulado ? AVISO_SIMULACAO : null,
      autenticacao: {
        modo: e.autenticacao_modo,
        simulada: simuladaAuth,
        ...(simuladaAuth
          ? {
              pin_demonstracao: PIN_DEMONSTRACAO,
              telefone_mascarado: mascararTelefone(mu?.telefone_e164 ?? null),
              pede_telefone: !!mu?.telefone_e164,
              pede_nif: !mu?.tem_nif,
            }
          : {}),
      },
      pode_autorizar:
        e.estado === 'a_espera_autorizacao' &&
        e.tentativas_autenticacao < MAX_TENTATIVAS_AUTENTICACAO,
      consentimento_em: e.consentimento_em,
      autorizacao: e.identidade
        ? {
            em: e.autorizado_em,
            nome: e.identidade.nome,
            nif_mascarado: e.identidade.nif_mascarado,
            nivel_garantia: e.identidade.nivel_garantia,
            simulada: e.identidade.simulada,
          }
        : null,
      comprovativo: e.comprovativo
        ? {
            ...e.comprovativo,
            pdf: `/v1/public/entregas/${e.token_publico}/comprovativo.pdf`,
          }
        : null,
      processo: proc[0] ? { numero: proc[0].numero } : null,
      erro:
        e.estado === 'falhou'
          ? 'Autorizou a entrega, mas o balcão online não respondeu. A câmara vai tentar outra vez; não precisa de fazer nada.'
          : null,
    };
  }

  /** POST /public/entregas/:token/autenticar { consentimento: true } → { url }. */
  async autenticar(token: string, ip: string | null) {
    const auth = this.autenticacao();
    const state = aleatorio();
    const nonce = aleatorio();
    const verificador = aleatorio();
    const e = await this.db.transaction(async (tx) => {
      const e = await this.porToken(token, tx, true);
      this.exigirAEspera(e);
      if (auth.modo !== e.autenticacao_modo) {
        throw new ErroApi(
          HttpStatus.CONFLICT,
          'modo_mudou',
          'O modo de autenticação mudou desde que o link foi enviado. Peça um link novo ao agente.',
        );
      }
      await tx.query(
        `UPDATE entregas_em_nome SET auth_state_hash = $2, auth_nonce = $3, auth_verificador = $4,
           auth_iniciada_em = now(), consentimento_em = coalesce(consentimento_em, now()), atualizado_em = now()
         WHERE id = $1`,
        [e.id, sha256(state), nonce, verificador],
      );
      if (!e.consentimento_em) {
        await this.registar(
          {
            municipioId: e.municipio_id,
            atorTipo: 'municipe',
            atorId: e.municipe_id,
            acao: 'consentir_entrega',
            objetoId: e.id,
            dados: {
              texto:
                'Autorizo a entrega deste pedido em meu nome no balcão online da câmara.',
              resumo_hash: e.resumo_hash,
              simulado: e.simulado,
            },
            ip,
          },
          tx,
        );
      }
      return e;
    });
    const { url } = await auth.iniciar({
      state,
      nonce,
      verificador,
      urlPaginaEntrega: this.linkPublico(e.token_publico),
    });
    return { url, simulada: auth.simulada };
  }

  private exigirAEspera(e: LinhaEntrega) {
    const efetivo = estadoEfetivo(e.estado, e.expira_em, new Date());
    if (efetivo === 'expirado') {
      throw new ErroApi(
        HttpStatus.GONE,
        'link_expirado',
        'Este link de autorização já expirou. Peça ao agente para preparar a entrega outra vez.',
      );
    }
    if (efetivo !== 'a_espera_autorizacao') {
      throw new ErroApi(
        HttpStatus.CONFLICT,
        'entrega_nao_espera_autorizacao',
        efetivo === 'entregue'
          ? 'Este pedido já foi entregue.'
          : `Esta entrega já não está à espera de autorização (${ESTADO_ROTULO[efetivo].toLowerCase()}).`,
        { estado: efetivo },
      );
    }
    if (e.tentativas_autenticacao >= MAX_TENTATIVAS_AUTENTICACAO) {
      throw new ErroApi(
        HttpStatus.TOO_MANY_REQUESTS,
        'demasiadas_tentativas',
        'Demasiadas tentativas falhadas. Peça ao agente um link novo.',
      );
    }
  }

  /** POST /public/entregas/:token/autorizar-simulado — a página que imita a CMD. */
  async autorizarSimulado(
    token: string,
    b: { estado: string; telefone?: string; pin: string; nif?: string },
    ip: string | null,
  ) {
    const e0 = await this.porToken(token);
    if (e0.autenticacao_modo !== 'simulada') {
      throw new ErroApi(
        HttpStatus.NOT_FOUND,
        'nao_encontrado',
        'Esta entrega não usa a autenticação simulada.',
      );
    }
    return this.retornoAutenticacao(e0, b.estado, { ...b }, ip);
  }

  /** GET /public/entregas/autenticacao/retorno — o regresso do fornecedor real. Devolve o token. */
  async retornoFornecedor(
    parametros: Record<string, string | undefined>,
    ip: string | null,
  ): Promise<string> {
    const state = parametros.state ?? parametros.RelayState ?? '';
    const [e] = state
      ? await this.db.query<LinhaEntrega>(
          'SELECT * FROM entregas_em_nome WHERE auth_state_hash = $1',
          [sha256(state)],
        )
      : [];
    if (!e) {
      throw new ErroApi(
        HttpStatus.BAD_REQUEST,
        'pedido_autenticacao_invalido',
        'O pedido de autenticação não existe ou já foi usado.',
      );
    }
    await this.retornoAutenticacao(e, state, parametros, ip);
    return e.token_publico;
  }

  private async retornoAutenticacao(
    e0: LinhaEntrega,
    state: string,
    parametros: Record<string, string | undefined>,
    ip: string | null,
  ) {
    if (e0.estado === 'entregue') return this.vistaPublica(e0); // repetir = mesmo resultado
    this.exigirAEspera(e0);
    const valido =
      !!e0.auth_state_hash &&
      !!state &&
      sha256(state).equals(e0.auth_state_hash) &&
      !!e0.auth_iniciada_em &&
      Date.now() - e0.auth_iniciada_em.getTime() <
        AUTENTICACAO_MINUTOS * 60_000;
    if (!valido) {
      throw new ErroApi(
        HttpStatus.BAD_REQUEST,
        'pedido_autenticacao_invalido',
        'O pedido de autenticação expirou ou não é deste link. Volte à página do pedido e carregue outra vez em autorizar.',
      );
    }

    const auth = this.autenticacao();
    const mu = e0.municipe_id
      ? await this.municipes.porId(e0.municipe_id)
      : null;
    let identidade: IdentidadeCidadao;
    try {
      identidade = await auth.retorno({
        parametros,
        nonce: e0.auth_nonce ?? '',
        verificador: e0.auth_verificador ?? '',
        esperado: {
          nome: mu?.nome ?? null,
          telefone: mu?.telefone_e164 ?? null,
          nif:
            auth.simulada && mu?.tem_nif
              ? await this.municipes.nifEmClaro(mu.id)
              : null,
        },
      });
    } catch (err) {
      await this.falhaAutenticacao(e0, err, ip);
      throw err;
    }

    // Quem se autenticou é o requerente?
    let mesmoNif: boolean | null = null;
    if (mu?.tem_nif && identidade.nif) {
      const dono = await this.municipes.porNif(e0.municipio_id, identidade.nif);
      mesmoNif = dono?.id === mu.id;
    }
    const confere = confereIdentidade(identidade, {
      tem_nif: !!mu?.tem_nif,
      mesmoNif,
    });
    if (!confere.ok) {
      const err = new ErroApi(
        HttpStatus.FORBIDDEN,
        confere.codigo,
        confere.mensagem,
      );
      await this.falhaAutenticacao(e0, err, ip);
      throw err;
    }

    await this.db
      .transaction(async (tx) => {
        const e = await this.porToken(e0.token_publico, tx, true);
        if (e.estado === 'entregue' || e.estado === 'autorizado') return;
        this.exigirAEspera(e);
        // O pedido não pode ter mudado depois de a pessoa o confirmar.
        const req = await this.requerimento(e.requerimento_id, tx);
        const agora = codigoResumo(await this.resumoDe(req, tx));
        if (agora !== e.resumo_hash) {
          await tx.query(
            `UPDATE entregas_em_nome SET estado = 'cancelado', erro = $2, atualizado_em = now() WHERE id = $1`,
            [e.id, 'O pedido mudou depois de confirmado.'],
          );
          await this.registar(
            {
              municipioId: e.municipio_id,
              atorTipo: 'sistema',
              acao: 'cancelar_entrega',
              objetoId: e.id,
              dados: { motivo: 'pedido alterado depois da confirmação' },
            },
            tx,
          );
          return 'alterado';
        }
        const nifMascarado = mascararNif(identidade.nif);
        await tx.query(
          `UPDATE entregas_em_nome SET estado = 'autorizado', autorizado_em = now(), identidade = $2,
           auth_state_hash = NULL, auth_verificador = NULL, auth_nonce = NULL, atualizado_em = now()
         WHERE id = $1`,
          [
            e.id,
            JSON.stringify({
              nome: identidade.nome,
              nif_mascarado: nifMascarado,
              nivel_garantia: identidade.nivel_garantia,
              fornecedor: identidade.fornecedor,
              simulada: identidade.simulada,
            }),
          ],
        );
        await this.registar(
          {
            municipioId: e.municipio_id,
            atorTipo: 'municipe',
            atorId: e.municipe_id,
            acao: 'autorizar_entrega',
            objetoId: e.id,
            dados: {
              nif_mascarado: nifMascarado,
              nif_confirmado: confere.nif_confirmado,
              nivel_garantia: identidade.nivel_garantia,
              fornecedor: identidade.fornecedor,
              consentimento_em: e.consentimento_em,
              resumo_hash: e.resumo_hash,
              simulado: e.simulado || identidade.simulada,
            },
            ip,
          },
          tx,
        );
        return 'ok';
      })
      .then((r) => {
        if (r === 'alterado') {
          throw new ErroApi(
            HttpStatus.CONFLICT,
            'pedido_alterado',
            'O pedido mudou depois de o ter confirmado, por isso não o entregámos. Fale outra vez com o agente para o rever.',
          );
        }
      });

    await this.submeter(e0.id, { atorTipo: 'sistema' });
    return this.vistaPublica(await this.porToken(e0.token_publico));
  }

  private async falhaAutenticacao(
    e: LinhaEntrega,
    err: unknown,
    ip: string | null,
  ) {
    const codigo = err instanceof ErroApi ? err.codigo : 'erro';
    // Configuração em falta não conta como tentativa da pessoa.
    if (
      codigo === 'autenticacao_por_configurar' ||
      codigo === 'autenticacao_por_ligar'
    )
      return;
    await this.db.query(
      `UPDATE entregas_em_nome SET tentativas_autenticacao = tentativas_autenticacao + 1, atualizado_em = now()
       WHERE id = $1`,
      [e.id],
    );
    await this.registar({
      municipioId: e.municipio_id,
      atorTipo: 'municipe',
      atorId: e.municipe_id,
      acao: 'autenticacao_recusada',
      objetoId: e.id,
      dados: { codigo, simulado: e.simulado },
      ip,
    });
  }

  private async requerimento(id: string, q: Pick<Tx, 'query'>) {
    const [r] = await q.query<LinhaRequerimento>(
      `SELECT id, municipio_id, municipe_id, conversa_id, tipo_processo_id, dados,
              estado::text AS estado, processo_id
       FROM requerimentos WHERE id = $1`,
      [id],
    );
    if (!r)
      throw new ErroApi(
        HttpStatus.NOT_FOUND,
        'nao_encontrado',
        'Requerimento não existe.',
      );
    return r;
  }

  // ------------------------------------------------------------ submissão

  /**
   * Submete uma entrega autorizada (ou que falhou) no balcão online, com a
   * entrega bloqueada: duas chamadas ao mesmo tempo não entregam duas vezes.
   * Sucesso → processo criado/atualizado, comprovativo, SMS e auditoria.
   * Falha → 'falhou' com o erro (tenta-se de novo pelo painel).
   */
  async submeter(
    entregaId: string,
    ator: { atorTipo: 'sistema' | 'utilizador'; atorId?: string },
  ): Promise<{
    estado: EstadoEntrega;
    numero_entrada: string | null;
    erro: string | null;
  }> {
    const sub = this.submissao();
    // Preenchido dentro da transação (o requerimento cujo PDF se gera depois).
    const depois: { pdf: string | null } = { pdf: null };
    try {
      const r = await this.db.transaction(async (tx) => {
        const [e] = await tx.query<LinhaEntrega>(
          'SELECT * FROM entregas_em_nome WHERE id = $1 FOR UPDATE',
          [entregaId],
        );
        if (!e)
          throw new ErroApi(
            HttpStatus.NOT_FOUND,
            'nao_encontrado',
            'Entrega não existe.',
          );
        if (e.estado === 'entregue') {
          return {
            estado: e.estado,
            numero_entrada: e.numero_entrada,
            erro: null,
          };
        }
        if (!podePassar(e.estado, 'entregue') || !e.identidade) {
          throw new ErroApi(
            HttpStatus.CONFLICT,
            'entrega_nao_autorizada',
            'Só se entrega depois de a pessoa autorizar.',
            { estado: e.estado },
          );
        }
        const req = await this.requerimento(e.requerimento_id, tx);
        const tipo = await this.tipos.porId(
          req.municipio_id,
          req.tipo_processo_id,
          tx,
        );
        const municipio = await this.municipios.porId(e.municipio_id);

        // O processo nasce aqui se ainda não existia (como na assinatura).
        let processoId = req.processo_id;
        let processoNumero: string | null = null;
        if (!processoId) {
          await tx.query(
            `UPDATE requerimentos SET assinatura = $2::assinatura_tipo,
               assinado_em = coalesce(assinado_em, now()), atualizado_em = now()
             WHERE id = $1`,
            [req.id, e.identidade.simulada ? 'simulada' : 'cmd'],
          );
          const p = await this.processos.criarDeRequerimento(tx, req, tipo);
          processoId = p.processo_id;
          processoNumero = p.numero;
          depois.pdf = req.id;
        } else {
          const [p] = await tx.query<{ numero: string }>(
            'SELECT numero FROM processos WHERE id = $1',
            [processoId],
          );
          processoNumero = p?.numero ?? null;
        }

        // O resumo de agora: os mesmos dados confirmados, os documentos que já chegaram.
        const resumo = await this.resumoDe(
          { ...req, processo_id: processoId },
          tx,
        );
        const comprovativo = await sub.submeter(
          {
            referencia: e.id,
            municipioId: e.municipio_id,
            tipo: { codigo: tipo.codigo, nome: tipo.nome },
            resumo,
            processoNumero,
          },
          {
            nif: null,
            nome: e.identidade.nome,
            nivel_garantia: e.identidade.nivel_garantia,
            fornecedor: e.identidade.fornecedor,
            simulada: e.identidade.simulada,
          },
          tx,
        );
        // Nada simulado pode sair como real.
        const simulado =
          e.simulado || comprovativo.simulado || e.identidade.simulada;
        const comp: Comprovativo = {
          ...comprovativo,
          requerente: {
            nome: e.identidade.nome,
            nif_mascarado: e.identidade.nif_mascarado,
          },
          simulado,
        };

        await tx.query(
          `UPDATE entregas_em_nome SET estado = 'entregue', entregue_em = now(), numero_entrada = $2,
             comprovativo = $3, processo_id = $4, simulado = $5, resumo = $6, erro = NULL,
             tentativas = tentativas + 1, atualizado_em = now()
           WHERE id = $1`,
          [
            e.id,
            comp.numero_entrada,
            JSON.stringify(comp),
            processoId,
            simulado,
            JSON.stringify(resumo),
          ],
        );
        await tx.query(
          `INSERT INTO processo_eventos (processo_id, tipo, descricao, ator_tipo, ator_id, dados)
           VALUES ($1, 'entrega_em_nome', $2, 'municipe', $3, $4)`,
          [
            processoId,
            `Entregue no balcão online em nome do requerente: entrada ${comp.numero_entrada}.` +
              (simulado ? ' Simulação, sem validade legal.' : ''),
            e.municipe_id,
            JSON.stringify({
              entrega_id: e.id,
              numero_entrada: comp.numero_entrada,
              nivel_garantia: e.identidade.nivel_garantia,
              simulado,
            }),
          ],
        );

        const telefone = await this.processos.telefoneDe(e.municipe_id, tx);
        if (telefone) {
          await this.mensagens.sms(
            {
              municipioId: e.municipio_id,
              municipeId: e.municipe_id,
              destino: telefone,
              motivo: 'requerimento',
              corpo:
                `${municipio.nome}: o seu pedido de ${tipo.nome} foi entregue no balcão online. ` +
                `N.º de entrada ${comp.numero_entrada}. Comprovativo: ${this.linkPublico(e.token_publico)}` +
                (simulado ? ' DEMONSTRAÇÃO: sem validade legal.' : ''),
              relacionado: {
                requerimento_id: e.requerimento_id,
                entrega_id: e.id,
                processo_id: processoId,
              },
              chave: `entrega_entregue:${e.id}`,
            },
            tx,
          );
        }
        await this.registar(
          {
            municipioId: e.municipio_id,
            atorTipo: ator.atorTipo,
            atorId: ator.atorId ?? null,
            acao: 'entregar_em_nome',
            objetoId: e.id,
            dados: {
              em_nome_de: e.municipe_id,
              requerimento_id: e.requerimento_id,
              processo_id: processoId,
              numero_entrada: comp.numero_entrada,
              recebido_em: comp.recebido_em,
              documentos: comp.documentos,
              nivel_garantia: e.identidade.nivel_garantia,
              autenticacao: e.autenticacao_modo,
              submissao: sub.modo,
              autorizado_em: e.autorizado_em,
              consentimento_em: e.consentimento_em,
              simulado,
            },
          },
          tx,
        );
        return {
          estado: 'entregue' as EstadoEntrega,
          numero_entrada: comp.numero_entrada,
          erro: null,
        };
      });
      if (depois.pdf) {
        await this.jobs.enviar(
          JOB_PDF,
          { requerimentoId: depois.pdf },
          { singletonKey: `pdf:${depois.pdf}:assinado` },
        );
      }
      return r;
    } catch (err) {
      // Erros nossos (não autorizada, não existe) sobem; os do destino ficam registados.
      const doDestino =
        err instanceof ErroSubmissao ||
        (err instanceof ErroApi && err.codigo === 'submissao_por_configurar') ||
        !(err instanceof ErroApi);
      if (!doDestino) throw err;
      const msg = mensagemErro(err);
      this.logger.warn(`Entrega ${entregaId} falhou: ${msg}`);
      const [e] = await this.db.query<{
        municipio_id: string;
        simulado: boolean;
      }>(
        `UPDATE entregas_em_nome SET estado = 'falhou', erro = $2, tentativas = tentativas + 1, atualizado_em = now()
         WHERE id = $1 AND estado IN ('autorizado','falhou') RETURNING municipio_id, simulado`,
        [entregaId, msg],
      );
      if (e) {
        await this.registar({
          municipioId: e.municipio_id,
          atorTipo: ator.atorTipo,
          atorId: ator.atorId ?? null,
          acao: 'entrega_falhou',
          objetoId: entregaId,
          dados: { erro: msg, submissao: sub.modo, simulado: e.simulado },
        });
      }
      return { estado: 'falhou', numero_entrada: null, erro: msg };
    }
  }

  // --------------------------------------------------------- comprovativo

  private async pdfDe(e: LinhaEntrega) {
    if (
      e.estado !== 'entregue' ||
      !e.comprovativo ||
      !e.identidade ||
      !e.autorizado_em
    ) {
      throw new ErroApi(
        HttpStatus.NOT_FOUND,
        'sem_comprovativo',
        'Ainda não há comprovativo: o pedido não foi entregue.',
      );
    }
    const [municipio, proc] = await Promise.all([
      this.municipios.porId(e.municipio_id),
      e.processo_id
        ? this.db.query<{ numero: string }>(
            'SELECT numero FROM processos WHERE id = $1',
            [e.processo_id],
          )
        : Promise.resolve([] as { numero: string }[]),
    ]);
    const pdf = await gerarPdfComprovativo({
      municipio: municipio.nome,
      comprovativo: e.comprovativo,
      resumo: e.resumo,
      autorizacao: {
        em: e.autorizado_em,
        fornecedor: e.identidade.fornecedor,
        nivel_garantia: e.identidade.nivel_garantia,
        consentimento_em: e.consentimento_em,
      },
      confirmacao: { em: e.confirmado_em, canal: e.canal },
      processoNumero: proc[0]?.numero ?? null,
    });
    const nome = `comprovativo-${e.comprovativo.numero_entrada.replace(/[^A-Za-z0-9-]/g, '-')}.pdf`;
    return { nome, pdf };
  }

  async pdfPublico(token: string) {
    return this.pdfDe(await this.porToken(token));
  }

  // ----------------------------------------------------------------- painel

  private async doMunicipio(
    m: { id: string },
    id: string,
    q: Pick<Tx, 'query'> = this.db,
  ) {
    const [e] = await q.query<LinhaEntrega>(
      'SELECT * FROM entregas_em_nome WHERE id = $1 AND municipio_id = $2',
      [id, m.id],
    );
    if (!e)
      throw new ErroApi(
        HttpStatus.NOT_FOUND,
        'nao_encontrado',
        'Entrega não existe.',
      );
    return e;
  }

  private vistaPainel(
    e: LinhaEntrega & {
      municipe_nome?: string | null;
      processo_numero?: string | null;
    },
  ) {
    return {
      id: e.id,
      estado: e.estado,
      estado_rotulo: ESTADO_ROTULO[e.estado],
      simulado: e.simulado,
      requerimento_id: e.requerimento_id,
      processo: e.processo_id
        ? { id: e.processo_id, numero: e.processo_numero ?? null }
        : null,
      municipe: e.municipe_id
        ? { id: e.municipe_id, nome: e.municipe_nome ?? null }
        : null,
      tipo: e.resumo.tipo,
      canal: e.canal,
      confirmacao: e.confirmacao,
      confirmado_em: e.confirmado_em,
      expira_em: e.expira_em,
      consentimento_em: e.consentimento_em,
      autorizado_em: e.autorizado_em,
      autenticacao: {
        modo: e.autenticacao_modo,
        nivel_garantia: e.identidade?.nivel_garantia ?? null,
        nif_mascarado: e.identidade?.nif_mascarado ?? null,
      },
      submissao: { modo: e.submissao_modo },
      numero_entrada: e.numero_entrada,
      entregue_em: e.entregue_em,
      comprovativo: e.comprovativo,
      tentativas: e.tentativas,
      tentativas_autenticacao: e.tentativas_autenticacao,
      erro: e.erro,
      criado_em: e.criado_em,
      atualizado_em: e.atualizado_em,
    };
  }

  async listar(
    m: { id: string },
    f: {
      estado?: EstadoEntrega;
      processo_id?: string;
      requerimento_id?: string;
    },
  ) {
    await this.expirarVencidas({ municipioId: m.id });
    const itens = await this.db.query<
      LinhaEntrega & {
        municipe_nome: string | null;
        processo_numero: string | null;
      }
    >(
      `SELECT e.*, mu.nome AS municipe_nome, p.numero AS processo_numero
       FROM entregas_em_nome e
       LEFT JOIN municipes mu ON mu.id = e.municipe_id
       LEFT JOIN processos p ON p.id = e.processo_id
       WHERE e.municipio_id = $1
         AND ($2::text IS NULL OR e.estado = $2)
         AND ($3::uuid IS NULL OR e.processo_id = $3
              OR e.requerimento_id IN (SELECT r.id FROM requerimentos r WHERE r.processo_id = $3))
         AND ($4::uuid IS NULL OR e.requerimento_id = $4)
       ORDER BY e.criado_em DESC
       LIMIT 200`,
      [
        m.id,
        f.estado ?? null,
        f.processo_id ?? null,
        f.requerimento_id ?? null,
      ],
    );
    return { modo: this.modo(), itens: itens.map((e) => this.vistaPainel(e)) };
  }

  async detalhe(m: { id: string }, id: string) {
    await this.expirarVencidas({ id });
    const e = await this.doMunicipio(m, id);
    const [extra] = await this.db.query<{
      municipe_nome: string | null;
      processo_numero: string | null;
    }>(
      `SELECT (SELECT nome FROM municipes WHERE id = $1) AS municipe_nome,
              (SELECT numero FROM processos WHERE id = $2) AS processo_numero`,
      [e.municipe_id, e.processo_id],
    );
    const historico = await this.db.query<{
      acao: string;
      ator_tipo: string;
      em: Date;
      dados: Record<string, unknown>;
    }>(
      `SELECT acao, ator_tipo::text, em, dados FROM audit_log
       WHERE objeto_tipo = 'entrega_em_nome' AND objeto_id = $1::text AND municipio_id = $2
       ORDER BY em, id`,
      [id, m.id],
    );
    return {
      ...this.vistaPainel({ ...e, ...extra }),
      resumo: e.resumo,
      historico,
      modo: this.modo(),
    };
  }

  async pdfPainel(m: { id: string }, id: string) {
    return this.pdfDe(await this.doMunicipio(m, id));
  }

  async tentarDeNovo(m: { id: string }, u: UtilizadorPainel, id: string) {
    const e = await this.doMunicipio(m, id);
    if (e.estado !== 'falhou') {
      throw new ErroApi(
        HttpStatus.CONFLICT,
        'entrega_nao_falhou',
        'Só se tenta de novo uma entrega que falhou.',
        { estado: e.estado },
      );
    }
    await this.registar({
      municipioId: m.id,
      atorTipo: 'utilizador',
      atorId: u.id,
      acao: 'tentar_entrega_de_novo',
      objetoId: id,
      dados: { tentativas: e.tentativas, simulado: e.simulado },
    });
    const r = await this.submeter(id, { atorTipo: 'utilizador', atorId: u.id });
    return { ...r, entrega: await this.detalhe(m, id) };
  }

  async cancelar(
    m: { id: string },
    u: UtilizadorPainel,
    id: string,
    motivo: string,
  ) {
    return this.db.transaction(async (tx) => {
      const [e] = await tx.query<LinhaEntrega>(
        'SELECT * FROM entregas_em_nome WHERE id = $1 AND municipio_id = $2 FOR UPDATE',
        [id, m.id],
      );
      if (!e)
        throw new ErroApi(
          HttpStatus.NOT_FOUND,
          'nao_encontrado',
          'Entrega não existe.',
        );
      if (!podePassar(e.estado, 'cancelado')) {
        throw new ErroApi(
          HttpStatus.CONFLICT,
          'entrega_nao_cancelavel',
          e.estado === 'entregue'
            ? 'Esta entrega já foi feita e não se cancela.'
            : 'Esta entrega já não se pode cancelar.',
          { estado: e.estado },
        );
      }
      await tx.query(
        `UPDATE entregas_em_nome SET estado = 'cancelado', erro = $2, atualizado_em = now(),
           auth_state_hash = NULL, auth_verificador = NULL, auth_nonce = NULL
         WHERE id = $1`,
        [id, `Cancelada no painel: ${motivo}`],
      );
      await this.registar(
        {
          municipioId: m.id,
          atorTipo: 'utilizador',
          atorId: u.id,
          acao: 'cancelar_entrega',
          objetoId: id,
          dados: { motivo, estado_anterior: e.estado, simulado: e.simulado },
        },
        tx,
      );
      return { id, estado: 'cancelado' as const };
    });
  }
}
