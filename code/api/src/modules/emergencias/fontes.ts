import type { Tx } from '../../database/database.service.js';
import type { AvisosZonaService } from '../avisos-zona/avisos-zona.service.js';
import { telefoneParaSms } from '../avisos-zona/avisos-zona.regras.js';
import { telefoneLigavel } from '../chamadas-saida/regras.js';
import type { Municipio } from '../municipios/municipios.service.js';
import type { GeocodificacaoService } from '../ocorrencias/geocodificacao.js';
import { ErroApi } from '../../common/erros.js';
import {
  Candidato,
  freguesiaNaLista,
  GeometriaEmergencia,
  IdFonte,
  LinhaLista,
  MAX_DESTINATARIOS,
  NOMES_FONTES,
  pontoNaZonaEmergencia,
  ResultadoFonte,
} from './emergencias.regras.js';
import {
  ErroFonteOperadores,
  Estimativa,
  FonteOperadores,
  PaginaOperadores,
} from './operadores.js';
import { TAMANHO_PAGINA, TENTATIVAS_PAGINA } from './operadores.regras.js';

/*
 * De onde vêm os números de um aviso de emergência. Um adaptador por fonte,
 * todos com a mesma forma (como a gestão documental em
 * modules/integracoes/gestao-documental.ts): o serviço só fala com a
 * interface, pede a todas as fontes escolhidas e junta (juntarFontes).
 *
 * Há três fontes com os números que a câmara já conhece e a dos operadores,
 * com os números de toda a gente da zona (simulada até haver acordo com a
 * ANEPC / operadores).
 */

/** O que se pede a uma fonte. */
export interface PedidoFonte {
  municipio: Municipio;
  zona: GeometriaEmergencia;
  /** Só para a fonte 'lista'. */
  lista: readonly LinhaLista[];
  /** Moradas conhecidas desde (fonte 'municipes'). */
  desde: Date;
}

export interface FonteDestinatarios {
  readonly id: IdFonte;
  readonly nome: string;
  /** Os números desta fonte para a zona. Nunca lança: erro → estado 'erro'. */
  procurar(p: PedidoFonte): Promise<ResultadoFonte>;
}

type Q = Pick<Tx, 'query'>;

function resultado(
  id: IdFonte,
  candidatos: Candidato[],
  nota: string | null,
): ResultadoFonte {
  return { fonte: id, nome: NOMES_FONTES[id], estado: 'ok', candidatos, nota };
}

function falhou(id: IdFonte, e: unknown): ResultadoFonte {
  return {
    fonte: id,
    nome: NOMES_FONTES[id],
    estado: 'erro',
    candidatos: [],
    nota: `Não foi possível consultar esta fonte: ${e instanceof Error ? e.message : String(e)}`.slice(
      0,
      300,
    ),
  };
}

/**
 * (a) Munícipes conhecidos com morada na zona: quem tem processos,
 * ocorrências, recolhas ou requerimentos com morada na zona (a mesma escolha
 * dos avisos por zona, por coordenadas). Numa zona por freguesias, os
 * processos com essa freguesia. Só telemóveis (é o que os avisos por zona
 * guardam); o opt-out dos avisos não conta numa emergência.
 */
export class FonteMunicipes implements FonteDestinatarios {
  readonly id = 'municipes' as const;
  readonly nome = NOMES_FONTES.municipes;

  constructor(
    private readonly db: Q,
    private readonly avisos: Pick<AvisosZonaService, 'afetados'>,
  ) {}

  async procurar(p: PedidoFonte): Promise<ResultadoFonte> {
    try {
      if (p.zona.geo) {
        const { afetados, excluidos } = await this.avisos.afetados(
          p.municipio,
          p.zona.geo,
          p.desde,
          'emergencia',
          this.db,
        );
        return resultado(
          this.id,
          afetados.map((a) => ({
            telefone_e164: a.telefone_e164,
            municipe_id: a.municipe_id,
            nome: a.nome,
            vulneravel: false,
          })),
          excluidos.sem_telefone
            ? `${excluidos.sem_telefone} munícipes com morada na zona não têm telemóvel registado.`
            : null,
        );
      }
      const linhas = await this.db.query<{
        municipe_id: string;
        freguesia: string;
        telefone_e164: string | null;
        nome: string | null;
      }>(
        `SELECT DISTINCT p.municipe_id, p.freguesia, mu.telefone_e164, mu.nome
         FROM processos p JOIN municipes mu ON mu.id = p.municipe_id
         WHERE p.municipio_id = $1 AND p.criado_em >= $2 AND p.freguesia IS NOT NULL
           AND mu.anonimizado_em IS NULL`,
        [p.municipio.id, p.desde],
      );
      const freguesias = p.zona.freguesias ?? [];
      const na = linhas.filter(
        (l) =>
          freguesiaNaLista(l.freguesia, freguesias) &&
          telefoneParaSms(l.telefone_e164),
      );
      return resultado(
        this.id,
        na.map((l) => ({
          telefone_e164: l.telefone_e164!,
          municipe_id: l.municipe_id,
          nome: l.nome,
          vulneravel: false,
        })),
        'Numa zona por freguesias contam os processos com a freguesia indicada.',
      );
    } catch (e) {
      return falhou(this.id, e);
    }
  }
}

/** Moradas dos contactos de cuidado procuradas no mapa, no máximo. */
export const MAX_GEOCODIFICAR = 200;

/**
 * (b) Contactos de cuidado da ação social na zona (pessoas inscritas, com
 * autorização): pela freguesia ou, numa zona do mapa, pela morada
 * geocodificada. São os mais vulneráveis: os primeiros a ser ligados.
 * Aceita telemóvel e fixo (muitos idosos só têm fixo: são ligados).
 */
export class FonteCuidado implements FonteDestinatarios {
  readonly id = 'cuidado' as const;
  readonly nome = NOMES_FONTES.cuidado;

  constructor(
    private readonly db: Q,
    private readonly geo: Pick<GeocodificacaoService, 'geocodificar'>,
  ) {}

  async procurar(p: PedidoFonte): Promise<ResultadoFonte> {
    try {
      const linhas = await this.db.query<{
        municipe_id: string;
        nome: string;
        morada: string | null;
        freguesia: string | null;
        telefone_e164: string | null;
      }>(
        `SELECT c.municipe_id, c.nome, c.morada, c.freguesia, mu.telefone_e164
         FROM contactos_cuidado c JOIN municipes mu ON mu.id = c.municipe_id
         WHERE c.municipio_id = $1 AND c.ativo AND mu.anonimizado_em IS NULL
         ORDER BY c.nome`,
        [p.municipio.id],
      );
      const com = linhas.filter(
        (l) =>
          telefoneLigavel(l.telefone_e164) || telefoneParaSms(l.telefone_e164),
      );
      const na: typeof com = [];
      let porLocalizar = 0;
      let geocodificadas = 0;
      for (const l of com) {
        if (p.zona.freguesias) {
          if (freguesiaNaLista(l.freguesia, p.zona.freguesias)) na.push(l);
          continue;
        }
        if (!l.morada) {
          porLocalizar++;
          continue;
        }
        if (geocodificadas >= MAX_GEOCODIFICAR) {
          porLocalizar++;
          continue;
        }
        geocodificadas++;
        const c = await this.geo.geocodificar(l.morada, p.municipio.nome);
        if (!c) porLocalizar++;
        else if (pontoNaZonaEmergencia(c, p.zona)) na.push(l);
      }
      return resultado(
        this.id,
        na.map((l) => ({
          telefone_e164: l.telefone_e164!,
          municipe_id: l.municipe_id,
          nome: l.nome,
          vulneravel: true,
        })),
        porLocalizar
          ? `${porLocalizar} pessoas inscritas não têm morada que se encontre no mapa: ficam de fora (use uma zona por freguesias para as incluir).`
          : null,
      );
    } catch (e) {
      return falhou(this.id, e);
    }
  }
}

/**
 * (c) Uma lista carregada à mão (CSV de telefones). É o que se usa na
 * simulação: quem a carrega declara que são números da zona.
 */
export class FonteLista implements FonteDestinatarios {
  readonly id = 'lista' as const;
  readonly nome = NOMES_FONTES.lista;

  procurar(p: PedidoFonte): Promise<ResultadoFonte> {
    return Promise.resolve(
      resultado(
        this.id,
        p.lista.map((l) => ({
          telefone_e164: l.telefone,
          municipe_id: null,
          nome: l.nome ?? null,
          vulneravel: false,
        })),
        p.lista.length
          ? 'Números carregados à mão: quem os carregou garante que são da zona.'
          : 'Nenhum número carregado.',
      ),
    );
  }
}

/**
 * (d) Todas as pessoas na zona: a fonte dos operadores (FonteOperadores, em
 * operadores.ts), simulada por omissão. Pede a estimativa, depois as páginas
 * (cada página falhada volta a ser pedida até TENTATIVAS_PAGINA vezes) e
 * marca cada número com `simulado` quando a fonte é a simulada: esses
 * números nunca saem para um fornecedor (barreira no MensagensService e no
 * ChamadasSaidaService).
 */
export class FonteOperadoresZona implements FonteDestinatarios {
  readonly id = 'operadores' as const;
  readonly nome = NOMES_FONTES.operadores;

  constructor(
    private readonly fonte: FonteOperadores,
    /** Não vale a pena ir além disto: o envio recusa acima do máximo. */
    private readonly maximo = MAX_DESTINATARIOS + 1,
    private readonly tamanho = TAMANHO_PAGINA,
  ) {}

  async procurar(p: PedidoFonte): Promise<ResultadoFonte> {
    const pedido = { municipioId: p.municipio.id, zona: p.zona };
    const simulada = this.fonte.simulada;
    let estimativa: Estimativa;
    try {
      estimativa = await this.fonte.estimar(pedido);
    } catch (e) {
      return this.recusa(e);
    }
    const candidatos: Candidato[] = [];
    let cursor: string | null = null;
    let repetidas = 0;
    let pagina = 0;
    try {
      do {
        let r: PaginaOperadores | null = null;
        for (let t = 1; !r; t++) {
          try {
            r = await this.fonte.pagina(pedido, cursor, this.tamanho);
          } catch (e) {
            if (!(e instanceof ErroFonteOperadores) || t >= TENTATIVAS_PAGINA)
              throw e;
            repetidas++;
          }
        }
        pagina++;
        for (const d of r.destinatarios) {
          candidatos.push({
            telefone_e164: d.telefone_e164,
            municipe_id: null,
            nome: null,
            vulneravel: false,
            simulado: simulada,
            zona_aproximada: d.zona_aproximada,
          });
        }
        cursor = r.seguinte;
      } while (cursor !== null && candidatos.length < this.maximo);
    } catch (e) {
      if (e instanceof ErroApi) return this.recusa(e);
      return {
        ...falhou(this.id, e),
        nota: `${falhou(this.id, e).nota} (página ${pagina + 1}, depois de ${TENTATIVAS_PAGINA} tentativas).`,
        simulada,
      };
    }
    const notas = [
      simulada
        ? 'SIMULADO: números gerados para demonstração (+351 9X 99N NNNN). Ficam registados como enviados (simulado); nenhum SMS nem chamada sai para eles.'
        : null,
      estimativa.nota,
      repetidas
        ? `${repetidas} ${repetidas === 1 ? 'página falhou e foi pedida' : 'páginas falharam e foram pedidas'} de novo.`
        : null,
      cursor !== null
        ? `Mais de ${MAX_DESTINATARIOS} números: o envio fica bloqueado acima do máximo.`
        : null,
    ].filter(Boolean);
    return {
      fonte: this.id,
      nome: this.nome,
      estado: 'ok',
      candidatos,
      nota: notas.join(' '),
      simulada,
      estimativa: {
        pessoas: estimativa.pessoas,
        com_telemovel: estimativa.com_telemovel,
        gerados: estimativa.a_devolver,
        demonstracao: estimativa.demonstracao,
      },
    };
  }

  /** Sem configuração (ou por ligar): 'nao_configurada', com a mensagem. */
  private recusa(e: unknown): ResultadoFonte {
    if (e instanceof ErroApi) {
      return {
        fonte: this.id,
        nome: this.nome,
        estado: 'nao_configurada',
        candidatos: [],
        nota: e.message,
        simulada: false,
        estimativa: null,
      };
    }
    return { ...falhou(this.id, e), simulada: this.fonte.simulada };
  }
}
