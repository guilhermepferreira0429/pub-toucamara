import { Injectable, Logger, Type } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import type { UtilizadorPainel } from '../../common/pedido.js';
import { DatabaseService } from '../../database/database.service.js';
import { PainelConhecimentoService } from '../conhecimento/painel-conhecimento.service.js';
import type { Municipio } from '../municipios/municipios.service.js';
import {
  CONTRADICAO,
  EXECUCOES_AVALIACAO,
  FONTES_DEMO,
  PERGUNTA_SEM_RESPOSTA,
  PERGUNTAS_AVALIACAO,
  RESPOSTAS_DEMO,
  RespostaDemo,
  SITE_VIMAGUA,
  TAXA_ANTIGA,
  TAXA_NOVA,
} from './demo.conhecimento.js';
import { REGULAMENTO, TEMAS, Tema } from './demo.conteudo.js';
import { escolherResposta, instanteDemo } from './demo.regras.js';

/** O que a preparação partilha com este serviço (ver DemoService). */
export interface ContextoDemo {
  m: Municipio;
  u: UtilizadorPainel;
  agora: Date;
  avisos: string[];
  temas: Map<Tema, string>;
  umaVez(
    chave: string,
    tipo: string,
    criar: () => Promise<string | null>,
  ): Promise<string | null>;
  registado(chave: string): Promise<string | null>;
  contar(o: string): void;
}

const DIA_MS = 86_400_000;

/**
 * O conhecimento da câmara de demonstração (demo.conhecimento.ts): fontes,
 * respostas no ar por tema, as conversas a citar a fonte, a pergunta sem
 * resposta da piscina, um teste de qualidade com resultados de
 * demonstração, a alteração da taxa das esplanadas por rever e a
 * contradição com a página das perguntas frequentes.
 */
@Injectable()
export class DemoConhecimentoService {
  private readonly logger = new Logger(DemoConhecimentoService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly ref: ModuleRef,
  ) {}

  private svc<T>(tipo: Type<T>): T {
    return this.ref.get(tipo, { strict: false });
  }

  /** Corre os passos por ordem (cada um idempotente). */
  async preparar(c: ContextoDemo) {
    const fontes = await this.fontes(c);
    const execucao = await this.avaliacao(c);
    await this.respostas(c, fontes, execucao);
    await this.semResposta(c);
    await this.citacoes(c, fontes);
    await this.alteracao(c, fontes);
    await this.contradicao(c, fontes);
    await this.usos(c);
    await this.emails(c, fontes);
  }

  // -------------------------------------------------------------------
  // Fontes
  // -------------------------------------------------------------------

  /** As entidades: a câmara e a da água (a Vimágua, se a câmara a tiver). */
  private async entidades(m: Municipio) {
    const [camara] = await this.db.query<{ id: string }>(
      `SELECT id FROM entidades WHERE municipio_id = $1 AND tipo = 'camara'
       ORDER BY nome LIMIT 1`,
      [m.id],
    );
    const [agua] = await this.db.query<{ id: string }>(
      `SELECT id FROM entidades WHERE municipio_id = $1 AND ativo
         AND (nome ILIKE '%vimágua%' OR nome ILIKE '%água%' OR descricao ILIKE '%água%')
       ORDER BY (nome ILIKE '%vimágua%') DESC, nome LIMIT 1`,
      [m.id],
    );
    let aguaId = agua?.id;
    if (!aguaId) {
      const [n] = await this.db.query<{ id: string }>(
        `INSERT INTO entidades (municipio_id, nome, tipo, descricao, site_url)
         VALUES ($1, 'Vimágua', 'empresa_municipal', 'Água e saneamento', $2)
         ON CONFLICT (municipio_id, nome) DO UPDATE SET site_url = EXCLUDED.site_url
         RETURNING id`,
        [m.id, SITE_VIMAGUA],
      );
      aguaId = n.id;
    }
    return { camara: camara?.id ?? null, agua: aguaId };
  }

  /** Fonte (chave) → id; inclui o regulamento das esplanadas ('regulamento'). */
  private async fontes(c: ContextoDemo): Promise<Map<string, string>> {
    const conh = this.svc(PainelConhecimentoService);
    const ent = await this.entidades(c.m);
    const lida = new Date(c.agora.getTime() - 45 * DIA_MS);
    const ids = new Map<string, string>();
    for (const f of FONTES_DEMO) {
      const id = await c.umaVez(`fonte:${f.chave}`, 'fonte', async () => {
        const entidade = f.entidade === 'agua' ? ent.agua : ent.camara;
        if (!entidade) return null;
        const [existe] = await this.db.query<{ id: string }>(
          'SELECT id FROM fontes WHERE municipio_id = $1 AND url = $2',
          [c.m.id, f.url],
        );
        let fonteId = existe?.id;
        if (!fonteId) {
          const nova = (await conh.criarFonte(c.m.id, c.u, {
            entidade_id: entidade,
            titulo: f.titulo,
            tipo: f.tipo,
            url: f.url,
            ler_a_cada_horas: 24 * 7,
            leitura_automatica: false,
          })) as { id: string };
          fonteId = nova.id;
        }
        await conh.colarTexto(c.m.id, c.u, fonteId, { texto: f.texto });
        // Lida há mês e meio (antes das conversas que a citam).
        await this.db.query(
          `UPDATE fonte_versoes SET lida_em = $2 WHERE fonte_id = $1`,
          [fonteId, lida],
        );
        await this.db.query(
          `UPDATE fontes SET demonstracao = true, ultima_leitura_em = $2 WHERE id = $1`,
          [fonteId, lida],
        );
        c.contar('fontes');
        return fonteId;
      });
      if (id) ids.set(f.chave, id);
    }
    const regulamento = await c.registado('fonte:regulamento_esplanadas');
    if (regulamento) {
      ids.set('regulamento', regulamento);
      // A versão original (3 €) é da mesma altura que as outras fontes.
      await this.db.query(
        `UPDATE fonte_versoes SET lida_em = $2
         WHERE fonte_id = $1 AND position($3 in texto) > 0 AND lida_em > $2`,
        [regulamento, lida, TAXA_ANTIGA],
      );
      await this.db.query(
        `UPDATE fontes SET demonstracao = true WHERE id = $1`,
        [regulamento],
      );
    }
    return ids;
  }

  /**
   * O trecho de uma fonte pela referência, na versão mais antiga (a que as
   * conversas e as respostas citaram) ou na mais recente.
   */
  private async trecho(
    fonteId: string,
    referencia: string,
    versao: 'primeira' | 'ultima' = 'primeira',
  ): Promise<string | null> {
    const [t] = await this.db.query<{ id: string }>(
      `SELECT t.id FROM trechos t
       JOIN fonte_versoes v ON v.id = t.fonte_versao_id
       WHERE v.fonte_id = $1 AND t.referencia = $2
       ORDER BY v.lida_em ${versao === 'primeira' ? 'ASC' : 'DESC'}, t.ordem LIMIT 1`,
      [fonteId, referencia],
    );
    return t?.id ?? null;
  }

  private async trechosDe(
    r: RespostaDemo,
    fontes: Map<string, string>,
    versao: 'primeira' | 'ultima' = 'primeira',
  ): Promise<string[]> {
    const ids: string[] = [];
    for (const [chave, ref] of r.trechos) {
      const fonte = fontes.get(chave);
      if (!fonte) continue;
      const id = await this.trecho(fonte, ref, versao);
      if (id) ids.push(id);
    }
    return ids;
  }

  // -------------------------------------------------------------------
  // Teste de qualidade (resultados de demonstração)
  // -------------------------------------------------------------------

  /** Três execuções do avaliador; devolve o id da mais recente. */
  private async avaliacao(c: ContextoDemo): Promise<string | null> {
    return c.umaVez('avaliacao:execucoes', 'avaliacao', async () => {
      const [cfg] = await this.db.query<{ versao: string | null }>(
        'SELECT versao FROM agente_config WHERE municipio_id = $1',
        [c.m.id],
      );
      const versao = cfg?.versao ?? 'v1';
      const nome = `Tou, Câmara? · chat · ${c.m.nome} (demonstração)`;
      const [sistema] = await this.db.query<{ id: string }>(
        `INSERT INTO avaliacao.sistemas (nome, municipio_id, adaptador, config, nosso)
         VALUES ($1, $2, 'tou-chat', '{"demonstracao": true}', true)
         ON CONFLICT (nome) DO UPDATE SET config = avaliacao.sistemas.config || '{"demonstracao": true}'
         RETURNING id`,
        [nome, c.m.id],
      );
      const [conjunto] = await this.db.query<{ id: string }>(
        `INSERT INTO avaliacao.conjuntos (nome, versao, municipio_id)
         VALUES ('Perguntas de demonstração', 1, $1)
         ON CONFLICT (nome, versao, municipio_id) DO UPDATE SET nome = EXCLUDED.nome
         RETURNING id`,
        [c.m.id],
      );
      const perguntas: string[] = [];
      for (const [i, p] of PERGUNTAS_AVALIACAO.entries()) {
        const [linha] = await this.db.query<{ id: string }>(
          `INSERT INTO avaliacao.perguntas (conjunto_id, ordem, categoria, texto, comportamento, nota)
           VALUES ($1, $2, $3, $4, $5, 'Pergunta de demonstração')
           ON CONFLICT (conjunto_id, ordem) DO UPDATE SET texto = EXCLUDED.texto
           RETURNING id`,
          [conjunto.id, i + 1, TEMAS[p.tema], p.texto, p.comportamento],
        );
        perguntas.push(linha.id);
        await this.db.query(
          `INSERT INTO avaliacao.gabarito (pergunta_id, municipio_id, resposta, factos_obrigatorios,
             estado, proposto_por, aprovado_por, aprovado_em)
           VALUES ($1, $2, $3, $4, 'aprovado', 'equipa', 'Equipa de demonstração', $5)
           ON CONFLICT DO NOTHING`,
          [
            linha.id,
            c.m.id,
            p.gabarito,
            p.factos,
            new Date(c.agora.getTime() - 25 * DIA_MS),
          ],
        );
      }
      let ultima: string | null = null;
      for (const e of EXECUCOES_AVALIACAO) {
        const inicio = instanteDemo(c.agora, c.m.fuso, e.dias, '15:00');
        const fim = new Date(inicio.getTime() + 6 * 60_000);
        const [ex] = await this.db.query<{ id: string }>(
          `INSERT INTO avaliacao.execucoes (sistema_id, conjunto_id, agente_versao, motivo, estado,
             iniciada_em, terminada_em)
           VALUES ($1, $2, $3, 'manual', 'terminada', $4, $5) RETURNING id`,
          [sistema.id, conjunto.id, versao, inicio, fim],
        );
        for (const [i, p] of PERGUNTAS_AVALIACAO.entries()) {
          const falha = e.falhas[i];
          const quando = new Date(inicio.getTime() + (i + 1) * 12_000);
          const [r] = await this.db.query<{ id: string }>(
            `INSERT INTO avaliacao.respostas (execucao_id, pergunta_id, texto, latencia_ms, respondida_em)
             VALUES ($1, $2, $3, $4, $5) RETURNING id`,
            [
              ex.id,
              perguntas[i],
              falha?.resposta ?? p.gabarito,
              1400 + ((i * 137) % 900),
              quando,
            ],
          );
          const veredicto = falha
            ? falha.veredicto
            : p.comportamento === 'passar_humano'
              ? 'passada_bem'
              : 'certa';
          await this.db.query(
            `INSERT INTO avaliacao.avaliacoes (resposta_id, rubrica_versao, veredicto,
               comportamento_observado, factos_certos, factos_errados, justificacao, avaliador, criada_em)
             VALUES ($1, 'demonstracao', $2, $3, $4, $5, $6, 'juiz', $7)`,
            [
              r.id,
              veredicto,
              p.comportamento,
              falha ? [] : p.factos,
              falha?.factos_errados ?? [],
              falha?.justificacao ?? 'Diz o mesmo que o gabarito.',
              new Date(quando.getTime() + 4000),
            ],
          );
        }
        ultima = ex.id;
      }
      c.contar('avaliacoes');
      return ultima;
    });
  }

  // -------------------------------------------------------------------
  // Respostas curadas
  // -------------------------------------------------------------------

  private async respostas(
    c: ContextoDemo,
    fontes: Map<string, string>,
    execucao: string | null,
  ) {
    const conh = this.svc(PainelConhecimentoService);
    for (const [i, r] of RESPOSTAS_DEMO.entries()) {
      await c.umaVez(`resposta:${r.chave}`, 'resposta', async () => {
        const trechos = await this.trechosDe(r, fontes);
        if (r.trechos.length && !trechos.length) return null;
        const nova = (await conh.criarResposta(c.m.id, c.u, {
          pergunta_tipo: r.pergunta,
          tema_id: c.temas.get(r.tema) ?? null,
          texto_voz: r.texto_voz,
          texto_sms: r.texto_sms,
          passa_a_pessoa_quando: r.passa_a_pessoa_quando ?? [],
          trechos,
          frases: r.frases,
        })) as { id: string };
        const escrita = new Date(c.agora.getTime() - (40 - i) * DIA_MS);
        await this.db.query(
          `UPDATE resposta_versoes SET criada_em = $2 WHERE resposta_id = $1`,
          [nova.id, escrita],
        );
        if (r.estado === 'no_ar') {
          // Publicada depois do teste que a deixou ir para o ar.
          await this.db.query(
            `UPDATE resposta_versoes SET publicada_em = $2, eval_execucao_id = $3
             WHERE resposta_id = $1`,
            [nova.id, new Date(escrita.getTime() + DIA_MS), execucao],
          );
          await this.db.query(
            `UPDATE respostas r SET estado = 'no_ar',
               versao_no_ar_id = (SELECT id FROM resposta_versoes WHERE resposta_id = r.id
                                  ORDER BY numero DESC LIMIT 1)
             WHERE r.id = $1`,
            [nova.id],
          );
        } else if (r.estado === 'em_teste') {
          await this.db.query(
            `UPDATE respostas SET estado = 'em_teste' WHERE id = $1`,
            [nova.id],
          );
        }
        c.contar('respostas');
        return nova.id;
      });
    }
  }

  /** A pergunta da piscina: sem resposta, com a equipa, ligada ao rascunho. */
  private async semResposta(c: ContextoDemo) {
    await c.umaVez(
      'pergunta_sem_resposta:piscina',
      'pergunta_sem_resposta',
      async () => {
        const turnos = await this.db.query<{ id: string; em: Date }>(
          `SELECT DISTINCT ON (cv.id) ct.id::text AS id, cv.iniciada_em AS em
           FROM demo_registos d
           JOIN conversas cv ON cv.id = d.objeto_id
           JOIN conversa_turnos ct ON ct.conversa_id = cv.id AND ct.papel = 'municipe'
           WHERE d.municipio_id = $1 AND d.tipo = 'conversa' AND cv.resultado = 'sem_resposta'
             AND cv.resumo ILIKE '%piscina%'
           ORDER BY cv.id, ct.ordem`,
          [c.m.id],
        );
        if (!turnos.length) return null;
        const resposta = await c.registado(
          `resposta:${PERGUNTA_SEM_RESPOSTA.resposta}`,
        );
        const datas = turnos.map((t) => t.em.getTime());
        const [p] = await this.db.query<{ id: string }>(
          `INSERT INTO perguntas_sem_resposta (municipio_id, texto, vezes, primeira_em, ultima_em,
             estado, o_que_falta, resposta_id)
           VALUES ($1, $2, $3, $4, $5, 'com_equipa', $6, $7) RETURNING id`,
          [
            c.m.id,
            PERGUNTA_SEM_RESPOSTA.texto,
            turnos.length,
            new Date(Math.min(...datas)),
            new Date(Math.max(...datas)),
            PERGUNTA_SEM_RESPOSTA.o_que_falta,
            resposta,
          ],
        );
        for (const t of turnos) {
          await this.db.query(
            `INSERT INTO pergunta_sem_resposta_ocorrencias (psr_id, turno_id)
             VALUES ($1, $2::bigint) ON CONFLICT DO NOTHING`,
            [p.id, t.id],
          );
        }
        c.contar('perguntas_sem_resposta');
        return p.id;
      },
    );
  }

  // -------------------------------------------------------------------
  // Citações nas conversas
  // -------------------------------------------------------------------

  /**
   * As conversas resolvidas da demonstração citam a fonte da resposta do
   * tema (a que tem as palavras da conversa). As passadas a funcionário e
   * as sem resposta ficam sem fonte, como no agente real. Corre sempre:
   * só cita as que ainda não têm citação.
   */
  private async citacoes(c: ContextoDemo, fontes: Map<string, string>) {
    const conversas = await this.db.query<{
      id: string;
      tema_id: string | null;
      texto: string;
      turno_id: string | null;
    }>(
      `SELECT cv.id, cv.tema_id,
              coalesce(cv.resumo, '') || ' ' ||
                coalesce((SELECT string_agg(t.texto, ' ') FROM conversa_turnos t
                          WHERE t.conversa_id = cv.id), '') AS texto,
              (SELECT t.id::text FROM conversa_turnos t
               WHERE t.conversa_id = cv.id AND t.papel = 'agente'
               ORDER BY t.ordem DESC LIMIT 1) AS turno_id
       FROM demo_registos d
       JOIN conversas cv ON cv.id = d.objeto_id
       WHERE d.municipio_id = $1 AND d.tipo = 'conversa'
         AND cv.resultado IN ('resolvida', 'marcacao')
         AND NOT EXISTS (SELECT 1 FROM conversa_turnos t JOIN citacoes ci ON ci.turno_id = t.id
                         WHERE t.conversa_id = cv.id)`,
      [c.m.id],
    );
    const temaDe = new Map([...c.temas].map(([k, v]) => [v, k]));
    const cache = new Map<string, string[]>();
    let n = 0;
    for (const cv of conversas) {
      if (!cv.turno_id) continue;
      const tema = cv.tema_id ? temaDe.get(cv.tema_id) : undefined;
      if (!tema) continue;
      const r = escolherResposta(RESPOSTAS_DEMO, tema, cv.texto);
      let trechos: string[] = [];
      if (r) {
        trechos = cache.get(r.chave) ?? (await this.trechosDe(r, fontes));
        cache.set(r.chave, trechos);
      }
      if (!trechos.length) continue;
      await this.db.query(
        `INSERT INTO citacoes (turno_id, trecho_id)
         SELECT $1::bigint, unnest($2::uuid[]) ON CONFLICT DO NOTHING`,
        [cv.turno_id, trechos],
      );
      n++;
    }
    if (n) c.contar('conversas_com_fonte');
  }

  /**
   * O email geral: quatro emails já triados (um com rascunho a citar a
   * fonte, um encaminhado à Vimágua, um respondido por um funcionário e um
   * com pouca confiança, para tratar à mão). Remetentes fictícios.
   */
  private async emails(c: ContextoDemo, fontes: Map<string, string>) {
    await c.umaVez('emails:demo', 'email', async () => {
      const temaId = (t: Tema) => c.temas.get(t) ?? null;
      const faq = fontes.get('esplanadas_faq');
      const trechoFaq = faq ? await this.trecho(faq, 'Como se pede') : null;
      const [agua] = await this.db.query<{ id: string }>(
        `SELECT e.id FROM entidades e JOIN fontes f ON f.entidade_id = e.id
         WHERE f.id = $1`,
        [fontes.get('agua') ?? null],
      );
      const [func] = await this.db.query<{ id: string }>(
        `SELECT id FROM utilizadores WHERE municipio_id = $1 AND ativo
           AND perfil IN ('chefe_divisao', 'tecnico', 'atendimento')
         ORDER BY (perfil <> 'tecnico'), criado_em LIMIT 1`,
        [c.m.id],
      );
      const quando = (dias: number, hhmm: string) =>
        instanteDemo(c.agora, c.m.fuso, dias, hhmm);
      const emails: {
        de: string;
        assunto: string;
        corpo: string;
        tema: Tema;
        recebido: Date;
        confianca: number;
        estado: 'nova' | 'respondida' | 'encaminhada';
        rascunho?: string;
        resposta?: string;
        entidade?: string | null;
        trechos?: string[];
      }[] = [
        {
          de: 'cafe.pereira@correio-demo.pt',
          assunto: 'Esplanada para o verão',
          corpo:
            'Bom dia. Tenho um café na Avenida Conde Margaride e queria voltar a pôr a esplanada a partir de maio, com 6 mesas. O que tenho de fazer? Manuel Pereira',
          tema: 'comercio',
          recebido: quando(0, '08:40'),
          confianca: 0.91,
          estado: 'nova',
          rascunho:
            'Bom dia, Sr. Manuel Pereira. A esplanada aberta pede-se por mera comunicação prévia, com 5 dias úteis de antecedência; pode tratar do pedido pelo telefone, com o agente, ou responder a este email com a área e o número de mesas. Com os melhores cumprimentos.',
          trechos: trechoFaq ? [trechoFaq] : [],
        },
        {
          de: 'ines.machado@correio-demo.pt',
          assunto: 'Sem água desde ontem à noite',
          corpo:
            'Estou sem água em casa desde ontem à noite, na Rua de Camões. Os vizinhos também. A quem me devo dirigir?',
          tema: 'agua',
          recebido: quando(1, '07:55'),
          confianca: 0.88,
          estado: 'encaminhada',
          entidade: agua?.id ?? null,
        },
        {
          de: 'rui.carvalho@correio-demo.pt',
          assunto: 'Obras com barulho ao sábado de manhã',
          corpo:
            'A obra ao lado da minha casa começa às 7h ao sábado com martelos pneumáticos. Isto é permitido?',
          tema: 'ruido',
          recebido: quando(3, '09:20'),
          confianca: 0.83,
          estado: 'respondida',
          resposta:
            'Obrigado pelo contacto. Vamos enviar a fiscalização ao local e confirmar o horário da obra. Ao sábado, as obras ruidosas precisam de licença especial de ruído.',
        },
        {
          de: 'antonio.faria@correio-demo.pt',
          assunto: 'Pedido de certidão',
          corpo:
            'Preciso de uma certidão para as Finanças sobre a casa da minha mãe. Como faço?',
          tema: 'obras',
          recebido: quando(0, '10:05'),
          confianca: 0.42,
          estado: 'nova',
        },
      ];
      let primeiro: string | null = null;
      for (const [i, e] of emails.entries()) {
        const [x] = await this.db.query<{ id: string }>(
          `INSERT INTO emails_entrada (municipio_id, de, para, assunto, corpo, recebido_em, mensagem_id,
             tema_id, confianca, rascunho_resposta, trechos_citados, classificado_em, estado,
             entidade_id, encaminhado_em, resposta, respondido_por, respondido_em)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $6::timestamptz + interval '1 minute',
                   $12, $13, $14, $15, $16, $17)
           RETURNING id`,
          [
            c.m.id,
            e.de,
            null,
            e.assunto,
            e.corpo,
            e.recebido,
            `demo-${c.m.slug}-email-${i + 1}`,
            temaId(e.tema),
            e.confianca,
            e.rascunho ?? null,
            e.trechos ?? [],
            e.estado,
            e.entidade ?? null,
            e.estado === 'encaminhada'
              ? new Date(e.recebido.getTime() + 25 * 60_000)
              : null,
            e.resposta ?? null,
            e.estado === 'respondida' ? (func?.id ?? null) : null,
            e.estado === 'respondida'
              ? new Date(e.recebido.getTime() + 3 * 3_600_000)
              : null,
          ],
        );
        primeiro ??= x.id;
      }
      c.contar('emails');
      return primeiro;
    });
  }

  /** "Usada em N conversas (30 dias)": as conversas que citam a resposta. */
  private async usos(c: ContextoDemo) {
    await this.db.query(
      `UPDATE respostas r SET usos_30d = (
         SELECT count(DISTINCT t.conversa_id)::int
         FROM resposta_fontes rf
         JOIN citacoes ci ON ci.trecho_id = rf.trecho_id
         JOIN conversa_turnos t ON t.id = ci.turno_id
         JOIN conversas cv ON cv.id = t.conversa_id
         WHERE rf.resposta_versao_id = r.versao_no_ar_id
           AND cv.iniciada_em > now() - interval '30 days')
       WHERE r.municipio_id = $1 AND r.versao_no_ar_id IS NOT NULL
         AND r.id IN (SELECT objeto_id FROM demo_registos
                      WHERE municipio_id = $1 AND tipo = 'resposta')`,
      [c.m.id],
    );
  }

  // -------------------------------------------------------------------
  // Alteração por rever e contradição
  // -------------------------------------------------------------------

  /**
   * A leitura desta noite encontrou a taxa nova no regulamento das
   * esplanadas (3 € → 3,50 € por m²): a alteração fica por rever, com a
   * resposta "Quanto custa uma esplanada?" afetada e uma proposta escrita.
   */
  private async alteracao(c: ContextoDemo, fontes: Map<string, string>) {
    const regulamento = fontes.get('regulamento');
    if (!regulamento) return;
    await c.umaVez('alteracao:esplanadas', 'alteracao', async () => {
      const conh = this.svc(PainelConhecimentoService);
      const noite = instanteDemo(c.agora, c.m.fuso, 0, '03:05', 60 * 6);
      const texto = REGULAMENTO.texto.replace(TAXA_ANTIGA, TAXA_NOVA);
      const r = (await conh.colarTexto(c.m.id, c.u, regulamento, {
        texto,
      })) as { alteracao_id: string | null; versao_id: string };
      if (!r.alteracao_id) return null;
      await this.db.query(
        `UPDATE alteracoes SET detetada_em = $2 WHERE id = $1`,
        [r.alteracao_id, noite],
      );
      await this.db.query(
        `UPDATE fonte_versoes SET lida_em = $2 WHERE id = $1`,
        [r.versao_id, noite],
      );
      await this.db.query(
        `UPDATE fontes SET ultima_leitura_em = $2 WHERE id = $1`,
        [regulamento, noite],
      );
      // A leitura da noite: todas as fontes, uma mudança.
      await c.umaVez('ingestao:noite', 'ingestao', async () => {
        const [i] = await this.db.query<{ id: string }>(
          `INSERT INTO ingestoes (municipio_id, iniciada_em, terminada_em, fontes_lidas, mudancas, erros)
           VALUES ($1, $2, $2::timestamptz + interval '4 minutes', 0, 1, 0) RETURNING id`,
          [c.m.id, new Date(noite.getTime() - 5 * 60_000)],
        );
        return i.id;
      });
      // A proposta para a resposta afetada (sem IA: escrita à mão).
      const esplanada = RESPOSTAS_DEMO.find(
        (x) => x.chave === 'esplanada_taxa',
      )!;
      const respostaId = await c.registado('resposta:esplanada_taxa');
      if (respostaId) {
        const trechos = await this.trechosDe(esplanada, fontes, 'ultima');
        const [v] = await this.db.query<{ id: string }>(
          `INSERT INTO resposta_versoes (resposta_id, numero, texto_voz, texto_sms, passa_a_pessoa_quando,
             criada_por, criada_em, origem, base_versao_id, factos, muda_factos)
           SELECT r.id, (SELECT max(numero) + 1 FROM resposta_versoes WHERE resposta_id = r.id),
                  $2, $3, '{}', $4, $5, $6, r.versao_no_ar_id, $7, true
           FROM respostas r WHERE r.id = $1
           RETURNING id`,
          [
            respostaId,
            esplanada.texto_voz.replace('3 euros', '3,50 euros'),
            esplanada.texto_sms.replace('3 €/m²', '3,50 €/m²'),
            c.u.id,
            new Date(noite.getTime() + 2 * 60_000),
            c.u.municipioId ? 'camara' : 'equipa',
            JSON.stringify({ adicionados: ['3,50'], removidos: ['3'] }),
          ],
        );
        if (trechos.length) {
          await this.db.query(
            `INSERT INTO resposta_fontes (resposta_versao_id, trecho_id)
             SELECT $1, unnest($2::uuid[]) ON CONFLICT DO NOTHING`,
            [v.id, trechos],
          );
        }
        await this.db.query(
          `INSERT INTO alteracao_respostas (alteracao_id, resposta_id, proposta_versao_id)
           VALUES ($1, $2, $3)
           ON CONFLICT (alteracao_id, resposta_id) DO UPDATE SET proposta_versao_id = EXCLUDED.proposta_versao_id`,
          [r.alteracao_id, respostaId, v.id],
        );
      }
      c.contar('alteracoes');
      return r.alteracao_id;
    });
  }

  /** As perguntas frequentes ainda dizem 3 €; o regulamento novo, 3,50 €. */
  private async contradicao(c: ContextoDemo, fontes: Map<string, string>) {
    const regulamento = fontes.get('regulamento');
    const faq = fontes.get('esplanadas_faq');
    if (!regulamento || !faq) return;
    await c.umaVez('contradicao:esplanadas', 'contradicao', async () => {
      const a = await this.trecho(regulamento, 'art. 4.º', 'ultima');
      const b = await this.trecho(faq, 'Quanto custa', 'ultima');
      if (!a || !b) return null;
      const [x] = await this.db.query<{ id: string }>(
        `INSERT INTO contradicoes (municipio_id, assunto, trecho_a_id, valor_a, trecho_b_id, valor_b,
           usar, estado, detetada_em)
         VALUES ($1, $2, $3, $4, $5, $6, 'a', 'aberta', $7) RETURNING id`,
        [
          c.m.id,
          CONTRADICAO.assunto,
          a,
          CONTRADICAO.valor_a,
          b,
          CONTRADICAO.valor_b,
          instanteDemo(c.agora, c.m.fuso, 0, '03:07', 60 * 6),
        ],
      );
      c.contar('contradicoes');
      return x.id;
    });
  }
}
