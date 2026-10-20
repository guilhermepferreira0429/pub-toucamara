import { z } from 'zod';
import { ferramenta } from '../../ferramentas/ferramenta.js';
import { AvisosZonaService } from './avisos-zona.service.js';

export function ferramentasAvisosZona(avisos: AvisosZonaService) {
  return [
    ferramenta({
      nome: 'nao_quero_avisos',
      descricao:
        'A pessoa diz que não quer receber os avisos por SMS da câmara sobre a zona dela (obras, cortes de água, recolha do lixo, trânsito): ' +
        '"não me mandem mais avisos", "parem com as mensagens". ' +
        'Grava a recusa. Os avisos de emergência (incêndios, cheias) continuam, por segurança: diz isso. ' +
        'Não é para SMS de um pedido ou processo dela (esses continuam). Confirma antes de usar se não for claro; depois diz o que vier em dizer.',
      entrada: z.object({}),
      async executar(ctx) {
        return avisos.naoQueroAvisos(ctx);
      },
    }),
  ];
}
