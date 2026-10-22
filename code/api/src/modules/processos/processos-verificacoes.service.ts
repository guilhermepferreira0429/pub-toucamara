import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { hojeLisboa } from '../../common/dias-uteis.js';
import { ErroApi } from '../../common/erros.js';
import type { UtilizadorPainel } from '../../common/pedido.js';
import { DatabaseService } from '../../database/database.service.js';
import { ClaudeService } from '../../ia/claude.service.js';
import { MIMES_VISAO, MimeVisao } from '../../ia/visao.service.js';
import { ArmazenamentoService } from '../armazenamento/armazenamento.service.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import type { Municipio } from '../municipios/municipios.service.js';
import { GeocodificacaoService } from '../ocorrencias/geocodificacao.js';
import { OrdenamentoService } from '../ordenamento/ordenamento.service.js';
import type { Ponto } from '../ordenamento/regras.js';
import { descricaoDoRequerimento } from './apoio.js';
import {
  DEFINICOES,
  declaradosDoRequerimento,
  EscolhaPerfil,
  escolherPerfil,
  infoPerfil,
  medidasParaPdm,
  pedidoDoPerfil,
  Perfil,
  PERFIS,
  prontoParaDecisao,
  verificacoesDoPerfil,
} from './perfis-verificacao.js';
import { ProcessosPainelService } from './processos-painel.service.js';
import { TiposProcessoService } from './tipos-processo.service.js';
import {
  ficheiroDemonstracao,
  PREFIXO_DEMONSTRACAO,
} from './projeto-demonstracao-pdf.js';
import { analisarPdf } from './analise-pdf.js';
import {
  aConfirmar,
  contagem,
  DocumentoLido,
  esquemaLeituraProjeto,
  FicheiroCandidato,
  interpretarLeitura,
  juntarVerificacoes,
  leituraNaoVerificavel,
  MAX_FICHEIROS_IA,
  obraDoProcesso,
  OpcoesLeitura,
  pedidoLeituraProjeto,
  PROJETO,
  ResultadoLeitura,
  selecionarParaLeitura,
  TERMO,
  Verificacao,
  VERIFICADOR_ORDEM,
  verificarInstrucao,
  verificarOrdem,
  verificarPdm,
  verificarTermo,
  VERSAO_VERIFICACOES,
} from './verificacoes.js';
import type { VerificadorOrdem } from './verificacoes.js';

/**
 * Hashes do que as verificações usam, do processo `p` (alias). Documentos:
 * ids, ficheiros, tipo e estado da verificação (a leitura da IA reaproveita-se
 * enquanto este não mudar). Regras: tipo, morada e coordenadas, zonas do PDM,
 * documentos exigidos, pedidos ao munícipe e requerimento.
 */
const HASH_DOCUMENTOS = `md5(coalesce((
  SELECT string_agg(concat_ws(':', d.id, d.ficheiro_key, d.tamanho, d.mime, d.verificacao_estado,
                              d.emitido_em, d.tipo_documento_id, d.descricao), ',' ORDER BY d.id)
  FROM documentos d WHERE d.processo_id = p.id), ''))`;

const HASH_REGRAS = `md5(concat_ws('|',
  p.tipo_processo_id, p.assunto, p.morada, p.lat, p.lng,
  (SELECT string_agg(concat_ws(':', z.id, z.nome, z.categoria, z.regras::text, z.poligono::text,
                               z.fonte::text, z.demonstracao, z.parametros::text), ',' ORDER BY z.id)
     FROM zonas_pdm z WHERE z.municipio_id = p.municipio_id),
  (SELECT string_agg(concat_ws(':', td.id, td.nome, td.obrigatorio, td.gerado_pelo_sistema,
                               td.verificacoes::text), ',' ORDER BY td.id)
     FROM tipo_processo_documentos td WHERE td.tipo_processo_id = p.tipo_processo_id),
  (SELECT string_agg(concat_ws(':', pp.id, pp.respondido_em), ',' ORDER BY pp.id)
     FROM processo_pedidos_estado pp WHERE pp.processo_id = p.id),
  (SELECT max(r.atualizado_em) FROM requerimentos r WHERE r.processo_id = p.id),
  (SELECT string_agg(md5(r.dados::text), ',' ORDER BY r.id) FROM requerimentos r WHERE r.processo_id = p.id)))`;

interface LinhaVerificacoes {
  id: string;
  versao_motor: string;
  documentos_hash: string;
  regras_hash: string;
  resultado: Verificacao[];
  leitura_ia: unknown;
  leitura_ia_em: Date | null;
  /** O perfil com que correu (null nas verificações antes da V4). */
  perfil: EscolhaPerfil | null;
  gerado_por: string | null;
  gerado_por_nome: string | null;
  gerado_em: Date;
}

/** O que fica em `leitura_ia`: a resposta validada e os documentos lidos. */
interface LeituraGuardada {
  documentos: DocumentoLido[];
  resposta: unknown;
  /** O perfil com que a IA leu (o pedido muda com ele). */
  perfil?: Perfil | null;
}

/** ?atualizar=true corre tudo outra vez; ?perfil=piscina escolhe o tipo de operação. */
export const esquemaVerificar = z.object({
  atualizar: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .default(false),
  perfil: z.enum(PERFIS).optional(),
});

/** As opções da leitura para o perfil (sem perfil: como antes da V4). */
function opcoesLeitura(perfil: Perfil | null): OpcoesLeitura {
  return perfil ? DEFINICOES[perfil].leitura : {};
}

interface DocumentoDoProcesso {
  id: string;
  tipo_documento_id: string | null;
  tipo_nome: string | null;
  descricao: string | null;
  regras_tipo: unknown;
  ficheiro_key: string;
  mime: string;
  tamanho: number | null;
  verificacao_estado: string;
  verificacao: unknown;
  emitido_em: string | null;
  recebido_em: Date;
}

const nomeDoc = (d: Pick<DocumentoDoProcesso, 'tipo_nome' | 'descricao'>) =>
  d.tipo_nome ?? d.descricao ?? 'Documento sem tipo';

/** Validade em meses configurada no tipo ({"tipo":"validade","meses":6}). */
function validadeMeses(regras: unknown): number | null {
  if (!Array.isArray(regras)) return null;
  for (const r of regras) {
    if (
      r &&
      typeof r === 'object' &&
      (r as { tipo?: unknown }).tipo === 'validade' &&
      typeof (r as { meses?: unknown }).meses === 'number'
    ) {
      return (r as { meses: number }).meses;
    }
  }
  return null;
}

function eMimeVisao(m: string): m is MimeVisao {
  return (MIMES_VISAO as readonly string[]).includes(m);
}

/**
 * Verificações automáticas do apoio ao técnico: PDM no local, instrução,
 * termo de responsabilidade, inscrição na Ordem (simulada) e leitura do
 * projeto pela IA. Corre só quando o técnico abre o apoio ou pede outra vez
 * (nunca em massa). Cada execução fica em `processo_verificacoes` com os
 * hashes dos documentos e das regras; a última serve de cache, e a leitura
 * da IA reaproveita-se enquanto os documentos forem os mesmos.
 */
@Injectable()
export class ProcessosVerificacoesService {
  private readonly logger = new Logger(ProcessosVerificacoesService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly claude: ClaudeService,
    private readonly armazenamento: ArmazenamentoService,
    private readonly auditoria: AuditoriaService,
    private readonly painel: ProcessosPainelService,
    private readonly tipos: TiposProcessoService,
    private readonly ordenamento: OrdenamentoService,
    private readonly geo: GeocodificacaoService,
    @Inject(VERIFICADOR_ORDEM) private readonly ordem: VerificadorOrdem,
  ) {}

  private async hashes(processoId: string) {
    const [r] = await this.db.query<{ documentos: string; regras: string }>(
      `SELECT ${HASH_DOCUMENTOS} AS documentos, ${HASH_REGRAS} AS regras
       FROM processos p WHERE p.id = $1`,
      [processoId],
    );
    return r;
  }

  private async ultima(processoId: string): Promise<LinhaVerificacoes | null> {
    const [l] = await this.db.query<LinhaVerificacoes>(
      `SELECT v.id, v.versao_motor, v.documentos_hash, v.regras_hash, v.resultado, v.leitura_ia,
              v.leitura_ia_em, v.perfil, v.gerado_por, u.nome AS gerado_por_nome, v.gerado_em
       FROM processo_verificacoes v LEFT JOIN utilizadores u ON u.id = v.gerado_por
       WHERE v.processo_id = $1 ORDER BY v.gerado_em DESC, v.id LIMIT 1`,
      [processoId],
    );
    return l ?? null;
  }

  private mostrar(
    processoId: string,
    l: LinhaVerificacoes,
    emCache: boolean,
    atual: boolean,
  ) {
    const escolha: EscolhaPerfil = l.perfil ?? {
      perfil: null,
      escolhido_por: null,
      candidatos: [],
      ambiguo: true,
    };
    return {
      processo_id: processoId,
      itens: l.resultado,
      contagem: contagem(l.resultado),
      /** O tipo de operação com que se verificou e o que fica para o técnico. */
      perfil: infoPerfil(escolha),
      /** Tudo verificado sem falhas nem avisos (o que vem da IA confirma-se na mesma). */
      pronto_para_decisao: prontoParaDecisao(l.resultado),
      /** Quantas vêm da IA (ou de uma simulação) e o técnico confirma: a IA nunca aprova sozinha. */
      a_confirmar: aConfirmar(l.resultado),
      gerado_em: l.gerado_em,
      gerado_por: l.gerado_por
        ? { id: l.gerado_por, nome: l.gerado_por_nome }
        : null,
      leitura_ia_em: l.leitura_ia_em,
      em_cache: emCache,
      /** false: os documentos ou as regras mudaram desde então. */
      atualizado: atual,
      ia_disponivel: this.claude.disponivel,
      versao: {
        motor: l.versao_motor,
        documentos: l.documentos_hash,
        regras: l.regras_hash,
      },
    };
  }

  /** As últimas verificações guardadas, sem correr nada (para os rascunhos e a ficha). */
  async guardadas(processoId: string) {
    const [l, h] = await Promise.all([
      this.ultima(processoId),
      this.hashes(processoId),
    ]);
    if (!l) return null;
    const atual =
      l.versao_motor === VERSAO_VERIFICACOES &&
      l.documentos_hash === h.documentos &&
      l.regras_hash === h.regras;
    return this.mostrar(processoId, l, true, atual);
  }

  /**
   * As verificações do processo: da cache se nada mudou, senão corre-as (a
   * leitura da IA só se os documentos mudaram ou com `atualizar`).
   */
  async obter(
    municipio: Municipio,
    u: UtilizadorPainel,
    id: string,
    atualizar: boolean,
    /** O tipo de operação escolhido pelo técnico (fica para as seguintes). */
    perfilPedido: Perfil | null = null,
  ) {
    await this.painel.carregar(municipio.id, id);
    const h = await this.hashes(id);
    const ultima = await this.ultima(id);
    const mesmoPerfilPedido =
      !perfilPedido ||
      (ultima?.perfil?.perfil === perfilPedido &&
        ultima.perfil.escolhido_por === 'tecnico');
    if (
      !atualizar &&
      mesmoPerfilPedido &&
      ultima &&
      ultima.versao_motor === VERSAO_VERIFICACOES &&
      ultima.documentos_hash === h.documentos &&
      ultima.regras_hash === h.regras
    ) {
      return this.mostrar(id, ultima, true, true);
    }

    const d = await this.painel.detalhe(municipio, id);
    const docs = await this.db.query<DocumentoDoProcesso>(
      `SELECT d.id, d.tipo_documento_id, td.nome AS tipo_nome, d.descricao, td.verificacoes AS regras_tipo,
              d.ficheiro_key, d.mime, d.tamanho, d.verificacao_estado, d.verificacao,
              to_char(d.emitido_em, 'YYYY-MM-DD') AS emitido_em, d.recebido_em
       FROM documentos d
       LEFT JOIN tipo_processo_documentos td ON td.id = d.tipo_documento_id
       WHERE d.processo_id = $1 ORDER BY d.recebido_em, d.id`,
      [id],
    );
    const descricao = descricaoDoRequerimento(d.requerimento?.dados ?? []);
    const [req] = await this.db.query<{ dados: unknown }>(
      `SELECT dados FROM requerimentos WHERE processo_id = $1
       ORDER BY atualizado_em DESC, id LIMIT 1`,
      [id],
    );
    const declarados = declaradosDoRequerimento(req?.dados);

    // O tipo de operação: o do técnico (agora ou antes), o declarado, o do tipo ou o do texto.
    const escolhidoAntes =
      ultima?.perfil?.escolhido_por === 'tecnico' ? ultima.perfil.perfil : null;
    const escolha = escolherPerfil({
      tipo: { codigo: d.tipo.codigo, nome: d.tipo.nome },
      assunto: d.assunto,
      descricao,
      operacao_declarada: declarados.operacao,
      escolhido: perfilPedido ?? escolhidoAntes,
    });
    const perfil = escolha.perfil;
    const opcoes = opcoesLeitura(perfil);

    // 5. Leitura do projeto (primeiro: o técnico autor serve à Ordem e ao termo).
    let leituraIa: unknown = null;
    let leituraIaEm: Date | null = null;
    let origemLeitura: 'nova' | 'reaproveitada' | 'sem' = 'sem';
    let leitura: ResultadoLeitura;
    const guardadaAntes = ultima?.leitura_ia as LeituraGuardada | null;
    const anterior =
      !atualizar &&
      guardadaAntes &&
      ultima?.documentos_hash === h.documentos &&
      (guardadaAntes.perfil ?? null) === perfil
        ? ultima
        : null;
    const lidos = this.documentosParaLer(docs);
    const guardada = anterior?.leitura_ia as LeituraGuardada | null;
    if (anterior && guardada?.documentos && guardada.resposta) {
      leituraIa = guardada;
      leituraIaEm = anterior.leitura_ia_em;
      origemLeitura = 'reaproveitada';
      leitura = interpretarLeitura(
        guardada.resposta,
        guardada.documentos,
        opcoes,
      );
    } else {
      const r = await this.lerProjeto(d, descricao, lidos, perfil);
      leitura = r.leitura;
      if (r.bruto) {
        leituraIa = r.bruto;
        leituraIaEm = new Date();
        origemLeitura = 'nova';
      }
    }

    // 2. Instrução.
    const exigidos = await this.tipos.documentos(d.tipo.id, {
      processoId: id,
    });
    const instrucao = verificarInstrucao({
      tipo_nome: d.tipo.nome,
      exigidos: exigidos.filter((x) => x.obrigatorio && !x.gerado_pelo_sistema)
        .length,
      tem: d.documentos_resumo.tem,
      faltam: d.documentos_resumo.faltam,
    });

    // 3. Termo de responsabilidade (o mais recente que não foi rejeitado).
    const termos = docs.filter((x) => TERMO.test(nomeDoc(x)));
    const termo =
      [...termos]
        .reverse()
        .find(
          (x) =>
            !['documento_errado', 'ilegivel'].includes(x.verificacao_estado),
        ) ??
      termos[termos.length - 1] ??
      null;
    const vTermo = verificarTermo({
      documento: termo
        ? {
            id: termo.id,
            nome: nomeDoc(termo),
            verificacao_estado: termo.verificacao_estado,
            verificacao: termo.verificacao,
            emitido_em: termo.emitido_em,
            recebido_em: termo.recebido_em,
          }
        : null,
      validade_meses: termo ? validadeMeses(termo.regras_tipo) : null,
      hoje: hojeLisboa(),
      assinado_ia: leitura.termo_assinado,
    });

    // 4. Ordem (simulada nesta versão).
    const resultadoOrdem = leitura.tecnico?.numero_inscricao
      ? await this.ordem.consultar(leitura.tecnico)
      : null;
    const vOrdem = verificarOrdem(
      leitura.tecnico,
      resultadoOrdem,
      leitura.tecnico_evidencias,
      origemLeitura === 'sem' && !leitura.tecnico
        ? 'O nome e o n.º de inscrição do técnico saem da leitura do projeto pela IA, que não foi feita.'
        : undefined,
    );

    // 1. PDM no local (o mesmo motor do o_que_posso_fazer).
    const zonas = await this.zonasComParametros(municipio.id);
    let ponto: Ponto | null =
      d.lat !== null && d.lng !== null ? [d.lat, d.lng] : null;
    let semPonto: string | undefined;
    if (!ponto && zonas.length) {
      if (!d.morada) {
        semPonto = 'O processo não tem morada nem coordenadas.';
      } else {
        const c = await this.geo
          .geocodificar(d.morada, municipio.nome)
          .catch(() => null);
        if (c) ponto = [c.lat, c.lng];
        else
          semPonto = `O processo não tem coordenadas e a morada "${d.morada}" não foi encontrada no mapa.`;
      }
    }
    const obra = perfil
      ? DEFINICOES[perfil].obra
      : obraDoProcesso(`${d.tipo.nome}. ${d.assunto}. ${descricao}`);
    const pdm = verificarPdm({
      ponto,
      sem_ponto: semPonto,
      zonas,
      obra,
      tipo: { codigo: d.tipo.codigo, nome: d.tipo.nome },
      medidas: medidasParaPdm(perfil, declarados),
    });
    if (perfil && !obra) {
      // O motor de degraus não tem esta operação: dizem-no os parâmetros.
      pdm.notas = pdm.notas.filter(
        (n) => !/^Não se percebeu o tipo de obra/.test(n),
      );
      pdm.notas.push(
        `Para ${DEFINICOES[perfil].nome.toLowerCase()} contam os parâmetros da zona (abaixo).`,
      );
    }

    // O que o tipo de operação acrescenta (documentos, números, elementos).
    const extra = perfil
      ? verificacoesDoPerfil({
          perfil,
          ponto,
          zonas,
          documentos: docs.map((x) => ({ id: x.id, nome: nomeDoc(x) })),
          declarados,
          leitura,
        })
      : null;

    const resultado = juntarVerificacoes({
      leitura,
      instrucao,
      termo: vTermo,
      ordem: vOrdem,
      pdm,
      documentos_perfil: extra?.documentos,
      pdm_perfil: extra?.pdm,
      desenhos_perfil: extra?.desenhos,
    });

    const [l] = await this.db.query<{ id: string; gerado_em: Date }>(
      `INSERT INTO processo_verificacoes (municipio_id, processo_id, versao_motor, documentos_hash,
         regras_hash, resultado, leitura_ia, leitura_ia_em, perfil, gerado_por)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id, gerado_em`,
      [
        municipio.id,
        id,
        VERSAO_VERIFICACOES,
        h.documentos,
        h.regras,
        JSON.stringify(resultado),
        leituraIa === null ? null : JSON.stringify(leituraIa),
        leituraIaEm,
        JSON.stringify(escolha),
        u.id,
      ],
    );
    await this.auditoria.registar({
      municipioId: municipio.id,
      atorTipo: 'utilizador',
      atorId: u.id,
      acao: 'verificar',
      objetoTipo: 'processo',
      objetoId: id,
      dados: {
        verificacoes_id: l.id,
        contagem: contagem(resultado),
        leitura_ia: origemLeitura,
        perfil: escolha.perfil,
        perfil_escolhido_por: escolha.escolhido_por,
        documentos_hash: h.documentos,
        regras_hash: h.regras,
        versao_motor: VERSAO_VERIFICACOES,
      },
    });
    return this.mostrar(
      id,
      {
        id: l.id,
        versao_motor: VERSAO_VERIFICACOES,
        documentos_hash: h.documentos,
        regras_hash: h.regras,
        resultado,
        leitura_ia: leituraIa,
        leitura_ia_em: leituraIaEm,
        perfil: escolha,
        gerado_por: u.id,
        gerado_por_nome: u.nome,
        gerado_em: l.gerado_em,
      },
      false,
      true,
    );
  }

  /** As zonas do PDM com os parâmetros urbanísticos (`zonas_pdm.parametros`). */
  private async zonasComParametros(municipioId: string) {
    const [zonas, parametros] = await Promise.all([
      this.ordenamento.zonas(municipioId),
      this.db.query<{ id: string; parametros: unknown }>(
        'SELECT id, parametros FROM zonas_pdm WHERE municipio_id = $1',
        [municipioId],
      ),
    ]);
    const porId = new Map(parametros.map((x) => [x.id, x.parametros]));
    return zonas.map((z) => ({ ...z, parametros: porId.get(z.id) ?? null }));
  }

  /**
   * Os documentos que vão à IA: as peças do projeto (pelo nome) e os
   * documentos sem tipo, mais o termo (para o técnico autor). PDF ou imagem.
   */
  private documentosParaLer(docs: DocumentoDoProcesso[]) {
    const projeto = docs.filter(
      (x) =>
        eMimeVisao(x.mime) &&
        !TERMO.test(nomeDoc(x)) &&
        (PROJETO.test(nomeDoc(x)) || (!x.tipo_documento_id && !x.descricao)),
    );
    if (!projeto.length) return [];
    const termos = docs.filter(
      (x) => eMimeVisao(x.mime) && TERMO.test(nomeDoc(x)),
    );
    return [...projeto, ...termos.slice(-1)].slice(0, MAX_FICHEIROS_IA);
  }

  private async lerProjeto(
    d: { tipo: { nome: string }; assunto: string },
    descricao: string,
    lidos: DocumentoDoProcesso[],
    perfil: Perfil | null,
  ): Promise<{ leitura: ResultadoLeitura; bruto: unknown }> {
    const sem = (motivo: string) => ({
      leitura: {
        antes: [],
        depois: [leituraNaoVerificavel(motivo)],
        tecnico: null,
        tecnico_evidencias: [],
        termo_assinado: null,
      },
      bruto: null,
    });
    if (!lidos.length) {
      return sem('Não há projeto (PDF ou imagens) entregue no processo.');
    }
    if (!this.claude.disponivel) {
      return sem(
        'A IA não está configurada nesta instalação: a leitura do projeto fica por fazer.',
      );
    }
    // Abrir os ficheiros e ver o que são (páginas, texto ou só imagem).
    const candidatos: FicheiroCandidato<{
      doc: DocumentoDoProcesso;
      ficheiro: Buffer;
    }>[] = [];
    const falhas: string[] = [];
    for (const x of lidos) {
      let ficheiro: Buffer | null = null;
      try {
        ficheiro = x.ficheiro_key.startsWith(PREFIXO_DEMONSTRACAO)
          ? await ficheiroDemonstracao(x.ficheiro_key)
          : this.armazenamento.disponivel
            ? await this.armazenamento.ler(x.ficheiro_key)
            : null;
      } catch (e) {
        this.logger.warn(
          `Não foi possível ler o documento ${x.id}: ${(e as Error).message}`,
        );
      }
      if (!ficheiro) {
        falhas.push(nomeDoc(x));
        continue;
      }
      candidatos.push({
        item: { doc: x, ficheiro },
        nome: nomeDoc(x),
        mime: x.mime,
        tamanho: ficheiro.length,
        analise: x.mime === 'application/pdf' ? analisarPdf(ficheiro) : null,
      });
    }
    // Sem passar os limites de páginas e de bytes de um pedido (o resto fica por ler, dito).
    const selecao = selecionarParaLeitura(candidatos);
    falhas.push(...selecao.por_ler);
    const usados = selecao.usados.map((u) => ({
      ...u.item,
      paginas: u.paginas,
      digitalizado: u.digitalizado,
    }));
    if (!usados.length) {
      return sem(
        selecao.por_ler.length
          ? `A IA não pode ler os ficheiros do projeto: ${selecao.por_ler.join('; ')}.`
          : this.armazenamento.disponivel
            ? 'Não foi possível abrir os ficheiros do projeto.'
            : 'Sem armazenamento configurado: não há como abrir os ficheiros do projeto.',
      );
    }
    const docsLidos: DocumentoLido[] = usados.map((u) => ({
      ...paraLido(u.doc),
      paginas: u.paginas,
      digitalizado: u.digitalizado,
    }));
    try {
      const bruto = await this.claude.extrair(
        esquemaLeituraProjeto,
        pedidoLeituraProjeto({
          tipo: d.tipo.nome,
          assunto: d.assunto,
          descricao,
          ficheiros: usados.map((u) => ({
            nome: nomeDoc(u.doc),
            ficheiro: u.ficheiro,
            mime: u.doc.mime as MimeVisao,
            paginas: u.paginas,
            digitalizado: u.digitalizado,
          })),
          perfil: perfil ? pedidoDoPerfil(perfil) : null,
          por_ler: falhas,
        }),
      );
      const leitura = interpretarLeitura(
        bruto,
        docsLidos,
        opcoesLeitura(perfil),
      );
      if (falhas.length) {
        leitura.depois.push({
          ...leituraNaoVerificavel(`Ficaram por ler: ${falhas.join(', ')}.`),
          codigo: 'ia_por_ler',
          titulo: 'Documentos que a IA não leu',
        });
      }
      // Só se guarda o que passou na validação (para reaproveitar), com os
      // documentos pela ordem em que foram (as referências são por número).
      const valida = esquemaLeituraProjeto.safeParse(bruto).success;
      const guardar: LeituraGuardada = {
        documentos: docsLidos,
        resposta: bruto,
        perfil,
      };
      return { leitura, bruto: valida ? guardar : null };
    } catch (e) {
      if (e instanceof ErroApi) {
        const motivo: Record<string, string> = {
          ia_indisponivel:
            'A IA está indisponível agora: tente gerar outra vez daqui a pouco.',
          ia_resposta_invalida:
            'A resposta da IA não veio no formato pedido: tente gerar outra vez.',
          ia_resposta_cortada:
            'A resposta da IA veio cortada: tente gerar outra vez.',
          ia_recusou: 'A IA recusou ler estes documentos.',
          ia_erro:
            'O pedido à IA falhou (os ficheiros podem ser grandes ou estar danificados): tente outra vez ou confirme os documentos.',
        };
        return sem(motivo[e.codigo] ?? 'A leitura do projeto pela IA falhou.');
      }
      throw e;
    }
  }

  /** O ficheiro de um documento do processo (para abrir na folha certa). */
  async ficheiro(
    municipio: Municipio,
    processoId: string,
    documentoId: string,
  ) {
    await this.painel.carregar(municipio.id, processoId);
    const [doc] = await this.db.query<{
      ficheiro_key: string;
      mime: string;
      tipo_nome: string | null;
      descricao: string | null;
    }>(
      `SELECT d.ficheiro_key, d.mime, td.nome AS tipo_nome, d.descricao
       FROM documentos d LEFT JOIN tipo_processo_documentos td ON td.id = d.tipo_documento_id
       WHERE d.id = $1 AND d.processo_id = $2 AND d.municipio_id = $3`,
      [documentoId, processoId, municipio.id],
    );
    if (!doc) {
      throw new ErroApi(
        HttpStatus.NOT_FOUND,
        'nao_encontrado',
        'Documento não existe.',
      );
    }
    const conteudo = doc.ficheiro_key.startsWith(PREFIXO_DEMONSTRACAO)
      ? await ficheiroDemonstracao(doc.ficheiro_key)
      : await this.armazenamento.ler(doc.ficheiro_key);
    if (!conteudo) {
      throw new ErroApi(
        HttpStatus.NOT_FOUND,
        'nao_encontrado',
        'Ficheiro de demonstração desconhecido.',
      );
    }
    return { conteudo, mime: doc.mime, nome: nomeDoc(doc) };
  }
}

function paraLido(x: DocumentoDoProcesso): DocumentoLido {
  return { id: x.id, nome: nomeDoc(x) };
}
