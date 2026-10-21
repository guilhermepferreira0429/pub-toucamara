import { Module, OnModuleInit } from '@nestjs/common';
import { ferramenta } from '../../ferramentas/ferramenta.js';
import { RegistoFerramentas } from '../../ferramentas/registo-ferramentas.service.js';
import { CampanhasService } from '../campanhas/campanhas.service.js';
import { OcorrenciasModule } from '../ocorrencias/ocorrencias.module.js';
import {
  ConsultasPublicasPainelController,
  ConsultasPublicasPublicoController,
} from './consultas-publicas.controller.js';
import {
  ConsultasPublicasService,
  entradaConsultasAbertas,
  entradaParticipar,
} from './consultas-publicas.service.js';

/**
 * Consulta pública por telefone, com resultados por freguesia. O agente
 * explica a consulta e regista a opinião (telefone, chat e porta das IAs);
 * a página pública deixa participar com o telemóvel. As chamadas a muita
 * gente são as campanhas de sempre (CampanhasService, sem estado próprio).
 */
@Module({
  imports: [OcorrenciasModule],
  controllers: [
    ConsultasPublicasPainelController,
    ConsultasPublicasPublicoController,
  ],
  providers: [ConsultasPublicasService, CampanhasService],
})
export class ConsultasPublicasModule implements OnModuleInit {
  constructor(
    private readonly registo: RegistoFerramentas,
    private readonly consultas: ConsultasPublicasService,
  ) {}

  onModuleInit() {
    this.registo.registar(
      ferramenta({
        nome: 'consultas_abertas',
        descricao:
          'As consultas públicas abertas da câmara (a câmara quer saber o que as pessoas acham de uma obra, de um horário…): ' +
          'o que está em causa, as perguntas com as opções, a pergunta aberta, até quando e quando sai o relatório. ' +
          'Usa quando a pessoa pergunta por consultas, quer dar opinião sobre um projeto da câmara, ou numa chamada de campanha sobre uma consulta (vem desta_chamada). ' +
          'Diz se a pessoa já participou (pode mudar a resposta).',
        entrada: entradaConsultasAbertas,
        executar: (ctx) => this.consultas.consultasAbertas(ctx),
      }),
      ferramenta({
        nome: 'participar_consulta',
        descricao:
          'Regista a participação da pessoa numa consulta pública: a opção escolhida em cada pergunta, a opinião livre (se der) e a freguesia onde mora ' +
          '(pergunta-a; se não souber, manda a morada). Antes, explica a consulta (consultas_abertas) e confirma as respostas com a pessoa. ' +
          'Uma participação por pessoa: se chamar outra vez, substitui a anterior. ' +
          'Se vier registada: true, diz o texto de "dizer". Se vier faltam_respostas ou falta_freguesia, pergunta o que falta e chama outra vez. ' +
          'Se vier precisa_identificacao, segue a instrução. Não digas o que as outras pessoas responderam.',
        entrada: entradaParticipar,
        executar: (ctx, e) => this.consultas.participar(ctx, e),
      }),
    );
  }
}
