import { Module, OnModuleInit } from '@nestjs/common';
import { ferramenta } from '../../ferramentas/ferramenta.js';
import { RegistoFerramentas } from '../../ferramentas/registo-ferramentas.service.js';
import { JobsService } from '../../jobs/jobs.service.js';
import { PagamentosModule } from '../pagamentos/pagamentos.module.js';
import {
  LicencasPainelController,
  LicencasPublicoController,
} from './licencas.controller.js';
import { DadosComuns, LicencasService } from './licencas.service.js';
import { entradaRenovar, LicencasAvisosService } from './avisos.service.js';
import {
  entradaCamposLicenca,
  entradaPedirLicenca,
  respostaCampos,
  respostaFaltas,
  validarLicenca,
} from './ferramentas.js';

/** O que as duas ferramentas que pedem devolvem (pedir_licenca e renovar_licenca). */
const DEVOLVE =
  'Devolve proposta "aprovar" (cumpre: diz a taxa, as condições e o "dizer") ou "tecnico" (diz que regra falha: um técnico vê e responde por SMS).';

export const FILA_LICENCAS = 'licencas_pagas';
/** Avisos antes de uma licença expirar (todos os dias de manhã). */
export const FILA_AVISOS_LICENCAS = 'licencas_avisos';

/**
 * Licenças decididas na chamada: regras em código, taxa em modo de teste,
 * aprovação num clique e a licença com QR por SMS.
 */
@Module({
  imports: [PagamentosModule],
  controllers: [LicencasPainelController, LicencasPublicoController],
  providers: [LicencasService, LicencasAvisosService],
  // As regras públicas e o verificador usam o mesmo motor.
  exports: [LicencasService],
})
export class LicencasModule implements OnModuleInit {
  constructor(
    private readonly registo: RegistoFerramentas,
    private readonly jobs: JobsService,
    private readonly licencas: LicencasService,
    private readonly avisos: LicencasAvisosService,
  ) {}

  onModuleInit() {
    // Duas ferramentas para os seis tipos (antes era uma por tipo): os campos
    // de cada tipo vêm do seu zod (ferramentas.ts) e a validação também.
    this.registo.registar(
      ferramenta({
        nome: 'campos_da_licenca',
        descricao:
          'Antes de pedir uma licença: os campos a perguntar para esse tipo (pergunta, obrigatório, formato, valores) e notas do tipo.',
        entrada: entradaCamposLicenca,
        executar: (_ctx, e) => Promise.resolve(respostaCampos(e.tipo)),
      }),
      ferramenta({
        nome: 'pedir_licenca',
        descricao:
          'Pede a licença com os dados confirmados e verifica as regras da câmara na hora. ' +
          'Se faltar ou estiver mal algum dado, devolve em_falta/invalidos para perguntares. ' +
          DEVOLVE,
        entrada: entradaPedirLicenca,
        executar: async (ctx, e) => {
          const v = validarLicenca(e.tipo, e.dados);
          if (!v.ok) return respostaFaltas(e.tipo, v);
          const r = await this.licencas.pedir(
            e.tipo,
            ctx,
            v.dados as DadosComuns,
          );
          if (e.tipo !== 'recinto_improvisado' || !v.dados.musica) return r;
          if (!('dizer' in r)) return r;
          return {
            ...r,
            tambem_ruido: true,
            dizer: `${r.dizer} Como vai haver música, precisa também da licença especial de ruído: trato já dela consigo?`,
          };
        },
      }),
      ferramenta({
        nome: 'renovar_licenca',
        descricao:
          'Renova uma licença a expirar (esplanada, dístico, publicidade, ocupação da via) com os dados da anterior. ' +
          '1.ª chamada sem confirmar: devolve os dados (ou escolher: true, e perguntas qual); lê-os, pergunta só o que mudou e chama com confirmar: true e as alteracoes. ' +
          DEVOLVE,
        entrada: entradaRenovar,
        // Também nas chamadas de renovação (motivo renovacao_licenca).
        agentes: ['entrada', 'saida', 'chat'],
        executar: (ctx, e) => this.avisos.renovar(ctx, e),
      }),
    );
    this.jobs.trabalhar(FILA_AVISOS_LICENCAS, async () => {
      await this.avisos.avisar();
    });
    // Todos os dias às 9h47 (Lisboa), dentro do horário em que se pode ligar.
    this.jobs.agendar(FILA_AVISOS_LICENCAS, '47 9 * * *');
    this.jobs.trabalhar(FILA_LICENCAS, async () => {
      await this.licencas.sincronizar();
    });
    this.jobs.agendar(FILA_LICENCAS, '* * * * *');
  }
}
