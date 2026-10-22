import { Global, Module, OnModuleInit } from '@nestjs/common';
import { z } from 'zod';
import { ferramenta } from '../../ferramentas/ferramenta.js';
import { RegistoFerramentas } from '../../ferramentas/registo-ferramentas.service.js';
import { AcompanhamentoFamiliarService } from './acompanhamento.service.js';
import {
  AcompanharPublicoController,
  AoVivoPainelController,
  AoVivoPublicoController,
  ChamadasAoVivoPublicoController,
} from './ao-vivo.controller.js';
import { AoVivoService } from './ao-vivo.service.js';
import { FalasAoVivoService } from './falas.service.js';
import { SimulacaoAoVivoService } from './simulacao.service.js';

/**
 * "A câmara a ouvir em direto": transcrição da chamada web, painel
 * "Chamadas a decorrer" com ajuda ao funcionário, "Fale com o meu filho"
 * na chamada web e os eventos do slide do pitch. Global: a ferramenta
 * `juntar_familiar` (chamadas-saida) usa o AcompanhamentoFamiliarService.
 */
@Global()
@Module({
  controllers: [
    ChamadasAoVivoPublicoController,
    AcompanharPublicoController,
    AoVivoPublicoController,
    AoVivoPainelController,
  ],
  providers: [
    FalasAoVivoService,
    AcompanhamentoFamiliarService,
    AoVivoService,
    SimulacaoAoVivoService,
  ],
  exports: [AcompanhamentoFamiliarService, AoVivoService],
})
export class AoVivoModule implements OnModuleInit {
  constructor(
    private readonly registo: RegistoFerramentas,
    private readonly acompanhamento: AcompanhamentoFamiliarService,
  ) {}

  onModuleInit() {
    this.registo.registar(
      ferramenta({
        nome: 'retirar_familiar',
        descricao:
          'Quando já não quer o familiar a acompanhar: o link dele deixa de funcionar.',
        entrada: z.object({}),
        executar: (ctx) => this.acompanhamento.retirarPeloAgente(ctx),
      }),
    );
  }
}
