import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import {
  agenteConfig,
  appConfig,
  armazenamentoConfig,
  authConfig,
  comunicacaoConfig,
  databaseConfig,
  embeddingsConfig,
  iaConfig,
  jobsConfig,
  webhooksConfig,
} from './config/configuration.js';
import { DatabaseModule } from './database/database.module.js';
import { FerramentasModule } from './ferramentas/ferramentas.module.js';
import { IaModule } from './ia/ia.module.js';
import { JobsModule } from './jobs/jobs.module.js';
import { AgentToolsModule } from './modules/agent-tools/agent-tools.module.js';
import { ArmazenamentoModule } from './modules/armazenamento/armazenamento.module.js';
import { AtendimentoModule } from './modules/atendimento/atendimento.module.js';
import { AuditoriaModule } from './modules/auditoria/auditoria.service.js';
import { AvisosZonaModule } from './modules/avisos-zona/avisos-zona.module.js';
import { EntradaModule } from './modules/entrada/entrada.module.js';
import { IntegracoesModule } from './modules/integracoes/integracoes.module.js';
import { ModelosModule } from './modules/modelos/modelos.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { ChamadasSaidaModule } from './modules/chamadas-saida/chamadas-saida.module.js';
import { ChatModule } from './modules/chat/chat.module.js';
import { ComunicacaoModule } from './modules/comunicacao/comunicacao.module.js';
import { ConhecimentoModule } from './modules/conhecimento/conhecimento.module.js';
import { ConversasModule } from './modules/conversas/conversas.module.js';
import { EmailsModule } from './modules/emails/emails.module.js';
import { MarcacoesModule } from './modules/marcacoes/marcacoes.module.js';
import { MunicipesModule } from './modules/municipes/municipes.module.js';
import { MunicipiosModule } from './modules/municipios/municipios.module.js';
import { OcorrenciasModule } from './modules/ocorrencias/ocorrencias.module.js';
import { PagamentosModule } from './modules/pagamentos/pagamentos.module.js';
import { PainelModule } from './modules/painel/painel.module.js';
import { CampanhasModule } from './modules/campanhas/campanhas.module.js';
import { LicencasModule } from './modules/licencas/licencas.module.js';
import { OrdenamentoModule } from './modules/ordenamento/ordenamento.module.js';
import { PortaIasModule } from './modules/porta-ias/porta-ias.module.js';
import { PerguntasChefiaModule } from './modules/perguntas-chefia/perguntas-chefia.module.js';
import { ProcessosModule } from './modules/processos/processos.module.js';
import { RelatoriosModule } from './modules/relatorios/relatorios.module.js';
import { RequerimentosModule } from './modules/requerimentos/requerimentos.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [
        appConfig,
        databaseConfig,
        agenteConfig,
        iaConfig,
        embeddingsConfig,
        authConfig,
        jobsConfig,
        comunicacaoConfig,
        armazenamentoConfig,
        webhooksConfig,
      ],
    }),
    // Base partilhada (global): qualquer módulo injeta estes serviços.
    DatabaseModule,
    JobsModule,
    IaModule,
    FerramentasModule,
    AuditoriaModule,
    MunicipiosModule,
    MunicipesModule,
    ConversasModule,
    ComunicacaoModule,
    ArmazenamentoModule,
    AuthModule,
    AgentToolsModule,
    // Domínios.
    ConhecimentoModule,
    AtendimentoModule,
    RequerimentosModule,
    ProcessosModule,
    OcorrenciasModule,
    PagamentosModule,
    MarcacoesModule,
    ChatModule,
    EmailsModule,
    PainelModule,
    RelatoriosModule,
    PerguntasChefiaModule,
    ChamadasSaidaModule,
    CampanhasModule,
    LicencasModule,
    OrdenamentoModule,
    // V2
    EntradaModule,
    ModelosModule,
    IntegracoesModule,
    AvisosZonaModule,
    // Porta para as IAs (MCP)
    PortaIasModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
