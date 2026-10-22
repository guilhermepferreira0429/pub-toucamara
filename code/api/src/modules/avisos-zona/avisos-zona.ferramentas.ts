import { z } from 'zod';
import { ferramenta } from '../../ferramentas/ferramenta.js';
import { AvisosZonaService } from './avisos-zona.service.js';

export function ferramentasAvisosZona(avisos: AvisosZonaService) {
  return [
    ferramenta({
      nome: 'nao_quero_avisos',
      descricao:
        'Quando não quer mais os SMS de avisos da zona (obras, água, lixo, trânsito; confirma se não for claro). Os de emergência e os dos pedidos dela continuam.',
      entrada: z.object({}),
      async executar(ctx) {
        return avisos.naoQueroAvisos(ctx);
      },
    }),
  ];
}
