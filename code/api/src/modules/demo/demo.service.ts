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
import { MarcacoesService } from '../marcacoes/marcacoes.service.js';
import {
  diaLocal,
  diasSeguintes,
  horaLocal,
  instanteLocal,
} from '../marcacoes/vagas.js';
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
import { PROCESSOS_PERFIS } from '../processos/projetos-perfis-pdf.js';
import {
  CONVERSAS,
  ConversaDemo,
  PESSOAS,
  PONTOS,
  PROCESSOS,
  ProcessoDemo,
  REGULAMENTO,
  TEMAS,
  Tema,
} from './demo.conteudo.js';
import {
  demoAtiva,
  diaDemo,
  instanteDemo,
  nifDemo,
  proximoDiaSemana,
  telefoneDemo,
} from './demo.regras.js';
import { ImagemDemo, pngDemonstracao } from './imagens-demo.js';
import { CONVERSAS_CONCELHO, criarConversaConcelho } from './concelho-demo.js';

export interface OpcoesPreparar {
  limpar_testes?: boolean;
  confirmar?: boolean;
}

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
      ],
    },
    {
      passo: 'ocorrencias',
      rotulo: 'Ocorrências com fotografia (um buraco reportado 3 vezes)',
      chaves: [
        'ocorrencia:buraco_1',
        'ocorrencia:buraco_2',
        'ocorrencia:buraco_3',
        'ocorrencia:candeeiro',
        'ocorrencia:contentor',
      ],
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
      passo: 'balcao',
      rotulo: 'Marcações no balcão (hoje/amanhã) e uma reclamação no prazo',
      chaves: [
        'marcacao:marcacao_1',
        'marcacao:marcacao_2',
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

  private async plano(m: Municipio, limpar: boolean) {
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
      return {
        passo: p.passo,
        rotulo: p.rotulo,
        total: p.chaves.length,
        ja_existem: ja,
        a_criar: p.chaves.length - ja,
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
    if (!o.confirmar) {
      return {
        ensaio: true,
        municipio: { slug: m.slug, nome: m.nome },
        ...(await this.plano(m, limpar)),
        nota: 'Ensaio: nada foi alterado. Repita com confirmar: true para executar.',
      };
    }

    const ocultados = limpar ? await this.ocultarTestes(m, u) : null;
    const avisos: string[] = [];
    const ctx = new Preparacao(m, u, new Date(), avisos);

    const passos: [string, () => Promise<void>][] = [
      ['base', () => this.base(ctx)],
      ['pessoas', () => this.pessoas(ctx)],
      ['conversas', () => this.conversas(ctx)],
      ['concelho', () => this.concelho(ctx)],
      ['passagens', () => this.passagens(ctx)],
      ['zonas_pdm', () => this.zonasPdm(ctx)],
      ['processo_apoio', () => this.processoApoio(ctx)],
      ['cartas', () => this.cartas(ctx)],
      ['processos', () => this.processos(ctx)],
      ['ocorrencias', () => this.ocorrencias(ctx)],
      ['licencas', () => this.licencas(ctx)],
      ['agora', () => this.agora(ctx)],
      ['linguagem_simples', () => this.linguagemSimples(ctx)],
      ['turismo', () => this.turismo(ctx)],
      ['cemiterios', () => this.servicoV4(ctx, 'cemiterios')],
      ['animais', () => this.servicoV4(ctx, 'animais')],
      ['agua', () => this.servicoV4(ctx, 'agua')],
      ['balcao', () => this.balcao(ctx)],
      ['antecipacoes', () => this.antecipacoes(ctx)],
    ];
    for (const [nome, correr] of passos) {
      try {
        await correr();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        this.logger.error(`Demo · ${nome}: ${msg}`);
        avisos.push(`${nome}: ${msg}`);
      }
    }

    const estado = await this.plano(m, false);
    const resumo = {
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

  // -------------------------------------------------------------------
  // Passos
  // -------------------------------------------------------------------

  /** Temas e categorias de ocorrência que faltem (por nome). */
  private async base(c: Preparacao) {
    for (const [k, nome] of Object.entries(TEMAS)) {
      const [t] = await this.db.query<{ id: string }>(
        'SELECT id FROM temas WHERE municipio_id = $1 AND lower(nome) = lower($2)',
        [c.m.id, nome],
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
    const inicio = instanteDemo(
      c.agora,
      c.m.fuso,
      conv.dias,
      conv.hora,
      25 + i * 11,
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
          [r.passagem_id, quando, emAberto, c.u.municipioId ? c.u.id : null],
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
    for (const p of PROCESSOS) {
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
      const ano = Number(hoje.slice(0, 4));
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
          faltam.length
            ? `Requerimento entregue. Processo ${numero} aberto, à espera de: ${faltam.join(', ')}.`
            : `Requerimento entregue. Processo ${numero} aberto.`,
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
      // A câmara pode ter posto "um funcionário confirma": aprova-se aqui.
      if (agora?.estado === 'por_aprovar')
        await licencas.aprovar(c.m, c.u, l.id);
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
            nome: 'Maria Fulana',
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
            nome: 'Teresa Beltrana',
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
            estabelecimento: 'Café Sicrano',
            morada: PONTOS.conde_margaride.morada,
            data_inicio: diaDemo(c.agora, c.m.fuso, 21),
            meses: 1,
            area_m2: 10,
            mesas: 4,
            passeio_livre_m: 2,
            nome: 'Café Sicrano, Lda',
          },
        },
      )) as { numero: string };
      const l = await doNumero(r.numero);
      await pagarEEmitir(l);
      // Para os alertas: a licença começou há um mês e acaba daqui a 5 dias.
      const acaba = diaDemo(c.agora, c.m.fuso, 5);
      const comecou = diaDemo(c.agora, c.m.fuso, -25);
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
    const aviso = (
      chave: string,
      e: {
        titulo: string;
        mensagem: string;
        tipo: 'obras' | 'agua';
        ponto: { lat: number; lng: number };
        descricao: string;
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
          `UPDATE avisos_zona SET estado = 'enviado', confirmado_por = $2, confirmado_em = now(),
             terminado_em = now()
           WHERE id = $1`,
          [criado.id, c.u.municipioId ? c.u.id : null],
        );
        c.contar('avisos');
        return criado.id;
      });
    await aviso('obras', {
      titulo: 'Obras na Rua de Santo António',
      mensagem: `Repavimentação da Rua de Santo António, entre o Largo do Toural e a Rua D. João I. Trânsito condicionado das 8h às 18h até ${ate(4)}. Aviso de demonstração.`,
      tipo: 'obras',
      ponto: PONTOS.santo_antonio,
      descricao: 'Rua de Santo António',
    });
    await aviso('agua', {
      titulo: 'Corte de água programado na Alameda de São Dâmaso',
      mensagem: `Corte de água na Alameda de São Dâmaso e ruas próximas: ${dataDita(dia(1))}, das 9h às 13h, para reparar uma conduta. Aviso de demonstração.`,
      tipo: 'agua',
      ponto: PONTOS.sao_damaso,
      descricao: 'Alameda de São Dâmaso e ruas próximas',
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

  /** Fontes de turismo de demonstração (o mesmo de POST /painel/turismo/demonstracao). */
  private async turismo(c: Preparacao) {
    await this.umaVez(c.m, 'turismo', 'turismo', async () => {
      const r = await this.svc(TurismoService).carregarDemonstracao(c.m, c.u);
      if (r.criadas) c.contar('turismo');
      return c.m.id;
    });
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

    await this.umaVez(c.m, 'reclamacao:luisa', 'reclamacao', async () => {
      const conversaId = c.conversa('reclamacao');
      await this.svc(RegistoFerramentas).executar(
        'registar_reclamacao',
        c.ctx('telefone', conversaId, 'luisa'),
        {
          nome: 'Luísa Fulana',
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
