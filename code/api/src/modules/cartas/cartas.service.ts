import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ModuleRef } from '@nestjs/core';
import { randomInt } from 'crypto';
import { z } from 'zod';
import { hojeLisboa, somarDiasUteis } from '../../common/dias-uteis.js';
import { ErroApi } from '../../common/erros.js';
import { proximoNumero } from '../../common/numeracao.js';
import { esquemaPaginacao, pagina } from '../../common/paginacao.js';
import type { UtilizadorPainel } from '../../common/pedido.js';
import { DatabaseService, Tx } from '../../database/database.service.js';
import type { ContextoFerramenta } from '../../ferramentas/ferramenta.js';
import { ClaudeService } from '../../ia/claude.service.js';
import { MIMES_VISAO, MimeVisao } from '../../ia/visao.service.js';
import { ArmazenamentoService } from '../armazenamento/armazenamento.service.js';
import { EncaminhamentoService } from '../atendimento/encaminhamento.service.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { MensagensService } from '../comunicacao/mensagens.service.js';
import { GlossarioService } from '../linguagem-simples/glossario.service.js';
import { detetarTermos } from '../linguagem-simples/regras.js';
import {
  Municipio,
  MunicipiosService,
} from '../municipios/municipios.service.js';
import { NotificacoesService } from '../notificacoes/notificacoes.service.js';
import { PagamentosService } from '../pagamentos/pagamentos.service.js';
import { ProcessosService } from '../processos/processos.service.js';
import { lerNumero } from '../processos/regras.js';
import {
  bytesDeBase64,
  MAXIMO_IMAGEM_BYTES,
  MAXIMO_PDF_BYTES,
  mimePelosBytes,
  semPrefixoDataUrl,
} from '../requerimentos/verificacao-documentos.js';
import { gerarPdfCartaDemo, leituraDemo, temMarcaDemo } from './demo-carta.js';
import {
  ALFABETO_CODIGO,
  calcularPrazo,
  CalculoPrazo,
  codigoValido,
  dataIso,
  DadosRascunho,
  diaPorExtenso,
  escolherProcesso,
  esquemaLeituraCarta,
  fraseFaltam,
  LeituraValidada,
  rascunhoElementos,
  rascunhoPronuncia,
  rascunhoProrrogacao,
  respostasPossiveis,
  ROTULO_RESPOSTA,
  SISTEMA_LEITURA,
  SISTEMA_PRONUNCIA,
  TAMANHO_CODIGO,
  TipoResposta,
  TIPOS_RESPOSTA,
  validarLeitura,
} from './regras.js';

/** Quantas vezes se pode pedir à IA a leitura da mesma carta. */
export const MAXIMO_LEITURAS = 5;
/** Cartas por conversa (chat, voz) e por dia na app. */
export const MAXIMO_CARTAS_CONVERSA = 6;
/** Lembrete: N dias úteis antes do fim do prazo. */
export const LEMBRETE_DIAS_UTEIS = 3;

export type CanalCarta =
  'chat' | 'telefone' | 'whatsapp' | 'sms' | 'ia' | 'app' | 'web' | 'demo';

export const esquemaFicheiro = z.object({
  mime: z.enum(MIMES_VISAO),
  ficheiro_base64: z
    .string()
    .min(16)
    .transform((s) => semPrefixoDataUrl(s.trim())),
});

export const esquemaRececao = z.object({
  data: z
    .string()
    .refine((s) => dataIso(s) !== null, 'Data no formato AAAA-MM-DD.'),
});

export const esquemaNovaResposta = z.object({
  tipo: z.enum(TIPOS_RESPOSTA),
  argumentos: z.string().trim().max(3000).nullish(),
  dias: z.coerce.number().int().min(1).max(90).nullish(),
});

export const esquemaEditarResposta = z.object({
  texto: z.string().trim().min(20).max(12000),
});

export const esquemaLembrete = z.object({ lembrar: z.boolean() });

export const esquemaListaCartas = esquemaPaginacao.extend({
  processo_id: z.uuid().optional(),
});

export const entradaLerCarta = z.object({
  codigo: z
    .string()
    .trim()
    .toUpperCase()
    .optional()
    .describe(
      'O código da carta: vem na mensagem do chat como [carta XXXXXXXXXX] ou no resultado anterior desta ferramenta. Vazio para começar (na chamada manda o SMS com o link para fotografar).',
    ),
  data_rececao: z
    .string()
    .optional()
    .describe(
      'O dia em que a pessoa recebeu a carta, AAAA-MM-DD (quando a ferramenta pediu, ou a pessoa disse).',
    ),
});

export const entradaPrepararResposta = z.object({
  codigo: z.string().trim().toUpperCase().describe('O código da carta.'),
  tipo: z
    .enum(TIPOS_RESPOSTA)
    .describe(
      'pronuncia (responder a dizer porque não concorda), prorrogacao (pedir mais tempo), elementos (enviar os documentos pedidos), pagamento (referência para pagar).',
    ),
  argumentos: z
    .string()
    .trim()
    .max(3000)
    .optional()
    .describe(
      'Na pronúncia: o que a pessoa disse, por palavras dela (porque não concorda, factos que quer que a câmara saiba). Na prorrogação: porque precisa de mais tempo.',
    ),
  dias: z
    .number()
    .int()
    .min(1)
    .max(90)
    .optional()
    .describe('Na prorrogação: quantos dias úteis a mais (por defeito 10).'),
});

interface LinhaCarta {
  id: string;
  municipio_id: string;
  codigo: string;
  municipe_id: string | null;
  conversa_id: string | null;
  canal: CanalCarta;
  estado: 'a_espera' | 'lida' | 'ilegivel' | 'respondida';
  leitura: LeituraValidada | null;
  da_camara: boolean | null;
  tipo: string | null;
  referencia: string | null;
  processo_id: string | null;
  modelo_id: string | null;
  data_rececao_dita: string | null;
  prazo: CalculoPrazo | null;
  data_limite: string | null;
  lembrar: boolean;
  lembrete_enviado_em: Date | null;
  demonstracao: boolean;
  leituras: number;
  ficheiro_key: string | null;
  criado_em: Date;
  lida_em: Date | null;
}

const COLUNAS = `c.id, c.municipio_id, c.codigo, c.municipe_id, c.conversa_id, c.canal, c.estado,
  c.leitura, c.da_camara, c.tipo, c.referencia, c.processo_id, c.modelo_id,
  to_char(c.data_rececao_dita, 'YYYY-MM-DD') AS data_rececao_dita, c.prazo,
  to_char(c.data_limite, 'YYYY-MM-DD') AS data_limite, c.lembrar, c.lembrete_enviado_em,
  c.demonstracao, c.leituras, c.ficheiro_key, c.criado_em, c.lida_em`;

interface LinhaResposta {
  id: string;
  tipo: TipoResposta;
  argumentos: string | null;
  texto: string;
  estado: 'rascunho' | 'entregue' | 'descartada';
  numero_entrada: string | null;
  pagamento_id: string | null;
  criado_em: Date;
  entregue_em: Date | null;
}

/** Quem está a pedir: a conversa do agente, a sessão do chat, a app ou o link. */
export interface Origem {
  municipio: Municipio;
  canal: CanalCarta;
  conversaId: string | null;
  municipeId: string | null;
  telefone?: string | null;
}

function naoEncontrada(): ErroApi {
  return new ErroApi(
    HttpStatus.NOT_FOUND,
    'carta_desconhecida',
    'Esta carta não existe ou não é desta conversa.',
  );
}

/**
 * "Não percebi esta carta da câmara": ler a carta (IA com visão, saída
 * validada), calcular o prazo, ligar ao processo da pessoa, preparar a
 * resposta e lembrar antes do fim do prazo. Serve o agente (chat e voz),
 * a página pública /carta/{codigo}, a app do munícipe e o painel.
 */
@Injectable()
export class CartasService {
  private readonly logger = new Logger(CartasService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly config: ConfigService,
    private readonly ref: ModuleRef,
    private readonly claude: ClaudeService,
    private readonly armazenamento: ArmazenamentoService,
    private readonly auditoria: AuditoriaService,
    private readonly municipios: MunicipiosService,
    private readonly mensagens: MensagensService,
    private readonly notificacoes: NotificacoesService,
    private readonly glossario: GlossarioService,
    private readonly processos: ProcessosService,
    private readonly pagamentos: PagamentosService,
  ) {}

  private webUrl(): string {
    return this.config.get<string>('app.webUrl') ?? '';
  }

  link(codigo: string): string {
    return `${this.webUrl()}/carta/${codigo}`;
  }

  // -------------------------------------------------------------------
  // Criar e ler
  // -------------------------------------------------------------------

  /** Uma carta à espera do ficheiro (a voz manda o link; o chat e a app já o têm). */
  async criar(o: Origem, tx?: Tx): Promise<{ id: string; codigo: string }> {
    const q = tx ?? this.db;
    if (o.conversaId) {
      const [n] = await q.query<{ n: number }>(
        'SELECT count(*)::int AS n FROM cartas WHERE conversa_id = $1',
        [o.conversaId],
      );
      if (n.n >= MAXIMO_CARTAS_CONVERSA) {
        throw new ErroApi(
          HttpStatus.TOO_MANY_REQUESTS,
          'demasiadas_cartas',
          'Já enviou muitas cartas nesta conversa. Comece outra ou ligue para a câmara.',
        );
      }
    }
    for (let tentativa = 0; tentativa < 5; tentativa++) {
      const codigo = Array.from(
        { length: TAMANHO_CODIGO },
        () => ALFABETO_CODIGO[randomInt(ALFABETO_CODIGO.length)],
      ).join('');
      const [c] = await q.query<{ id: string }>(
        `INSERT INTO cartas (municipio_id, codigo, municipe_id, conversa_id, canal)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (codigo) DO NOTHING RETURNING id`,
        [o.municipio.id, codigo, o.municipeId, o.conversaId, o.canal],
      );
      if (c) return { id: c.id, codigo };
    }
    throw new Error('Não foi possível gerar um código de carta livre.');
  }

  private async porCodigo(codigo: string, q: Pick<Tx, 'query'> = this.db) {
    const c = codigo.trim().toUpperCase();
    if (!codigoValido(c)) throw naoEncontrada();
    const [l] = await q.query<LinhaCarta>(
      `SELECT ${COLUNAS} FROM cartas c WHERE c.codigo = $1`,
      [c],
    );
    if (!l) throw naoEncontrada();
    return l;
  }

  private async porId(id: string) {
    const [l] = await this.db.query<LinhaCarta>(
      `SELECT ${COLUNAS} FROM cartas c WHERE c.id = $1`,
      [id],
    );
    if (!l) throw naoEncontrada();
    return l;
  }

  /** O ficheiro (base64) → bytes e tipo verdadeiro, com os limites. */
  lerFicheiro(e: z.output<typeof esquemaFicheiro>): {
    bytes: Buffer;
    mime: MimeVisao;
  } {
    const tamanho = bytesDeBase64(e.ficheiro_base64);
    const maximo =
      e.mime === 'application/pdf' ? MAXIMO_PDF_BYTES : MAXIMO_IMAGEM_BYTES;
    if (tamanho > maximo) {
      throw new ErroApi(
        HttpStatus.PAYLOAD_TOO_LARGE,
        'ficheiro_grande',
        e.mime === 'application/pdf'
          ? 'O PDF é demasiado grande (máximo 10 MB).'
          : 'A fotografia é demasiado grande: tire outra com menos resolução (máximo 5 MB).',
        { maximo_bytes: maximo },
      );
    }
    const bytes = Buffer.from(e.ficheiro_base64, 'base64');
    const real = mimePelosBytes(bytes);
    if (!real || !(MIMES_VISAO as readonly string[]).includes(real)) {
      throw new ErroApi(
        HttpStatus.UNSUPPORTED_MEDIA_TYPE,
        'ficheiro_invalido',
        'Envie uma fotografia (JPEG, PNG, WebP) ou um PDF.',
      );
    }
    return { bytes, mime: real as MimeVisao };
  }

  /**
   * Lê a carta: guarda o ficheiro (se houver armazenamento), pede a leitura
   * à IA (ou usa a de demonstração), valida, liga ao processo e calcula o
   * prazo. Devolve a página pública atualizada.
   */
  async receberFicheiro(
    codigo: string,
    e: z.output<typeof esquemaFicheiro>,
    ator: { tipo: 'municipe' | 'agente'; municipeId?: string | null } = {
      tipo: 'municipe',
    },
  ) {
    const carta = await this.porCodigo(codigo);
    if (carta.estado === 'lida' || carta.estado === 'respondida') {
      throw new ErroApi(
        HttpStatus.CONFLICT,
        'carta_ja_lida',
        'Esta carta já foi lida. Para outra carta, comece de novo.',
      );
    }
    if (carta.leituras >= MAXIMO_LEITURAS) {
      throw new ErroApi(
        HttpStatus.TOO_MANY_REQUESTS,
        'demasiadas_leituras',
        'Já tentámos ler esta carta várias vezes. Ligue para a câmara ou vá ao balcão.',
      );
    }
    const f = this.lerFicheiro(e);
    const m = await this.municipioDe(carta.municipio_id);
    await this.db.query(
      `UPDATE cartas SET leituras = leituras + 1, mime = $2, tamanho = $3,
         municipe_id = coalesce(municipe_id, $4), atualizado_em = now()
       WHERE id = $1`,
      [carta.id, f.mime, f.bytes.length, ator.municipeId ?? null],
    );
    if (!carta.municipe_id && ator.municipeId)
      carta.municipe_id = ator.municipeId;

    const chave = await this.guardar(carta, f);
    const { leitura, demonstracao } = await this.pedirLeitura(m, f);
    await this.aplicarLeitura(m, carta, leitura, {
      demonstracao,
      chave,
      ator: ator.tipo,
    });
    return this.publico(carta.codigo);
  }

  private async municipioDe(id: string): Promise<Municipio> {
    const [m] = await this.db.query<Municipio>(
      'SELECT id, slug, nome, fuso FROM municipios WHERE id = $1',
      [id],
    );
    return m;
  }

  /** Sem S3 não se guarda o ficheiro: lê-se e esquece-se (fica a leitura). */
  private async guardar(
    carta: LinhaCarta,
    f: { bytes: Buffer; mime: MimeVisao },
  ): Promise<string | null> {
    if (!this.armazenamento.disponivel) return null;
    const ext = f.mime === 'application/pdf' ? 'pdf' : f.mime.split('/')[1];
    const chave = `documentos/cartas/${carta.municipio_id}/${carta.id}.${ext}`;
    try {
      await this.armazenamento.guardar(chave, f.bytes, f.mime);
      return chave;
    } catch (e) {
      this.logger.warn(
        `Carta ${carta.id}: ficheiro não guardado (${(e as Error).message}).`,
      );
      return null;
    }
  }

  private async pedirLeitura(
    m: Municipio,
    f: { bytes: Buffer; mime: MimeVisao },
  ) {
    if (!this.claude.disponivel && temMarcaDemo(f.bytes)) {
      const p = await this.processoDemo(m.id);
      return {
        leitura: leituraDemo({
          numeroProcesso: p?.numero ?? `CP 412/${new Date().getFullYear()}`,
          assunto: p?.assunto ?? 'Porta na cozinha',
          data: diasAtras(7),
          municipio: m.nome,
        }),
        demonstracao: true,
      };
    }
    if (!this.claude.disponivel) {
      // Nunca se inventa uma leitura: sem IA, tenta-se mais tarde.
      throw new ErroApi(
        HttpStatus.SERVICE_UNAVAILABLE,
        'ia_indisponivel',
        'De momento não conseguimos ler cartas. Tente daqui a pouco ou ligue para a câmara.',
      );
    }
    const leitura = await this.claude.extrair(esquemaLeituraCarta, {
      sistema: SISTEMA_LEITURA,
      conteudo:
        'Lê esta carta que o munícipe recebeu e não percebe. Preenche os campos só com o que está escrito.',
      ficheiros: [{ nome: 'Carta recebida', ficheiro: f.bytes, mime: f.mime }],
      esforco: 'medium',
      maxTokens: 8000,
    });
    return { leitura, demonstracao: false };
  }

  private async processoDemo(municipioId: string) {
    const [p] = await this.db.query<{
      id: string;
      numero: string;
      assunto: string;
      municipe_id: string | null;
    }>(
      `SELECT id, numero, assunto, municipe_id FROM processos
       WHERE municipio_id = $1 AND assunto ILIKE 'Porta na cozinha%'
       ORDER BY criado_em LIMIT 1`,
      [municipioId],
    );
    return p ?? null;
  }

  /** Grava a leitura validada, a ligação ao processo e o prazo. */
  private async aplicarLeitura(
    m: Municipio,
    carta: LinhaCarta,
    bruta: z.infer<typeof esquemaLeituraCarta>,
    o: {
      demonstracao: boolean;
      chave: string | null;
      ator: 'municipe' | 'agente' | 'sistema';
    },
  ) {
    const leitura = validarLeitura(bruta, m.nome);
    const processoId = leitura.da_camara
      ? await this.ligar(m.id, leitura.referencia.valor, carta.municipe_id)
      : null;
    const modeloId = processoId
      ? await this.modeloDoProcesso(processoId)
      : null;
    const prazo = leitura.legivel
      ? await this.prazoDe(m.id, leitura, carta.data_rececao_dita)
      : null;
    await this.db.transaction(async (tx) => {
      await tx.query(
        `UPDATE cartas SET estado = $2, leitura = $3, da_camara = $4, tipo = $5,
           referencia = $6, processo_id = $7, modelo_id = $8, prazo = $9,
           data_limite = $10, demonstracao = $11, ficheiro_key = coalesce($12, ficheiro_key),
           lida_em = now(), atualizado_em = now()
         WHERE id = $1`,
        [
          carta.id,
          leitura.legivel ? 'lida' : 'ilegivel',
          JSON.stringify(leitura),
          leitura.da_camara,
          leitura.tipo,
          leitura.referencia.valor,
          processoId,
          modeloId,
          prazo ? JSON.stringify(prazo) : null,
          prazo?.data_limite ?? null,
          o.demonstracao,
          o.chave,
        ],
      );
      if (processoId && leitura.legivel) {
        await this.eventoNoProcesso(tx, processoId, leitura, carta);
      }
      await this.auditoria.registar(
        {
          municipioId: m.id,
          atorTipo: o.ator,
          atorId: o.ator === 'municipe' ? carta.municipe_id : null,
          acao: 'ler_carta',
          objetoTipo: 'carta',
          objetoId: carta.id,
          dados: {
            tipo: leitura.tipo,
            da_camara: leitura.da_camara,
            processo_id: processoId,
            prazo: prazo?.estado ?? null,
            demonstracao: o.demonstracao,
          },
        },
        tx,
      );
    });
  }

  /** Nota interna na linha do tempo: o munícipe pediu ajuda com o ofício. */
  private async eventoNoProcesso(
    tx: Tx,
    processoId: string,
    leitura: LeituraValidada,
    carta: LinhaCarta,
  ) {
    const [ja] = await tx.query(
      `SELECT 1 FROM processo_eventos
       WHERE processo_id = $1 AND tipo = 'carta_ajuda' AND dados->>'carta_id' = $2`,
      [processoId, carta.id],
    );
    if (ja) return;
    await tx.query(
      `INSERT INTO processo_eventos (processo_id, tipo, descricao, ator_tipo, ator_id, interno, dados)
       VALUES ($1, 'carta_ajuda', $2, 'municipe', $3, true, $4)`,
      [
        processoId,
        `O munícipe pediu ajuda para perceber o ofício (${leitura.tipo_rotulo.toLowerCase()}).`,
        carta.municipe_id,
        JSON.stringify({ carta_id: carta.id, tipo: leitura.tipo }),
      ],
    );
  }

  private async ligar(
    municipioId: string,
    referencia: string | null,
    municipeId: string | null,
  ): Promise<string | null> {
    const dito = referencia ? lerNumero(referencia) : null;
    if (!dito) return null;
    const candidatos = await this.db.query<{
      id: string;
      numero: string;
      municipe_id: string | null;
    }>(
      `SELECT id, numero, municipe_id FROM processos
       WHERE municipio_id = $1 AND numero ~ ('[ -]' || $2::text || '/')`,
      [municipioId, String(dito.n)],
    );
    const l = escolherProcesso(referencia, municipeId, candidatos);
    return l.tipo === 'ligado' ? l.processoId : null;
  }

  /** O processo existe mas falta saber quem é a pessoa (para o agente pedir). */
  private async precisaIdentificacao(carta: LinhaCarta): Promise<boolean> {
    if (carta.processo_id || !carta.da_camara || !carta.referencia)
      return false;
    const dito = lerNumero(carta.referencia);
    if (!dito) return false;
    const candidatos = await this.db.query<{
      id: string;
      numero: string;
      municipe_id: string | null;
    }>(
      `SELECT id, numero, municipe_id FROM processos
       WHERE municipio_id = $1 AND numero ~ ('[ -]' || $2::text || '/')`,
      [carta.municipio_id, String(dito.n)],
    );
    return (
      escolherProcesso(carta.referencia, carta.municipe_id, candidatos).tipo ===
      'precisa_identificacao'
    );
  }

  private async modeloDoProcesso(processoId: string): Promise<string | null> {
    const [d] = await this.db.query<{ modelo_id: string }>(
      `SELECT modelo_id FROM documentos_gerados
       WHERE processo_id = $1 AND tipo = 'oficio' AND modelo_id IS NOT NULL
       ORDER BY assinado_em DESC NULLS LAST, versao DESC LIMIT 1`,
      [processoId],
    );
    return d?.modelo_id ?? null;
  }

  private async prazoDe(
    municipioId: string,
    leitura: LeituraValidada,
    rececao: string | null,
  ): Promise<CalculoPrazo> {
    const feriados = await this.municipios.feriados(municipioId);
    return calcularPrazo({
      prazo: leitura.prazo,
      dataNotificacao: leitura.data_notificacao.valor,
      dataDocumento: leitura.data_documento.valor,
      dataRececaoDita: rececao,
      hoje: hojeLisboa(),
      feriados,
    });
  }

  /** "Recebi a carta no dia X": recalcula o prazo. */
  async definirRececao(
    codigo: string,
    data: string,
    ator: 'municipe' | 'agente' = 'municipe',
  ) {
    const carta = await this.porCodigo(codigo);
    if (!carta.leitura) {
      throw new ErroApi(
        HttpStatus.CONFLICT,
        'carta_por_ler',
        'Ainda não lemos esta carta.',
      );
    }
    const dia = dataIso(data);
    if (!dia || dia > hojeLisboa()) {
      throw new ErroApi(
        HttpStatus.BAD_REQUEST,
        'data_invalida',
        'A data de receção não pode ser depois de hoje.',
      );
    }
    const prazo = await this.prazoDe(carta.municipio_id, carta.leitura, dia);
    await this.db.query(
      `UPDATE cartas SET data_rececao_dita = $2, prazo = $3, data_limite = $4,
         lembrete_enviado_em = NULL, atualizado_em = now()
       WHERE id = $1`,
      [carta.id, dia, JSON.stringify(prazo), prazo.data_limite],
    );
    await this.auditoria.registar({
      municipioId: carta.municipio_id,
      atorTipo: ator,
      atorId: ator === 'municipe' ? carta.municipe_id : null,
      acao: 'definir_rececao_carta',
      objetoTipo: 'carta',
      objetoId: carta.id,
      dados: { prazo: prazo.estado },
    });
    return this.publico(codigo);
  }

  async definirLembrete(codigo: string, lembrar: boolean) {
    const carta = await this.porCodigo(codigo);
    await this.db.query(
      'UPDATE cartas SET lembrar = $2, atualizado_em = now() WHERE id = $1',
      [carta.id, lembrar],
    );
    return this.publico(codigo);
  }

  // -------------------------------------------------------------------
  // Página pública
  // -------------------------------------------------------------------

  async publico(codigo: string) {
    const carta = await this.porCodigo(codigo);
    const m = await this.municipioDe(carta.municipio_id);
    const l = carta.leitura;
    const [respostas, processo, termos, precisaIdent, encaminhamento] =
      await Promise.all([
        this.respostas(carta.id),
        carta.processo_id
          ? this.resumoProcesso(m.id, carta.processo_id)
          : Promise.resolve(null),
        l ? this.termos(m.id, l) : Promise.resolve([]),
        this.precisaIdentificacao(carta),
        l && carta.da_camara === false
          ? this.encaminhamento(m.id, l)
          : Promise.resolve(null),
      ]);
    const prazo = carta.prazo;
    return {
      codigo: carta.codigo,
      link: this.link(carta.codigo),
      municipio: m.nome,
      estado: carta.estado,
      canal: carta.canal,
      criado_em: carta.criado_em,
      lida_em: carta.lida_em,
      demonstracao: carta.demonstracao,
      ia_disponivel: this.claude.disponivel,
      leituras_restantes: Math.max(0, MAXIMO_LEITURAS - carta.leituras),
      leitura: l
        ? {
            da_camara: l.da_camara,
            entidade_emissora: l.entidade_emissora,
            tipo: l.tipo,
            tipo_rotulo: l.tipo_rotulo,
            assunto: l.assunto,
            explicacao: l.explicacao,
            o_que_e: l.o_que_e,
            referencia: l.referencia,
            data_documento: l.data_documento,
            data_notificacao: l.data_notificacao,
            prazo_lido: l.prazo,
            pedido: l.pedido,
            valores: l.valores,
            consequencias: l.consequencias,
            motivo_ilegivel: l.motivo_ilegivel,
            termos,
          }
        : null,
      prazo,
      prazo_frase: prazo ? fraseFaltam(prazo) : null,
      pergunta_rececao:
        !!prazo &&
        prazo.estado !== 'calculado' &&
        carta.estado !== 'respondida',
      data_rececao_dita: carta.data_rececao_dita,
      processo,
      precisa_identificacao: precisaIdent,
      encaminhamento,
      respostas_possiveis:
        l && l.da_camara && carta.estado !== 'respondida'
          ? respostasPossiveis(l.tipo, l.valores.length > 0).map((t) => ({
              tipo: t,
              rotulo: ROTULO_RESPOSTA[t],
            }))
          : [],
      respostas,
      lembrar: carta.lembrar,
      lembrete_dias_uteis: LEMBRETE_DIAS_UTEIS,
      lembrete_enviado_em: carta.lembrete_enviado_em,
      aviso:
        'Esta explicação ajuda a perceber a carta; o que vale é o que a carta diz. Em caso de dúvida, fale com a câmara.',
    };
  }

  private async respostas(cartaId: string) {
    const linhas = await this.db.query<
      LinhaResposta & {
        pag_referencia: string | null;
        pag_entidade: string | null;
        pag_valor: number | null;
        pag_ate: string | null;
        pag_estado: string | null;
      }
    >(
      `SELECT r.id, r.tipo, r.argumentos, r.texto, r.estado, r.numero_entrada, r.pagamento_id,
              r.criado_em, r.entregue_em,
              p.mb_referencia AS pag_referencia, p.mb_entidade AS pag_entidade,
              p.valor_cent AS pag_valor, to_char(p.pagar_ate, 'YYYY-MM-DD') AS pag_ate,
              p.estado::text AS pag_estado
       FROM carta_respostas r
       LEFT JOIN pagamentos p ON p.id = r.pagamento_id
       WHERE r.carta_id = $1 AND r.estado <> 'descartada'
       ORDER BY r.criado_em`,
      [cartaId],
    );
    return linhas.map((r) => ({
      id: r.id,
      tipo: r.tipo,
      rotulo: ROTULO_RESPOSTA[r.tipo],
      argumentos: r.argumentos,
      texto: r.texto,
      estado: r.estado,
      numero_entrada: r.numero_entrada,
      criado_em: r.criado_em,
      entregue_em: r.entregue_em,
      pagamento: r.pagamento_id
        ? {
            entidade: r.pag_entidade,
            referencia: r.pag_referencia,
            valor_cent: r.pag_valor,
            pagar_ate: r.pag_ate,
            estado: r.pag_estado,
            modo_teste: true,
          }
        : null,
    }));
  }

  /** O processo (estado, linha do tempo sem notas internas) e o link dele. */
  private async resumoProcesso(municipioId: string, processoId: string) {
    try {
      const [p, link] = await Promise.all([
        this.processos.publicoPorId(municipioId, processoId),
        this.processos.linkProcesso(municipioId, processoId),
      ]);
      return {
        numero: p.numero,
        assunto: p.assunto,
        tipo: p.tipo,
        fase: p.fase,
        fase_rotulo: p.fase_rotulo,
        fase_em_palavras: p.fase_em_palavras,
        linha_do_tempo: p.linha_do_tempo.slice(-6),
        faltam: p.documentos.faltam,
        pode_enviar_documentos: !!p.requerimento_token,
        link,
      };
    } catch (e) {
      this.logger.warn(
        `Carta: processo ${processoId} (${(e as Error).message}).`,
      );
      return null;
    }
  }

  /** Os termos do glossário que aparecem na explicação e nos excertos. */
  private async termos(municipioId: string, l: LeituraValidada) {
    const lista = await this.glossario.ativos(municipioId);
    if (!lista.length) return [];
    const texto = [
      l.tipo_rotulo,
      l.explicacao,
      l.prazo.excerto ?? '',
      ...l.pedido.map((p) => p.excerto),
      ...l.consequencias.map((c) => c.excerto ?? ''),
    ].join('\n');
    const ids = new Set(detetarTermos(texto, lista).map((m) => m.termo_id));
    return lista
      .filter((t) => ids.has(t.id))
      .slice(0, 6)
      .map((t) => ({
        termo: t.termo,
        explicacao: t.explicacao,
        fonte_legal: t.fonte_legal,
        demonstracao: t.demonstracao,
      }));
  }

  /** Carta de outra entidade: quem trata e o contacto (encaminhar). */
  private async encaminhamento(municipioId: string, l: LeituraValidada) {
    const entidade = l.entidade_emissora ?? 'outra entidade';
    let contacto: unknown = null;
    try {
      const enc = this.ref.get(EncaminhamentoService, { strict: false });
      const r = await enc.procurar(municipioId, `${entidade} ${l.assunto}`);
      if (r.encontrada && !('emergencia' in r && r.emergencia)) contacto = r;
    } catch (e) {
      this.logger.warn(`Carta: encaminhamento (${(e as Error).message}).`);
    }
    return {
      entidade,
      tipo_entidade: l.tipo_entidade,
      encaminhar: contacto,
      dizer: `Esta carta não é da câmara: é de ${entidade}. Só ${entidade} pode tratar dela.`,
    };
  }

  // -------------------------------------------------------------------
  // Respostas
  // -------------------------------------------------------------------

  async prepararResposta(
    codigo: string,
    e: z.output<typeof esquemaNovaResposta>,
    ctx?: ContextoFerramenta,
  ) {
    const carta = await this.porCodigo(codigo);
    const l = carta.leitura;
    if (!l || carta.estado !== 'lida') {
      throw new ErroApi(
        HttpStatus.CONFLICT,
        carta.estado === 'respondida' ? 'carta_respondida' : 'carta_por_ler',
        carta.estado === 'respondida'
          ? 'A resposta a esta carta já foi entregue.'
          : 'Ainda não lemos esta carta.',
      );
    }
    if (!l.da_camara) {
      throw new ErroApi(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'carta_de_outra_entidade',
        'Esta carta não é da câmara: a resposta é com a entidade que a mandou.',
      );
    }
    if (!respostasPossiveis(l.tipo, l.valores.length > 0).includes(e.tipo)) {
      throw new ErroApi(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'resposta_nao_aplicavel',
        `Para este tipo de carta não preparamos "${ROTULO_RESPOSTA[e.tipo]}".`,
      );
    }
    const m = await this.municipioDe(carta.municipio_id);
    const [pessoa] = carta.municipe_id
      ? await this.db.query<{ nome: string | null }>(
          'SELECT nome FROM municipes WHERE id = $1',
          [carta.municipe_id],
        )
      : [];
    const dados: DadosRascunho = {
      municipio: m.nome,
      nome: pessoa?.nome ?? null,
      referencia: l.referencia.valor,
      assunto: l.assunto,
      dataCarta: l.data_documento.valor,
      argumentos: e.argumentos ?? null,
      diasPedidos: e.dias ?? null,
      dataLimite: carta.data_limite,
      pedido: l.pedido.map((p) => p.o_que),
    };

    let texto: string;
    let pagamentoId: string | null = null;
    if (e.tipo === 'pronuncia') {
      let formais: string | undefined;
      if (e.argumentos && this.claude.disponivel) {
        formais = await this.claude.escrever({
          sistema: SISTEMA_PRONUNCIA,
          conteudo: `Tipo de carta: ${l.tipo_rotulo}. Assunto: ${l.assunto}.\nO que a pessoa disse:\n${e.argumentos}`,
          esforco: 'medium',
          maxTokens: 3000,
        });
      }
      texto = rascunhoPronuncia(dados, formais);
    } else if (e.tipo === 'prorrogacao') {
      texto = rascunhoProrrogacao(dados);
    } else if (e.tipo === 'elementos') {
      texto = rascunhoElementos(dados);
    } else {
      const r = await this.prepararPagamento(m, carta, l, ctx);
      pagamentoId = r.pagamentoId;
      texto = r.texto;
    }

    const [r] = await this.db.query<{ id: string }>(
      `INSERT INTO carta_respostas (municipio_id, carta_id, tipo, argumentos, texto, pagamento_id)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [m.id, carta.id, e.tipo, e.argumentos ?? null, texto, pagamentoId],
    );
    await this.auditoria.registar({
      municipioId: m.id,
      atorTipo: ctx ? 'agente' : 'municipe',
      atorId: ctx ? null : carta.municipe_id,
      acao: 'preparar_resposta_carta',
      objetoTipo: 'carta',
      objetoId: carta.id,
      dados: { tipo: e.tipo, resposta_id: r.id },
    });
    return { resposta_id: r.id, carta: await this.publico(codigo) };
  }

  /**
   * Pagamento: com o processo ligado, a referência de teste do processo
   * (PagamentosService, com o valor que a carta diz); sem processo, só a
   * referência que vem na própria carta.
   */
  private async prepararPagamento(
    m: Municipio,
    carta: LinhaCarta,
    l: LeituraValidada,
    ctx?: ContextoFerramenta,
  ): Promise<{ pagamentoId: string | null; texto: string }> {
    const v = l.valores[0];
    if (!v) {
      throw new ErroApi(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'sem_valor',
        'Não encontrámos o valor a pagar na carta.',
      );
    }
    const euros = (c: number) =>
      new Intl.NumberFormat('pt-PT', {
        style: 'currency',
        currency: 'EUR',
      }).format(c / 100);
    if (!carta.processo_id) {
      return {
        pagamentoId: null,
        texto: v.referencia_mb
          ? `Pagar ${euros(v.valor_cent)} (${v.descricao}) com os dados de pagamento que vêm na carta: ${v.referencia_mb}.`
          : `Pagar ${euros(v.valor_cent)} (${v.descricao}). A carta não traz referência Multibanco: peça-a à câmara.`,
      };
    }
    const contexto: ContextoFerramenta = ctx ?? {
      municipio: m,
      canal: 'chat',
      conversaId: carta.conversa_id,
      municipeId: carta.municipe_id,
      telefone: null,
    };
    const p = (await this.pagamentos.criar(
      contexto,
      { processo_id: carta.processo_id },
      {
        linhas: [
          {
            codigo: 'CARTA',
            descricao: v.descricao,
            unidade: 'fixo',
            quantidade: 1,
            valor_unitario_cent: v.valor_cent,
            valor_cent: v.valor_cent,
          },
        ],
        total_cent: v.valor_cent,
      },
    )) as { pagamento_id: string; entidade: string; referencia: string };
    return {
      pagamentoId: p.pagamento_id,
      texto: `Referência Multibanco de teste para pagar ${euros(v.valor_cent)} (${v.descricao}): entidade ${p.entidade}, referência ${p.referencia}. É modo de teste: nada é cobrado.`,
    };
  }

  async editarResposta(codigo: string, respostaId: string, texto: string) {
    const carta = await this.porCodigo(codigo);
    const [r] = await this.db.query<{ id: string }>(
      `UPDATE carta_respostas SET texto = $3, atualizado_em = now()
       WHERE id = $1 AND carta_id = $2 AND estado = 'rascunho' AND tipo <> 'pagamento'
       RETURNING id`,
      [respostaId, carta.id, texto],
    );
    if (!r) throw this.respostaNaoEditavel();
    return this.publico(codigo);
  }

  private respostaNaoEditavel(): ErroApi {
    return new ErroApi(
      HttpStatus.CONFLICT,
      'resposta_nao_editavel',
      'Esta resposta já não se pode mudar (já foi entregue ou não existe).',
    );
  }

  /**
   * A pessoa confirmou: a resposta entra no processo (simulado: um número de
   * entrada DEMO e a nota na linha do tempo) e o lembrete deixa de fazer falta.
   */
  async entregarResposta(codigo: string, respostaId: string) {
    const carta = await this.porCodigo(codigo);
    const r = await this.db.transaction(async (tx) => {
      const [resp] = await tx.query<LinhaResposta>(
        `SELECT id, tipo, texto, estado FROM carta_respostas
         WHERE id = $1 AND carta_id = $2 FOR UPDATE`,
        [respostaId, carta.id],
      );
      if (!resp || resp.estado === 'descartada')
        throw this.respostaNaoEditavel();
      if (resp.estado === 'entregue') return { ja: true, numero: null };
      const ano = new Date().getFullYear();
      const n = await proximoNumero(tx, carta.municipio_id, 'CARTA', ano);
      const numero = `DEMO-CARTA-${String(n).padStart(4, '0')}/${ano}`;
      await tx.query(
        `UPDATE carta_respostas SET estado = 'entregue', numero_entrada = $2,
           entregue_em = now(), atualizado_em = now()
         WHERE id = $1`,
        [resp.id, numero],
      );
      await tx.query(
        `UPDATE cartas SET estado = 'respondida', atualizado_em = now() WHERE id = $1`,
        [carta.id],
      );
      if (carta.processo_id && resp.tipo !== 'pagamento') {
        await tx.query(
          `INSERT INTO processo_eventos (processo_id, tipo, descricao, ator_tipo, ator_id, interno, dados)
           VALUES ($1, 'resposta_municipe', $2, 'municipe', $3, false, $4)`,
          [
            carta.processo_id,
            `${ROTULO_RESPOSTA[resp.tipo]}: o munícipe respondeu ao ofício (entrada ${numero}, simulada).`,
            carta.municipe_id,
            JSON.stringify({
              carta_id: carta.id,
              resposta_id: resp.id,
              numero_entrada: numero,
            }),
          ],
        );
      }
      await this.auditoria.registar(
        {
          municipioId: carta.municipio_id,
          atorTipo: 'municipe',
          atorId: carta.municipe_id,
          acao: 'entregar_resposta_carta',
          objetoTipo: 'carta',
          objetoId: carta.id,
          dados: { tipo: resp.tipo, numero_entrada: numero, simulado: true },
        },
        tx,
      );
      return { ja: false, numero };
    });
    return {
      entregue: true,
      ja_estava: r.ja,
      numero_entrada: r.numero,
      simulado: true,
      carta: await this.publico(codigo),
    };
  }

  // -------------------------------------------------------------------
  // Agente (chat e voz)
  // -------------------------------------------------------------------

  /** A carta tem de ser desta conversa ou desta pessoa. */
  private async daConversa(ctx: ContextoFerramenta, codigo: string) {
    const carta = await this.porCodigo(codigo);
    const minha =
      carta.municipio_id === ctx.municipio.id &&
      ((!!ctx.conversaId && carta.conversa_id === ctx.conversaId) ||
        (!!ctx.municipeId && carta.municipe_id === ctx.municipeId));
    if (!minha) throw naoEncontrada();
    return carta;
  }

  async lerCartaAgente(
    ctx: ContextoFerramenta,
    e: z.output<typeof entradaLerCarta>,
  ) {
    if (!e.codigo) return this.comecarAgente(ctx);
    let carta = await this.daConversa(ctx, e.codigo);

    // A pessoa identificou-se depois de enviar: liga agora ao processo.
    if (ctx.municipeId && !carta.municipe_id) {
      await this.db.query('UPDATE cartas SET municipe_id = $2 WHERE id = $1', [
        carta.id,
        ctx.municipeId,
      ]);
      carta.municipe_id = ctx.municipeId;
    }
    if (carta.leitura?.da_camara && !carta.processo_id && carta.municipe_id) {
      const pid = await this.ligar(
        ctx.municipio.id,
        carta.referencia,
        carta.municipe_id,
      );
      if (pid) {
        const modelo = await this.modeloDoProcesso(pid);
        await this.db.transaction(async (tx) => {
          await tx.query(
            'UPDATE cartas SET processo_id = $2, modelo_id = $3 WHERE id = $1',
            [carta.id, pid, modelo],
          );
          await this.eventoNoProcesso(tx, pid, carta.leitura!, carta);
        });
      }
    }
    if (e.data_rececao && carta.leitura) {
      await this.definirRececao(carta.codigo, e.data_rececao, 'agente');
    }
    carta = await this.porCodigo(carta.codigo);
    return this.resultadoAgente(await this.publico(carta.codigo));
  }

  /** Sem código: na voz, SMS com o link para fotografar; no chat, o anexo. */
  private async comecarAgente(ctx: ContextoFerramenta) {
    if (ctx.canal === 'chat' || !ctx.telefone) {
      return {
        a_espera_da_carta: true,
        dizer:
          'Envie-me uma fotografia da carta (ou o PDF) aqui, no botão de anexar ao lado da caixa de texto. Tire a fotografia à carta toda, com boa luz.',
      };
    }
    const { id, codigo } = await this.criar({
      municipio: ctx.municipio,
      canal: ctx.canal,
      conversaId: ctx.conversaId,
      municipeId: ctx.municipeId,
    });
    const link = this.link(codigo);
    await this.mensagens.sms({
      municipioId: ctx.municipio.id,
      municipeId: ctx.municipeId,
      destino: ctx.telefone,
      motivo: 'carta',
      corpo: `${ctx.municipio.nome}: para percebermos a sua carta, tire-lhe uma fotografia aqui: ${link}`,
      relacionado: {
        carta_id: id,
        ...(ctx.conversaId ? { conversa_id: ctx.conversaId } : {}),
      },
      chave: `carta_link:${id}`,
    });
    return {
      codigo,
      a_espera_da_carta: true,
      sms_enviado: true,
      link,
      dizer:
        'Mandei-lhe agora um SMS com um link. Abra-o, tire uma fotografia à carta toda e carregue em enviar. Diga-me quando tiver enviado, que eu leio-a consigo.',
    };
  }

  /** O que volta ao modelo: curto, com o "dizer". */
  resultadoAgente(p: Awaited<ReturnType<CartasService['publico']>>) {
    if (p.estado === 'a_espera') {
      return {
        codigo: p.codigo,
        a_espera_da_carta: true,
        link: p.link,
        dizer:
          'Ainda não recebi a fotografia. Abra o link do SMS, tire a fotografia à carta e carregue em enviar; eu fico à espera.',
      };
    }
    const l = p.leitura!;
    if (p.estado === 'ilegivel') {
      return {
        codigo: p.codigo,
        ilegivel: true,
        link: p.link,
        dizer: `Não consegui ler bem a carta. ${l.motivo_ilegivel ?? 'Tire outra fotografia, com mais luz e a carta toda.'}`,
      };
    }
    if (!l.da_camara) {
      return {
        codigo: p.codigo,
        da_camara: false,
        entidade: l.entidade_emissora,
        encaminhar: p.encaminhamento,
        instrucao:
          'Diz que a carta não é da câmara e de quem é. Se encaminhar vier vazio, usa a ferramenta encaminhar com o nome da entidade; nunca inventes contactos.',
        dizer: `${p.encaminhamento?.dizer ?? 'Esta carta não é da câmara.'} ${l.explicacao}`,
      };
    }
    const partes = [l.explicacao];
    let pergunta: string | null = null;
    if (p.prazo_frase) partes.push(p.prazo_frase);
    else if (p.prazo?.estado === 'falta_data') {
      pergunta = 'data_rececao';
      partes.push(
        `A carta dá ${p.prazo.dias} dias ${p.prazo.unidade === 'corridos' ? 'seguidos' : 'úteis'} a contar de quando a recebeu. Em que dia recebeu a carta?`,
      );
    } else if (p.prazo?.estado === 'sem_prazo') {
      pergunta = 'data_rececao';
      partes.push(
        'Não encontrei nenhum prazo escrito na carta, por isso não lhe digo uma data. Em que dia a recebeu? E a carta diz em algum lado "no prazo de … dias"?',
      );
    }
    const nada = l.consequencias[0];
    if (nada) {
      partes.push(
        nada.origem === 'carta'
          ? `Se não fizer nada: ${nada.texto}`
          : `Se não fizer nada, em regra: ${nada.texto}`,
      );
    }
    if (p.respostas_possiveis.length) {
      partes.push(
        `Posso preparar consigo: ${p.respostas_possiveis.map((r) => r.rotulo.toLowerCase()).join(' ou ')}.`,
      );
    }
    return {
      codigo: p.codigo,
      da_camara: true,
      tipo: l.tipo,
      tipo_rotulo: l.tipo_rotulo,
      assunto: l.assunto,
      referencia: l.referencia.valor,
      prazo: p.prazo
        ? {
            estado: p.prazo.estado,
            data_limite: p.prazo.data_limite,
            data_limite_dita: p.prazo.data_limite
              ? diaPorExtenso(p.prazo.data_limite)
              : null,
            faltam_dias_uteis: p.prazo.faltam_dias_uteis,
            terminou: p.prazo.terminou,
            excerto: l.prazo_lido.excerto,
          }
        : null,
      pergunta,
      pedido: l.pedido.map((x) => x.o_que),
      processo: p.processo
        ? { numero: p.processo.numero, fase: p.processo.fase_em_palavras }
        : null,
      precisa_identificacao: p.precisa_identificacao || undefined,
      instrucao: p.precisa_identificacao
        ? 'A carta é de um processo da câmara: para o ligar ao processo e dizer o estado, pede o NIF e usa identificar_municipe; depois chama outra vez com o mesmo código.'
        : undefined,
      respostas_possiveis: p.respostas_possiveis.map((r) => r.tipo),
      demonstracao: p.demonstracao || undefined,
      link: p.link,
      dizer: partes.join(' '),
    };
  }

  async prepararRespostaAgente(
    ctx: ContextoFerramenta,
    e: z.output<typeof entradaPrepararResposta>,
  ) {
    const carta = await this.daConversa(ctx, e.codigo);
    const r = await this.prepararResposta(
      carta.codigo,
      { tipo: e.tipo, argumentos: e.argumentos, dias: e.dias },
      ctx,
    );
    const resp = r.carta.respostas.find((x) => x.id === r.resposta_id)!;
    let sms = false;
    if (ctx.telefone && ctx.canal !== 'chat') {
      await this.mensagens.sms({
        municipioId: ctx.municipio.id,
        municipeId: ctx.municipeId,
        destino: ctx.telefone,
        motivo: 'carta',
        corpo: `${ctx.municipio.nome}: o rascunho da sua resposta está pronto para rever e confirmar: ${r.carta.link}`,
        relacionado: { carta_id: carta.id },
        chave: `carta_resposta:${resp.id}`,
      });
      sms = true;
    }
    const dizer =
      resp.tipo === 'pagamento'
        ? resp.texto
        : `Preparei o rascunho (${resp.rotulo.toLowerCase()}). ${sms ? 'Mandei-lhe o link por SMS' : 'Está no link'}: leia com calma, mude o que quiser e, se estiver bem, carregue em "Confirmar e entregar". Nada é entregue sem a sua confirmação.`;
    return {
      codigo: carta.codigo,
      resposta: {
        tipo: resp.tipo,
        rotulo: resp.rotulo,
        texto: resp.texto,
        pagamento: resp.pagamento,
      },
      link: r.carta.link,
      sms_enviado: sms,
      dizer,
    };
  }

  // -------------------------------------------------------------------
  // Chat (anexo) e app
  // -------------------------------------------------------------------

  /** O anexo do chat: cria a carta da conversa e lê-a logo. */
  async doChat(o: Origem, e: z.output<typeof esquemaFicheiro>) {
    this.lerFicheiro(e); // limites antes de criar
    const { codigo } = await this.criar(o);
    try {
      return await this.receberFicheiro(codigo, e, {
        tipo: 'municipe',
        municipeId: o.municipeId,
      });
    } catch (err) {
      // A carta fica 'a_espera': pode tentar de novo pelo link.
      if (err instanceof ErroApi) {
        const antes =
          err.detalhes && typeof err.detalhes === 'object' ? err.detalhes : {};
        throw new ErroApi(err.getStatus(), err.codigo, err.message, {
          ...antes,
          codigo,
        });
      }
      throw err;
    }
  }

  async daApp(municipeId: string, municipioId: string, limite = 30) {
    return this.db.query<{
      codigo: string;
      estado: string;
      tipo: string | null;
      assunto: string | null;
      data_limite: string | null;
      criado_em: Date;
    }>(
      `SELECT c.codigo, c.estado, c.tipo, c.leitura->>'assunto' AS assunto,
              to_char(c.data_limite, 'YYYY-MM-DD') AS data_limite, c.criado_em
       FROM cartas c
       WHERE c.municipio_id = $1 AND c.municipe_id = $2
       ORDER BY c.criado_em DESC LIMIT $3`,
      [municipioId, municipeId, limite],
    );
  }

  async publicoDaApp(municipeId: string, codigo: string) {
    const carta = await this.porCodigo(codigo);
    if (carta.municipe_id !== municipeId) throw naoEncontrada();
    return this.publico(codigo);
  }

  // -------------------------------------------------------------------
  // Lembretes
  // -------------------------------------------------------------------

  /**
   * Cartas lidas, por responder, com o prazo a acabar em
   * LEMBRETE_DIAS_UTEIS dias úteis (ou menos): avisa a pessoa (push na app
   * ou SMS) uma vez. Corre todos os dias de manhã.
   */
  async lembrar(hoje = hojeLisboa()): Promise<number> {
    const cartas = await this.db.query<{
      id: string;
      municipio_id: string;
      municipe_id: string;
      codigo: string;
      data_limite: string;
      tipo_rotulo: string | null;
      municipio: string;
    }>(
      `SELECT c.id, c.municipio_id, c.municipe_id, c.codigo,
              to_char(c.data_limite, 'YYYY-MM-DD') AS data_limite,
              c.leitura->>'tipo_rotulo' AS tipo_rotulo, m.nome AS municipio
       FROM cartas c JOIN municipios m ON m.id = c.municipio_id
       WHERE c.estado = 'lida' AND c.lembrar AND c.lembrete_enviado_em IS NULL
         AND c.municipe_id IS NOT NULL AND c.data_limite >= $1::date
         AND c.data_limite <= $1::date + 10`,
      [hoje],
    );
    let n = 0;
    for (const c of cartas) {
      const feriados = await this.municipios.feriados(c.municipio_id);
      const aviso = somarDiasUteis(hoje, LEMBRETE_DIAS_UTEIS, feriados);
      if (c.data_limite > aviso) continue;
      const r = await this.notificacoes.notificar(
        c.municipe_id,
        {
          titulo: 'O prazo da sua carta está a acabar',
          corpo: `${c.municipio}: o prazo para responder à carta (${(c.tipo_rotulo ?? 'carta da câmara').toLowerCase()}) termina a ${diaPorExtenso(c.data_limite)}. A resposta já está preparada aqui: ${this.link(c.codigo)}`,
          link: this.link(c.codigo),
          tipo: 'carta:prazo',
        },
        {
          chave: `carta_prazo:${c.id}:${c.data_limite}`,
          relacionado: { carta_id: c.id },
        },
      );
      await this.db.query(
        'UPDATE cartas SET lembrete_enviado_em = now() WHERE id = $1',
        [c.id],
      );
      if (r.enviada) n++;
    }
    return n;
  }

  // -------------------------------------------------------------------
  // Painel
  // -------------------------------------------------------------------

  async listar(m: Municipio, f: z.output<typeof esquemaListaCartas>) {
    const linhas = await this.db.query<{
      id: string;
      estado: string;
      canal: string;
      tipo: string | null;
      tipo_rotulo: string | null;
      assunto: string | null;
      da_camara: boolean | null;
      referencia: string | null;
      processo_id: string | null;
      processo_numero: string | null;
      modelo_nome: string | null;
      data_limite: string | null;
      prazo_estado: string | null;
      respostas: number;
      entregues: number;
      demonstracao: boolean;
      criado_em: Date;
    }>(
      `SELECT c.id, c.estado, c.canal, c.tipo, c.leitura->>'tipo_rotulo' AS tipo_rotulo,
              c.leitura->>'assunto' AS assunto, c.da_camara, c.referencia,
              c.processo_id, p.numero AS processo_numero, mr.nome AS modelo_nome,
              to_char(c.data_limite, 'YYYY-MM-DD') AS data_limite,
              c.prazo->>'estado' AS prazo_estado,
              (SELECT count(*)::int FROM carta_respostas r WHERE r.carta_id = c.id AND r.estado <> 'descartada') AS respostas,
              (SELECT count(*)::int FROM carta_respostas r WHERE r.carta_id = c.id AND r.estado = 'entregue') AS entregues,
              c.demonstracao, c.criado_em
       FROM cartas c
       LEFT JOIN processos p ON p.id = c.processo_id
       LEFT JOIN modelos_resposta mr ON mr.id = c.modelo_id
       WHERE c.municipio_id = $1 AND c.estado <> 'a_espera'
         AND ($2::uuid IS NULL OR c.processo_id = $2)
         AND ($3::timestamptz IS NULL OR (c.criado_em, c.id) < ($3, $4::uuid))
       ORDER BY c.criado_em DESC, c.id DESC
       LIMIT $5`,
      [
        m.id,
        f.processo_id ?? null,
        f.cursor?.em ?? null,
        f.cursor?.id ?? null,
        f.limite + 1,
      ],
    );
    return pagina(linhas, f.limite, (l) => ({ em: l.criado_em, id: l.id }));
  }

  async detalhe(m: Municipio, u: UtilizadorPainel, id: string) {
    const [c] = await this.db.query<LinhaCarta>(
      `SELECT ${COLUNAS} FROM cartas c WHERE c.id = $1 AND c.municipio_id = $2`,
      [id, m.id],
    );
    if (!c) throw naoEncontrada();
    await this.auditoria.registar({
      municipioId: m.id,
      atorTipo: 'utilizador',
      atorId: u.id,
      acao: 'ver',
      objetoTipo: 'carta',
      objetoId: c.id,
    });
    const respostas = await this.respostas(c.id);
    return {
      id: c.id,
      estado: c.estado,
      canal: c.canal,
      criado_em: c.criado_em,
      lida_em: c.lida_em,
      processo_id: c.processo_id,
      demonstracao: c.demonstracao,
      leitura: c.leitura,
      prazo: c.prazo,
      tem_ficheiro: !!c.ficheiro_key,
      // O texto das respostas é da pessoa: o painel vê o tipo e o estado.
      respostas: respostas.map((r) => ({
        tipo: r.tipo,
        rotulo: r.rotulo,
        estado: r.estado,
        numero_entrada: r.numero_entrada,
        entregue_em: r.entregue_em,
      })),
    };
  }

  /**
   * "Ofícios que mais confundem": quantas pessoas pediram ajuda com cada
   * modelo de ofício (ou, sem modelo, com cada tipo de carta), para a câmara
   * reescrever em linguagem simples os que mais confundem.
   */
  async confusoes(m: Municipio) {
    const linhas = await this.db.query<{
      modelo_id: string | null;
      modelo_nome: string | null;
      tipo: string;
      tipo_rotulo: string | null;
      total: number;
      ultimos_30_dias: number;
      sem_prazo: number;
      responderam: number;
      ultima_em: Date;
    }>(
      `SELECT c.modelo_id, mr.nome AS modelo_nome, coalesce(c.tipo, 'outro') AS tipo,
              max(c.leitura->>'tipo_rotulo') AS tipo_rotulo,
              count(*)::int AS total,
              count(*) FILTER (WHERE c.criado_em > now() - interval '30 days')::int AS ultimos_30_dias,
              count(*) FILTER (WHERE c.prazo->>'estado' <> 'calculado')::int AS sem_prazo,
              count(*) FILTER (WHERE c.estado = 'respondida')::int AS responderam,
              max(c.criado_em) AS ultima_em
       FROM cartas c
       LEFT JOIN modelos_resposta mr ON mr.id = c.modelo_id
       WHERE c.municipio_id = $1 AND c.estado IN ('lida','respondida') AND c.da_camara
       GROUP BY c.modelo_id, mr.nome, coalesce(c.tipo, 'outro')
       ORDER BY total DESC, ultima_em DESC
       LIMIT 20`,
      [m.id],
    );
    const [t] = await this.db.query<{ total: number; outras: number }>(
      `SELECT count(*) FILTER (WHERE da_camara)::int AS total,
              count(*) FILTER (WHERE NOT da_camara)::int AS outras
       FROM cartas WHERE municipio_id = $1 AND estado IN ('lida','respondida')`,
      [m.id],
    );
    return {
      itens: linhas.map((l) => ({
        ...l,
        nome: l.modelo_nome ?? l.tipo_rotulo ?? 'Carta da câmara',
        por_modelo: !!l.modelo_id,
      })),
      total_cartas_camara: t.total,
      total_outras_entidades: t.outras,
      nota: 'Conta as cartas que os munícipes pediram para explicar. Sem processo ligado, agrupa-se pelo tipo de carta.',
    };
  }

  // -------------------------------------------------------------------
  // Demonstração
  // -------------------------------------------------------------------

  /**
   * A carta de demonstração já lida: a "Notificação para audiência prévia"
   * do processo "Porta na cozinha", recebida há 3 dias úteis, ligada ao
   * processo e à requerente. Sem IA (leitura de demonstração).
   */
  async prepararDemo(m: Municipio, processoId: string): Promise<string | null> {
    const [p] = await this.db.query<{
      numero: string;
      assunto: string;
      municipe_id: string | null;
    }>(
      'SELECT numero, assunto, municipe_id FROM processos WHERE id = $1 AND municipio_id = $2',
      [processoId, m.id],
    );
    if (!p) return null;
    const feriados = await this.municipios.feriados(m.id);
    const hoje = hojeLisboa();
    const recebida = diasUteisAtras(hoje, 3, feriados);
    const bruta = leituraDemo({
      numeroProcesso: p.numero,
      assunto: p.assunto,
      data: diasUteisAtras(hoje, 5, feriados),
      municipio: m.nome,
    });
    const { id, codigo } = await this.criar({
      municipio: m,
      canal: 'demo',
      conversaId: null,
      municipeId: p.municipe_id,
    });
    await this.db.query(
      'UPDATE cartas SET data_rececao_dita = $2 WHERE id = $1',
      [id, recebida],
    );
    const carta = await this.porCodigo(codigo);
    await this.aplicarLeitura(m, carta, bruta, {
      demonstracao: true,
      chave: null,
      ator: 'sistema',
    });
    return id;
  }

  /** O PDF da carta de demonstração (para enviar no chat ou na app). */
  async pdfDemo(m: Municipio): Promise<Buffer> {
    const p = await this.processoDemo(m.id);
    return gerarPdfCartaDemo({
      municipio: m.nome,
      numeroProcesso: p?.numero ?? `CP 412/${new Date().getFullYear()}`,
      assunto: p?.assunto ?? 'Porta na cozinha',
      data: diasAtras(7),
      destinataria: 'Sandra M. (munícipe de demonstração)',
      morada: 'Rua de Demonstração, 12 · 4800-000',
    });
  }
}

function diasAtras(n: number): string {
  const d = new Date(`${hojeLisboa()}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

/** O dia útil n antes de `hoje`. */
function diasUteisAtras(
  hoje: string,
  n: number,
  feriados: Set<string>,
): string {
  const d = new Date(`${hoje}T12:00:00Z`);
  let contados = 0;
  while (contados < n) {
    d.setUTCDate(d.getUTCDate() - 1);
    const iso = d.toISOString().slice(0, 10);
    const s = d.getUTCDay();
    if (s !== 0 && s !== 6 && !feriados.has(iso)) contados++;
  }
  return d.toISOString().slice(0, 10);
}
