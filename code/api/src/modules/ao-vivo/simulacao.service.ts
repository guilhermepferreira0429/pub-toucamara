import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { ErroApi } from '../../common/erros.js';
import type { UtilizadorPainel } from '../../common/pedido.js';
import { DatabaseService } from '../../database/database.service.js';
import { RegistoFerramentas } from '../../ferramentas/registo-ferramentas.service.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import type { Municipio } from '../municipios/municipios.service.js';
import { AoVivoService } from './ao-vivo.service.js';
import { FalasAoVivoService } from './falas.service.js';

type Passo =
  | { s: number; fala: 'municipe' | 'agente'; texto: string }
  | {
      s: number;
      ferramenta: string;
      fase: 'pedido' | 'resposta';
      resultado?: unknown;
    }
  | { s: number; juntar: true }
  | { s: number; dizerResultado: true };

/** Número do familiar na simulação: o SMS fica gravado como simulado. */
const TELEFONE_FAMILIAR = '+351912000000';

/**
 * O guião da chamada simulada (só fora de produção). A licença é de
 * demonstração: o resultado é inventado e nada é criado; a junção do
 * familiar é a verdadeira (ferramenta `juntar_familiar`), com o SMS
 * gravado como simulado.
 */
const GUIAO: Passo[] = [
  {
    s: 1,
    fala: 'agente',
    texto: 'Câmara Municipal, boa tarde. Em que posso ajudar?',
  },
  {
    s: 4,
    fala: 'municipe',
    texto:
      'Boa tarde. Queria fazer uma festa de anos no quintal no sábado, até à uma da manhã. Preciso de licença por causa do barulho?',
  },
  { s: 6, ferramenta: 'procurar_conhecimento', fase: 'pedido' },
  {
    s: 7,
    ferramenta: 'procurar_conhecimento',
    fase: 'resposta',
    resultado: {
      trechos: [
        { titulo: 'Regulamento Geral do Ruído', referencia: 'art. 15.º' },
      ],
    },
  },
  {
    s: 9,
    fala: 'agente',
    texto:
      'Para música depois das 23 horas precisa de uma licença especial de ruído. Posso tratar disso já. Qual é a morada?',
  },
  {
    s: 14,
    fala: 'municipe',
    texto:
      'É na Rua de Santo António. Eu vivo sozinha e não percebo muito disto. Pode falar com a minha filha?',
  },
  {
    s: 17,
    fala: 'agente',
    texto:
      'Claro. Posso mandar um SMS à sua filha com um link para ela acompanhar esta chamada e me escrever. Concorda?',
  },
  { s: 21, fala: 'municipe', texto: 'Sim, concordo. Chama-se Ana.' },
  { s: 22, ferramenta: 'juntar_familiar', fase: 'pedido' },
  { s: 23, juntar: true },
  { s: 24, dizerResultado: true },
  { s: 32, fala: 'municipe', texto: 'E quanto é que isso custa?' },
  { s: 34, ferramenta: 'pedir_licenca', fase: 'pedido' },
  {
    s: 36,
    ferramenta: 'pedir_licenca',
    fase: 'resposta',
    resultado: {
      pedida: true,
      tipo: 'ruido',
      emitida: true,
      numero: 'LR-SIMULACAO',
      simulado: true,
    },
  },
  {
    s: 38,
    fala: 'agente',
    texto:
      'Verifiquei as regras e o seu pedido cumpre todas: a licença ficou emitida e segue por SMS. (Chamada simulada: nada foi criado.)',
  },
];

/** Quanto tempo a chamada simulada fica aberta, a responder ao funcionário e ao familiar. */
const DURACAO_MS = 10 * 60_000;

/**
 * "Simular chamada" (painel, só em desenvolvimento): uma chamada web a
 * fingir, com a mesma rota de escrita do browser, para mostrar o painel ao
 * vivo e a página do familiar sem ElevenLabs. Responde ao funcionário e ao
 * familiar como o agente faria.
 */
@Injectable()
export class SimulacaoAoVivoService {
  private readonly logger = new Logger(SimulacaoAoVivoService.name);
  /** Link do familiar das simulações (só para o painel de desenvolvimento). */
  private readonly links = new Map<string, string>();

  constructor(
    private readonly db: DatabaseService,
    private readonly config: ConfigService,
    private readonly aoVivo: AoVivoService,
    private readonly falas: FalasAoVivoService,
    private readonly registo: RegistoFerramentas,
    private readonly auditoria: AuditoriaService,
  ) {}

  get permitida(): boolean {
    return this.config.get<string>('app.ambiente') !== 'production';
  }

  linkDe(conversaId: string): string | null {
    return this.links.get(conversaId) ?? null;
  }

  async iniciar(m: Municipio, u: UtilizadorPainel, rapido = false) {
    if (!this.permitida) {
      throw new ErroApi(
        HttpStatus.NOT_FOUND,
        'nao_encontrado',
        'A simulação só existe em desenvolvimento.',
      );
    }
    const ref = `sim-${randomUUID()}`;
    const s = await this.aoVivo.criarSessao(
      { municipio: m.slug, conversa_ref: ref },
      'simulacao',
      true,
    );
    await this.auditoria.registar({
      municipioId: m.id,
      atorTipo: 'utilizador',
      atorId: u.id,
      acao: 'simular_chamada',
      objetoTipo: 'conversa',
      objetoId: s.conversa_id,
      dados: {},
    });
    void this.correr(
      m,
      s.sessao_id,
      s.token,
      s.conversa_id,
      rapido ? 0.05 : 1,
    ).catch((e: Error) =>
      this.logger.warn(`Simulação ${s.conversa_id}: ${e.message}`),
    );
    return { conversa_id: s.conversa_id, simulada: true };
  }

  private async correr(
    m: Municipio,
    sessaoId: string,
    token: string,
    conversaId: string,
    escala: number,
  ) {
    const esperar = (ms: number) =>
      new Promise((r) => setTimeout(r, Math.round(ms * escala)));
    const escrever = (itens: unknown[]) =>
      this.aoVivo.escrever(sessaoId, token, { itens } as never);
    let feito = 0;
    let resultadoJuntar: { dizer?: string; link_simulacao?: string } | null =
      null;
    let cursor = await this.falas.ultimaSeq(conversaId);

    const responderAInjecoes = async () => {
      const novas = await this.falas.desde(conversaId, cursor, [
        'funcionario',
        'familiar',
      ]);
      for (const f of novas) {
        cursor = f.seq;
        await esperar(2000);
        const quem =
          typeof f.dados?.quem === 'string' ? f.dados.quem : 'o seu familiar';
        await escrever([
          {
            tipo: 'fala',
            quem: 'agente',
            texto:
              f.quem === 'funcionario'
                ? `O funcionário da câmara pede para lhe dizer: ${f.texto}`
                : `${quem[0].toUpperCase()}${quem.slice(1)} escreveu: «${f.texto}». Quer que use essa informação no seu pedido?`,
          },
        ]);
        if (f.quem === 'familiar') {
          await esperar(3000);
          await escrever([
            { tipo: 'fala', quem: 'municipe', texto: 'Sim, pode usar.' },
          ]);
        }
      }
    };

    for (const p of GUIAO) {
      await esperar((p.s - feito) * 1000);
      feito = p.s;
      if (!(await this.aindaAtiva(sessaoId))) return;
      if ('fala' in p) {
        await escrever([{ tipo: 'fala', quem: p.fala, texto: p.texto }]);
      } else if ('ferramenta' in p) {
        await escrever([
          {
            tipo: 'ferramenta',
            ferramenta: p.ferramenta,
            fase: p.fase,
            resultado: p.resultado ? JSON.stringify(p.resultado) : undefined,
          },
        ]);
      } else if ('juntar' in p) {
        resultadoJuntar = (await this.registo.executar(
          'juntar_familiar',
          {
            municipio: m,
            canal: 'telefone',
            conversaId,
            municipeId: null,
            telefone: null,
          },
          {
            telefone: TELEFONE_FAMILIAR,
            nome: 'Ana',
            relacao: 'a sua filha',
            resumo:
              'A mãe quer fazer uma festa de anos no quintal no sábado até à uma da manhã e precisa da licença especial de ruído.',
            autorizou: true,
          },
        )) as { dizer?: string; link_simulacao?: string };
        if (resultadoJuntar?.link_simulacao)
          this.links.set(conversaId, resultadoJuntar.link_simulacao);
        const { link_simulacao: _l, ...semLink } = resultadoJuntar ?? {};
        void _l;
        await escrever([
          {
            tipo: 'ferramenta',
            ferramenta: 'juntar_familiar',
            fase: 'resposta',
            resultado: JSON.stringify(semLink),
          },
        ]);
      } else if ('dizerResultado' in p && resultadoJuntar?.dizer) {
        await escrever([
          { tipo: 'fala', quem: 'agente', texto: resultadoJuntar.dizer },
        ]);
      }
      await responderAInjecoes();
    }

    const fim = Date.now() + DURACAO_MS * escala;
    while (Date.now() < fim) {
      if (!(await this.aindaAtiva(sessaoId))) return;
      await responderAInjecoes();
      await new Promise((r) => setTimeout(r, 1000));
    }
    const [s] = await this.db.query<{
      id: string;
      municipio_id: string;
      conversa_id: string;
      simulada: boolean;
    }>(
      `SELECT id, municipio_id, conversa_id, simulada FROM chamadas_ao_vivo WHERE id = $1`,
      [sessaoId],
    );
    if (s) await this.aoVivo.terminarSessao(s);
    this.links.delete(conversaId);
  }

  private async aindaAtiva(sessaoId: string): Promise<boolean> {
    const [s] = await this.db.query<{ ok: boolean }>(
      `SELECT (terminada_em IS NULL AND expira_em > now()) AS ok FROM chamadas_ao_vivo WHERE id = $1`,
      [sessaoId],
    );
    return !!s?.ok;
  }

  /** Terminar a chamada simulada (botão no painel). */
  async terminar(m: Municipio, conversaId: string) {
    const [s] = await this.db.query<{
      id: string;
      municipio_id: string;
      conversa_id: string;
      simulada: boolean;
    }>(
      `SELECT id, municipio_id, conversa_id, simulada FROM chamadas_ao_vivo
       WHERE conversa_id = $1 AND municipio_id = $2 AND simulada`,
      [conversaId, m.id],
    );
    if (!s)
      throw new ErroApi(
        HttpStatus.NOT_FOUND,
        'nao_encontrado',
        'Não há uma chamada simulada com este id.',
      );
    await this.aoVivo.terminarSessao(s);
    this.links.delete(conversaId);
    return { terminada: true };
  }
}
