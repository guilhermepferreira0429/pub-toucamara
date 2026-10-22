/*
 * O catálogo de serviços municipais (V4): escolas, reservas, estacionamento,
 * habitação, cemitérios, animais, água… Em vez de uma ferramenta por ação
 * (o agente de voz já leva ~8 mil tokens de ferramentas), cada módulo regista
 * aqui as suas ações e o agente vê só duas ferramentas:
 *
 * - `outros_servicos(area?)`: sem área, as áreas e as ações de cada uma;
 *   com área, as ações com os campos a perguntar (do zod de cada ação);
 * - `pedir_servico(area, acao, dados)`: valida com o zod da ação (o que
 *   falta volta em português, como no pedir_licenca) e corre.
 *
 * Registar (no onModuleInit do módulo):
 *
 *   this.servicos.registar(servico({
 *     area: 'cemiterios',
 *     acao: 'procurar_sepultura',
 *     titulo: 'Onde está sepultada uma pessoa',
 *     quando: 'Quando quer saber onde está a sepultura de um familiar.',
 *     entrada: z.object({ nome: z.string().min(3).describe('Nome da pessoa falecida.') }),
 *     executar: (ctx, e) => this.cemiterios.procurar(ctx, e),
 *   }));
 *
 * O resultado segue as regras gerais (ferramentas/regras-gerais.ts): "dizer",
 * precisa_identificacao + instrucao, confirmado, valores de demonstração.
 */
import { HttpStatus, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { ErroApi } from '../common/erros.js';
import type { ContextoFerramenta } from './ferramenta.js';

/** As áreas do catálogo (a ordem é a da lista que o agente ouve). */
export const AREAS = {
  escolas: 'escolas: inscrições, refeições, transporte escolar, atividades',
  reservas: 'reservas de pavilhões, piscinas, auditórios e bilhetes',
  estacionamento: 'estacionamento: multas, parques, lugares para deficientes',
  habitacao: 'habitação municipal: candidaturas, rendas, reparações',
  cemiterios: 'cemitérios: sepulturas, concessões, taxas',
  animais: 'animais: canil, adoções, animais perdidos, registo',
  agua: 'água e saneamento (Vimágua): leituras, faturas, avarias',
} as const;
export type AreaServico = keyof typeof AREAS;
export const LISTA_AREAS = Object.keys(AREAS) as AreaServico[];

export interface ServicoMunicipal<E extends z.ZodObject = z.ZodObject> {
  area: AreaServico;
  /** snake_case, único dentro da área. */
  acao: string;
  /** O que é, curto ("Inscrever na cantina"). */
  titulo: string;
  /** Quando usar, numa frase (é o que o modelo lê para escolher). */
  quando: string;
  /** Os campos: cada um com .describe() = a pergunta a fazer. */
  entrada: E;
  /** Muda alguma coisa em nome da pessoa? (o agente lê os dados de volta antes) */
  altera?: boolean;
  executar(ctx: ContextoFerramenta, entrada: z.output<E>): Promise<unknown>;
}

/** Só para inferir o tipo da entrada no `executar`. */
export function servico<E extends z.ZodObject>(
  s: ServicoMunicipal<E>,
): ServicoMunicipal {
  return s;
}

@Injectable()
export class RegistoServicos {
  private readonly servicos = new Map<string, ServicoMunicipal>();

  registar(...lista: ServicoMunicipal[]): void {
    for (const s of lista) {
      const chave = `${s.area}/${s.acao}`;
      if (this.servicos.has(chave))
        throw new Error(`Serviço registado duas vezes: ${chave}`);
      this.servicos.set(chave, s);
    }
  }

  todos(): ServicoMunicipal[] {
    return [...this.servicos.values()];
  }

  daArea(area: AreaServico): ServicoMunicipal[] {
    return this.todos().filter((s) => s.area === area);
  }

  obter(area: string, acao: string): ServicoMunicipal {
    const s = this.servicos.get(`${area}/${acao}`);
    if (!s) {
      const da = LISTA_AREAS.includes(area as AreaServico)
        ? this.daArea(area as AreaServico)
        : [];
      throw new ErroApi(
        HttpStatus.NOT_FOUND,
        'servico_desconhecido',
        da.length
          ? `A área ${area} não tem a ação "${acao}". Ações: ${da.map((x) => x.acao).join(', ')}.`
          : `Não há a área "${area}". Use outros_servicos para ver as áreas.`,
      );
    }
    return s;
  }
}
