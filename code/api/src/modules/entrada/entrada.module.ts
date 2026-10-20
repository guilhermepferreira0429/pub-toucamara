import { Module, OnModuleInit } from '@nestjs/common';
import { JobsService } from '../../jobs/jobs.service.js';
import { EntradaController } from './entrada.controller.js';
import { EntradaService, FILA_ENCAMINHAR } from './entrada.service.js';
import { EncaminhamentoAutomaticoService } from './encaminhamento-automatico.service.js';
import type { TipoItem } from './entrada.regras.js';

/**
 * Caixa de entrada única (telefone, chat, email e balcão) com o
 * encaminhamento automático para o serviço e o técnico. O job
 * `encaminhar_entrada` corre de 5 em 5 min (todos os municípios com o
 * encaminhamento ligado) e logo que se regista um pedido de balcão.
 */
@Module({
  controllers: [EntradaController],
  providers: [EntradaService, EncaminhamentoAutomaticoService],
  exports: [EncaminhamentoAutomaticoService],
})
export class EntradaModule implements OnModuleInit {
  constructor(
    private readonly jobs: JobsService,
    private readonly encaminhamento: EncaminhamentoAutomaticoService,
  ) {}

  onModuleInit() {
    this.jobs.trabalhar<{
      municipio_id?: string;
      tipo?: TipoItem;
      id?: string;
    }>(
      FILA_ENCAMINHAR,
      async (d) => {
        if (d.municipio_id && d.tipo && d.id) {
          await this.encaminhamento.encaminharItem(
            d.municipio_id,
            d.tipo,
            d.id,
          );
        } else {
          await this.encaminhamento.encaminharTodos();
        }
      },
      { concorrencia: 1 },
    );
    this.jobs.agendar(FILA_ENCAMINHAR, '*/5 * * * *');
  }
}
