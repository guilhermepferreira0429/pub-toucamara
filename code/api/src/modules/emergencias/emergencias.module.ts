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
          'Num aviso de emergência da câmara (cheia, incêndio, corte de água, calor extremo): grava se a pessoa está em segurança ou precisa de ajuda. ' +
          'Nas chamadas de emergência (motivo_da_chamada com mensagem de emergência) usa esta em vez de resposta_campanha. ' +
          'Também serve se a pessoa ligar ou escrever ela própria por causa do aviso. ' +
          'Usa "precisa_ajuda" se pedir ajuda (para sair de casa, saúde, água...) ou se ficaste preocupado: a câmara e a proteção civil recebem logo um alerta. ' +
          'Se houver perigo imediato para a vida, diz para ligar já 112. Diz o texto de "dizer".',
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
