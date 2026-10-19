import { Module, OnModuleInit } from '@nestjs/common';
import { RegistoFerramentas } from '../../ferramentas/registo-ferramentas.service.js';
import {
  PagamentosPainelController,
  PagamentosPublicoController,
  PagamentosWebhookController,
} from './pagamentos.controller.js';
import { ferramentasPagamentos } from './pagamentos.ferramentas.js';
import { PagamentosService } from './pagamentos.service.js';

/** Taxas (simulação) e pagamentos em modo de teste. */
@Module({
  controllers: [
    PagamentosWebhookController,
    PagamentosPublicoController,
    PagamentosPainelController,
  ],
  providers: [PagamentosService],
  exports: [PagamentosService],
})
export class PagamentosModule implements OnModuleInit {
  constructor(
    private readonly registo: RegistoFerramentas,
    private readonly pagamentos: PagamentosService,
  ) {}

  onModuleInit() {
    this.registo.registar(...ferramentasPagamentos(this.pagamentos));
  }
}
