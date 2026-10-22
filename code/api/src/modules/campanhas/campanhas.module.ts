import { Module, OnModuleInit } from '@nestjs/common';
import { ferramenta } from '../../ferramentas/ferramenta.js';
import { RegistoFerramentas } from '../../ferramentas/registo-ferramentas.service.js';
import { CampanhasController } from './campanhas.controller.js';
import { CampanhasService, entradaResposta } from './campanhas.service.js';

/**
 * Campanhas de contacto (ação social): "Onda de calor, ligar a todos".
 * As chamadas saem pelo módulo das chamadas de saída (motivo 'campanha').
 */
@Module({
  controllers: [CampanhasController],
  providers: [CampanhasService],
  exports: [CampanhasService],
})
export class CampanhasModule implements OnModuleInit {
  constructor(
    private readonly registo: RegistoFerramentas,
    private readonly campanhas: CampanhasService,
  ) {}

  onModuleInit() {
    this.registo.registar(
      ferramenta({
        nome: 'resposta_campanha',
        descricao:
          'No fim de uma chamada de campanha (saber se a pessoa está bem): grava a resposta; precisa_ajuda aparece logo à ação social. gravado: false → não é campanha.',
        agentes: ['saida'],
        entrada: entradaResposta,
        executar: (ctx, e) => this.campanhas.resposta(ctx, e),
      }),
    );
  }
}
