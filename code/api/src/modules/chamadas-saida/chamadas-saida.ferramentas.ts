import { z } from 'zod';
import { ferramenta } from '../../ferramentas/ferramenta.js';
import { ChamadasSaidaService } from './chamadas-saida.service.js';

export function ferramentasChamadasSaida(chamadas: ChamadasSaidaService) {
  return [
    ferramenta({
      nome: 'motivo_da_chamada',
      descricao:
        'Numa chamada feita por nós (tipo_chamada = saida): porque ligámos, o que mudou no processo, o que falta e até quando. ' +
        'Usa no início se as variáveis da chamada vierem vazias, ou se a pessoa perguntar outra vez porque lhe ligaram. ' +
        'Se vier chamada_de_saida: false, foi a pessoa que ligou: segue o atendimento normal.',
      entrada: z.object({}),
      async executar(ctx) {
        return chamadas.motivoDaChamada(ctx);
      },
    }),
    ferramenta({
      nome: 'nao_quero_chamadas',
      descricao:
        'A pessoa diz que não quer ser ligada pela câmara ("não me liguem", "prefiro SMS"). ' +
        'Grava a recusa: não voltamos a ligar para avisos (continuam por SMS). ' +
        'Confirma antes de usar se não for claro; depois diz o que vier em dizer.',
      entrada: z.object({}),
      async executar(ctx) {
        return chamadas.naoQueroChamadas(ctx);
      },
    }),
  ];
}
