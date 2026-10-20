import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ErroApi } from '../../common/erros.js';
import { Cursor, pagina } from '../../common/paginacao.js';
import type { UtilizadorPainel } from '../../common/pedido.js';
import { DatabaseService } from '../../database/database.service.js';
import { ArmazenamentoService } from '../armazenamento/armazenamento.service.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { LinksCurtosService } from '../comunicacao/links-curtos.service.js';
import { mascararTelefone } from '../municipes/municipes.service.js';
import { objetosDaConversa } from './objetos-conversa.js';
import { resumoCurto } from './retomar.js';

/** Conversas anteriores no detalhe ("histórico do munícipe"). */
const MAX_HISTORICO = 10;

export interface FiltrosConversas {
  canal?: string;
  resultado?: string;
  tema_id?: string;
  de?: Date;
  ate?: Date;
  texto?: string;
  fora_de_horas?: boolean;
  revisao?: 'certa' | 'errada' | 'por_rever';
  limite: number;
  cursor: Cursor | null;
}

interface LinhaLista {
  id: string;
  canal: string;
  iniciada_em: Date;
  duracao_s: number | null;
  resultado: string;
  fora_de_horas: boolean | null;
  resumo: string | null;
  revisao: string | null;
  tema_id: string | null;
  tema: string | null;
  municipe_id: string | null;
  municipe_nome: string | null;
  telefone: string | null;
  momentos: number;
  fonte: { titulo: string; url: string; referencia: string | null } | null;
}

/** O objeto sem a chave (tokens e códigos públicos não vão para o painel). */
function sem<T extends object, K extends keyof T>(o: T, chave: K): Omit<T, K> {
  const copia = { ...o };
  delete copia[chave];
  return copia;
}

/** Painel · Conversas e a página pública "O que tem de fazer". */
@Injectable()
export class PainelConversasService {
  constructor(
    private readonly db: DatabaseService,
    private readonly auditoria: AuditoriaService,
    private readonly armazenamento: ArmazenamentoService,
    private readonly links: LinksCurtosService,
    private readonly config: ConfigService,
  ) {}

  async listar(municipioId: string, f: FiltrosConversas) {
    const linhas = await this.db.query<LinhaLista>(
      `SELECT c.id, c.canal, c.iniciada_em, c.duracao_s, c.resultado, c.fora_de_horas,
              c.resumo, c.revisao, c.tema_id, t.nome AS tema,
              c.municipe_id, m.nome AS municipe_nome, m.telefone_e164 AS telefone,
              (SELECT count(*)::int FROM conversa_momentos cm WHERE cm.conversa_id = c.id) AS momentos,
              (SELECT json_build_object('titulo', fo.titulo, 'url', fo.url, 'referencia', tr.referencia)
               FROM conversa_turnos ct
               JOIN citacoes ci ON ci.turno_id = ct.id
               JOIN trechos tr ON tr.id = ci.trecho_id
               JOIN fonte_versoes fv ON fv.id = tr.fonte_versao_id
               JOIN fontes fo ON fo.id = fv.fonte_id
               WHERE ct.conversa_id = c.id
               ORDER BY ct.ordem, tr.ordem LIMIT 1) AS fonte
       FROM conversas c
       LEFT JOIN temas t ON t.id = c.tema_id
       LEFT JOIN municipes m ON m.id = c.municipe_id
       WHERE c.municipio_id = $1
         AND ($2::canal IS NULL OR c.canal = $2)
         AND ($3::resultado_conv IS NULL OR c.resultado = $3)
         AND ($4::uuid IS NULL OR c.tema_id = $4)
         AND ($5::timestamptz IS NULL OR c.iniciada_em >= $5)
         AND ($6::timestamptz IS NULL OR c.iniciada_em < $6)
         AND ($7::text IS NULL OR c.resumo ILIKE '%' || $7 || '%')
         AND ($8::boolean IS NULL OR c.fora_de_horas = $8)
         AND ($9::text IS NULL
              OR ($9 = 'por_rever' AND c.revisao IS NULL)
              OR c.revisao = $9)
         AND ($10::timestamptz IS NULL OR (c.iniciada_em, c.id) < ($10, $11::uuid))
       ORDER BY c.iniciada_em DESC, c.id DESC
       LIMIT $12`,
      [
        municipioId,
        f.canal ?? null,
        f.resultado ?? null,
        f.tema_id ?? null,
        f.de ?? null,
        f.ate ?? null,
        f.texto ? f.texto.replace(/[%_\\]/g, '\\$&') : null,
        f.fora_de_horas ?? null,
        f.revisao ?? null,
        f.cursor?.em ?? null,
        f.cursor?.id ?? null,
        f.limite + 1,
      ],
    );
    const p = pagina(linhas, f.limite, (l) => ({
      em: l.iniciada_em,
      id: l.id,
    }));
    return {
      itens: p.itens.map((l) => ({
        id: l.id,
        canal: l.canal,
        iniciada_em: l.iniciada_em,
        duracao_s: l.duracao_s,
        resultado: l.resultado,
        fora_de_horas: l.fora_de_horas,
        resumo: l.resumo,
        revisao: l.revisao,
        tema: l.tema_id ? { id: l.tema_id, nome: l.tema } : null,
        municipe: l.municipe_id
          ? {
              id: l.municipe_id,
              nome: l.municipe_nome,
              telefone: mascararTelefone(l.telefone),
            }
          : null,
        momentos: l.momentos,
        // A primeira fonte citada na conversa (ou null).
        fonte: l.fonte,
      })),
      proximo_cursor: p.proximo_cursor,
    };
  }

  private async conversa(municipioId: string, id: string) {
    const [c] = await this.db.query<{
      id: string;
      canal: string;
      provider_id: string | null;
      municipe_id: string | null;
      iniciada_em: Date;
      terminada_em: Date | null;
      duracao_s: number | null;
      idioma: string;
      consentimento_em: Date | null;
      gravacao_key: string | null;
      resultado: string;
      tema_id: string | null;
      tema: string | null;
      resumo: string | null;
      proximos_passos: string[];
      resumo_sms: string | null;
      resumida_em: Date | null;
      continuacao_de: string | null;
      agente_versao: string | null;
      fora_de_horas: boolean | null;
      revisao: string | null;
      revisao_nota: string | null;
      revista_por: string | null;
      revista_por_nome: string | null;
      revista_em: Date | null;
    }>(
      `SELECT c.*, t.nome AS tema, u.nome AS revista_por_nome
       FROM conversas c
       LEFT JOIN temas t ON t.id = c.tema_id
       LEFT JOIN utilizadores u ON u.id = c.revista_por
       WHERE c.id = $1 AND c.municipio_id = $2`,
      [id, municipioId],
    );
    if (!c) {
      throw new ErroApi(
        HttpStatus.NOT_FOUND,
        'conversa_nao_encontrada',
        'Conversa não encontrada.',
      );
    }
    return c;
  }

  async detalhe(
    municipioId: string,
    id: string,
    u: UtilizadorPainel,
    ip: string,
  ) {
    const c = await this.conversa(municipioId, id);
    const [turnos, momentos, citacoes, ficha, objetos, historico] =
      await Promise.all([
        this.db.query(
          `SELECT id::text, ordem, papel, texto, inicio_ms, fim_ms
         FROM conversa_turnos WHERE conversa_id = $1 ORDER BY ordem`,
          [id],
        ),
        this.db.query(
          `SELECT id::text, tipo, em_ms, turno_id::text, dados, criado_em
         FROM conversa_momentos WHERE conversa_id = $1
         ORDER BY em_ms NULLS LAST, id`,
          [id],
        ),
        this.db.query(
          `SELECT ct.turno_id::text, tr.id AS trecho_id, tr.referencia,
                left(tr.texto, 400) AS trecho, fo.titulo AS fonte, fo.url,
                e.nome AS entidade, fv.lida_em
         FROM citacoes ct
         JOIN conversa_turnos tu ON tu.id = ct.turno_id
         JOIN trechos tr ON tr.id = ct.trecho_id
         JOIN fonte_versoes fv ON fv.id = tr.fonte_versao_id
         JOIN fontes fo ON fo.id = fv.fonte_id
         JOIN entidades e ON e.id = fo.entidade_id
         WHERE tu.conversa_id = $1
         ORDER BY tu.ordem`,
          [id],
        ),
        c.municipe_id
          ? this.db.query<{
              id: string;
              nome: string | null;
              telefone: string | null;
              conversas_anteriores: number;
            }>(
              `SELECT m.id, m.nome, m.telefone_e164 AS telefone,
                    (SELECT count(*)::int FROM conversas o
                     WHERE o.municipe_id = m.id AND o.id <> $2 AND o.iniciada_em < $3) AS conversas_anteriores
             FROM municipes m WHERE m.id = $1`,
              [c.municipe_id, id, c.iniciada_em],
            )
          : Promise.resolve([]),
        objetosDaConversa(this.db, id),
        this.historicoMunicipe(municipioId, c),
      ]);

    await this.auditoria.registar({
      municipioId,
      atorTipo: 'utilizador',
      atorId: u.id,
      acao: 'ver',
      objetoTipo: 'conversa',
      objetoId: id,
      ip,
    });

    const m = ficha[0];
    return {
      id: c.id,
      canal: c.canal,
      iniciada_em: c.iniciada_em,
      terminada_em: c.terminada_em,
      duracao_s: c.duracao_s,
      idioma: c.idioma,
      fora_de_horas: c.fora_de_horas,
      resultado: c.resultado,
      tema: c.tema_id ? { id: c.tema_id, nome: c.tema } : null,
      resumo: c.resumo,
      proximos_passos: c.proximos_passos,
      resumo_sms: c.resumo_sms,
      resumida_em: c.resumida_em,
      continuacao_de: c.continuacao_de,
      historico_municipe: historico,
      agente_versao: c.agente_versao,
      consentimento_em: c.consentimento_em,
      tem_gravacao: c.gravacao_key !== null,
      revisao: {
        valor: c.revisao,
        nota: c.revisao_nota,
        por: c.revista_por
          ? { id: c.revista_por, nome: c.revista_por_nome }
          : null,
        em: c.revista_em,
      },
      // Nunca o NIF; o telefone mascarado.
      municipe: m
        ? {
            id: m.id,
            nome: m.nome,
            telefone: mascararTelefone(m.telefone),
            conversas_anteriores: m.conversas_anteriores,
          }
        : null,
      turnos,
      momentos,
      citacoes,
      criado: {
        requerimentos: objetos.requerimentos.map((r) =>
          sem(r, 'token_publico'),
        ),
        processos: objetos.processos.map((p) => sem(p, 'link_codigo')),
        ocorrencias: objetos.ocorrencias.map((o) => sem(o, 'token_publico')),
        marcacoes: objetos.marcacoes.map((x) => sem(x, 'token_publico')),
        recolhas: objetos.recolhas,
        pagamentos: objetos.pagamentos.map((p) => sem(p, 'link_codigo')),
        passagens: objetos.passagens,
      },
    };
  }

  /**
   * Histórico do munícipe: as conversas anteriores a esta (todos os canais),
   * da mais recente para trás. A de que esta é continuação vem marcada.
   */
  private async historicoMunicipe(
    municipioId: string,
    c: {
      id: string;
      municipe_id: string | null;
      iniciada_em: Date;
      continuacao_de: string | null;
    },
  ) {
    if (!c.municipe_id) return [];
    const linhas = await this.db.query<{
      id: string;
      canal: string;
      iniciada_em: Date;
      resultado: string;
      tema_id: string | null;
      tema: string | null;
      resumo_sms: string | null;
      resumo: string | null;
    }>(
      `SELECT o.id, o.canal, o.iniciada_em, o.resultado, o.tema_id, t.nome AS tema,
              o.resumo_sms, o.resumo
       FROM conversas o LEFT JOIN temas t ON t.id = o.tema_id
       WHERE o.municipio_id = $1 AND o.municipe_id = $2 AND o.id <> $3
         AND o.iniciada_em < $4
       ORDER BY o.iniciada_em DESC
       LIMIT $5`,
      [municipioId, c.municipe_id, c.id, c.iniciada_em, MAX_HISTORICO],
    );
    return linhas.map((l) => ({
      id: l.id,
      canal: l.canal,
      iniciada_em: l.iniciada_em,
      resultado: l.resultado,
      tema: l.tema_id ? { id: l.tema_id, nome: l.tema } : null,
      resumo: resumoCurto(l.resumo_sms, l.resumo, 200) || null,
      continuada_por_esta: l.id === c.continuacao_de,
    }));
  }

  /** URL de 5 minutos; cada acesso fica na auditoria ("X ouviu a gravação"). */
  async gravacao(
    municipioId: string,
    id: string,
    u: UtilizadorPainel,
    ip: string,
  ) {
    const c = await this.conversa(municipioId, id);
    if (!c.gravacao_key) {
      throw new ErroApi(
        HttpStatus.NOT_FOUND,
        'sem_gravacao',
        'Esta conversa não tem gravação (sem consentimento ou já apagada).',
      );
    }
    const url = await this.armazenamento.urlLeitura(c.gravacao_key, 5);
    await this.auditoria.registar({
      municipioId,
      atorTipo: 'utilizador',
      atorId: u.id,
      acao: 'ouvir_gravacao',
      objetoTipo: 'conversa',
      objetoId: id,
      dados: { nome: u.nome },
      ip,
    });
    return { url, expira_em: new Date(Date.now() + 5 * 60_000) };
  }

  async rever(
    municipioId: string,
    id: string,
    u: UtilizadorPainel,
    revisao: 'certa' | 'errada',
    nota: string | null,
  ) {
    const [r] = await this.db.query<{
      revisao: string;
      revisao_nota: string | null;
      revista_em: Date;
    }>(
      `UPDATE conversas SET revisao = $3, revisao_nota = $4, revista_por = $5, revista_em = now()
       WHERE id = $1 AND municipio_id = $2
       RETURNING revisao, revisao_nota, revista_em`,
      [id, municipioId, revisao, nota, u.id],
    );
    if (!r) {
      throw new ErroApi(
        HttpStatus.NOT_FOUND,
        'conversa_nao_encontrada',
        'Conversa não encontrada.',
      );
    }
    await this.auditoria.registar({
      municipioId,
      atorTipo: 'utilizador',
      atorId: u.id,
      acao: 'rever',
      objetoTipo: 'conversa',
      objetoId: id,
      dados: { revisao },
    });
    return {
      id,
      revisao: r.revisao,
      nota: r.revisao_nota,
      por: { id: u.id, nome: u.nome },
      em: r.revista_em,
    };
  }

  /**
   * Página "O que tem de fazer" (link do SMS): resumo, próximos passos e o
   * que foi criado, cada um com a sua página pública. Sem transcrição.
   */
  async publico(codigo: string) {
    const { destinoId, municipioId } = await this.links.resolver(
      codigo,
      'resumo',
    );
    const [c] = await this.db.query<{
      iniciada_em: Date;
      resumo_sms: string | null;
      proximos_passos: string[];
      resumida_em: Date | null;
      municipio: string;
      telefone_linha: string | null;
    }>(
      `SELECT c.iniciada_em, c.resumo_sms, c.proximos_passos, c.resumida_em,
              mu.nome AS municipio, mu.telefone_linha
       FROM conversas c JOIN municipios mu ON mu.id = c.municipio_id
       WHERE c.id = $1 AND c.municipio_id = $2`,
      [destinoId, municipioId],
    );
    if (!c) {
      throw new ErroApi(
        HttpStatus.NOT_FOUND,
        'link_invalido',
        'Este link não existe ou já expirou.',
      );
    }
    const o = await objetosDaConversa(this.db, destinoId);
    const web = this.config.get<string>('app.webUrl') ?? '';
    const pag = (tipo: string, token: string | null) =>
      token ? `${web}/${tipo}/${token}` : null;

    return {
      municipio: { nome: c.municipio, telefone: c.telefone_linha },
      data: c.iniciada_em,
      // O resumo do painel é para funcionários; aqui vai o texto para o munícipe.
      resumo: c.resumo_sms,
      resumo_pronto: c.resumida_em !== null,
      proximos_passos: c.proximos_passos,
      criado: [
        ...o.requerimentos.map((r) => ({
          tipo: 'requerimento',
          titulo: r.tipo,
          estado: r.estado,
          em_falta: r.campos_em_falta,
          url: pag('requerimento', r.token_publico),
        })),
        ...o.processos.map((p) => ({
          tipo: 'processo',
          titulo: `${p.numero} · ${p.assunto}`,
          estado: p.fase,
          url: pag('processo', p.link_codigo),
        })),
        ...o.ocorrencias.map((x) => ({
          tipo: 'ocorrencia',
          titulo: `${x.numero} · ${x.categoria}`,
          estado: x.estado,
          url: pag('ocorrencia', x.token_publico),
        })),
        ...o.marcacoes.map((m) => ({
          tipo: 'marcacao',
          titulo: m.agenda,
          estado: m.estado,
          inicio: m.inicio,
          local: m.local,
          levar: m.levar ?? [],
          url: pag('marcacao', m.token_publico),
        })),
        ...o.recolhas.map((r) => ({
          tipo: 'recolha',
          titulo: 'Recolha de monos',
          estado: r.estado,
          inicio: r.janela_inicio,
          url: null,
        })),
        ...o.pagamentos.map((p) => ({
          tipo: 'pagamento',
          titulo: 'Pagamento de taxa',
          estado: p.estado,
          valor_cent: p.valor_cent,
          pagar_ate: p.pagar_ate,
          modo_teste: p.modo_teste,
          url: pag('pagamento', p.link_codigo),
        })),
      ],
    };
  }
}
