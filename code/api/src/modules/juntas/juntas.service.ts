import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomInt } from 'crypto';
import { z } from 'zod';
import { proximoNumero } from '../../common/numeracao.js';
import { ErroApi } from '../../common/erros.js';
import { pagina } from '../../common/paginacao.js';
import type { Cursor } from '../../common/paginacao.js';
import type { UtilizadorPainel } from '../../common/pedido.js';
import { DatabaseService, Tx } from '../../database/database.service.js';
import type { ContextoFerramenta } from '../../ferramentas/ferramenta.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { MensagensService } from '../comunicacao/mensagens.service.js';
import { MunicipesService } from '../municipes/municipes.service.js';
import {
  MunicipiosService,
  type Municipio,
} from '../municipios/municipios.service.js';
import { gerarPdfAtestado } from './atestado-pdf.js';
import type { TipoMunicipio } from './funcionalidades.js';
import {
  abreviarNome,
  DEFS_ATESTADO,
  type JuntaConhecida,
  lerAgregado,
  normalizarFreguesia,
  resolverFreguesia,
  textoAtestado,
  type TipoAtestado,
  TIPOS_ATESTADO,
} from './regras.js';

/** O município com o que a versão junta precisa. */
export interface InfoMunicipio {
  id: string;
  slug: string;
  nome: string;
  tipo: TipoMunicipio;
  concelho_id: string | null;
  freguesias: string[];
  demonstracao: boolean;
  telefone_linha: string | null;
}

/** O que o agente recolhe e confirma (área `junta` do catálogo). */
export interface PedidoAtestado {
  tipo: Exclude<TipoAtestado, 'prova_vida'> | 'prova_vida';
  nome: string;
  morada: string;
  freguesia?: string;
  finalidade?: string;
  agregado?: string[];
  rendimento_mensal?: number;
  entidade_pensao?: string;
  pode_deslocar?: boolean;
}

export const esquemaEmitir = z.object({
  /** Nota do funcionário que vai no atestado (ex.: "Verificado presencialmente"). */
  nota: z.string().trim().max(300).optional(),
});

export const esquemaRecusar = z.object({
  motivo: z.string().trim().min(5).max(500),
});

interface Linha {
  id: string;
  municipio_id: string;
  numero: string;
  tipo: TipoAtestado;
  estado: 'pedido' | 'emitido' | 'recusado';
  municipe_id: string | null;
  nome: string;
  morada: string;
  freguesia: string;
  finalidade: string | null;
  dados: {
    agregado?: { nome: string; parentesco: string | null }[];
    rendimento_mensal?: number | null;
    entidade_pensao?: string | null;
    pode_deslocar?: boolean | null;
  };
  canal: string;
  conversa_id: string | null;
  origem_municipio_id: string | null;
  origem: string | null;
  codigo_verificacao: string;
  emitido_por: string | null;
  emitido_por_nome: string | null;
  emitido_em: Date | null;
  texto_emitido: string | null;
  motivo_recusa: string | null;
  confirmado_em: Date;
  criado_em: Date;
  telefone: string | null;
}

const COLUNAS = `a.id, a.municipio_id, a.numero, a.tipo, a.estado, a.municipe_id, a.nome, a.morada,
  a.freguesia, a.finalidade, a.dados, a.canal, a.conversa_id, a.origem_municipio_id,
  o.nome AS origem, a.codigo_verificacao, a.emitido_por, u.nome AS emitido_por_nome, a.emitido_em,
  a.texto_emitido, a.motivo_recusa, a.confirmado_em, a.criado_em,
  (SELECT telefone_e164 FROM municipes WHERE id = a.municipe_id) AS telefone`;
const DE = `FROM atestados a
  LEFT JOIN municipios o ON o.id = a.origem_municipio_id
  LEFT JOIN utilizadores u ON u.id = a.emitido_por`;

// Sem 0/O, 1/I/L: lê-se num SMS e dita-se ao telefone.
const ALFABETO = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

function codigoNovo(): string {
  return Array.from(
    { length: 10 },
    () => ALFABETO[randomInt(ALFABETO.length)],
  ).join('');
}

function dataLonga(d: Date): string {
  return d.toLocaleDateString('pt-PT', {
    timeZone: 'Europe/Lisbon',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

/** 'Junta de Freguesia de Azurém' → 'Azurém'; tira o prefixo das entidades. */
export function freguesiaDoNome(nome: string): string {
  return nome
    .replace(
      /^(junta de freguesia|uni[aã]o das freguesias|uni[aã]o de freguesias|freguesia)\s+(de|da|do|das|dos)\s+/i,
      '',
    )
    .trim();
}

/**
 * Versão para juntas de freguesia: atestados (pedidos pelo agente da junta
 * ou encaminhados pelo da câmara), o painel da junta e a ligação câmara ↔
 * junta pela freguesia da morada.
 */
@Injectable()
export class JuntasService {
  constructor(
    private readonly db: DatabaseService,
    private readonly config: ConfigService,
    private readonly municipios: MunicipiosService,
    private readonly municipes: MunicipesService,
    private readonly mensagens: MensagensService,
    private readonly auditoria: AuditoriaService,
  ) {}

  webUrl(): string {
    return this.config.get<string>('app.webUrl') ?? '';
  }

  urlVerificacao(codigo: string): string {
    return `${this.webUrl()}/atestado/${codigo}`;
  }

  // -------------------------------------------------------------------
  // Municípios e juntas
  // -------------------------------------------------------------------

  async info(id: string): Promise<InfoMunicipio> {
    const [m] = await this.db.query<InfoMunicipio>(
      `SELECT id, slug, nome, tipo, concelho_id, coalesce(freguesias, '{}') AS freguesias,
              demonstracao, telefone_linha
       FROM municipios WHERE id = $1`,
      [id],
    );
    if (!m) {
      throw new ErroApi(
        HttpStatus.NOT_FOUND,
        'municipio_desconhecido',
        'Município não existe.',
      );
    }
    return m;
  }

  /** A câmara do concelho (a própria, se for câmara). */
  async camaraDe(m: Pick<Municipio, 'id' | 'tipo' | 'concelho_id'>) {
    return this.info(
      m.tipo === 'junta' && m.concelho_id ? m.concelho_id : m.id,
    );
  }

  /** As juntas do concelho no Tou, Câmara?. */
  async juntasDoConcelho(camaraId: string): Promise<InfoMunicipio[]> {
    return this.db.query<InfoMunicipio>(
      `SELECT id, slug, nome, tipo, concelho_id, coalesce(freguesias, '{}') AS freguesias,
              demonstracao, telefone_linha
       FROM municipios WHERE tipo = 'junta' AND concelho_id = $1 ORDER BY nome`,
      [camaraId],
    );
  }

  /**
   * As freguesias que a câmara já conhece nos seus dados (entidades das
   * juntas, processos, consultas, eventos, conversas, contactos).
   */
  async freguesiasConhecidas(camaraId: string): Promise<string[]> {
    const linhas = await this.db.query<{
      freguesia: string;
      entidade: boolean;
    }>(
      `SELECT DISTINCT freguesia, entidade FROM (
         SELECT nome AS freguesia, true AS entidade FROM entidades
           WHERE municipio_id = $1 AND tipo = 'junta' AND ativo
         UNION SELECT unnest(freguesias), false FROM consultas_publicas WHERE municipio_id = $1
         UNION SELECT freguesia, false FROM processos WHERE municipio_id = $1
         UNION SELECT freguesia, false FROM eventos WHERE municipio_id = $1
         UNION SELECT freguesia, false FROM contactos_cuidado WHERE municipio_id = $1
         UNION SELECT freguesia, false FROM conversas WHERE municipio_id = $1 AND freguesia IS NOT NULL
       ) f WHERE freguesia IS NOT NULL AND length(trim(freguesia)) > 1
       LIMIT 500`,
      [camaraId],
    );
    const vistas = new Map<string, string>();
    for (const l of linhas) {
      const nome = l.entidade ? freguesiaDoNome(l.freguesia) : l.freguesia;
      const k = normalizarFreguesia(nome);
      if (k.length > 1 && !vistas.has(k)) vistas.set(k, nome);
    }
    return [...vistas.values()].sort((a, b) => a.localeCompare(b, 'pt'));
  }

  /** O contacto da junta que não está no sistema (entidades da câmara). */
  private async contactoJunta(camaraId: string, freguesia: string) {
    const entidades = await this.db.query<{
      id: string;
      nome: string;
      site_url: string | null;
    }>(
      `SELECT id, nome, site_url FROM entidades
       WHERE municipio_id = $1 AND tipo = 'junta' AND ativo`,
      [camaraId],
    );
    const alvo = normalizarFreguesia(freguesia);
    const e = entidades.find(
      (x) => normalizarFreguesia(freguesiaDoNome(x.nome)) === alvo,
    );
    if (!e) return null;
    const contactos = await this.db.query<{
      tipo: string;
      rotulo: string | null;
      valor: string;
    }>(
      `SELECT tipo, rotulo, valor FROM entidade_contactos WHERE entidade_id = $1
       ORDER BY CASE tipo WHEN 'telefone' THEN 0 WHEN 'balcao' THEN 1 ELSE 2 END`,
      [e.id],
    );
    return { nome: e.nome, site: e.site_url, contactos };
  }

  /** O que a junta não trata: o contacto da câmara do concelho. */
  async respostaSoCamara(ctx: ContextoFerramenta) {
    const camara = await this.camaraDe(ctx.municipio);
    const telefone = camara.telefone_linha;
    return {
      feito: false,
      motivo: 'tratado_pela_camara',
      camara: { nome: `Câmara Municipal de ${camara.nome}`, telefone },
      dizer: `Isso não é tratado pela junta de freguesia: é da Câmara Municipal de ${camara.nome}.${
        telefone ? ` Pode ligar para ${telefone}.` : ''
      }`,
      instrucao:
        'Não tentes outra ferramenta para isto. Se a pessoa quiser, dá o contacto da câmara (encaminhar) ou passa a um funcionário da junta.',
    };
  }

  // -------------------------------------------------------------------
  // Agente: pedir atestado / prova de vida / estado
  // -------------------------------------------------------------------

  async pedir(ctx: ContextoFerramenta, e: PedidoAtestado) {
    const camara = await this.camaraDe(ctx.municipio);
    const [juntas, conhecidas] = await Promise.all([
      this.juntasDoConcelho(camara.id),
      this.freguesiasConhecidas(camara.id),
    ]);
    const conhecidasJuntas: JuntaConhecida[] = juntas.map((j) => ({
      id: j.id,
      nome: j.nome,
      freguesias: j.freguesias,
    }));
    const r = resolverFreguesia(
      e.freguesia,
      e.morada,
      conhecidasJuntas,
      conhecidas,
    );
    const def = DEFS_ATESTADO[e.tipo];
    if (!r) {
      return {
        feito: false,
        motivo: 'freguesia_desconhecida',
        em_falta: [
          {
            campo: 'freguesia',
            pergunta: 'De que freguesia é a sua morada?',
          },
        ],
        dizer: `Não consegui perceber a freguesia da morada. De que freguesia do concelho de ${camara.nome} é?`,
      };
    }
    if (!r.junta) {
      // A freguesia existe nos dados, mas a junta não está no Tou, Câmara?.
      const contacto = await this.contactoJunta(camara.id, r.freguesia);
      return {
        feito: false,
        motivo: 'junta_fora_do_sistema',
        encaminhado: true,
        freguesia: r.freguesia,
        junta: contacto,
        dizer: `O ${def.curto} é passado pela junta de freguesia de ${r.freguesia}, que ainda não recebe pedidos por aqui.${
          contacto?.contactos[0]
            ? ` O contacto é ${contacto.contactos[0].valor}.`
            : ' Tem de se dirigir à junta.'
        }`,
        instrucao:
          'Dá o contacto da junta (ou usa encaminhar). Não digas que o pedido ficou feito.',
      };
    }
    if (!ctx.municipeId) {
      return this.precisaIdentificacao();
    }
    const quem = await this.municipes.porId(ctx.municipeId);
    if (!quem?.tem_nif) return this.precisaIdentificacao();

    const destino = await this.info(r.junta.id);
    const encaminhado = destino.id !== ctx.municipio.id;
    const dados: Linha['dados'] = {};
    if (e.tipo === 'agregado_familiar') {
      dados.agregado = lerAgregado(e.agregado ?? []);
      if (!dados.agregado.length) {
        return {
          feito: false,
          motivo: 'faltam_dados',
          em_falta: [
            {
              campo: 'agregado',
              pergunta:
                'Quem vive consigo? Diga o nome e o parentesco de cada pessoa.',
            },
          ],
          dizer:
            'Para o atestado de agregado familiar preciso de saber quem vive consigo: o nome e o parentesco de cada pessoa.',
        };
      }
    }
    if (e.tipo === 'situacao_economica') {
      dados.rendimento_mensal = e.rendimento_mensal ?? null;
    }
    if (e.tipo === 'prova_vida') {
      dados.entidade_pensao = e.entidade_pensao ?? null;
      dados.pode_deslocar = e.pode_deslocar ?? null;
    }

    const criado = await this.db.transaction(async (tx) => {
      const municipeId = encaminhado
        ? await this.municipeNaJunta(tx, destino.id, ctx, quem.nome ?? e.nome)
        : ctx.municipeId;
      const ano = new Date().getFullYear();
      const numero = `AT ${await proximoNumero(tx, destino.id, 'AT', ano)}/${ano}`;
      const [a] = await tx.query<{ id: string; codigo_verificacao: string }>(
        `INSERT INTO atestados (municipio_id, numero, tipo, municipe_id, nome, morada, freguesia,
           finalidade, dados, canal, conversa_id, origem_municipio_id, codigo_verificacao)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         RETURNING id, codigo_verificacao`,
        [
          destino.id,
          numero,
          e.tipo,
          municipeId,
          e.nome.trim(),
          e.morada.trim(),
          r.freguesia,
          e.finalidade?.trim() || null,
          JSON.stringify(dados),
          ctx.canal,
          encaminhado ? null : ctx.conversaId,
          encaminhado ? ctx.municipio.id : null,
          codigoNovo(),
        ],
      );
      await this.auditoria.registar(
        {
          municipioId: destino.id,
          atorTipo: 'agente',
          acao: 'pedir_atestado',
          objetoTipo: 'atestado',
          objetoId: a.id,
          dados: {
            tipo: e.tipo,
            numero,
            canal: ctx.canal,
            ...(encaminhado ? { encaminhado_por: ctx.municipio.id } : {}),
          },
        },
        tx,
      );
      if (encaminhado) {
        // Fica também no registo da câmara (ou da junta) que encaminhou.
        await this.auditoria.registar(
          {
            municipioId: ctx.municipio.id,
            atorTipo: 'agente',
            acao: 'encaminhar_atestado',
            objetoTipo: 'atestado',
            objetoId: a.id,
            dados: { junta: destino.id, numero, tipo: e.tipo },
          },
          tx,
        );
      }
      if (ctx.telefone) {
        await this.mensagens.sms(
          {
            municipioId: destino.id,
            municipeId,
            destino: ctx.telefone,
            motivo: 'atestado',
            corpo: `${destino.nome}: recebemos o pedido de ${def.curto} ${numero}. Avisamos por SMS quando estiver pronto. Acompanhe: ${this.urlVerificacao(a.codigo_verificacao)}`,
            relacionado: { atestado_id: a.id },
            chave: `atestado_pedido:${a.id}`,
          },
          tx,
        );
      }
      return { id: a.id, numero };
    });

    const prazo = def.prazoDiasUteis;
    const deslocar =
      e.tipo === 'prova_vida'
        ? e.pode_deslocar === false
          ? ' A junta combina consigo a visita a casa.'
          : ' Tem de ir à junta com o cartão de cidadão para a prova ficar feita.'
        : '';
    return {
      feito: true,
      numero: criado.numero,
      tipo: e.tipo,
      junta: destino.nome,
      freguesia: r.freguesia,
      encaminhado,
      prazo_dias_uteis: prazo,
      requisitos: def.requisitos,
      valores_de_demonstracao: true,
      dizer: `${encaminhado ? `Este pedido é da ${destino.nome} e já lho passei. ` : ''}O pedido de ${def.curto} ficou registado com o número ${criado.numero}. A junta trata dele em cerca de ${prazo} dias úteis e avisa por SMS quando estiver pronto.${deslocar}`,
    };
  }

  private precisaIdentificacao() {
    return {
      feito: false,
      motivo: 'precisa_identificacao',
      precisa_identificacao: true,
      instrucao:
        'O atestado é passado em nome da pessoa: pede o NIF e usa identificar_municipe; depois chama outra vez pedir_servico com os mesmos dados.',
    };
  }

  /** O munícipe na junta de destino (pelo telefone), com o nome e o NIF. */
  private async municipeNaJunta(
    tx: Tx,
    juntaId: string,
    ctx: ContextoFerramenta,
    nome: string,
  ): Promise<string> {
    const m =
      (await this.municipes.porTelefone(juntaId, ctx.telefone, tx)) ??
      (await this.municipes.criar(juntaId, {}, tx));
    const nif = ctx.municipeId
      ? await this.municipes.nifEmClaro(ctx.municipeId)
      : null;
    await this.municipes.atualizar(
      m.id,
      { nome, ...(nif && !m.tem_nif ? { nif } : {}) },
      tx,
    );
    return m.id;
  }

  /** Os pedidos da pessoa (pelo telefone, na junta ou nas juntas do concelho). */
  async estado(ctx: ContextoFerramenta, numero?: string) {
    const camara = await this.camaraDe(ctx.municipio);
    const juntas = (await this.juntasDoConcelho(camara.id)).map((j) => j.id);
    if (!ctx.telefone && !ctx.municipeId) return this.precisaIdentificacao();
    const linhas = await this.db.query<{
      numero: string;
      tipo: TipoAtestado;
      estado: string;
      junta: string;
      criado_em: Date;
      motivo_recusa: string | null;
    }>(
      `SELECT a.numero, a.tipo, a.estado, m.nome AS junta, a.criado_em, a.motivo_recusa
       FROM atestados a JOIN municipios m ON m.id = a.municipio_id
       JOIN municipes p ON p.id = a.municipe_id
       WHERE a.municipio_id = ANY($1::uuid[])
         AND (p.id = $2 OR ($3::text IS NOT NULL AND p.telefone_e164 = $3))
         AND ($4::text IS NULL OR replace(lower(a.numero), ' ', '') = replace(lower($4), ' ', ''))
       ORDER BY a.criado_em DESC LIMIT 5`,
      [juntas, ctx.municipeId, ctx.telefone, numero ?? null],
    );
    if (!linhas.length) {
      return {
        encontrado: false,
        dizer: 'Não encontrei pedidos de atestado com este número de telefone.',
      };
    }
    const frase = (l: (typeof linhas)[number]) =>
      `${DEFS_ATESTADO[l.tipo].curto} ${l.numero} (${l.junta}): ${
        l.estado === 'pedido'
          ? 'ainda a ser tratado'
          : l.estado === 'emitido'
            ? 'pronto, enviámos o link por SMS'
            : `não foi passado (${l.motivo_recusa ?? 'sem motivo'})`
      }`;
    return {
      encontrado: true,
      pedidos: linhas.map((l) => ({
        numero: l.numero,
        tipo: l.tipo,
        estado: l.estado,
        junta: l.junta,
      })),
      dizer: `${linhas.map(frase).join('; ')}.`,
    };
  }

  // -------------------------------------------------------------------
  // Painel da junta
  // -------------------------------------------------------------------

  async listar(
    m: Municipio,
    f: { estado?: string; tipo?: string },
    limite: number,
    cursor: Cursor | null,
  ) {
    const linhas = await this.db.query<Linha>(
      `SELECT ${COLUNAS} ${DE}
       WHERE a.municipio_id = $1
         AND ($2::text IS NULL OR a.estado = $2)
         AND ($3::text IS NULL OR a.tipo = $3)
         AND ($4::timestamptz IS NULL OR (a.criado_em, a.id) < ($4, $5::uuid))
       ORDER BY a.criado_em DESC, a.id DESC LIMIT $6`,
      [
        m.id,
        f.estado ?? null,
        f.tipo ?? null,
        cursor?.em ?? null,
        cursor?.id ?? null,
        limite + 1,
      ],
    );
    const [contagens] = await this.db.query<{
      pedido: number;
      emitido: number;
      recusado: number;
    }>(
      `SELECT count(*) FILTER (WHERE estado = 'pedido')::int AS pedido,
              count(*) FILTER (WHERE estado = 'emitido')::int AS emitido,
              count(*) FILTER (WHERE estado = 'recusado')::int AS recusado
       FROM atestados WHERE municipio_id = $1`,
      [m.id],
    );
    return {
      ...pagina(linhas.map(this.paraPainel), limite, (l) => ({
        em: l.criado_em,
        id: l.id,
      })),
      contagens,
      demonstracao: true,
    };
  }

  private readonly paraPainel = (l: Linha) => ({
    id: l.id,
    numero: l.numero,
    tipo: l.tipo,
    titulo: DEFS_ATESTADO[l.tipo].titulo,
    estado: l.estado,
    nome: l.nome,
    morada: l.morada,
    freguesia: l.freguesia,
    finalidade: l.finalidade,
    dados: l.dados,
    canal: l.canal,
    conversa_id: l.conversa_id,
    encaminhado_por: l.origem,
    telefone: l.telefone,
    confirmado_em: l.confirmado_em,
    criado_em: l.criado_em,
    emitido_em: l.emitido_em,
    emitido_por: l.emitido_por_nome,
    motivo_recusa: l.motivo_recusa,
    codigo: l.codigo_verificacao,
  });

  private async linha(municipioId: string | null, id: string): Promise<Linha> {
    const [l] = await this.db.query<Linha>(
      `SELECT ${COLUNAS} ${DE} WHERE a.id = $1 AND ($2::uuid IS NULL OR a.municipio_id = $2)`,
      [id, municipioId],
    );
    if (!l) {
      throw new ErroApi(
        HttpStatus.NOT_FOUND,
        'nao_encontrado',
        'Atestado não existe.',
      );
    }
    return l;
  }

  async detalhe(m: Municipio, id: string) {
    const l = await this.linha(m.id, id);
    return {
      ...this.paraPainel(l),
      requisitos: DEFS_ATESTADO[l.tipo].requisitos,
      texto: l.texto_emitido
        ? l.texto_emitido.split('\n\n')
        : this.paragrafos(l, m.nome, null, new Date()),
      url_publica: this.urlVerificacao(l.codigo_verificacao),
      valores_de_demonstracao: true,
    };
  }

  private paragrafos(
    l: Linha,
    junta: string,
    nota: string | null,
    data: Date,
  ): string[] {
    return textoAtestado({
      tipo: l.tipo,
      nome: l.nome,
      morada: l.morada,
      freguesia: l.freguesia,
      junta,
      finalidade: l.finalidade,
      agregado: l.dados.agregado,
      rendimentoMensal: l.dados.rendimento_mensal ?? null,
      entidadePensao: l.dados.entidade_pensao ?? null,
      nota,
      data: dataLonga(data),
    });
  }

  async emitir(
    m: Municipio,
    u: UtilizadorPainel,
    id: string,
    d: z.infer<typeof esquemaEmitir>,
  ) {
    const l = await this.linha(m.id, id);
    if (l.estado !== 'pedido') {
      throw new ErroApi(
        HttpStatus.CONFLICT,
        'ja_decidido',
        `Este pedido já foi ${l.estado === 'emitido' ? 'emitido' : 'recusado'}.`,
      );
    }
    const agora = new Date();
    const texto = this.paragrafos(l, m.nome, d.nota ?? null, agora).join(
      '\n\n',
    );
    const def = DEFS_ATESTADO[l.tipo];
    await this.db.transaction(async (tx) => {
      await tx.query(
        `UPDATE atestados SET estado = 'emitido', emitido_por = $2, emitido_em = $3,
           texto_emitido = $4, atualizado_em = now()
         WHERE id = $1 AND municipio_id = $5 AND estado = 'pedido'`,
        [id, u.id, agora, texto, m.id],
      );
      await this.auditoria.registar(
        {
          municipioId: m.id,
          atorTipo: 'utilizador',
          atorId: u.id,
          acao: 'emitir_atestado',
          objetoTipo: 'atestado',
          objetoId: id,
          dados: { numero: l.numero, tipo: l.tipo },
        },
        tx,
      );
      if (l.telefone) {
        await this.mensagens.sms(
          {
            municipioId: m.id,
            municipeId: l.municipe_id,
            destino: l.telefone,
            motivo: 'atestado',
            corpo: `${m.nome}: o seu ${def.curto} ${l.numero} está pronto. Documento e QR: ${this.urlVerificacao(l.codigo_verificacao)}`,
            relacionado: { atestado_id: id },
            chave: `atestado_emitido:${id}`,
          },
          tx,
        );
      }
    });
    return this.detalhe(m, id);
  }

  async recusar(
    m: Municipio,
    u: UtilizadorPainel,
    id: string,
    d: z.infer<typeof esquemaRecusar>,
  ) {
    const l = await this.linha(m.id, id);
    if (l.estado !== 'pedido') {
      throw new ErroApi(
        HttpStatus.CONFLICT,
        'ja_decidido',
        'Este pedido já foi decidido.',
      );
    }
    const def = DEFS_ATESTADO[l.tipo];
    await this.db.transaction(async (tx) => {
      await tx.query(
        `UPDATE atestados SET estado = 'recusado', motivo_recusa = $2, emitido_por = $3,
           atualizado_em = now()
         WHERE id = $1 AND municipio_id = $4`,
        [id, d.motivo, u.id, m.id],
      );
      await this.auditoria.registar(
        {
          municipioId: m.id,
          atorTipo: 'utilizador',
          atorId: u.id,
          acao: 'recusar_atestado',
          objetoTipo: 'atestado',
          objetoId: id,
          dados: { numero: l.numero, motivo: d.motivo },
        },
        tx,
      );
      if (l.telefone) {
        await this.mensagens.sms(
          {
            municipioId: m.id,
            municipeId: l.municipe_id,
            destino: l.telefone,
            motivo: 'atestado',
            corpo: `${m.nome}: o ${def.curto} ${l.numero} não pode ser passado. ${d.motivo}`,
            relacionado: { atestado_id: id },
            chave: `atestado_recusado:${id}`,
          },
          tx,
        );
      }
    });
    return this.detalhe(m, id);
  }

  // -------------------------------------------------------------------
  // PDF e página pública (link do SMS e QR)
  // -------------------------------------------------------------------

  private async porCodigo(codigo: string): Promise<Linha> {
    const [l] = await this.db.query<Linha>(
      `SELECT ${COLUNAS} ${DE} WHERE a.codigo_verificacao = $1`,
      [codigo.trim().toUpperCase()],
    );
    if (!l) {
      throw new ErroApi(
        HttpStatus.NOT_FOUND,
        'nao_encontrado',
        'Este atestado não existe.',
      );
    }
    return l;
  }

  async publico(codigo: string) {
    const l = await this.porCodigo(codigo);
    const junta = await this.info(l.municipio_id);
    const def = DEFS_ATESTADO[l.tipo];
    return {
      numero: l.numero,
      tipo: l.tipo,
      titulo: def.titulo,
      junta: junta.nome,
      estado: l.estado,
      titular: abreviarNome(l.nome),
      freguesia: l.freguesia,
      pedido_em: l.criado_em,
      emitido_em: l.emitido_em,
      motivo_recusa: l.estado === 'recusado' ? l.motivo_recusa : null,
      prazo_dias_uteis: def.prazoDiasUteis,
      requisitos: def.requisitos,
      pdf: l.estado === 'emitido',
      demonstracao: true,
    };
  }

  async pdfPorCodigo(codigo: string) {
    return this.pdf(await this.porCodigo(codigo));
  }

  async pdfPainel(m: Municipio, id: string) {
    return this.pdf(await this.linha(m.id, id));
  }

  private async pdf(l: Linha): Promise<{ nome: string; pdf: Buffer }> {
    if (l.estado !== 'emitido' || !l.emitido_em || !l.texto_emitido) {
      throw new ErroApi(
        HttpStatus.NOT_FOUND,
        'atestado_por_emitir',
        'Este atestado ainda não foi emitido.',
      );
    }
    const junta = await this.info(l.municipio_id);
    const camara = junta.concelho_id
      ? await this.info(junta.concelho_id)
      : null;
    const pdf = await gerarPdfAtestado({
      junta: junta.nome,
      concelho: camara?.nome ?? null,
      numero: l.numero,
      titulo: DEFS_ATESTADO[l.tipo].titulo,
      paragrafos: l.texto_emitido.split('\n\n'),
      emitido: { por: l.emitido_por_nome ?? 'a junta', em: l.emitido_em },
      urlVerificacao: this.urlVerificacao(l.codigo_verificacao),
      codigo: l.codigo_verificacao,
    });
    return {
      nome: `atestado-${l.numero.replace(/\W+/g, '-')}.pdf`,
      pdf,
    };
  }

  // -------------------------------------------------------------------
  // Painel: o que é este município (junta ou câmara) e as ligações
  // -------------------------------------------------------------------

  async resumo(m: Municipio) {
    const eu = await this.info(m.id);
    if (eu.tipo === 'junta') {
      const camara = await this.camaraDe(m);
      return {
        tipo: eu.tipo,
        nome: eu.nome,
        freguesias: eu.freguesias,
        demonstracao: eu.demonstracao,
        concelho: {
          id: camara.id,
          nome: camara.nome,
          telefone: camara.telefone_linha,
        },
        juntas: [],
      };
    }
    const juntas = await this.juntasDoConcelho(m.id);
    return {
      tipo: eu.tipo,
      nome: eu.nome,
      freguesias: [],
      demonstracao: eu.demonstracao,
      concelho: null,
      juntas: juntas.map((j) => ({
        id: j.id,
        slug: j.slug,
        nome: j.nome,
        freguesias: j.freguesias,
        demonstracao: j.demonstracao,
      })),
    };
  }

  /** Para a página do chat da junta (`/junta/[slug]`). */
  async publicoMunicipio(slug: string) {
    const m = await this.municipios.porSlug(slug);
    const i = await this.info(m.id);
    if (i.tipo !== 'junta') {
      throw new ErroApi(
        HttpStatus.NOT_FOUND,
        'nao_e_junta',
        'Não é uma junta de freguesia.',
      );
    }
    const camara = await this.camaraDe(m);
    return {
      slug: i.slug,
      nome: i.nome,
      freguesias: i.freguesias,
      concelho: camara.nome,
      demonstracao: i.demonstracao,
    };
  }
}

export { TIPOS_ATESTADO };
