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
import { AgoraModule } from './modules/agora/agora.module.js';
import { NotificacoesModule } from './modules/notificacoes/notificacoes.module.js';
import { ArmazenamentoModule } from './modules/armazenamento/armazenamento.module.js';
import { AtendimentoModule } from './modules/atendimento/atendimento.module.js';
import { AuditoriaModule } from './modules/auditoria/auditoria.service.js';
import { AvisosZonaModule } from './modules/avisos-zona/avisos-zona.module.js';
import { EmergenciasModule } from './modules/emergencias/emergencias.module.js';
import { EntradaModule } from './modules/entrada/entrada.module.js';
import { IntegracoesModule } from './modules/integracoes/integracoes.module.js';
import { ModelosModule } from './modules/modelos/modelos.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { ChamadasSaidaModule } from './modules/chamadas-saida/chamadas-saida.module.js';
import { DocsModule } from './modules/docs/docs.module.js';
import { SmsEntradaModule } from './modules/sms-entrada/sms-entrada.module.js';
import { WhatsappModule } from './modules/whatsapp/whatsapp.module.js';
import { ChatModule } from './modules/chat/chat.module.js';
import { ComunicacaoModule } from './modules/comunicacao/comunicacao.module.js';
import { ConhecimentoModule } from './modules/conhecimento/conhecimento.module.js';
import { ConversasModule } from './modules/conversas/conversas.module.js';
import { EmailsModule } from './modules/emails/emails.module.js';
import { EmpresasModule } from './modules/empresas/empresas.module.js';
import { MarcacoesModule } from './modules/marcacoes/marcacoes.module.js';
import { MunicipesModule } from './modules/municipes/municipes.module.js';
import { MunicipiosModule } from './modules/municipios/municipios.module.js';
import { OcorrenciasModule } from './modules/ocorrencias/ocorrencias.module.js';
import { PagamentosModule } from './modules/pagamentos/pagamentos.module.js';
import { PainelModule } from './modules/painel/painel.module.js';
import { CampanhasModule } from './modules/campanhas/campanhas.module.js';
import { ConsultasPublicasModule } from './modules/consultas-publicas/consultas-publicas.module.js';
import { LicencasModule } from './modules/licencas/licencas.module.js';
import { LinguagemSimplesModule } from './modules/linguagem-simples/linguagem-simples.module.js';
import { ApoiosModule } from './modules/apoios/apoios.module.js';
import { AppMunicipeModule } from './modules/app-municipe/app-municipe.module.js';
import { EquipaCampoModule } from './modules/equipa-campo/equipa-campo.module.js';
import { PushModule } from './modules/app-municipe/push.module.js';
import { ArquivoModule } from './modules/arquivo/arquivo.module.js';
import { OrdenamentoModule } from './modules/ordenamento/ordenamento.module.js';
import { RegrasPublicasModule } from './modules/regras-publicas/regras-publicas.module.js';
import { RegrasVersoesModule } from './modules/regras-publicas/versoes.service.js';
import { FiscalizacaoModule } from './modules/fiscalizacao/fiscalizacao.module.js';
import { ReclamacoesModule } from './modules/reclamacoes/reclamacoes.module.js';
import { ReunioesModule } from './modules/reunioes/reunioes.module.js';
import { ContratacaoModule } from './modules/contratacao/contratacao.module.js';
import { PortaIasModule } from './modules/porta-ias/porta-ias.module.js';
import { PerguntasChefiaModule } from './modules/perguntas-chefia/perguntas-chefia.module.js';
import { ProcedimentosModule } from './modules/procedimentos/procedimentos.module.js';
import { ProcessosModule } from './modules/processos/processos.module.js';
import { RelatoriosModule } from './modules/relatorios/relatorios.module.js';
import { RequerimentosModule } from './modules/requerimentos/requerimentos.module.js';
import { TransparenciaModule } from './modules/transparencia/transparencia.module.js';
import { EntregasModule } from './modules/entregas/entregas.module.js';

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
    NotificacoesModule,
    ArmazenamentoModule,
    AuthModule,
    AgentToolsModule,
    // Push para a app do munícipe (global: avisos, emergências, processos).
    PushModule,
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
    DocsModule,
    SmsEntradaModule,
    WhatsappModule,
    CampanhasModule,
    LicencasModule,
    OrdenamentoModule,
    EmpresasModule,
    // Regras públicas e verificáveis (histórico das regras, verificador)
    RegrasVersoesModule,
    RegrasPublicasModule,
    ApoiosModule,
    // V2
    EntradaModule,
    ModelosModule,
    IntegracoesModule,
    AvisosZonaModule,
    EmergenciasModule,
    AgoraModule,
    // Memória da câmara: procedimentos internos, entrevistas e assistente
    ProcedimentosModule,
    ConsultasPublicasModule,
    // Porta para as IAs (MCP)
    PortaIasModule,
    ReclamacoesModule,
    ReunioesModule,
    ContratacaoModule,
    // Transparência: dados abertos e indicadores no portal
    TransparenciaModule,
    EntregasModule,
    FiscalizacaoModule,
    // Arquivo antigo digitalizado e pedidos de consulta
    ArquivoModule,
    // App dos munícipes (Flutter): entrar com o telemóvel, os seus dados, push
    AppMunicipeModule,
    EquipaCampoModule,
    // Editais e regulamentos em linguagem simples e glossário administrativo
    LinguagemSimplesModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
