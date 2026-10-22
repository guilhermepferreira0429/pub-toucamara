import type { ContextoFerramenta } from '../../ferramentas/ferramenta.js';
import {
  camposDe,
  dadosDe,
  type ParCampo,
  validarDados,
} from '../../ferramentas/campos-zod.js';
import {
  AREAS,
  type AreaServico,
  LISTA_AREAS,
  RegistoServicos,
} from '../../ferramentas/servicos.js';

/** O resultado de `outros_servicos`. */
export function respostaCatalogo(registo: RegistoServicos, area?: string) {
  if (!area) {
    return {
      areas: LISTA_AREAS.map((a) => ({
        area: a,
        o_que_e: AREAS[a],
        acoes: registo
          .daArea(a)
          .map((s) => ({ acao: s.acao, titulo: s.titulo })),
      })).filter((a) => a.acoes.length > 0),
      instrucao:
        'Escolhe a área do pedido e chama outros_servicos com ela para ver os campos.',
    };
  }
  const acoes = registo.daArea(area as AreaServico);
  if (!acoes.length) {
    return {
      area,
      acoes: [],
      dizer: 'Esse serviço ainda não se trata por aqui.',
      instrucao:
        'Procura no conhecimento (procurar_conhecimento) ou passa a um funcionário.',
    };
  }
  return {
    area,
    acoes: acoes.map((s) => ({
      acao: s.acao,
      titulo: s.titulo,
      quando: s.quando,
      ...(s.altera ? { altera: true } : {}),
      campos: camposDe(s.entrada),
    })),
    instrucao:
      'Escolhe a ação, pergunta os campos obrigatórios um de cada vez (os outros só se a pessoa souber) e chama pedir_servico. Se altera: true, lê os dados de volta e espera pelo sim antes.',
  };
}

/** O resultado de `pedir_servico`. */
export async function respostaPedido(
  registo: RegistoServicos,
  ctx: ContextoFerramenta,
  area: string,
  acao: string,
  dados: ParCampo[],
) {
  const s = registo.obter(area, acao);
  const v = validarDados(s.entrada, dadosDe(s.entrada, dados));
  if (!v.ok) {
    const partes = [
      ...v.em_falta.map((f) => f.pergunta.replace(/\.$/, '').toLowerCase()),
      ...v.invalidos.map((x) => `${x.campo.replace(/_/g, ' ')} ${x.problema}`),
    ];
    return {
      feito: false,
      motivo: v.em_falta.length ? 'faltam_dados' : 'dados_invalidos',
      em_falta: v.em_falta,
      invalidos: v.invalidos,
      dizer: `Preciso de saber: ${partes.join('; ')}.`,
    };
  }
  return s.executar(ctx, v.dados);
}
