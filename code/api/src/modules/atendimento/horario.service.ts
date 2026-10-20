import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service.js';
import { MunicipiosService } from '../municipios/municipios.service.js';
import {
  estaAberto,
  Horario,
  HORARIO_POR_OMISSAO,
  horarioSimples,
  HorarioSimples,
  lerHorario,
  prazoResposta,
  proximaAbertura,
} from './horario.js';

// O horário do balcão muda poucas vezes por ano; o agente pergunta a cada chamada.
const VALIDADE_MS = 60_000;

interface Contexto {
  horario: Horario;
  fuso: string;
  feriados: ReadonlySet<string>;
}

/**
 * Horário de atendimento da câmara: o contacto `balcao` da entidade `camara`
 * do município (sem horário configurado, seg-sex 9h-17h), com os feriados
 * nacionais e municipais e no fuso do município. Usado na passagem a
 * funcionário, no fim da chamada (`conversas.fora_de_horas`) e para dizer se
 * o contacto de outra entidade está aberto agora.
 */
@Injectable()
export class HorarioService {
  private cache = new Map<string, { horario: Horario; ate: number }>();

  constructor(
    private readonly db: DatabaseService,
    private readonly municipios: MunicipiosService,
  ) {}

  private async balcao(municipioId: string): Promise<Horario> {
    const emCache = this.cache.get(municipioId);
    if (emCache && emCache.ate > Date.now()) return emCache.horario;
    const linhas = await this.db.query<{ horario: unknown }>(
      `SELECT c.horario FROM entidade_contactos c
       JOIN entidades e ON e.id = c.entidade_id
       WHERE e.municipio_id = $1 AND e.tipo = 'camara' AND e.ativo
         AND c.tipo = 'balcao' AND c.horario IS NOT NULL
       ORDER BY e.nome, c.rotulo NULLS LAST, c.id`,
      [municipioId],
    );
    // Vários balcões: vale o primeiro com um horário que se perceba.
    const horario =
      linhas.map((l) => lerHorario(l.horario)).find((h) => h !== null) ??
      HORARIO_POR_OMISSAO;
    this.cache.set(municipioId, { horario, ate: Date.now() + VALIDADE_MS });
    return horario;
  }

  private async contexto(municipioId: string): Promise<Contexto> {
    const [horario, municipio, feriados] = await Promise.all([
      this.balcao(municipioId),
      this.municipios.porId(municipioId),
      this.municipios.feriados(municipioId),
    ]);
    return { horario, fuso: municipio.fuso, feriados };
  }

  /** Fora do horário do balcão (fim de semana, feriado, antes/depois/almoço). */
  async foraDeHoras(municipioId: string, em: Date): Promise<boolean> {
    const c = await this.contexto(municipioId);
    return !estaAberto(c.horario, em, c.fuso, c.feriados);
  }

  /** Início do próximo período de atendimento; se está aberto, é `em`. */
  async proximoAtendimento(municipioId: string, em: Date): Promise<Date> {
    const c = await this.contexto(municipioId);
    return proximaAbertura(c.horario, em, c.fuso, c.feriados);
  }

  /**
   * Tudo o que a passagem a funcionário precisa de uma vez: se está fora de
   * horas e até quando se responde (ver `prazoResposta`).
   */
  async paraPassagem(
    municipioId: string,
    em: Date,
  ): Promise<{ foraDeHoras: boolean; responderAte: Date; fuso: string }> {
    const c = await this.contexto(municipioId);
    const proximo = proximaAbertura(c.horario, em, c.fuso, c.feriados);
    return {
      foraDeHoras: !estaAberto(c.horario, em, c.fuso, c.feriados),
      responderAte: prazoResposta(proximo, c.fuso, c.feriados),
      fuso: c.fuso,
    };
  }

  /** O horário do balcão (o mesmo das contas acima) para mostrar no painel. */
  async balcaoSimples(municipioId: string): Promise<HorarioSimples> {
    return horarioSimples(await this.balcao(municipioId));
  }

  async fuso(municipioId: string): Promise<string> {
    return (await this.municipios.porId(municipioId)).fuso;
  }

  /**
   * Se um contacto qualquer (linha de avarias, balcão de outra entidade) está
   * aberto. Sem horário, ou um que não se perceba → null: o agente não deve
   * afirmar que está aberto. Devolve uma função para verificar vários
   * contactos seguidos sem voltar à BD.
   */
  async verificador(
    municipioId: string,
  ): Promise<(horarioJson: unknown, em: Date) => boolean | null> {
    const [municipio, feriados] = await Promise.all([
      this.municipios.porId(municipioId),
      this.municipios.feriados(municipioId),
    ]);
    return (json, em) => {
      const h = lerHorario(json);
      return h ? estaAberto(h, em, municipio.fuso, feriados) : null;
    };
  }
}
