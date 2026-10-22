import { z } from 'zod';
import { ferramenta } from '../../ferramentas/ferramenta.js';
import { ChamadasSaidaService } from './chamadas-saida.service.js';

export function ferramentasChamadasSaida(chamadas: ChamadasSaidaService) {
  return [
    ferramenta({
      nome: 'motivo_da_chamada',
      descricao:
        'Se as variáveis da chamada vierem vazias ou a pessoa perguntar porque lhe ligámos: o motivo, o que mudou, o que falta e até quando. chamada_de_saida: false → foi a pessoa que ligou.',
      agentes: ['saida'],
      entrada: z.object({}),
      async executar(ctx) {
        return chamadas.motivoDaChamada(ctx);
      },
    }),
    ferramenta({
      nome: 'nao_quero_chamadas',
      descricao:
        'Quando não quer que a câmara lhe ligue ("prefiro SMS"; confirma se não for claro): os avisos passam a ir só por SMS.',
      // Também quando a pessoa liga (ou escreve) depois de uma chamada nossa.
      agentes: ['entrada', 'saida', 'chat'],
      entrada: z.object({}),
      async executar(ctx) {
        return chamadas.naoQueroChamadas(ctx);
      },
    }),
  ];
}
