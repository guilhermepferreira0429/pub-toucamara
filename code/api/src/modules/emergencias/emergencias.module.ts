import { Module, OnModuleInit } from '@nestjs/common';
import { ferramenta } from '../../ferramentas/ferramenta.js';
import { RegistoFerramentas } from '../../ferramentas/registo-ferramentas.service.js';
import { JobsService } from '../../jobs/jobs.service.js';
import { AvisosZonaService } from '../avisos-zona/avisos-zona.service.js';
import { CampanhasModule } from '../campanhas/campanhas.module.js';
import { GeocodificacaoService } from '../ocorrencias/geocodificacao.js';
import { EmergenciasController } from './emergencias.controller.js';
import {
  EmergenciasService,
  entradaResposta,
  FILA_EMERGENCIAS,
} from './emergencias.service.js';

/**
 * Avisos de emergência em massa (SMS a todos e chamadas do agente). As
 * chamadas são uma campanha (módulo campanhas); a escolha dos munícipes por
 * zona é a dos avisos por zona (AvisosZonaService, só a função `afetados`).
 * O job `emergencias_seguimento` (a cada minuto) traz as respostas, alerta
 * quem precisa de ajuda e encerra as que passaram a validade.
 */
@Module({
  imports: [CampanhasModule],
  controllers: [EmergenciasController],
  providers: [EmergenciasService, AvisosZonaService, GeocodificacaoService],
})
export class EmergenciasModule implements OnModuleInit {
  constructor(
    private readonly registo: RegistoFerramentas,
    private readonly jobs: JobsService,
    private readonly emergencias: EmergenciasService,
  ) {}

  onModuleInit() {
    this.registo.registar(
      ferramenta({
        nome: 'resposta_emergencia',
        descricao:
          'Num aviso de emergência da câmara (cheia, incêndio, corte de água, calor), na nossa chamada (em vez de resposta_campanha) ou se a pessoa liga ou escreve por causa dele: grava se está em segurança. ' +
          'precisa_ajuda (ou se ficaste preocupado) alerta logo a câmara e a proteção civil.',
        // Quem recebeu o aviso também pode ligar ou escrever por causa dele.
        agentes: ['entrada', 'saida', 'chat'],
        entrada: entradaResposta,
        executar: (ctx, e) => this.emergencias.resposta(ctx, e),
      }),
    );
    this.jobs.trabalhar(FILA_EMERGENCIAS, () => this.emergencias.processar(), {
      concorrencia: 1,
    });
    this.jobs.agendar(FILA_EMERGENCIAS, '* * * * *');
  }
}
