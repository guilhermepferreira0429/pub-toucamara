import { HttpStatus, Injectable, Logger, Type } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ModuleRef } from '@nestjs/core';
import { somarDiasUteis } from '../../common/dias-uteis.js';
import { ErroApi } from '../../common/erros.js';
import { proximoNumero } from '../../common/numeracao.js';
import type { UtilizadorPainel } from '../../common/pedido.js';
import { DatabaseService, Tx } from '../../database/database.service.js';
import type { ContextoFerramenta } from '../../ferramentas/ferramenta.js';
import { RegistoFerramentas } from '../../ferramentas/registo-ferramentas.service.js';
import { JobsService } from '../../jobs/jobs.service.js';
import {
  AgoraPublicacoesService,
  esquemaComunicado,
  esquemaEvento,
} from '../agora/agora.publicacoes.js';
import { PassagensService } from '../atendimento/passagens.service.js';
import {
  AntecipacoesDemoService,
  PROCESSOS_ANTECIPACAO,
} from '../antecipacoes/antecipacoes.demo.js';
import { ArmazenamentoService } from '../armazenamento/armazenamento.service.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { CampanhasService } from '../campanhas/campanhas.service.js';
import { CartasService } from '../cartas/cartas.service.js';
import {
  AvisosZonaService,
  esquemaNovoAviso,
} from '../avisos-zona/avisos-zona.service.js';
import { MensagensService } from '../comunicacao/mensagens.service.js';
import { PainelConhecimentoService } from '../conhecimento/painel-conhecimento.service.js';
import {
  ConsultasPublicasService,
  esquemaConsulta,
} from '../consultas-publicas/consultas-publicas.service.js';
import { LicencasService } from '../licencas/licencas.service.js';
import { GlossarioService } from '../linguagem-simples/glossario.service.js';
import { LinguagemSimplesService } from '../linguagem-simples/linguagem-simples.service.js';
import { seccoesDoOriginal } from '../linguagem-simples/regras.js';
import { Agenda, MarcacoesService } from '../marcacoes/marcacoes.service.js';
import {
  diaDaSemana,
  diaLocal,
  diasSeguintes,
  gerarSlots,
  horaLocal,
  instanteLocal,
} from '../marcacoes/vagas.js';
import { EstacionamentoService } from '../estacionamento/estacionamento.service.js';
import { ReservasService } from '../reservas/reservas.service.js';
import { MunicipesService } from '../municipes/municipes.service.js';
import {
  Municipio,
  MunicipiosService,
} from '../municipios/municipios.service.js';
import { OcorrenciasService } from '../ocorrencias/ocorrencias.service.js';
import { OrdenamentoService } from '../ordenamento/ordenamento.service.js';
import { PagamentosService } from '../pagamentos/pagamentos.service.js';
import { ProcessosDemonstracaoService } from '../processos/processos-demonstracao.service.js';
import { TurismoService } from '../turismo/turismo.service.js';
import { CemiteriosService } from '../cemiterios/cemiterios.service.js';
import { AnimaisService } from '../animais/animais.service.js';
import { AguaService } from '../agua/agua.service.js';
import { EscolasService } from '../escolas/escolas.service.js';
import { HabitacaoService } from '../habitacao/habitacao.service.js';
import { JuntasDemoService } from '../juntas/juntas.demo.js';
import { PROCESSOS_PERFIS } from '../processos/projetos-perfis-pdf.js';
import {
  CONVERSAS,
  ConversaDemo,
  DESTINATARIOS_AVISOS,
  MARCACOES_HOJE,
  PESSOAS,
  PONTOS,
  PROCESSOS,
  ProcessoDemo,
  REGULAMENTO,
  TEMAS,
  TEMAS_EQUIVALENTES,
  Tema,
} from './demo.conteudo.js';
import {
  demoAtiva,
  diaDemo,
  instanteConversaDemo,
  instanteDemo,
  nifDemo,
  proximoDiaSemana,
  telefoneDemo,
} from './demo.regras.js';
import { ImagemDemo, pngDemonstracao } from './imagens-demo.js';
import { CONVERSAS_CONCELHO, criarConversaConcelho } from './concelho-demo.js';
import { DemoAcertosService } from './demo-acertos.service.js';
import {
  ContextoDemo,
  DemoConhecimentoService,
} from './demo-conhecimento.service.js';
import { FONTES_DEMO, RESPOSTAS_DEMO } from './demo.conhecimento.js';
import { CAMPANHA_CALOR, CUIDADO, MAIS_OCORRENCIAS } from './demo.volume.js';

export interface OpcoesPreparar {
  limpar_testes?: boolean;
  confirmar?: boolean;
  /**
   * Acertar também os dados de base com nomes de teste (a entidade "Águas
   * do Concelho" passa a Vimágua, a chefia "Chefe Teste" ganha um nome).
   * Por omissão sim; os testes automáticos, que contam com o seed, não.
   */
  acertar_base?: boolean;
  /**
   * Mexer no conhecimento: fontes e regulamento de demonstração, respostas,
   * alteração, contradição, emails e os testes de qualidade de
   * demonstração. Por omissão só numa câmara sem fontes próprias: numa
   * câmara real (com as suas fontes e avaliações medidas) a demo junta o
   * resto (pessoas, pedidos, ocorrências, contactos…) sem lhes tocar.
   */
  conhecimento?: boolean;
}

/** Os passos que mexem em fontes, respostas ou avaliações. */
const PASSOS_CONHECIMENTO = new Set([
  'conhecimento',
  'linguagem_simples',
  'qualidade',
]);

interface Passo {
  passo: string;
  rotulo: string;
  chaves: string[];
}

/** Os passos da preparação e as chaves fixas do que cada um cria. */
export function passosDemo(): Passo[] {
  const passadas = CONVERSAS.filter(
    (c) => c.resultado === 'passada_funcionario',
  );
  return [
    {
      passo: 'pessoas',
      rotulo: 'Munícipes fictícios (telefones de teste)',
      chaves: PESSOAS.map((p) => `municipe:${p.chave}`),
    },
    {
      passo: 'conversas',
      rotulo: 'Conversas por voz, chat, SMS e WhatsApp (últimos 30 dias)',
      chaves: CONVERSAS.map((c) => `conversa:${c.chave}`),
    },
    {
      passo: 'concelho',
      rotulo:
        'Conversas por freguesia para o "Pergunte ao concelho" (obra em Azurém)',
      chaves: CONVERSAS_CONCELHO.map((c) => `conversa:${c.chave}`),
    },
    {
      passo: 'passagens',
      rotulo: 'Passagens a funcionário (2 em aberto)',
      chaves: passadas.map((c) => `passagem:${c.chave}`),
    },
    {
      passo: 'zonas_pdm',
      rotulo: 'Zonas do PDM de demonstração',
      chaves: ['zonas_pdm'],
    },
    {
      passo: 'processo_apoio',
      rotulo:
        'Processo CP "Porta na cozinha" e a análise por tipo de operação (ampliação, piscina, muro)',
      chaves: [
        'processo:porta_cozinha',
        ...PROCESSOS_PERFIS.map((p) => `processo:analise_${p.chave}`),
      ],
    },
    {
      passo: 'cartas',
      rotulo:
        'Carta "Não percebi": audiência prévia do processo "Porta na cozinha", lida e explicada',
      chaves: ['carta:audiencia_previa'],
    },
    {
      passo: 'processos',
      rotulo:
        'Processos noutras fases (documento em falta, prazo a acabar, decidido)',
      chaves: [
        ...PROCESSOS.map((p) => `processo:${p.chave}`),
        'pagamento:marquise',
        'consultas:processo',
      ],
    },
    {
      passo: 'ocorrencias',
      rotulo:
        'Ocorrências com fotografia (um buraco reportado 3 vezes) e mais avisos pelas freguesias',
      chaves: [
        'ocorrencia:buraco_1',
        'ocorrencia:buraco_2',
        'ocorrencia:buraco_3',
        'ocorrencia:candeeiro',
        'ocorrencia:contentor',
        ...MAIS_OCORRENCIAS.map((o) => `ocorrencia:${o.chave}`),
      ],
    },
    {
      passo: 'acao_social',
      rotulo:
        'Ação social: pessoas inscritas (com consentimento) e uma campanha de onda de calor já feita',
      chaves: [...CUIDADO.map((p) => `cuidado:${p.chave}`), 'campanha:calor'],
    },
    {
      passo: 'licencas',
      rotulo:
        'Licenças (emitida sozinha, fora das regras, esplanada a expirar)',
      chaves: [
        'licenca:ruido_emitida',
        'licenca:ruido_tecnico',
        'licenca:esplanada',
      ],
    },
    {
      passo: 'agora',
      rotulo:
        'O que se passa perto de mim: obras, corte de água, eventos, comunicados, consulta',
      chaves: [
        'aviso:obras',
        'aviso:agua',
        'evento:feira',
        'evento:concerto',
        'evento:visita',
        'evento:mercado',
        'comunicado:balcao',
        'comunicado:monos',
        'consulta:toural',
        'aviso:destinatarios',
      ],
    },
    {
      passo: 'linguagem_simples',
      rotulo:
        'Regulamento com versão em linguagem simples publicada + glossário',
      chaves: [
        'fonte:regulamento_esplanadas',
        'documento_simples:esplanadas',
        'glossario',
      ],
    },
    {
      passo: 'conhecimento',
      rotulo:
        'Conhecimento: fontes por tema, respostas no ar, conversas com a fonte citada, a alteração das esplanadas (3 € → 3,50 €) por rever, uma contradição e emails triados',
      chaves: [
        ...FONTES_DEMO.map((f) => `fonte:${f.chave}`),
        ...RESPOSTAS_DEMO.map((r) => `resposta:${r.chave}`),
        'pergunta_sem_resposta:piscina',
        'alteracao:esplanadas',
        'ingestao:noite',
        'contradicao:esplanadas',
        'emails:demo',
      ],
    },
    {
      passo: 'satisfacao',
      rotulo:
        'Satisfação: notas de 1 a 5 dadas no link do resumo, em parte das conversas resolvidas',
      chaves: ['satisfacao'],
    },
    {
      passo: 'qualidade',
      rotulo:
        'Teste de qualidade com resultados de demonstração (três execuções, a última acima dos 80%)',
      chaves: ['avaliacao:execucoes'],
    },
    {
      passo: 'antecipacoes',
      rotulo:
        'Antecipações: pedido a acabar, prazo da câmara a acabar, obra perto de caducar',
      chaves: PROCESSOS_ANTECIPACAO.map((p) => p.chave),
    },
    {
      passo: 'turismo',
      rotulo: 'Fontes de turismo em PT/EN/ES/FR (página /visitar)',
      chaves: ['turismo'],
    },
    {
      passo: 'cemiterios',
      rotulo:
        'Cemitérios: sepulturas, concessões (uma a terminar, taxas por pagar) e pedidos',
      chaves: ['cemiterios'],
    },
    {
      passo: 'animais',
      rotulo:
        'Canil: animais para adoção (/adotar), um pedido de visita, um gato perdido e um encontrado',
      chaves: ['animais'],
    },
    {
      passo: 'agua',
      rotulo:
        'Água (Vimágua): leitura, rotura e fatura encaminhadas pelo adaptador simulado',
      chaves: ['agua'],
    },
    {
      passo: 'escolas',
      rotulo:
        'Escolas: alunos com cantina, transporte por decidir, atividades e pré-escolar',
      chaves: ['escolas'],
    },
    {
      passo: 'habitacao',
      rotulo:
        'Habitação municipal: fogos, inquilinos, reparações e candidaturas pontuadas',
      chaves: ['habitacao'],
    },
    {
      passo: 'junta',
      rotulo:
        'Junta de Freguesia de Azurém (demonstração): agente, utilizadores do painel, conhecimento e atestados por emitir',
      chaves: ['junta'],
    },
    {
      passo: 'estacionamento',
      rotulo:
        'Estacionamento: parques e zona tarifada, multas, uma defesa por analisar e um pedido de lugar reservado',
      chaves: [
        'estacionamento',
        'estacionamento:defesa',
        'estacionamento:lugar',
      ],
    },
    {
      passo: 'reservas',
      rotulo:
        'Reservas: pavilhão, piscina, auditório, sala e campo, eventos com bilhete e reservas por aprovar e por pagar',
      chaves: ['reservas', 'reserva:auditorio', 'reserva:pavilhao'],
    },
    {
      passo: 'balcao',
      rotulo:
        'Marcações no balcão (as de hoje e as próximas) e uma reclamação no prazo',
      chaves: [
        'marcacao:marcacao_1',
        'marcacao:marcacao_2',
        // As de hoje (MARCACOES_HOJE) dependem do dia: sem horário hoje
        // (fim de semana, feriado) não há; por isso não entram no plano.
        'reclamacao:luisa',
      ],
    },
  ];
}

/**
 * Nome do método que o apoio ao técnico pode ter para juntar ao processo
 * "Porta na cozinha" mais elementos de demonstração (além do que o
 * `ProcessosDemonstracaoService.carregar` já cria: projeto PDF, termo e
 * certidão). Assinatura: `(m: Municipio, u: UtilizadorPainel, processoId: string)`.
 */
export const METODO_EXTRA_PROJETO_DEMO = 'prepararExtrasDemonstracao';

/**
 * "Preparar demo": a câmara de demonstração com dados coerentes e datas
 * relativas a hoje. Idempotente: cada objeto tem uma chave fixa em
 * `demo_registos` e o que já tem chave não se cria outra vez. Usa os
 * serviços reais (ferramentas do agente, comunicados, eventos, avisos,
 * consultas, linguagem simples...) e só escreve SQL onde não há serviço
 * (conversas antigas com transcrição, processos noutras fases).
 *
 * "Limpar testes" esconde (não apaga) o que a equipa criou nos testes.
 * Sem `confirmar: true` tudo é ensaio: diz o que faria e não muda nada.
 */
@Injectable()
export class DemoService {
  private readonly logger = new Logger(DemoService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly ref: ModuleRef,
    private readonly config: ConfigService,
    private readonly auditoria: AuditoriaService,
    private readonly municipios: MunicipiosService,
    private readonly municipes: MunicipesService,
    private readonly jobs: JobsService,
    private readonly conhecimentoDemo: DemoConhecimentoService,
    private readonly acertos: DemoAcertosService,
  ) {}

  private svc<T>(tipo: Type<T>): T {
    return this.ref.get(tipo, { strict: false });
  }

  // -------------------------------------------------------------------
  // Ligada / desligada
  // -------------------------------------------------------------------

  ativa(): boolean {
    return demoAtiva(
      this.config.get<string>('app.ambiente') ?? 'development',
      process.env.DEMO_ATIVA,
    );
  }

  private exigirAtiva() {
    if (!this.ativa()) {
      throw new ErroApi(
        HttpStatus.NOT_FOUND,
        'demo_desligada',
        'A preparação da demonstração está desligada neste servidor (DEMO_ATIVA).',
      );
    }
  }

  // -------------------------------------------------------------------
  // Registos (o que a demonstração criou)
  // -------------------------------------------------------------------

  private async registado(
    municipioId: string,
    chave: string,
  ): Promise<string | null> {
    const [r] = await this.db.query<{ objeto_id: string }>(
      'SELECT objeto_id FROM demo_registos WHERE municipio_id = $1 AND chave = $2',
      [municipioId, chave],
    );
    return r?.objeto_id ?? null;
  }

  private async registar(
    municipioId: string,
    chave: string,
    tipo: string,
    objetoId: string,
    tx?: Tx,
  ) {
    await (tx ?? this.db).query(
      `INSERT INTO demo_registos (municipio_id, chave, tipo, objeto_id)
       VALUES ($1, $2, $3, $4) ON CONFLICT (municipio_id, chave) DO NOTHING`,
      [municipioId, chave, tipo, objetoId],
    );
  }

  /** Cria só se a chave ainda não existe; devolve o id (novo ou antigo). */
  private async umaVez(
    m: Municipio,
    chave: string,
    tipo: string,
    criar: () => Promise<string | null>,
  ): Promise<string | null> {
    const ja = await this.registado(m.id, chave);
    if (ja) return ja;
    const id = await criar();
    if (id) await this.registar(m.id, chave, tipo, id);
    return id;
  }

  // -------------------------------------------------------------------
  // Plano (o ensaio) e estado
  // -------------------------------------------------------------------

  /** A câmara já tem fontes que não foram criadas pela demonstração? */
  private async temConhecimentoReal(m: Municipio): Promise<boolean> {
    const [r] = await this.db.query<{ tem: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM fontes f
         WHERE f.municipio_id = $1
           AND NOT EXISTS (SELECT 1 FROM demo_registos d
                           WHERE d.municipio_id = f.municipio_id AND d.tipo = 'fonte'
                             AND d.objeto_id = f.id)) AS tem`,
      [m.id],
    );
    return !!r?.tem;
  }

  private async plano(m: Municipio, limpar: boolean, conhecimento = true) {
    const existentes = new Set(
      (
        await this.db.query<{ chave: string }>(
          'SELECT chave FROM demo_registos WHERE municipio_id = $1',
          [m.id],
        )
      ).map((r) => r.chave),
    );
    const passos = passosDemo().map((p) => {
      const ja = p.chaves.filter((c) => existentes.has(c)).length;
      const salta = !conhecimento && PASSOS_CONHECIMENTO.has(p.passo);
      return {
        passo: p.passo,
        rotulo: p.rotulo,
        total: p.chaves.length,
        ja_existem: ja,
        a_criar: salta ? 0 : p.chaves.length - ja,
        ...(salta ? { salta: true } : {}),
      };
    });
    return {
      passos,
      a_criar: passos.reduce((s, p) => s + p.a_criar, 0),
      ja_existem: passos.reduce((s, p) => s + p.ja_existem, 0),
      ocultar: limpar ? await this.contarTestes(m) : null,
    };
  }

  /** O que "limpar testes" esconderia: tudo o que não é demo, até agora. */
  private async contarTestes(m: Municipio) {
    const [r] = await this.db.query<{
      conversas: number;
      passagens: number;
      ocorrencias: number;
    }>(
      `SELECT
         (SELECT count(*)::int FROM conversas c
          WHERE c.municipio_id = $1 AND c.oculto_em IS NULL AND c.iniciada_em < now()
            AND NOT EXISTS (SELECT 1 FROM demo_registos d
                            WHERE d.municipio_id = $1 AND d.objeto_id = c.id)) AS conversas,
         (SELECT count(*)::int FROM passagens_humano p JOIN conversas c ON c.id = p.conversa_id
          WHERE c.municipio_id = $1 AND c.oculto_em IS NULL AND c.iniciada_em < now()
            AND NOT EXISTS (SELECT 1 FROM demo_registos d
                            WHERE d.municipio_id = $1 AND d.objeto_id = c.id)) AS passagens,
         (SELECT count(*)::int FROM ocorrencias o
          WHERE o.municipio_id = $1 AND o.oculto_em IS NULL AND o.criada_em < now()
            AND NOT EXISTS (SELECT 1 FROM demo_registos d
                            WHERE d.municipio_id = $1 AND d.objeto_id = o.id)) AS ocorrencias`,
      [m.id],
    );
    return r;
  }

  async estado(m: Municipio) {
    if (!this.ativa()) {
      return {
        ativa: false,
        motivo:
          'Desligada neste servidor. Para ligar em produção: DEMO_ATIVA=true.',
      };
    }
    const [prep] = await this.db.query<{
      preparada_em: Date;
      vezes: number;
      resumo: unknown;
      preparada_por_nome: string | null;
    }>(
      `SELECT p.preparada_em, p.vezes, p.resumo, u.nome AS preparada_por_nome
       FROM demo_preparacoes p LEFT JOIN utilizadores u ON u.id = p.preparada_por
       WHERE p.municipio_id = $1`,
      [m.id],
    );
    const porTipo = await this.db.query<{ tipo: string; n: number }>(
      `SELECT tipo, count(*)::int AS n FROM demo_registos
       WHERE municipio_id = $1 GROUP BY tipo ORDER BY tipo`,
      [m.id],
    );
    const [ocultos] = await this.db.query<{
      conversas: number;
      ocorrencias: number;
    }>(
      `SELECT (SELECT count(*)::int FROM conversas WHERE municipio_id = $1 AND oculto_em IS NOT NULL) AS conversas,
              (SELECT count(*)::int FROM ocorrencias WHERE municipio_id = $1 AND oculto_em IS NOT NULL) AS ocorrencias`,
      [m.id],
    );
    const plano = await this.plano(m, false);
    return {
      ativa: true,
      municipio: { slug: m.slug, nome: m.nome },
      preparada: !!prep,
      preparada_em: prep?.preparada_em ?? null,
      preparada_por: prep?.preparada_por_nome ?? null,
      vezes: prep?.vezes ?? 0,
      registos: Object.fromEntries(porTipo.map((r) => [r.tipo, r.n])),
      total_registos: porTipo.reduce((s, r) => s + r.n, 0),
      passos: plano.passos,
      ocultos,
      ultimo_resumo: prep?.resumo ?? null,
    };
  }

  // -------------------------------------------------------------------
  // Ocultar / repor
  // -------------------------------------------------------------------

  private async ocultarTestes(m: Municipio, u: UtilizadorPainel | null) {
    return this.db.transaction(async (tx) => {
      const conversas = await tx.query<{ id: string }>(
        `UPDATE conversas c SET oculto_em = now()
         WHERE c.municipio_id = $1 AND c.oculto_em IS NULL AND c.iniciada_em < now()
           AND NOT EXISTS (SELECT 1 FROM demo_registos d
                           WHERE d.municipio_id = $1 AND d.objeto_id = c.id)
         RETURNING c.id`,
        [m.id],
      );
      const [{ n: passagens }] = await tx.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM passagens_humano WHERE conversa_id = ANY($1::uuid[])`,
        [conversas.map((c) => c.id)],
      );
      const ocorrencias = await tx.query<{ id: string }>(
        `UPDATE ocorrencias o SET oculto_em = now()
         WHERE o.municipio_id = $1 AND o.oculto_em IS NULL AND o.criada_em < now()
           AND NOT EXISTS (SELECT 1 FROM demo_registos d
                           WHERE d.municipio_id = $1 AND d.objeto_id = o.id)
         RETURNING o.id`,
        [m.id],
      );
      const r = {
        conversas: conversas.length,
        passagens,
        ocorrencias: ocorrencias.length,
      };
      await this.auditoria.registar(
        {
          municipioId: m.id,
          atorTipo: u ? 'utilizador' : 'sistema',
          atorId: u?.id ?? null,
          acao: 'ocultar_testes',
          objetoTipo: 'demo',
          objetoId: m.id,
          dados: r,
        },
        tx,
      );
      return r;
    });
  }

  async reporOcultos(m: Municipio, u: UtilizadorPainel | null) {
    this.exigirAtiva();
    const r = await this.db.transaction(async (tx) => {
      const conversas = await tx.query(
        `UPDATE conversas SET oculto_em = NULL
         WHERE municipio_id = $1 AND oculto_em IS NOT NULL RETURNING id`,
        [m.id],
      );
      const ocorrencias = await tx.query(
        `UPDATE ocorrencias SET oculto_em = NULL
         WHERE municipio_id = $1 AND oculto_em IS NOT NULL RETURNING id`,
        [m.id],
      );
      const contas = {
        conversas: conversas.length,
        ocorrencias: ocorrencias.length,
      };
      await this.auditoria.registar(
        {
          municipioId: m.id,
          atorTipo: u ? 'utilizador' : 'sistema',
          atorId: u?.id ?? null,
          acao: 'repor_ocultos',
          objetoTipo: 'demo',
          objetoId: m.id,
          dados: contas,
        },
        tx,
      );
      return contas;
    });
    await this.refrescarVistas();
    return { repostos: r };
  }

  private async refrescarVistas() {
    // O painel corre com a role do RLS, que não é dona das vistas: o
    // refrescamento vai para a fila (o job corre fora do pedido).
    try {
      await this.jobs.enviar('refrescar_vistas', {});
    } catch (e) {
      this.logger.warn(`refrescar_vistas: ${(e as Error).message}`);
    }
  }

  // -------------------------------------------------------------------
  // Preparar
  // -------------------------------------------------------------------

  async preparar(m: Municipio, u: UtilizadorPainel, o: OpcoesPreparar = {}) {
    this.exigirAtiva();
    const limpar = !!o.limpar_testes;
    const conhecimento = o.conhecimento ?? !(await this.temConhecimentoReal(m));
    if (!o.confirmar) {
      return {
        ensaio: true,
        municipio: { slug: m.slug, nome: m.nome },
        conhecimento,
        ...(await this.plano(m, limpar, conhecimento)),
        nota: 'Ensaio: nada foi alterado. Repita com confirmar: true para executar.',
      };
    }

    const ocultados = limpar ? await this.ocultarTestes(m, u) : null;
    const avisos: string[] = [];
    const ctx = new Preparacao(m, u, new Date(), avisos);

    // Acertos das preparações antigas: antes do conhecimento (que cita as
    // conversas já com o resultado certo) e no fim (o resto).
    const acertar = async () => {
      const r = await this.acertos.acertar(m, o.acertar_base !== false);
      for (const [k, n] of Object.entries(r)) {
        if (n)
          ctx.criados[`acertos_${k}`] = (ctx.criados[`acertos_${k}`] ?? 0) + n;
      }
    };
    // Os processos antes do "Porta na cozinha": a numeração acerta-se antes
    // da carta (que leva o número do processo).
    const passos: [string, () => Promise<void>][] = [
      ['base', () => this.base(ctx)],
      ['pessoas', () => this.pessoas(ctx)],
      ['conversas', () => this.conversas(ctx)],
      ['concelho', () => this.concelho(ctx)],
      ['passagens', () => this.passagens(ctx)],
      ['zonas_pdm', () => this.zonasPdm(ctx)],
      ['processos', () => this.processos(ctx)],
      ['antecipacoes', () => this.antecipacoes(ctx)],
      ['processo_apoio', () => this.processoApoio(ctx)],
      ['numeracao', async () => void (await this.acertos.numeracao(m))],
      ['cartas', () => this.cartas(ctx)],
      ['ocorrencias', () => this.ocorrencias(ctx)],
      ['acao_social', () => this.acaoSocial(ctx)],
      ['licencas', () => this.licencas(ctx)],
      ['agora', () => this.agora(ctx)],
      ['linguagem_simples', () => this.linguagemSimples(ctx)],
      ['acertos', acertar],
      [
        'conhecimento',
        () => this.conhecimentoDemo.preparar(this.contextoDemo(ctx)),
      ],
      ['turismo', () => this.turismo(ctx)],
      ['cemiterios', () => this.servicoV4(ctx, 'cemiterios')],
      ['animais', () => this.servicoV4(ctx, 'animais')],
      ['agua', () => this.servicoV4(ctx, 'agua')],
      ['escolas', () => this.escolas(ctx)],
      ['habitacao', () => this.habitacao(ctx)],
      ['junta', () => this.junta(ctx)],
      ['balcao', () => this.balcao(ctx)],
      ['satisfacao', () => this.satisfacao(ctx)],
      ['consultas', () => this.consultasProcesso(ctx)],
      ['estacionamento', () => this.estacionamento(ctx)],
      ['reservas', () => this.reservas(ctx)],
      ['acertos', acertar],
    ];
    for (const [nome, correr] of passos) {
      // Numa câmara com fontes próprias, as fontes, as respostas e as
      // avaliações ficam como estão (a demo não as contamina).
      if (!conhecimento && PASSOS_CONHECIMENTO.has(nome)) continue;
      try {
        await correr();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        this.logger.error(`Demo · ${nome}: ${msg}`);
        avisos.push(`${nome}: ${msg}`);
      }
    }

    const estado = await this.plano(m, false, conhecimento);
    const resumo = {
      conhecimento,
      criados: ctx.criados,
      total_registos: estado.ja_existem,
      ocultados,
      avisos,
    };
    await this.db.transaction(async (tx) => {
      await tx.query(
        `INSERT INTO demo_preparacoes (municipio_id, preparada_por, resumo)
         VALUES ($1, $2, $3)
         ON CONFLICT (municipio_id) DO UPDATE SET preparada_em = now(),
           preparada_por = EXCLUDED.preparada_por, resumo = EXCLUDED.resumo,
           vezes = demo_preparacoes.vezes + 1`,
        [m.id, u.municipioId ? u.id : null, JSON.stringify(resumo)],
      );
      await this.auditoria.registar(
        {
          municipioId: m.id,
          atorTipo: 'utilizador',
          atorId: u.id,
          acao: 'preparar_demo',
          objetoTipo: 'demo',
          objetoId: m.id,
          dados: { criados: ctx.criados, ocultados, avisos: avisos.length },
        },
        tx,
      );
    });
    await this.refrescarVistas();
    return {
      ensaio: false,
      municipio: { slug: m.slug, nome: m.nome },
      ...resumo,
      passos: estado.passos,
    };
  }

  /** O que os serviços auxiliares (conhecimento) precisam da preparação. */
  private contextoDemo(c: Preparacao): ContextoDemo {
    return {
      m: c.m,
      u: c.u,
      agora: c.agora,
      avisos: c.avisos,
      temas: c.temas,
      umaVez: (chave, tipo, criar) => this.umaVez(c.m, chave, tipo, criar),
      registado: (chave) => this.registado(c.m.id, chave),
      contar: (o) => c.contar(o),
    };
  }

  // -------------------------------------------------------------------
  // Passos
  // -------------------------------------------------------------------

  /** Temas e categorias de ocorrência que faltem (por nome). */
  private async base(c: Preparacao) {
    c.funcionario =
      c.u.municipioId === c.m.id ? c.u : await this.funcionario(c.m);
    for (const [k, nome] of Object.entries(TEMAS)) {
      // Primeiro o tema real equivalente (se a câmara o tiver), depois o da demo.
      const nomes = [...TEMAS_EQUIVALENTES[k as Tema], nome];
      const [t] = await this.db.query<{ id: string }>(
        `SELECT id FROM temas WHERE municipio_id = $1 AND lower(nome) = ANY($2::text[])
         ORDER BY array_position($2::text[], lower(nome)) LIMIT 1`,
        [c.m.id, nomes.map((n) => n.toLowerCase())],
      );
      if (t) {
        c.temas.set(k as Tema, t.id);
        continue;
      }
      const [n] = await this.db.query<{ id: string }>(
        'INSERT INTO temas (municipio_id, nome) VALUES ($1, $2) RETURNING id',
        [c.m.id, nome],
      );
      await this.registar(c.m.id, `tema:${k}`, 'tema', n.id);
      c.temas.set(k as Tema, n.id);
    }
    const categorias: [string, string, string][] = [
      ['buraco', 'Buraco na via', '%buraco%'],
      ['iluminacao', 'Iluminação pública', '%ilumina%'],
      ['lixo', 'Recolha de lixo', '%lixo%'],
    ];
    for (const [k, nome, padrao] of categorias) {
      const [cat] = await this.db.query<{ nome: string }>(
        `SELECT nome FROM categorias_ocorrencia
         WHERE municipio_id = $1 AND nome ILIKE $2 ORDER BY nome LIMIT 1`,
        [c.m.id, padrao],
      );
      if (cat) {
        c.categorias.set(k, cat.nome);
        continue;
      }
      const [n] = await this.db.query<{ id: string }>(
        `INSERT INTO categorias_ocorrencia (municipio_id, nome, icone)
         VALUES ($1, $2, $3) RETURNING id`,
        [
          c.m.id,
          nome,
          k === 'buraco'
            ? 'construction'
            : k === 'iluminacao'
              ? 'lamp'
              : 'trash',
        ],
      );
      await this.registar(c.m.id, `categoria:${k}`, 'categoria', n.id);
      c.categorias.set(k, nome);
    }
  }

  /** Um funcionário ativo da câmara (chefia primeiro). */
  private async funcionario(m: Municipio): Promise<UtilizadorPainel | null> {
    const [f] = await this.db.query<{
      id: string;
      nome: string;
      email: string;
      perfil: UtilizadorPainel['perfil'];
    }>(
      `SELECT id, nome, email, perfil FROM utilizadores
       WHERE municipio_id = $1 AND ativo
         AND perfil IN ('chefe_divisao', 'tecnico', 'atendimento')
       ORDER BY (perfil <> 'chefe_divisao'), (perfil <> 'tecnico'), criado_em
       LIMIT 1`,
      [m.id],
    );
    return f ? ({ ...f, municipioId: m.id } as UtilizadorPainel) : null;
  }

  private async pessoas(c: Preparacao) {
    for (const p of PESSOAS) {
      const id = await this.umaVez(
        c.m,
        `municipe:${p.chave}`,
        'municipe',
        async () => {
          const mu = await this.municipes.porTelefone(
            c.m.id,
            telefoneDemo(p.telefone),
          );
          if (!mu) return null;
          try {
            await this.municipes.atualizar(mu.id, {
              nome: p.nome,
              ...(p.nif !== undefined ? { nif: nifDemo(p.nif) } : {}),
            });
          } catch {
            await this.municipes.atualizar(mu.id, { nome: p.nome });
          }
          c.contar('municipes');
          return mu.id;
        },
      );
      if (id)
        c.pessoas.set(p.chave, { id, telefone: telefoneDemo(p.telefone) });
    }
  }

  private async conversas(c: Preparacao) {
    let i = 0;
    for (const conv of CONVERSAS) {
      i++;
      const id = await this.umaVez(
        c.m,
        `conversa:${conv.chave}`,
        'conversa',
        () => this.criarConversa(c, conv, i),
      );
      if (id) c.conversas.set(conv.chave, id);
    }
  }

  private async criarConversa(
    c: Preparacao,
    conv: ConversaDemo,
    i: number,
  ): Promise<string> {
    const pessoa = c.pessoa(conv.pessoa);
    const inicio = instanteConversaDemo(
      c.agora,
      c.m.fuso,
      conv.dias,
      conv.hora,
    );
    const hora = Number(horaLocal(inicio, c.m.fuso).slice(0, 2));
    const semana = new Date(
      `${diaLocal(inicio, c.m.fuso)}T12:00:00Z`,
    ).getUTCDay();
    const foraDeHoras = hora < 9 || hora >= 17 || semana === 0 || semana === 6;
    const duracao =
      conv.canal === 'telefone'
        ? 50 + conv.turnos.length * 38 + (i % 5) * 13
        : null;
    const fim = new Date(inicio.getTime() + (duracao ?? 240) * 1000);
    const resumoSms = conv.resumo.split('. ')[0].slice(0, 140);
    const id = await this.db.transaction(async (tx) => {
      const [nova] = await tx.query<{ id: string }>(
        `INSERT INTO conversas (municipio_id, municipe_id, canal, provider_id, iniciada_em, terminada_em,
           duracao_s, consentimento_em, resultado, tema_id, resumo, proximos_passos, resumo_sms,
           resumida_em, fora_de_horas, agente_versao)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::resultado_conv, $10, $11, $12, $13, $6, $14, 'demonstracao')
         RETURNING id`,
        [
          c.m.id,
          pessoa.id,
          conv.canal,
          `demo-${c.m.slug}-${conv.chave}`,
          inicio,
          fim,
          duracao,
          conv.canal === 'telefone' ? inicio : null,
          conv.resultado,
          c.temas.get(conv.tema) ?? null,
          conv.resumo,
          JSON.stringify(conv.proximos ?? []),
          resumoSms,
          foraDeHoras,
        ],
      );
      let ms = 0;
      for (const [ordem, t] of conv.turnos.entries()) {
        const dur = 4000 + t.texto.length * 55;
        await tx.query(
          `INSERT INTO conversa_turnos (conversa_id, ordem, papel, texto, inicio_ms, fim_ms)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [nova.id, ordem + 1, t.papel, t.texto, ms, ms + dur],
        );
        ms += dur + 800;
      }
      return nova.id;
    });
    // O SMS do fim da conversa (não sai: os telefones são da gama de teste).
    if (conv.canal !== 'chat') {
      await this.svc(MensagensService).sms({
        municipioId: c.m.id,
        municipeId: pessoa.id,
        destino: pessoa.telefone,
        motivo: 'fim_chamada',
        corpo: `${c.m.nome}: ${resumoSms}.`,
        relacionado: { conversa_id: id },
        chave: `demo:fim:${id}`,
      });
    }
    c.contar('conversas');
    return id;
  }

  /** Conversas anónimas com freguesia (Pergunte ao concelho). */
  private async concelho(c: Preparacao) {
    let i = 0;
    for (const conv of CONVERSAS_CONCELHO) {
      i++;
      await this.umaVez(c.m, `conversa:${conv.chave}`, 'conversa', async () => {
        const id = await this.db.transaction((tx) =>
          criarConversaConcelho(
            tx,
            {
              municipioId: c.m.id,
              slug: c.m.slug,
              fuso: c.m.fuso,
              agora: c.agora,
              temaId: c.temas.get(conv.tema) ?? null,
            },
            conv,
            i,
          ),
        );
        c.contar('conversas_concelho');
        return id;
      });
    }
  }

  private async passagens(c: Preparacao) {
    const passagens = this.svc(PassagensService);
    for (const conv of CONVERSAS.filter(
      (x) => x.resultado === 'passada_funcionario',
    )) {
      await this.umaVez(c.m, `passagem:${conv.chave}`, 'passagem', async () => {
        const conversaId = c.conversa(conv.chave);
        const [cv] = await this.db.query<{ iniciada_em: Date }>(
          'SELECT iniciada_em FROM conversas WHERE id = $1',
          [conversaId],
        );
        const quando = new Date(cv.iniciada_em.getTime() + 3 * 60_000);
        const r = await passagens.criar(
          c.ctx(conv.canal, conversaId, conv.pessoa),
          {
            motivo: conv.chave === 'passagem_marquise' ? 'processo' : 'pedido',
            resumo: conv.resumo,
          },
          quando,
        );
        const emAberto = conv.dias === 0;
        await this.db.query(
          `UPDATE passagens_humano SET criada_em = $2::timestamptz,
             estado = CASE WHEN $3 THEN estado ELSE 'respondida' END,
             respondida_em = CASE WHEN $3 THEN NULL ELSE $2::timestamptz + interval '2 hours' END,
             atribuida_a = CASE WHEN $3 THEN atribuida_a ELSE $4::uuid END
           WHERE id = $1`,
          [r.passagem_id, quando, emAberto, c.funcionario?.id ?? null],
        );
        c.contar('passagens');
        return r.passagem_id;
      });
    }
  }

  private async zonasPdm(c: Preparacao) {
    await this.umaVez(c.m, 'zonas_pdm', 'zonas_pdm', async () => {
      const [{ n }] = await this.db.query<{ n: number }>(
        'SELECT count(*)::int AS n FROM zonas_pdm WHERE municipio_id = $1',
        [c.m.id],
      );
      const ord = this.svc(OrdenamentoService);
      if (!n) {
        await ord.carregarDemonstracao(c.m, c.u);
        c.contar('zonas_pdm');
      }
      try {
        await ord.carregarConsultasDemonstracao(c.m, c.u);
      } catch (e) {
        if (!(e instanceof ErroApi)) throw e; // já havia perguntas
      }
      return c.m.id;
    });
  }

  /**
   * O processo "Porta na cozinha" vem do apoio ao técnico
   * (`ProcessosDemonstracaoService`, o mesmo de POST /painel/processos/demonstracao:
   * projeto PDF de 3 folhas, termo e certidão). Aqui só se liga à conversa
   * e à requerente com telefone de teste.
   */
  private async processoApoio(c: Preparacao) {
    await this.umaVez(c.m, 'processo:porta_cozinha', 'processo', async () => {
      const r = await this.svc(ProcessosDemonstracaoService).carregar(c.m, c.u);
      await this.db.query(
        `UPDATE processos SET conversa_origem_id = coalesce(conversa_origem_id, $2),
           municipe_id = coalesce($3, municipe_id)
         WHERE id = $1`,
        [
          r.processo_id,
          c.conversas.get('porta_cozinha') ?? null,
          c.pessoas.get('sandra')?.id ?? null,
        ],
      );
      await this.prepararProjetoDemo(c, r.processo_id);
      c.contar('processos');
      return r.processo_id;
    });
    // A análise por tipo de operação: ampliação acima do índice, piscina
    // perto da extrema, muro em ordem (mesmo serviço da rota do painel).
    for (const p of PROCESSOS_PERFIS) {
      await this.umaVez(
        c.m,
        `processo:analise_${p.chave}`,
        'processo',
        async () => {
          const r = await this.svc(ProcessosDemonstracaoService).carregarPerfil(
            c.m,
            c.u,
            p.chave,
          );
          c.contar('processos'); // como o "Porta na cozinha": conta ao registar
          return r.processo_id;
        },
      );
    }
  }

  /**
   * A carta que a requerente do "Porta na cozinha" não percebeu (a
   * notificação para audiência prévia), já lida com a leitura de
   * demonstração: o prazo, o rascunho por preparar e a nota na ficha.
   */
  private async cartas(c: Preparacao) {
    const processoId = await this.registado(c.m.id, 'processo:porta_cozinha');
    if (!processoId) return;
    await this.umaVez(c.m, 'carta:audiencia_previa', 'carta', async () => {
      const id = await this.svc(CartasService).prepararDemo(c.m, processoId);
      if (id) c.contar('cartas');
      return id;
    });
  }

  /**
   * Ponto de extensão: se o apoio ao técnico tiver mais dados de
   * demonstração para este processo (método METODO_EXTRA_PROJETO_DEMO no
   * `ProcessosDemonstracaoService`), corre-os. Sem o método, nada.
   */
  private async prepararProjetoDemo(c: Preparacao, processoId: string) {
    const svc = this.svc(ProcessosDemonstracaoService) as unknown as Record<
      string,
      unknown
    >;
    const f = svc[METODO_EXTRA_PROJETO_DEMO];
    if (typeof f !== 'function') return;
    await (
      f as (m: Municipio, u: UtilizadorPainel, id: string) => Promise<unknown>
    ).call(svc, c.m, c.u, processoId);
  }

  private async processos(c: Preparacao) {
    const [tipo] = await this.db.query<{
      id: string;
      prazo_dias_uteis: number;
    }>(
      `SELECT id, prazo_dias_uteis FROM tipos_processo
       WHERE municipio_id = $1 AND codigo = 'CP' ORDER BY ativo DESC LIMIT 1`,
      [c.m.id],
    );
    if (!tipo) {
      c.avisos.push(
        'processos: falta o tipo de processo CP (comunicação prévia).',
      );
      return;
    }
    const docs = await this.db.query<{ id: string; nome: string }>(
      `SELECT id, nome FROM tipo_processo_documentos WHERE tipo_processo_id = $1 ORDER BY ordem`,
      [tipo.id],
    );
    const feriados = await this.municipios.feriados(c.m.id);
    // Pela ordem de entrada (a numeração segue as datas).
    const porEntrada = [...PROCESSOS].sort(
      (a, b) => b.entrou_ha_dias - a.entrou_ha_dias,
    );
    for (const p of porEntrada) {
      await this.umaVez(c.m, `processo:${p.chave}`, 'processo', () =>
        this.criarProcesso(c, p, tipo, docs, feriados),
      );
    }
    // A taxa da marquise, por pagar (guia com referência Multibanco de teste).
    await this.umaVez(c.m, 'pagamento:marquise', 'pagamento', async () => {
      const processoId = await this.registado(c.m.id, 'processo:marquise');
      if (!processoId) return null;
      const r = await this.svc(PagamentosService).criar(
        c.ctx('telefone', null, 'pedro'),
        { processo_id: processoId, metodo: 'multibanco' },
        {
          linhas: [
            {
              codigo: 'DEMO',
              descricao:
                'Admissão da comunicação prévia (valor de demonstração)',
              unidade: 'fixo',
              quantidade: 1,
              valor_unitario_cent: 6470,
              valor_cent: 6470,
            },
          ],
          total_cent: 6470,
        },
      );
      const [pg] = await this.db.query<{ id: string }>(
        `SELECT id FROM pagamentos WHERE processo_id = $1 ORDER BY criado_em DESC LIMIT 1`,
        [processoId],
      );
      void r;
      c.contar('pagamentos');
      return pg?.id ?? null;
    });
  }

  private async criarProcesso(
    c: Preparacao,
    p: ProcessoDemo,
    tipo: { id: string; prazo_dias_uteis: number },
    docs: { id: string; nome: string }[],
    feriados: Set<string>,
  ): Promise<string> {
    const pessoa = c.pessoa(p.pessoa);
    const entrada = instanteDemo(c.agora, c.m.fuso, p.entrou_ha_dias, '10:15');
    const diaEntrada = diaLocal(entrada, c.m.fuso);
    const hoje = diaDemo(c.agora, c.m.fuso, 0);
    const prazoFim =
      p.fase === 'documentos'
        ? null
        : p.prazo_em_dias_uteis !== undefined
          ? somarDiasUteis(hoje, p.prazo_em_dias_uteis, feriados)
          : somarDiasUteis(diaEntrada, tipo.prazo_dias_uteis, feriados);
    const decidido =
      p.decidido_ha_dias !== undefined
        ? instanteDemo(c.agora, c.m.fuso, p.decidido_ha_dias, '15:30')
        : null;
    const id = await this.db.transaction(async (tx) => {
      const ano = Number(diaEntrada.slice(0, 4));
      const n = await proximoNumero(tx, c.m.id, 'CP', ano);
      const numero = `CP ${n}/${ano}`;
      const [novo] = await tx.query<{ id: string }>(
        `INSERT INTO processos (municipio_id, numero, tipo_processo_id, municipe_id, assunto, morada,
           freguesia, fase, prazo_inicio, prazo_fim, decisao, decidido_em, criado_em, atualizado_em,
           demonstracao)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::fase_processo, $9, $10, $11, $12, $13, $13, true)
         RETURNING id`,
        [
          c.m.id,
          numero,
          tipo.id,
          pessoa.id,
          p.assunto,
          p.morada,
          p.freguesia,
          p.fase,
          p.fase === 'documentos' ? null : diaEntrada,
          prazoFim,
          decidido ? 'admitido' : null,
          decidido,
          entrada,
        ],
      );
      const entregues =
        p.entregues === 'todos' ? docs : docs.slice(0, p.entregues);
      for (const d of entregues) {
        await tx.query(
          `INSERT INTO documentos (municipio_id, processo_id, tipo_documento_id, ficheiro_key, mime,
             origem, verificacao_estado, recebido_em)
           VALUES ($1, $2, $3, $4, 'application/pdf', 'upload', 'valido', $5)`,
          [
            c.m.id,
            novo.id,
            d.id,
            `${c.m.slug}/documentos/demonstracao/${novo.id}-${d.id}.pdf`,
            entrada,
          ],
        );
      }
      const faltam = docs.slice(entregues.length).map((d) => d.nome);
      await tx.query(
        `INSERT INTO processo_eventos (processo_id, tipo, descricao, ator_tipo, ator_id, dados, em)
         VALUES ($1, 'criado', $2, 'municipe', $3, $4, $5)`,
        [
          novo.id,
          // Sem o número: a numeração da demo pode ser acertada depois.
          faltam.length
            ? `Requerimento entregue. Processo aberto, à espera de: ${faltam.join(', ')}.`
            : 'Requerimento entregue. Processo aberto.',
          pessoa.id,
          JSON.stringify({ demonstracao: true, faltam }),
          entrada,
        ],
      );
      if (p.fase !== 'documentos') {
        await tx.query(
          `INSERT INTO processo_eventos (processo_id, tipo, descricao, ator_tipo, dados, em)
           VALUES ($1, 'fase', 'Passou a apreciação técnica.', 'sistema', '{"demonstracao": true}', $2)`,
          [novo.id, new Date(entrada.getTime() + 86_400_000)],
        );
      }
      if (decidido) {
        await tx.query(
          `INSERT INTO processo_eventos (processo_id, tipo, descricao, ator_tipo, dados, em)
           VALUES ($1, 'decisao', 'Comunicação prévia admitida. Ofício enviado ao requerente.', 'sistema',
                   '{"demonstracao": true, "decisao": "admitido"}', $2)`,
          [novo.id, decidido],
        );
      }
      return novo.id;
    });
    c.contar('processos');
    return id;
  }

  /**
   * "Consultas ao estado do processo": o agente consultou o processo de
   * quem perguntou em que ponto estava (o mesmo registo que a ferramenta).
   */
  private async consultasProcesso(c: Preparacao) {
    await this.umaVez(c.m, 'consultas:processo', 'auditoria', async () => {
      const r = await this.db.query(
        `INSERT INTO audit_log (municipio_id, ator_tipo, acao, objeto_tipo, objeto_id, dados, em)
         SELECT $1, 'agente', 'consultar', 'processo', p.id::text,
                jsonb_build_object('conversa_id', cv.id, 'demonstracao', true),
                cv.iniciada_em + interval '1 minute'
         FROM demo_registos d
         JOIN conversas cv ON cv.id = d.objeto_id
         JOIN LATERAL (SELECT p.id FROM processos p
                       WHERE p.municipio_id = $1 AND p.municipe_id = cv.municipe_id
                       ORDER BY p.criado_em LIMIT 1) p ON true
         WHERE d.municipio_id = $1 AND d.tipo = 'conversa'
           AND (cv.resumo ILIKE 'Quis saber em que ponto está o seu processo%'
                OR cv.resumo ILIKE 'Recebeu a decisão%')
         RETURNING id`,
        [c.m.id],
      );
      if (r.length) c.contar('consultas_processo');
      return r.length ? c.m.id : null;
    });
  }

  /**
   * Satisfação: cerca de metade das conversas resolvidas teve resposta ao
   * "Ficou resolvido?" do link do resumo (notas de demonstração).
   */
  private async satisfacao(c: Preparacao) {
    await this.umaVez(c.m, 'satisfacao', 'satisfacao', async () => {
      const conversas = await this.db.query<{ id: string; fim: Date }>(
        `SELECT cv.id, coalesce(cv.terminada_em, cv.iniciada_em) AS fim
         FROM demo_registos d JOIN conversas cv ON cv.id = d.objeto_id
         WHERE d.municipio_id = $1 AND d.tipo = 'conversa' AND d.chave NOT LIKE 'conversa:concelho_%'
           AND cv.resultado IN ('resolvida', 'marcacao')
         ORDER BY cv.iniciada_em`,
        [c.m.id],
      );
      const notas = [5, 4, 5, 5, 3, 4, 5, 2, 5, 4];
      const comentarios: Record<number, string> = {
        2: 'Resolveu logo, nem precisei de ir à câmara.',
        7: 'Deu-me a informação certa, mas tive de ligar duas vezes.',
        4: 'Respondeu, mas tive de repetir a morada.',
      };
      let n = 0;
      for (const [i, cv] of conversas.entries()) {
        if (i % 2) continue;
        const k = n % notas.length;
        await this.db.query(
          `INSERT INTO satisfacao_respostas (municipio_id, conversa_id, nota, comentario, respondida_em)
           VALUES ($1, $2, $3, $4, $5) ON CONFLICT (conversa_id) DO NOTHING`,
          [
            c.m.id,
            cv.id,
            notas[k],
            (n < notas.length ? comentarios[k] : undefined) ?? null,
            // Depois da conversa, nunca no futuro.
            new Date(
              Math.min(
                cv.fim.getTime() + (10 + (i % 7) * 9) * 60_000,
                c.agora.getTime() - 60_000,
              ),
            ),
          ],
        );
        n++;
      }
      if (n) c.contar('satisfacao');
      return n ? c.m.id : null;
    });
  }

  /** Processos com momentos nos próximos dias (módulo antecipacoes). */
  private async antecipacoes(c: Preparacao) {
    const svc = this.svc(AntecipacoesDemoService);
    for (const p of PROCESSOS_ANTECIPACAO) {
      await this.umaVez(c.m, p.chave, 'processo', async () => {
        const id = await svc.criar(
          c.m,
          p.chave,
          c.pessoa(p.pessoa).id,
          c.agora,
        );
        if (id) c.contar('processos');
        return id;
      });
    }
  }

  private async ocorrencias(c: Preparacao) {
    const svc = this.svc(OcorrenciasService);
    const registar = async (
      chave: string,
      conversa: string,
      categoria: string,
      descricao: string,
      ponto: { lat: number; lng: number; morada: string },
      imagem: ImagemDemo | null,
      depois?: (id: string) => Promise<void>,
    ) =>
      this.umaVez(c.m, `ocorrencia:${chave}`, 'ocorrencia', async () => {
        const conv = CONVERSAS.find((x) => x.chave === conversa)!;
        const conversaId = c.conversa(conversa);
        await svc.registar(
          c.ctx(conv.canal, conversaId, conv.pessoa),
          {
            categoria: c.categorias.get(categoria) ?? categoria,
            descricao,
            morada: ponto.morada,
          },
          { coords: { lat: ponto.lat, lng: ponto.lng } },
        );
        const [o] = await this.db.query<{ id: string }>(
          `SELECT o.id FROM ocorrencias o WHERE o.conversa_id = $1 ORDER BY o.criada_em DESC LIMIT 1`,
          [conversaId],
        );
        // A hora do registo é a da conversa.
        await this.db.query(
          `UPDATE ocorrencias o SET criada_em = c.iniciada_em + interval '2 minutes'
           FROM conversas c WHERE o.id = $1 AND c.id = $2`,
          [o.id, conversaId],
        );
        if (imagem) await this.foto(c, o.id, imagem);
        if (depois) await depois(o.id);
        c.contar('ocorrencias');
        return o.id;
      });

    const s = PONTOS.santo_antonio;
    await registar(
      'buraco_1',
      'buraco_1',
      'buraco',
      'Buraco grande no meio da faixa, junto ao n.º 40. Já houve um carro a bater.',
      s,
      'buraco',
    );
    await registar(
      'buraco_2',
      'buraco_2',
      'buraco',
      'Buraco na estrada perto do n.º 40.',
      { ...s, lat: s.lat + 0.00008 },
      null,
    );
    await registar(
      'buraco_3',
      'buraco_3',
      'buraco',
      'Buraco perigoso no n.º 40.',
      { ...s, lng: s.lng + 0.0001 },
      null,
    );

    await registar(
      'candeeiro',
      'candeeiro',
      'iluminacao',
      'Candeeiro apagado há três noites, do lado da Rua Paio Galvão.',
      PONTOS.toural,
      'candeeiro',
      async (id) => {
        await svc.alterar(c.m, c.u, id, {
          estado: 'com_equipa',
          prevista_para: diaDemo(c.agora, c.m.fuso, 1),
        });
      },
    );
    await registar(
      'contentor',
      'contentor',
      'lixo',
      'Contentor do lixo com a tampa partida.',
      PONTOS.joao_i,
      'contentor',
      async (id) => {
        await svc.alterar(c.m, c.u, id, { estado: 'resolvida' });
        await this.db.query(
          `UPDATE ocorrencias SET resolvida_em = criada_em + interval '2 days 3 hours' WHERE id = $1`,
          [id],
        );
      },
    );

    // O volume: avisos pelas freguesias, sem conversa (vieram pela app ou
    // por uma chamada antiga), em vários estados.
    const horas = ['08:20', '10:45', '13:10', '17:35', '21:50'];
    for (const [i, o] of MAIS_OCORRENCIAS.entries()) {
      await this.umaVez(
        c.m,
        `ocorrencia:${o.chave}`,
        'ocorrencia',
        async () => {
          const pessoa = c.pessoa(o.pessoa);
          await svc.registar(
            c.ctx('telefone', null, o.pessoa),
            {
              categoria: c.categorias.get(o.categoria) ?? o.categoria,
              descricao: o.descricao,
              morada: o.morada,
            },
            { coords: { lat: o.lat, lng: o.lng }, semSms: true },
          );
          const [nova] = await this.db.query<{ id: string }>(
            `SELECT id FROM ocorrencias
           WHERE municipio_id = $1 AND municipe_id = $2 AND descricao = $3
           ORDER BY criada_em DESC LIMIT 1`,
            [c.m.id, pessoa.id, o.descricao],
          );
          if (!nova) return null;
          await this.db.query(
            'UPDATE ocorrencias SET criada_em = $2 WHERE id = $1',
            [
              nova.id,
              instanteDemo(c.agora, c.m.fuso, o.dias, horas[i % horas.length]),
            ],
          );
          if (o.estado === 'com_equipa') {
            await svc.alterar(c.m, c.u, nova.id, {
              estado: 'com_equipa',
              prevista_para: diaDemo(c.agora, c.m.fuso, 1 + (i % 4)),
            });
          } else if (o.estado === 'resolvida') {
            await svc.alterar(c.m, c.u, nova.id, { estado: 'resolvida' });
            await this.db.query(
              `UPDATE ocorrencias
             SET resolvida_em = least(criada_em + make_interval(days => $2, hours => 5), now() - interval '1 hour')
             WHERE id = $1`,
              [nova.id, 1 + (i % 3)],
            );
          }
          // A linha do tempo com as datas do aviso, não as da preparação.
          await this.db.query(
            `UPDATE ocorrencia_eventos e SET em = CASE
             WHEN e.tipo = 'registada' THEN o.criada_em
             ELSE coalesce(o.resolvida_em, least(o.criada_em + interval '4 hours', now())) END
           FROM ocorrencias o WHERE o.id = e.ocorrencia_id AND o.id = $1`,
            [nova.id],
          );
          c.contar('ocorrencias');
          return nova.id;
        },
      );
    }
  }

  /**
   * Ação social: as pessoas inscritas (com consentimento) e uma campanha de
   * onda de calor de há dois dias, já terminada: quem está bem, quem
   * precisa de ajuda (uma já tratada) e quem não atendeu.
   */
  private async acaoSocial(c: Preparacao) {
    const campanhas = this.svc(CampanhasService);
    const contactos = new Map<string, { id: string; municipe: string }>();
    for (const [i, p] of CUIDADO.entries()) {
      const id = await this.umaVez(
        c.m,
        `cuidado:${p.chave}`,
        'contacto_cuidado',
        async () => {
          const r = await campanhas.criarContacto(c.m, c.u, {
            nome: p.nome,
            telefone: telefoneDemo(p.telefone),
            morada: p.morada,
            freguesia: p.freguesia,
            notas: p.notas,
            consentimento_origem: i % 3 === 0 ? 'balcao' : 'acao_social',
          });
          await this.db.query(
            `UPDATE contactos_cuidado SET consentimento_em = now() - make_interval(days => $2),
             criado_em = now() - make_interval(days => $2)
           WHERE id = $1`,
            [r.id, 40 + i * 13],
          );
          c.contar('contactos_cuidado');
          return r.id;
        },
      );
      if (!id) continue;
      const [cc] = await this.db.query<{ municipe_id: string }>(
        'SELECT municipe_id FROM contactos_cuidado WHERE id = $1',
        [id],
      );
      if (cc) contactos.set(p.chave, { id, municipe: cc.municipe_id });
    }

    await this.umaVez(c.m, 'campanha:calor', 'campanha', async () => {
      if (!contactos.size) return null;
      const feita = instanteDemo(
        c.agora,
        c.m.fuso,
        CAMPANHA_CALOR.dias,
        '10:00',
      );
      return this.db.transaction(async (tx) => {
        const [camp] = await tx.query<{ id: string }>(
          `INSERT INTO campanhas (municipio_id, tipo, titulo, mensagem, perguntas, sms_recurso,
             estado, criada_por, criada_em, terminada_em)
           VALUES ($1, 'onda_calor', $2, $3, $4, $5, 'terminada', $6, $7, $7::timestamptz + interval '3 hours')
           RETURNING id`,
          [
            c.m.id,
            CAMPANHA_CALOR.titulo,
            CAMPANHA_CALOR.mensagem,
            JSON.stringify(CAMPANHA_CALOR.perguntas),
            CAMPANHA_CALOR.sms_recurso,
            c.funcionario?.id ?? null,
            feita,
          ],
        );
        for (const [i, p] of CUIDADO.entries()) {
          const ct = contactos.get(p.chave);
          if (!ct) continue;
          const respondido = new Date(feita.getTime() + (8 + i * 9) * 60_000);
          await tx.query(
            `INSERT INTO campanha_destinatarios (campanha_id, contacto_id, municipe_id, estado,
               necessidades, nota, respondido_em, tratado_em, tratado_por, tratado_nota)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
            [
              camp.id,
              ct.id,
              ct.municipe,
              p.calor.estado,
              p.calor.necessidades ?? [],
              p.calor.nota ?? null,
              p.calor.estado === 'nao_atendeu' ? null : respondido,
              p.calor.tratado
                ? new Date(respondido.getTime() + 95 * 60_000)
                : null,
              p.calor.tratado ? (c.funcionario?.id ?? null) : null,
              p.calor.tratado ?? null,
            ],
          );
        }
        c.contar('campanhas');
        return camp.id;
      });
    });
  }

  /** A ilustração de demonstração, se houver armazenamento (S3). */
  private async foto(c: Preparacao, ocorrenciaId: string, imagem: ImagemDemo) {
    const arm = this.svc(ArmazenamentoService);
    if (!arm.disponivel) {
      if (!c.avisos.some((a) => a.startsWith('fotografias'))) {
        c.avisos.push(
          'fotografias: sem armazenamento (S3_BUCKET) as ocorrências ficam sem a ilustração de demonstração.',
        );
      }
      return;
    }
    const chave = arm.chave(c.m.slug, 'fotos-ocorrencias', 'png');
    await arm.guardar(chave, pngDemonstracao(imagem), 'image/png');
    await this.db.query(
      'INSERT INTO ocorrencia_fotos (ocorrencia_id, ficheiro_key) VALUES ($1, $2)',
      [ocorrenciaId, chave],
    );
  }

  private async licencas(c: Preparacao) {
    const registo = this.svc(RegistoFerramentas);
    const licencas = this.svc(LicencasService);

    const doNumero = async (numero: string) => {
      const [l] = await this.db.query<{
        id: string;
        processo_id: string;
        estado: string;
      }>(
        `SELECT l.id, l.processo_id, l.estado FROM licencas l JOIN processos p ON p.id = l.processo_id
         WHERE p.numero = $1 AND p.municipio_id = $2`,
        [numero, c.m.id],
      );
      return l;
    };
    /** Paga em modo de teste (o mesmo caminho do link do SMS) e emite. */
    const pagarEEmitir = async (l: { id: string; processo_id: string }) => {
      const [link] = await this.db.query<{ codigo: string }>(
        `SELECT lc.codigo FROM pagamentos pg
         JOIN links_curtos lc ON lc.destino_tipo = 'pagamento' AND lc.destino_id = pg.id
         WHERE pg.processo_id = $1 AND pg.estado = 'pendente'
         ORDER BY lc.expira_em DESC LIMIT 1`,
        [l.processo_id],
      );
      if (link)
        await this.svc(PagamentosService).simularPagamentoPublico(link.codigo);
      await licencas.sincronizar(c.m.id);
      const [agora] = await this.db.query<{ estado: string }>(
        'SELECT estado FROM licencas WHERE id = $1',
        [l.id],
      );
      // A câmara pode ter posto "um funcionário confirma": aprova-o um
      // funcionário da câmara (sem nenhum, a licença fica por aprovar).
      if (agora?.estado === 'por_aprovar' && c.funcionario)
        await licencas.aprovar(c.m, c.funcionario, l.id);
    };
    const recuar = async (licencaId: string, conversa: string) => {
      await this.db.query(
        `UPDATE licencas l SET criada_em = c.iniciada_em + interval '3 minutes',
           decidida_em = CASE WHEN l.decidida_em IS NULL THEN NULL ELSE c.iniciada_em + interval '9 minutes' END
         FROM conversas c WHERE l.id = $1 AND c.id = $2`,
        [licencaId, c.conversa(conversa)],
      );
      await this.db.query(
        `UPDATE processos p SET criado_em = l.criada_em FROM licencas l
         WHERE l.id = $1 AND p.id = l.processo_id`,
        [licencaId],
      );
    };

    await this.umaVez(c.m, 'licenca:ruido_emitida', 'licenca', async () => {
      const r = (await registo.executar(
        'pedir_licenca',
        c.ctx('telefone', c.conversa('festa_maria'), 'maria'),
        {
          tipo: 'ruido',
          dados: {
            atividade: 'festa_privada',
            descricao: 'Festa de anos no quintal, com música',
            morada: 'Rua Gil Vicente, 30, Guimarães',
            data: proximoDiaSemana(c.agora, c.m.fuso, 6, 10),
            hora_inicio: '20:00',
            hora_fim: '01:00',
            pessoas: 40,
            musica_amplificada: true,
            nome: 'Maria Fernandes',
            metodo: 'mbway',
          },
        },
      )) as { numero: string };
      const l = await doNumero(r.numero);
      await pagarEEmitir(l);
      await recuar(l.id, 'festa_maria');
      c.contar('licencas');
      return l.id;
    });

    await this.umaVez(c.m, 'licenca:ruido_tecnico', 'licenca', async () => {
      const r = (await registo.executar(
        'pedir_licenca',
        c.ctx('telefone', c.conversa('festa_teresa'), 'teresa'),
        {
          tipo: 'ruido',
          dados: {
            atividade: 'festa_privada',
            descricao: 'Jantar de aniversário com música ao vivo',
            morada: 'Rua Paio Galvão, 12, Guimarães',
            data: proximoDiaSemana(c.agora, c.m.fuso, 2, 10),
            hora_inicio: '20:00',
            hora_fim: '01:00',
            pessoas: 30,
            musica_amplificada: true,
            nome: 'Teresa Lopes',
          },
        },
      )) as { numero: string };
      const l = await doNumero(r.numero);
      await recuar(l.id, 'festa_teresa');
      c.contar('licencas');
      return l.id;
    });

    await this.umaVez(c.m, 'licenca:esplanada', 'licenca', async () => {
      const r = (await registo.executar(
        'pedir_licenca',
        c.ctx('chat', c.conversa('esplanada'), 'manuel'),
        {
          tipo: 'esplanada',
          dados: {
            estabelecimento: 'Café Pereira',
            morada: PONTOS.conde_margaride.morada,
            data_inicio: diaDemo(c.agora, c.m.fuso, 21),
            meses: 1,
            area_m2: 10,
            mesas: 4,
            passeio_livre_m: 2,
            estrado: false,
            centro_historico: false,
            nome: 'Café Pereira, Lda',
          },
        },
      )) as { numero: string };
      const l = await doNumero(r.numero);
      await pagarEEmitir(l);
      // Para os alertas e a renovação: começou há 20 dias e acaba daqui a 10
      // (a renovação começa a seguir e tem de ter 5 dias úteis de antecedência).
      const acaba = diaDemo(c.agora, c.m.fuso, 10);
      const comecou = diaDemo(c.agora, c.m.fuso, -20);
      await this.db.query(
        `UPDATE licencas SET valida_ate = $2::date,
           dados = jsonb_set(dados, '{data_inicio}', to_jsonb($3::text))
         WHERE id = $1`,
        [l.id, acaba, comecou],
      );
      await recuar(l.id, 'esplanada');
      c.contar('licencas');
      return l.id;
    });
  }

  private async agora(c: Preparacao) {
    const pub = this.svc(AgoraPublicacoesService);
    const avisos = this.svc(AvisosZonaService);
    const dia = (n: number) => diaDemo(c.agora, c.m.fuso, n);
    const dataDita = (iso: string) =>
      new Date(`${iso}T12:00:00Z`).toLocaleDateString('pt-PT', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        timeZone: 'UTC',
      });
    const ate = (dias: number) =>
      new Date(`${dia(dias)}T12:00:00Z`).toLocaleDateString('pt-PT', {
        day: 'numeric',
        month: 'long',
        timeZone: 'UTC',
      });

    // Avisos por zona: criados pelo serviço (rascunho, com os afetados) e
    // dados como enviados SEM SMS (é demonstração: só aparecem no /agora).
    // O texto conta com o link: tem de caber em 4 partes com o domínio de
    // produção, não só com o localhost.
    const aviso = (
      chave: string,
      e: {
        titulo: string;
        mensagem: string;
        tipo: 'obras' | 'agua';
        ponto: { lat: number; lng: number };
        descricao: string;
        ha_dias: number;
      },
    ) =>
      this.umaVez(c.m, `aviso:${chave}`, 'aviso_zona', async () => {
        const criado = (await avisos.criar(
          c.m,
          c.u,
          esquemaNovoAviso.parse({
            titulo: e.titulo,
            mensagem: e.mensagem,
            tipo: e.tipo,
            zona: {
              tipo: 'ponto',
              lat: e.ponto.lat,
              lng: e.ponto.lng,
              raio_m: 200,
              descricao: e.descricao,
            },
          }),
        )) as { id: string };
        await this.db.query(
          `UPDATE avisos_zona SET estado = 'enviado', criado_em = $3,
             confirmado_por = $2, confirmado_em = $3::timestamptz + interval '6 minutes',
             terminado_em = $3::timestamptz + interval '9 minutes'
           WHERE id = $1`,
          [
            criado.id,
            c.funcionario?.id ?? null,
            instanteDemo(c.agora, c.m.fuso, e.ha_dias, '10:20'),
          ],
        );
        c.contar('avisos');
        return criado.id;
      });
    await aviso('obras', {
      titulo: 'Obras na Rua de Santo António',
      mensagem: `Repavimentação entre o Largo do Toural e a Rua D. João I. Trânsito condicionado das 8h às 18h até ${ate(4)}. Aviso de demonstração.`,
      tipo: 'obras',
      ponto: PONTOS.santo_antonio,
      descricao: 'Rua de Santo António',
      ha_dias: 2,
    });
    await aviso('agua', {
      titulo: 'Corte de água na Alameda de São Dâmaso',
      mensagem: `Corte de água na Alameda de São Dâmaso: ${dataDita(dia(1))}, das 9h às 13h, para reparar uma conduta (Vimágua). Aviso de demonstração.`,
      tipo: 'agua',
      ponto: PONTOS.sao_damaso,
      descricao: 'Alameda de São Dâmaso e ruas próximas',
      ha_dias: 1,
    });

    const evento = (
      chave: string,
      dias: number,
      inicio: string,
      fim: string,
      e: {
        titulo: string;
        descricao: string;
        local: string;
        ponto: { lat: number; lng: number };
      },
    ) =>
      this.umaVez(c.m, `evento:${chave}`, 'evento', async () => {
        const d = dia(dias);
        const n = await pub.criarEvento(
          c.m,
          c.u,
          esquemaEvento.parse({
            titulo: e.titulo,
            descricao: `${e.descricao} Evento de demonstração.`,
            local: e.local,
            lat: e.ponto.lat,
            lng: e.ponto.lng,
            inicio: instanteLocal(d, inicio, c.m.fuso),
            fim: instanteLocal(d, fim, c.m.fuso),
            publicar: true,
          }),
        );
        c.contar('eventos');
        return n.id;
      });
    await evento('feira', 2, '10:00', '19:00', {
      titulo: 'Feira de artesanato no Largo da Oliveira',
      descricao: 'Bancas de artesãos do concelho: cerâmica, linho e cutelaria.',
      local: 'Largo da Oliveira',
      ponto: PONTOS.oliveira,
    });
    await evento('concerto', 3, '18:00', '20:00', {
      titulo: 'Concerto da banda de música no Toural',
      descricao: 'Concerto ao ar livre, gratuito.',
      local: 'Largo do Toural',
      ponto: PONTOS.toural,
    });
    await evento('visita', 4, '10:30', '12:00', {
      titulo: 'Visita guiada ao centro histórico',
      descricao: 'Visita a pé, com inscrição no posto de turismo.',
      local: 'Largo da Oliveira',
      ponto: PONTOS.oliveira,
    });
    await evento('mercado', 6, '08:00', '13:00', {
      titulo: 'Mercado de produtores na Alameda',
      descricao: 'Fruta, legumes e queijos de produtores locais.',
      local: 'Alameda de São Dâmaso',
      ponto: PONTOS.sao_damaso,
    });

    const comunicado = (chave: string, titulo: string, texto: string) =>
      this.umaVez(c.m, `comunicado:${chave}`, 'comunicado', async () => {
        const n = await pub.criarComunicado(
          c.m,
          c.u,
          esquemaComunicado.parse({
            tipo: 'comunicado',
            titulo,
            texto: `${texto} Comunicado de demonstração.`,
            publicar: true,
          }),
        );
        c.contar('comunicados');
        return n.id;
      });
    await comunicado(
      'balcao',
      'Balcão Único com atendimento por marcação',
      'Pode marcar atendimento no Balcão Único pelo telefone, a qualquer hora, e receber a confirmação por SMS. Quem vai sem marcação continua a ser atendido.',
    );
    await comunicado(
      'monos',
      'Recolha de monos marcada pelo telefone',
      'A recolha de móveis velhos e eletrodomésticos é gratuita e passa a ser marcada pelo telefone, com lembrete por SMS na véspera.',
    );

    await this.umaVez(c.m, 'consulta:toural', 'consulta_publica', async () => {
      const cp = this.svc(ConsultasPublicasService);
      const nova = await cp.criar(
        c.m,
        c.u,
        esquemaConsulta.parse({
          titulo: 'Requalificação do Largo do Toural',
          resumo:
            'A câmara quer saber o que as pessoas preferem para o Largo do Toural: mais árvores e bancos, mais esplanadas ou ficar como está. Consulta de demonstração.',
          perguntas: [
            {
              texto: 'Concorda com mais árvores e bancos no largo?',
              opcoes: ['Concordo', 'Não concordo', 'Não sei'],
            },
          ],
          pergunta_aberta: 'O que gostaria de ver no largo?',
          abre_em: dia(-3),
          fecha_em: dia(20),
        }),
      );
      await cp.abrir(c.m, c.u, nova.id);
      c.contar('consultas');
      return nova.id;
    });
    // No fim: um erro aqui não deixa eventos e comunicados por criar.
    await this.destinatariosAvisos(c);
  }

  /**
   * Quem recebeu os avisos por zona: SMS simulados (os telefones são da gama
   * de teste e não saem), quase todos entregues.
   */
  private async destinatariosAvisos(c: Preparacao) {
    await this.umaVez(c.m, 'aviso:destinatarios', 'aviso_zona', async () => {
      let total = 0;
      for (const [chave, pessoas] of Object.entries(DESTINATARIOS_AVISOS)) {
        const avisoId = await this.registado(c.m.id, `aviso:${chave}`);
        if (!avisoId) continue;
        const [a] = await this.db.query<{
          titulo: string;
          mensagem: string;
          confirmado_em: Date | null;
        }>(
          'SELECT titulo, mensagem, confirmado_em FROM avisos_zona WHERE id = $1',
          [avisoId],
        );
        const base = a.confirmado_em ?? c.agora;
        for (const [i, k] of pessoas.entries()) {
          const p = c.pessoas.get(k);
          if (!p) continue;
          const entregue = i !== pessoas.length - 1; // um ainda sem recibo
          const [ms] = await this.db.query<{ id: string }>(
            `INSERT INTO mensagens_saida (municipio_id, municipe_id, canal, destino, motivo, corpo,
               relacionado, enviar_em, estado, enviada_em, entregue_em, simulado, provider_id)
             VALUES ($1, $2, 'sms', $3, 'aviso', $4, $5, $6, $7::estado_msg, $6, $8, false,
                     'demonstracao')
             RETURNING id`,
            [
              c.m.id,
              p.id,
              p.telefone,
              `${c.m.nome}: ${a.mensagem}`,
              JSON.stringify({ aviso_id: avisoId, demonstracao: true }),
              new Date(base.getTime() + (2 + i) * 60_000),
              entregue ? 'entregue' : 'enviada',
              entregue ? new Date(base.getTime() + (3 + i) * 60_000) : null,
            ],
          );
          await this.db.query(
            `INSERT INTO avisos_zona_destinatarios (aviso_id, municipe_id, telefone_e164, origens,
               estado, mensagem_id)
             VALUES ($1, $2, $3, $4, 'enviado', $5) ON CONFLICT DO NOTHING`,
            [
              avisoId,
              p.id,
              p.telefone,
              [i % 2 ? 'processo' : 'ocorrencia'],
              ms.id,
            ],
          );
          total++;
        }
        await this.db.query(
          `UPDATE avisos_zona SET destinatarios_previstos = $2 WHERE id = $1`,
          [avisoId, pessoas.length],
        );
      }
      if (total) c.contar('avisos_destinatarios');
      return total ? c.m.id : null;
    });
  }

  private async linguagemSimples(c: Preparacao) {
    const fonteId = await this.umaVez(
      c.m,
      'fonte:regulamento_esplanadas',
      'fonte',
      async () => {
        const conh = this.svc(PainelConhecimentoService);
        const [existe] = await this.db.query<{ id: string }>(
          'SELECT id FROM fontes WHERE municipio_id = $1 AND url = $2',
          [c.m.id, REGULAMENTO.url],
        );
        let id = existe?.id;
        if (!id) {
          const f = (await conh.criarFonte(c.m.id, c.u, {
            entidade_id: await this.entidadeCamara(c.m),
            titulo: REGULAMENTO.titulo,
            tipo: 'regulamento',
            url: REGULAMENTO.url,
            ler_a_cada_horas: 24 * 365,
            leitura_automatica: false,
          })) as { id: string };
          id = f.id;
        }
        await conh.colarTexto(c.m.id, c.u, id, { texto: REGULAMENTO.texto });
        return id;
      },
    );
    if (fonteId) {
      await this.umaVez(
        c.m,
        'documento_simples:esplanadas',
        'documento_simples',
        async () => {
          const ls = this.svc(LinguagemSimplesService);
          await ls.criar(c.m, c.u, { fonte_id: fonteId, tipo: 'regulamento' });
          const [doc] = await this.db.query<{ id: string }>(
            'SELECT id FROM documentos_simples WHERE fonte_id = $1',
            [fonteId],
          );
          // Escrita à mão (sem IA), coerente com o texto oficial, e revista
          // ao publicar. Cada parte aponta para o artigo de onde vem.
          const seccoes = seccoesDoOriginal(REGULAMENTO.texto);
          const seccao = (n: number) =>
            seccoes.find((s) => s.referencia === `art. ${n}.º`)?.id;
          await ls.guardarRascunho(c.m, c.u, doc.id, {
            titulo: REGULAMENTO.simples.titulo,
            resumo: REGULAMENTO.simples.resumo,
            partes: REGULAMENTO.simples.partes.map((p) => ({
              chave: p.chave,
              titulo: p.titulo,
              texto: p.texto,
              seccoes: p.artigos.map(seccao).filter((s): s is string => !!s),
            })),
          });
          const [v] = await this.db.query<{ id: string }>(
            `SELECT id FROM documento_simples_versoes WHERE documento_id = $1 AND estado = 'rascunho'`,
            [doc.id],
          );
          await ls.publicar(c.m, c.u, doc.id, v.id);
          c.contar('linguagem_simples');
          return doc.id;
        },
      );
    }
    await this.umaVez(c.m, 'glossario', 'glossario', async () => {
      const r = await this.svc(GlossarioService).carregarDemonstracao(c.m, c.u);
      if (r.novos) c.contar('glossario');
      return c.m.id;
    });
  }

  /**
   * Estacionamento: parques e multas de demonstração (o mesmo de POST
   * /painel/estacionamento/demonstracao), uma defesa por analisar e um
   * pedido de lugar reservado, feitos pelas ações do agente.
   */
  private async estacionamento(c: Preparacao) {
    const est = this.svc(EstacionamentoService);
    await this.umaVez(c.m, 'estacionamento', 'estacionamento', async () => {
      const r = await est.carregarDemonstracao(c.m, c.u);
      if (r.parques) c.contar('parques');
      if (r.multas) c.contar('multas');
      return c.m.id;
    });
    await this.umaVez(
      c.m,
      'estacionamento:defesa',
      'defesa_multa',
      async () => {
        const r = (await est.apresentarDefesa(c.ctx('chat', null, 'rui'), {
          numero_auto: 'EST-DEMO-0002',
          motivo:
            'Tinha o talão do parquímetro no tablier e ainda estava dentro da hora paga. Tenho a fotografia do talão.',
          nome: 'Rui Carvalho',
          confirmado: true,
        })) as { defesa_id?: string };
        if (r.defesa_id) c.contar('defesas');
        return r.defesa_id ?? null;
      },
    );
    await this.umaVez(
      c.m,
      'estacionamento:lugar',
      'lugar_reservado',
      async () => {
        const r = (await est.pedirLugar(c.ctx('telefone', null, 'teresa'), {
          morada: 'Rua de Santo António 52, Guimarães',
          tem_cartao: true,
          matricula: '33-TT-44',
          nome: 'Teresa Lopes',
          observacoes: 'Desloca-se em cadeira de rodas.',
          confirmado: true,
        })) as { pedido_id?: string };
        if (r.pedido_id) c.contar('lugares_reservados');
        return r.pedido_id ?? null;
      },
    );
  }

  /**
   * Reservas: equipamentos e sessões de demonstração (o mesmo de POST
   * /painel/reservas/demonstracao), um auditório por aprovar e um pavilhão
   * por pagar, feitos pela ação do agente.
   */
  private async reservas(c: Preparacao) {
    const res = this.svc(ReservasService);
    await this.umaVez(c.m, 'reservas', 'reservas', async () => {
      const r = await res.carregarDemonstracao(c.m, c.u);
      if (r.equipamentos) c.contar('equipamentos');
      if (r.sessoes) c.contar('sessoes_bilhetes');
      return c.m.id;
    });
    const hoje = diaDemo(c.agora, c.m.fuso, 0);
    const proximo = (desde: number, dias: string[]) =>
      diasSeguintes(hoje, desde + 14)
        .slice(desde)
        .find((d) => dias.includes(diaDaSemana(d)))!;
    const pedidos: [
      string,
      string,
      Parameters<ReservasService['reservar']>[1],
    ][] = [
      [
        'auditorio',
        'helena',
        {
          equipamento: 'Auditório Municipal',
          dia: proximo(6, ['ter', 'qua', 'qui']),
          hora_inicio: '21:00',
          duracao_horas: 2,
          finalidade: 'Sarau de dança da associação cultural',
          nome: 'Helena Sousa',
          confirmado: true,
        },
      ],
      [
        'pavilhao',
        'carlos',
        {
          equipamento: 'Pavilhão Municipal',
          dia: proximo(3, ['sab']),
          hora_inicio: '10:00',
          duracao_horas: 2,
          finalidade: 'Jogo de futsal entre amigos',
          nome: 'Carlos Mendes',
          metodo: 'multibanco',
          confirmado: true,
        },
      ],
    ];
    for (const [chave, pessoa, e] of pedidos) {
      await this.umaVez(c.m, `reserva:${chave}`, 'reserva', async () => {
        const r = (await res.reservar(c.ctx('chat', null, pessoa), e)) as {
          codigo?: string;
          dizer?: string;
        };
        if (!r.codigo) {
          c.avisos.push(`reserva ${chave}: ${r.dizer ?? 'não ficou feita'}`);
          return null;
        }
        const [l] = await this.db.query<{ id: string }>(
          'SELECT id FROM reservas WHERE codigo = $1',
          [r.codigo],
        );
        c.contar('reservas');
        return l?.id ?? null;
      });
    }
  }

  /** Fontes de turismo de demonstração (o mesmo de POST /painel/turismo/demonstracao). */
  private async turismo(c: Preparacao) {
    await this.umaVez(c.m, 'turismo', 'turismo', async () => {
      const r = await this.svc(TurismoService).carregarDemonstracao(c.m, c.u);
      if (r.criadas) c.contar('turismo');
      return c.m.id;
    });
  }

  /** Escolas, atividades e alunos de demonstração (encarregados: munícipes com NIF). */
  private async escolas(c: Preparacao) {
    await this.umaVez(c.m, 'escolas', 'escolas', async () => {
      const encarregados = ['sandra', 'maria', 'teresa', 'carlos', 'helena']
        // Pela ordem: quem faltar fica '' e os seus registos não se criam.
        .map((k) => c.pessoas.get(k)?.id ?? '');
      const r = await this.svc(EscolasService).carregarDemonstracao(
        c.m,
        c.u,
        encarregados,
      );
      if (r.alunos) c.contar('alunos');
      return c.m.id;
    });
  }

  /** Fogos, inquilinos, reparações e candidaturas de demonstração. */
  private async habitacao(c: Preparacao) {
    await this.umaVez(c.m, 'habitacao', 'habitacao', async () => {
      const pessoas = ['manuel', 'teresa', 'pedro', 'helena', 'carlos', 'maria']
        // Pela ordem: quem faltar fica '' e os seus registos não se criam.
        .map((k) => c.pessoas.get(k)?.id ?? '');
      const r = await this.svc(HabitacaoService).carregarDemonstracao(
        c.m,
        c.u,
        pessoas,
      );
      if (r.fogos) c.contar('fogos');
      return c.m.id;
    });
  }

  /** A junta de freguesia de demonstração, ligada a esta câmara (modules/juntas). */
  private async junta(c: Preparacao) {
    const r = await this.svc(JuntasDemoService).preparar(c.m, c.u);
    if (!r) return;
    if (r.criada) c.contar('junta');
    await this.registar(c.m.id, 'junta', 'junta', r.junta.id);
  }

  /** Catálogo de serviços (V4): os dados de demonstração de cada área. */
  private async servicoV4(
    c: Preparacao,
    area: 'cemiterios' | 'animais' | 'agua',
  ) {
    await this.umaVez(c.m, area, area, async () => {
      const r =
        area === 'cemiterios'
          ? await this.svc(CemiteriosService).carregarDemonstracao(c.m)
          : area === 'animais'
            ? await this.svc(AnimaisService).carregarDemonstracao(c.m)
            : await this.svc(AguaService).carregarDemonstracao(c.m);
      if (Object.values(r).some((n) => n > 0)) c.contar(area);
      return c.m.id;
    });
  }

  private async entidadeCamara(m: Municipio): Promise<string> {
    const [e] = await this.db.query<{ id: string }>(
      `SELECT id FROM entidades WHERE municipio_id = $1 AND tipo = 'camara' ORDER BY nome LIMIT 1`,
      [m.id],
    );
    if (e) return e.id;
    const [n] = await this.db.query<{ id: string }>(
      `INSERT INTO entidades (municipio_id, nome, tipo, descricao)
       VALUES ($1, $2, 'camara', 'Câmara Municipal') RETURNING id`,
      [m.id, `Câmara Municipal de ${m.nome}`],
    );
    await this.registar(m.id, 'entidade:camara', 'entidade', n.id);
    return n.id;
  }

  /**
   * O dia de hoje na agenda do balcão: as marcações que já passaram
   * (atendida ou faltou) e as que faltam. Sem horário hoje (fim de semana,
   * feriado), não há.
   */
  private async marcacoesDeHoje(c: Preparacao, agenda: Agenda) {
    const hoje = diaDemo(c.agora, c.m.fuso, 0);
    const ocupados = await this.db.query<{ inicio: Date; fim: Date }>(
      `SELECT lower(periodo) AS inicio, upper(periodo) AS fim FROM marcacoes
       WHERE agenda_id = $1 AND estado = 'marcada'
         AND periodo && tstzrange($2, $2::timestamptz + interval '1 day')`,
      [agenda.id, instanteLocal(hoje, '00:00', c.m.fuso)],
    );
    const slots = gerarSlots({
      horario: agenda.horario,
      duracaoMin: agenda.duracao_min,
      dias: [hoje],
      fuso: c.m.fuso,
      feriados: await this.municipios.feriados(c.m.id),
      agora: instanteLocal(hoje, '00:00', c.m.fuso),
      ocupados,
    });
    if (!slots.length) return;
    const usados = new Set<number>();
    let passadas = 0;
    for (const x of MARCACOES_HOJE) {
      const desde = instanteLocal(hoje, x.hora, c.m.fuso).getTime();
      const slot =
        slots.find(
          (s) => s.inicio.getTime() >= desde && !usados.has(s.inicio.getTime()),
        ) ?? null;
      if (!slot) continue;
      usados.add(slot.inicio.getTime());
      await this.umaVez(c.m, `marcacao:${x.chave}`, 'marcacao', async () => {
        const pessoa = c.pessoas.get(x.pessoa);
        if (!pessoa) return null;
        const passou = slot.fim.getTime() <= c.agora.getTime();
        const estado = passou
          ? passadas++ === 1
            ? 'faltou'
            : 'realizada'
          : 'marcada';
        const [r] = await this.db.query<{ id: string }>(
          `INSERT INTO marcacoes (agenda_id, municipe_id, periodo, assunto, estado, criada_em,
             lembrete_enviado_em)
           VALUES ($1, $2, tstzrange($3, $4), $5, $6, $7, $8) RETURNING id`,
          [
            agenda.id,
            pessoa.id,
            slot.inicio,
            slot.fim,
            x.assunto,
            estado,
            instanteDemo(c.agora, c.m.fuso, 3, '10:00'),
            instanteDemo(c.agora, c.m.fuso, 1, '18:00'),
          ],
        );
        c.contar('marcacoes');
        return r.id;
      });
    }
  }

  private async balcao(c: Preparacao) {
    const marcacoes = this.svc(MarcacoesService);
    const [agenda] = await marcacoes.agendas(c.m.id);
    if (!agenda) {
      c.avisos.push('marcações: o município não tem agendas do balcão.');
    } else {
      const hoje = diaDemo(c.agora, c.m.fuso, 0);
      const livres = await marcacoes.vagasLivres(
        c.m,
        agenda,
        diasSeguintes(hoje, 10),
      );
      // Uma no primeiro dia com vagas (hoje, se ainda der) e outra no seguinte.
      const dias = [
        ...new Set(livres.map((s) => diaLocal(s.inicio, c.m.fuso))),
      ];
      const escolhidas = dias.slice(0, 2).map((d) => {
        const doDia = livres.filter((s) => diaLocal(s.inicio, c.m.fuso) === d);
        return doDia[Math.min(2, doDia.length - 1)];
      });
      const pedidos: [string, string, string][] = [
        ['marcacao_1', 'antonio', 'Entregar documentos do licenciamento'],
        ['marcacao_2', 'ines', 'Licença de ocupação da via pública'],
      ];
      for (const [i, [chave, pessoa, assunto]] of pedidos.entries()) {
        const slot = escolhidas[i];
        if (!slot) continue;
        await this.umaVez(c.m, `marcacao:${chave}`, 'marcacao', async () => {
          const conv = CONVERSAS.find((x) => x.chave === chave)!;
          const r = await marcacoes.marcar(
            c.ctx(conv.canal, c.conversa(chave), pessoa),
            {
              agenda_id: agenda.id,
              inicio: slot.inicio.toISOString(),
              assunto,
            },
          );
          c.contar('marcacoes');
          return r.marcacao_id;
        });
      }
    }

    if (agenda) await this.marcacoesDeHoje(c, agenda);

    await this.umaVez(c.m, 'reclamacao:luisa', 'reclamacao', async () => {
      const conversaId = c.conversa('reclamacao');
      await this.svc(RegistoFerramentas).executar(
        'registar_reclamacao',
        c.ctx('telefone', conversaId, 'luisa'),
        {
          nome: 'Luísa Gomes',
          servico_visado: 'Balcão Único',
          descricao:
            'Esperei mais de uma hora no Balcão Único sem senha e sem ninguém me dizer quanto tempo faltava.',
          pedido: 'Que haja informação sobre o tempo de espera.',
          confirmado: true,
        },
      );
      const [r] = await this.db.query<{ id: string }>(
        'SELECT id FROM reclamacoes WHERE conversa_id = $1 ORDER BY criada_em DESC LIMIT 1',
        [conversaId],
      );
      if (r) c.contar('reclamacoes');
      return r?.id ?? null;
    });
  }
}

/** O estado de uma preparação em curso (o que já se sabe e o que se criou). */
class Preparacao {
  readonly temas = new Map<Tema, string>();
  readonly categorias = new Map<string, string>();
  readonly pessoas = new Map<string, { id: string; telefone: string }>();
  readonly conversas = new Map<string, string>();
  readonly criados: Record<string, number> = {};
  /**
   * Quem assina os atos da câmara na demonstração (aprovar uma licença,
   * responder a uma passagem): quem prepara, se for da câmara; senão a
   * chefia ou um técnico do município. Nunca a equipa do fornecedor.
   */
  funcionario: UtilizadorPainel | null = null;

  constructor(
    readonly m: Municipio,
    readonly u: UtilizadorPainel,
    readonly agora: Date,
    readonly avisos: string[],
  ) {}

  contar(o: string) {
    this.criados[o] = (this.criados[o] ?? 0) + 1;
  }

  pessoa(chave: string) {
    const p = this.pessoas.get(chave);
    if (!p) throw new Error(`Pessoa de demonstração em falta: ${chave}`);
    return p;
  }

  conversa(chave: string): string {
    const c = this.conversas.get(chave);
    if (!c) throw new Error(`Conversa de demonstração em falta: ${chave}`);
    return c;
  }

  ctx(
    canal: ContextoFerramenta['canal'],
    conversaId: string | null,
    pessoa: string,
  ): ContextoFerramenta {
    const p = this.pessoa(pessoa);
    return {
      municipio: this.m,
      canal,
      conversaId,
      municipeId: p.id,
      telefone: p.telefone,
    };
  }
}
