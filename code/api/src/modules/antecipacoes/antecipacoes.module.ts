import { Module, OnModuleInit } from '@nestjs/common';
import { ferramenta } from '../../ferramentas/ferramenta.js';
import { RegistoFerramentas } from '../../ferramentas/registo-ferramentas.service.js';
import { JobsService } from '../../jobs/jobs.service.js';
import { AntecipacoesController } from './antecipacoes.controller.js';
import { AntecipacoesDemoService } from './antecipacoes.demo.js';
import {
  AntecipacoesService,
  entradaExplicar,
} from './antecipacoes.service.js';

/** O job diário das antecipações. */
export const FILA_ANTECIPACOES = 'antecipacoes';

/**
 * "A câmara liga-lhe antes de o problema existir": vigia os prazos de cada
 * processo, pedido, pagamento e licença e contacta o munícipe antes (chamada
 * do agente nos importantes, push/SMS no resto); a chefia recebe os alertas
 * dos prazos da câmara.
 */
@Module({
  controllers: [AntecipacoesController],
  providers: [AntecipacoesService, AntecipacoesDemoService],
  exports: [AntecipacoesService],
})
export class AntecipacoesModule implements OnModuleInit {
  constructor(
    private readonly registo: RegistoFerramentas,
    private readonly jobs: JobsService,
    private readonly antecipacoes: AntecipacoesService,
  ) {}

  onModuleInit() {
    this.registo.registar(
      ferramenta({
        nome: 'explicar_momento',
        descricao:
          'Explica à pessoa uma data importante que está a chegar nos assuntos dela: um prazo dela a acabar (documento pedido), a audiência prévia (pode responder antes de a câmara indeferir), o prazo da câmara para decidir, a obra que tem de começar antes de a licença caducar ou a taxa por pagar. ' +
          'Usa numa chamada da câmara com motivo de aviso antecipado, ou quando a pessoa diz que recebeu um aviso ou uma chamada sobre um prazo. Precisa de saber quem é a pessoa. ' +
          'Diz o que vem em "dizer" e depois o que pode fazer. Se confirmar_com_a_camara for true, não garantas o efeito legal: diz que a câmara confirma.',
        entrada: entradaExplicar,
        executar: (ctx, e) => this.antecipacoes.explicar(ctx, e),
      }),
    );
    this.jobs.trabalhar(FILA_ANTECIPACOES, async () => {
      await this.antecipacoes.correr();
    });
    // Todos os dias às 10h17 (Lisboa): já dentro do horário das chamadas.
    this.jobs.agendar(FILA_ANTECIPACOES, '17 10 * * *');
  }
}
