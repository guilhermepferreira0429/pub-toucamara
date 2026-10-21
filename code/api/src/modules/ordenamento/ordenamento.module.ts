import {
  Controller,
  Get,
  HttpCode,
  Module,
  OnModuleInit,
  Param,
  Post,
} from '@nestjs/common';
import { MunicipioAtual, UtilizadorAtual } from '../../common/pedido.js';
import type { UtilizadorPainel } from '../../common/pedido.js';
import { ferramenta } from '../../ferramentas/ferramenta.js';
import { RegistoFerramentas } from '../../ferramentas/registo-ferramentas.service.js';
import { Painel } from '../auth/painel.guard.js';
import type { Municipio } from '../municipios/municipios.service.js';
import { OcorrenciasModule } from '../ocorrencias/ocorrencias.module.js';
import {
  entradaOQuePossoFazer,
  OrdenamentoService,
} from './ordenamento.service.js';

/** Painel · Ordenamento: as zonas do PDM e o que as pessoas perguntam onde. */
@Controller('painel/ordenamento')
@Painel('conhecimento_ver')
export class OrdenamentoPainelController {
  constructor(private readonly ordenamento: OrdenamentoService) {}

  @Get()
  ver(@MunicipioAtual() m: Municipio) {
    return this.ordenamento.painel(m);
  }

  @Post('demonstracao')
  @HttpCode(201)
  @Painel('conhecimento')
  demonstracao(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
  ) {
    return this.ordenamento.carregarDemonstracao(m, u);
  }
}

/** A página do link do SMS: a planta com a zona e os passos. */
@Controller('public/consultas-pdm')
export class OrdenamentoPublicoController {
  constructor(private readonly ordenamento: OrdenamentoService) {}

  @Get(':codigo')
  ver(@Param('codigo') codigo: string) {
    return this.ordenamento.publico(codigo);
  }
}

@Module({
  imports: [OcorrenciasModule],
  controllers: [OrdenamentoPainelController, OrdenamentoPublicoController],
  providers: [OrdenamentoService],
})
export class OrdenamentoModule implements OnModuleInit {
  constructor(
    private readonly registo: RegistoFerramentas,
    private readonly ordenamento: OrdenamentoService,
  ) {}

  onModuleInit() {
    this.registo.registar(
      ferramenta({
        nome: 'o_que_posso_fazer',
        descricao:
          'Diz o que é preciso para uma obra numa morada concreta, pelo plano diretor municipal (PDM): isento, comunicação prévia, licença ou não permitido. ' +
          'Usa quando a pessoa diz o que quer fazer e onde ("quero fazer um anexo no quintal, na Rua X"). ' +
          'Se vier em_falta, pergunta a área ou a altura e chama outra vez. Diz o "dizer", os limites e os passos; a planta e os passos seguem por SMS. ' +
          'Se a pessoa quiser avançar com comunicação prévia, podes preencher o requerimento com iniciar_requerimento.',
        entrada: entradaOQuePossoFazer,
        executar: (ctx, e) => this.ordenamento.oQuePossoFazer(ctx, e),
      }),
    );
  }
}
