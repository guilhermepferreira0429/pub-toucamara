import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ErroApi } from '../../common/erros.js';
import { DatabaseService } from '../../database/database.service.js';
import type { ContextoFerramenta } from '../../ferramentas/ferramenta.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { LimitePedidos } from '../chat/limite.js';
import { MensagensService } from '../comunicacao/mensagens.service.js';
import { primeiroNome } from '../conversas/retomar.js';
import { quemFalado } from '../chamadas-saida/juncao-familiar.js';
import { FalasAoVivoService, MensagemSse, sondar } from './falas.service.js';
import {
  hashToken,
  injecaoFamiliar,
  MAXIMO_MENSAGEM,
  novoToken,
  Quem,
  VALIDADE_ACOMPANHAR_MS,
} from './regras.js';

export interface SessaoAtiva {
  id: string;
  municipio_id: string;
  conversa_id: string;
  simulada: boolean;
  expira_em: Date;
}

interface Acompanhamento {
  id: string;
  municipio_id: string;
  conversa_id: string;
  juncao_id: string;
  nome_familiar: string | null;
  relacao: string | null;
  expira_em: Date;
  aberturas: number;
  max_aberturas: number;
  mensagens: number;
  max_mensagens: number;
  retirado_em: Date | null;
  retirado_por: 'municipe' | 'sistema' | null;
}

/** O que o familiar vê (e escreve): nunca as ferramentas em bruto. */
const QUEM_FAMILIAR: Quem[] = [
  'municipe',
  'agente',
  'familiar',
  'funcionario',
  'ferramenta',
];

export const AVISO_PRIVACIDADE =
  'Está a ver esta conversa porque a pessoa autorizou, durante a chamada, que a acompanhasse. ' +
  'Use-a só para a ajudar. Não guarde nem partilhe o que aqui vê. ' +
  'A pessoa pode deixar de partilhar a qualquer momento e o link deixa de funcionar quando a chamada acaba.';

/**
 * "Fale com o meu filho" na chamada web: em vez de uma conferência no
 * Twilio, o familiar recebe um SMS com um link (curto prazo, uso limitado,
 * só aquela conversa) que abre a transcrição em direto e um campo para
 * escrever ao agente. O caminho do Twilio (chamadas telefónicas reais)
 * fica no JuncaoFamiliarService.
 */
@Injectable()
export class AcompanhamentoFamiliarService {
  private readonly limiteEscrita = new LimitePedidos(6, 60_000);

  constructor(
    private readonly db: DatabaseService,
    private readonly config: ConfigService,
    private readonly falas: FalasAoVivoService,
    private readonly mensagens: MensagensService,
    private readonly auditoria: AuditoriaService,
  ) {}

  private get webUrl(): string {
    return this.config.get<string>('app.webUrl') ?? '';
  }

  /** A sessão da chamada web desta conversa, se estiver a decorrer. */
  async sessaoAtiva(conversaId: string | null): Promise<SessaoAtiva | null> {
    if (!conversaId) return null;
    const [s] = await this.db.query<SessaoAtiva>(
      `SELECT id, municipio_id, conversa_id, simulada, expira_em FROM chamadas_ao_vivo
       WHERE conversa_id = $1 AND terminada_em IS NULL AND expira_em > now()`,
      [conversaId],
    );
    return s ?? null;
  }

  /**
   * Ferramenta `juntar_familiar` numa chamada web. Pede autorização antes:
   * o familiar vai ver o que se fala e pode escrever ao agente.
   */
  async juntarNaChamadaWeb(
    ctx: ContextoFerramenta,
    e: {
      nome?: string | null;
      relacao?: string | null;
      resumo: string;
      autorizou?: boolean | null;
    },
    telefone: string,
    sessao: SessaoAtiva,
  ) {
    const quem = quemFalado(e.nome ?? null, e.relacao ?? null);
    if (e.autorizou !== true) {
      return {
        juntado: false,
        precisa_autorizacao: true,
        dizer:
          `Antes de avisar ${quem}, preciso da sua autorização: ${quem} vai receber um SMS com um link ` +
          'para ver o que estamos a falar e para me escrever. Pode deixar de partilhar quando quiser. Concorda?',
      };
    }
    const conversaId = sessao.conversa_id;
    const token = novoToken();
    const expira = new Date(
      Math.min(
        Date.now() + VALIDADE_ACOMPANHAR_MS,
        new Date(sessao.expira_em).getTime(),
      ),
    );
    const [m] = await this.db.query<{ nome: string | null }>(
      `SELECT nome FROM municipes WHERE id = $1 AND anonimizado_em IS NULL`,
      [ctx.municipeId],
    );
    const de = primeiroNome(m?.nome);
    const link = `${this.webUrl}/acompanhar/${token}`;

    const juncaoId = await this.db.transaction(async (tx) => {
      const [j] = await tx.query<{ id: string }>(
        `INSERT INTO juncoes_familiar
           (municipio_id, conversa_id, municipe_id, telefone_familiar, nome_familiar,
            relacao, resumo, sala, modo, estado)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'tc-web-' || gen_random_uuid(), 'web', 'a_acompanhar')
         RETURNING id`,
        [
          ctx.municipio.id,
          conversaId,
          ctx.municipeId,
          telefone,
          e.nome ?? null,
          e.relacao ?? null,
          e.resumo,
        ],
      );
      await tx.query(
        `INSERT INTO acompanhamentos_familiar
           (municipio_id, conversa_id, juncao_id, token_hash, nome_familiar, relacao, expira_em)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          ctx.municipio.id,
          conversaId,
          j.id,
          hashToken(token),
          e.nome ?? null,
          e.relacao ?? null,
          expira,
        ],
      );
      await this.mensagens.sms(
        {
          municipioId: ctx.municipio.id,
          municipeId: null,
          destino: telefone,
          motivo: 'familiar',
          corpo:
            `Olá${e.nome ? ` ${primeiroNome(e.nome)}` : ''}. ${de || 'Um familiar seu'} pediu a sua ajuda numa chamada com a ` +
            `Câmara Municipal de ${ctx.municipio.nome}. Acompanhe e escreva-nos aqui (válido 2 horas): ${link}`,
          relacionado: { juncao_familiar_id: j.id, conversa_id: conversaId },
          chave: `familiar-web:${j.id}`,
          simulado: sessao.simulada,
        },
        tx,
      );
      await this.falas.publicar(
        ctx.municipio.id,
        'familiar',
        `Familiar convidado a acompanhar a chamada${sessao.simulada ? ' (simulação)' : ''}`,
        tx,
      );
      return j.id;
    });
    await this.auditoria.registar({
      municipioId: ctx.municipio.id,
      atorTipo: 'agente',
      acao: 'juntar_familiar',
      objetoTipo: 'juncao_familiar',
      objetoId: juncaoId,
      dados: { modo: 'web', canal: ctx.canal, autorizado: true },
    });
    return {
      juntado: true,
      modo: 'web',
      sms_enviado: true,
      // Só para a simulação de demonstração (o link nunca vai para o agente).
      ...(sessao.simulada ? { link_simulacao: link } : {}),
      dizer:
        `Mandei um SMS a ${quem} com um link para acompanhar esta chamada e me escrever. ` +
        `Quando ${quem} escrever, eu digo-lhe. Se deixar de precisar, diga "já não preciso".`,
    };
  }

  /** "Já não preciso": os links da conversa deixam de funcionar. */
  async retirarDaConversa(
    conversaId: string | null,
    por: 'municipe' | 'sistema',
  ): Promise<number> {
    if (!conversaId) return 0;
    const r = await this.db.query<{ juncao_id: string; municipio_id: string }>(
      `UPDATE acompanhamentos_familiar SET retirado_em = now(), retirado_por = $2
       WHERE conversa_id = $1 AND retirado_em IS NULL
       RETURNING juncao_id, municipio_id`,
      [conversaId, por],
    );
    if (r.length) {
      await this.db.query(
        `UPDATE juncoes_familiar SET estado = 'retirada', atualizada_em = now()
         WHERE id = ANY ($1::uuid[])`,
        [r.map((x) => x.juncao_id)],
      );
      if (por === 'municipe') {
        await this.auditoria.registar({
          municipioId: r[0].municipio_id,
          atorTipo: 'municipe',
          acao: 'retirar_familiar',
          objetoTipo: 'conversa',
          objetoId: conversaId,
          dados: { links: r.length },
        });
      }
    }
    return r.length;
  }

  /** Ferramenta `retirar_familiar`. */
  async retirarPeloAgente(ctx: ContextoFerramenta) {
    const n = await this.retirarDaConversa(ctx.conversaId, 'municipe');
    return n
      ? {
          retirado: true,
          dizer:
            'Está feito: o seu familiar deixou de ver esta conversa e o link já não funciona.',
        }
      : {
          retirado: false,
          dizer: 'Não há ninguém a acompanhar esta conversa.',
        };
  }

  /** Quem acompanha a conversa agora (para o painel e para o /ligar). */
  async estadoDaConversa(
    conversaId: string,
  ): Promise<{ ativo: boolean; quem: string | null }> {
    const [a] = await this.db.query<Acompanhamento>(
      `SELECT * FROM acompanhamentos_familiar
       WHERE conversa_id = $1 AND retirado_em IS NULL AND expira_em > now()
       ORDER BY criado_em DESC LIMIT 1`,
      [conversaId],
    );
    return {
      ativo: !!a,
      quem: a ? quemFalado(a.nome_familiar, a.relacao) : null,
    };
  }

  // ------------------------------------------------------------ público

  private async porToken(token: string): Promise<Acompanhamento> {
    const [a] = await this.db.query<Acompanhamento>(
      `SELECT * FROM acompanhamentos_familiar WHERE token_hash = $1`,
      [hashToken(token)],
    );
    if (!a)
      throw new ErroApi(
        HttpStatus.NOT_FOUND,
        'link_invalido',
        'Este link não existe.',
      );
    return a;
  }

  private verificarAtivo(a: Acompanhamento) {
    if (a.retirado_em) {
      throw new ErroApi(
        HttpStatus.GONE,
        'link_terminado',
        a.retirado_por === 'municipe'
          ? 'A pessoa deixou de partilhar esta conversa.'
          : 'A chamada terminou. Obrigado pela ajuda.',
      );
    }
    if (new Date(a.expira_em).getTime() <= Date.now()) {
      throw new ErroApi(
        HttpStatus.GONE,
        'link_terminado',
        'Este link já expirou.',
      );
    }
  }

  /** Página do familiar: conta uma abertura (uso limitado). */
  async publico(token: string) {
    const a = await this.porToken(token);
    this.verificarAtivo(a);
    const [conta] = await this.db.query<{ aberturas: number }>(
      `UPDATE acompanhamentos_familiar SET aberturas = aberturas + 1
       WHERE id = $1 AND aberturas < max_aberturas RETURNING aberturas`,
      [a.id],
    );
    if (!conta)
      throw new ErroApi(
        HttpStatus.GONE,
        'link_terminado',
        'Este link já foi aberto demasiadas vezes. Peça um novo durante a chamada.',
      );
    const [info] = await this.db.query<{
      nome: string | null;
      municipio: string;
    }>(
      `SELECT mu.nome, m.nome AS municipio FROM conversas c
       JOIN municipios m ON m.id = c.municipio_id
       LEFT JOIN municipes mu ON mu.id = c.municipe_id AND mu.anonimizado_em IS NULL
       WHERE c.id = $1`,
      [a.conversa_id],
    );
    const falas = await this.falas.desde(a.conversa_id, 0, QUEM_FAMILIAR, 300);
    return {
      pessoa: primeiroNome(info?.nome) || null,
      municipio: info?.municipio ?? '',
      quem: quemFalado(a.nome_familiar, a.relacao),
      aviso: AVISO_PRIVACIDADE,
      expira_em: a.expira_em,
      mensagens_restantes: Math.max(0, a.max_mensagens - a.mensagens),
      falas: falas.map(paraFamiliar),
    };
  }

  /** SSE da página do familiar: as falas novas e o fim (retirado/expirado). */
  async eventos(token: string, desde: number) {
    const a = await this.porToken(token);
    this.verificarAtivo(a);
    let cursor = desde;
    return sondar(async () => {
      const [estado] = await this.db.query<{
        retirado_em: Date | null;
        retirado_por: string | null;
        expirado: boolean;
      }>(
        `SELECT retirado_em, retirado_por, expira_em <= now() AS expirado
         FROM acompanhamentos_familiar WHERE id = $1`,
        [a.id],
      );
      const novas = await this.falas.desde(
        a.conversa_id,
        cursor,
        QUEM_FAMILIAR,
      );
      if (novas.length) cursor = novas[novas.length - 1].seq;
      const eventos: MensagemSse[] = novas.map((f) => ({
        type: 'fala',
        data: paraFamiliar(f),
      }));
      if (!estado || estado.retirado_em || estado.expirado) {
        eventos.push({
          type: 'fim',
          data: {
            motivo:
              estado?.retirado_por === 'municipe'
                ? 'retirado'
                : estado?.retirado_em
                  ? 'terminada'
                  : 'expirado',
          },
        });
        return { eventos, fim: true };
      }
      return { eventos };
    });
  }

  /** O familiar escreve ao agente: fica na transcrição e é injetado. */
  async escrever(token: string, texto: string) {
    const a = await this.porToken(token);
    this.verificarAtivo(a);
    if (!this.limiteEscrita.permitir(a.id)) {
      throw new ErroApi(
        HttpStatus.TOO_MANY_REQUESTS,
        'limite',
        'Está a escrever muito depressa. Espere um pouco.',
      );
    }
    const limpo = texto.trim().slice(0, MAXIMO_MENSAGEM);
    const [conta] = await this.db.query<{ mensagens: number }>(
      `UPDATE acompanhamentos_familiar SET mensagens = mensagens + 1
       WHERE id = $1 AND mensagens < max_mensagens RETURNING mensagens`,
      [a.id],
    );
    if (!conta)
      throw new ErroApi(
        HttpStatus.TOO_MANY_REQUESTS,
        'limite',
        'Já escreveu o máximo de mensagens nesta chamada.',
      );
    const quem = quemFalado(a.nome_familiar, a.relacao);
    const seq = await this.falas.inserir({
      municipioId: a.municipio_id,
      conversaId: a.conversa_id,
      quem: 'familiar',
      texto: limpo,
      dados: { quem, injecao: injecaoFamiliar(quem, limpo) },
    });
    return {
      seq,
      mensagens_restantes: Math.max(0, a.max_mensagens - conta.mensagens),
    };
  }
}

function paraFamiliar(f: {
  seq: number;
  quem: Quem;
  texto: string;
  em: string;
}) {
  return { seq: f.seq, quem: f.quem, texto: f.texto, em: f.em };
}
