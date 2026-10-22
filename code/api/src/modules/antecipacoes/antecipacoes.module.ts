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
          'Num aviso antecipado (ou se a pessoa diz que recebeu um aviso sobre uma data): explica a data que está a chegar (prazo dela, audiência prévia, prazo da câmara, caducidade da obra, taxa) e o que pode fazer. ' +
          'confirmar_com_a_camara: true → não garantas o efeito legal.',
        // Nas chamadas da câmara e no chat (cartão "momento"); ao telefone,
        // quem liga pergunta pelo processo (estado_processo).
        agentes: ['saida', 'chat'],
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
