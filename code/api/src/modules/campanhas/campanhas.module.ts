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
          'Numa chamada de campanha (a câmara ligou para saber se a pessoa está bem): grava a resposta no fim. ' +
          'Usa "precisa_ajuda" se a pessoa pediu alguma coisa ou se ficaste preocupado; a ação social vê logo no painel. ' +
          'Diz o texto de "dizer". Se vier gravado: false, não é uma chamada de campanha.',
        entrada: entradaResposta,
        executar: (ctx, e) => this.campanhas.resposta(ctx, e),
      }),
    );
  }
}
