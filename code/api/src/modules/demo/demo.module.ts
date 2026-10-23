import {
  Body,
  Controller,
  Get,
  HttpCode,
  Module,
  Param,
  Post,
} from '@nestjs/common';
import { z } from 'zod';
import { MunicipioAtual, UtilizadorAtual } from '../../common/pedido.js';
import type { UtilizadorPainel } from '../../common/pedido.js';
import { validar } from '../../common/validacao.js';
import { Painel } from '../auth/painel.guard.js';
import type { Municipio } from '../municipios/municipios.service.js';
import { DemoAcertosService } from './demo-acertos.service.js';
import { DemoConhecimentoService } from './demo-conhecimento.service.js';
import { DemoService } from './demo.service.js';
import { DemoVisitanteService } from './demo-visitante.service.js';

const esquemaPreparar = z.object({
  /** Esconder do painel as conversas e ocorrências dos testes (reversível). */
  limpar_testes: z.boolean().optional(),
  /** Sem `true` é só um ensaio: diz o que faria e não muda nada. */
  confirmar: z.boolean().optional(),
  /** Acertar os dados de base com nomes de teste (por omissão sim). */
  acertar_base: z.boolean().optional(),
  // Mexer nas fontes, respostas e avaliações; por omissão só sem fontes próprias.
  conhecimento: z.boolean().optional(),
});

/**
 * Painel · Preparar demo (administração e chefia). Desligado em produção
 * salvo DEMO_ATIVA=true; o estado responde sempre (`ativa: false`), para a
 * barra lateral saber se mostra o item.
 */
@Controller('painel/demo')
@Painel('demo')
export class DemoController {
  constructor(private readonly demo: DemoService) {}

  @Get('estado')
  estado(@MunicipioAtual() m: Municipio) {
    return this.demo.estado(m);
  }

  @Post('preparar')
  @HttpCode(200)
  preparar(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Body() body: unknown,
  ) {
    return this.demo.preparar(m, u, validar(esquemaPreparar, body ?? {}));
  }

  @Post('repor-ocultos')
  @HttpCode(200)
  repor(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
  ) {
    return this.demo.reporOcultos(m, u);
  }
}

const esquemaRenovacao = z.object({ telefone: z.string().min(9).max(20) });

/**
 * "Experimentar uma renovação" no /ligar: uma licença de esplanada de
 * demonstração no número de quem experimenta (só com a demonstração ligada).
 */
@Controller('public/demo')
export class DemoPublicoController {
  constructor(private readonly visitante: DemoVisitanteService) {}

  /** { telefone } → a licença a renovar (a mesma, se já havia uma). */
  @Post(':municipio/renovacao')
  @HttpCode(201)
  renovacao(@Param('municipio') slug: string, @Body() body: unknown) {
    return this.visitante.licencaParaRenovar(
      slug,
      validar(esquemaRenovacao, body ?? {}).telefone,
    );
  }
}

/** A câmara de demonstração pronta com um botão (e `npm run demo:preparar`). */
@Module({
  controllers: [DemoController, DemoPublicoController],
  providers: [
    DemoService,
    DemoConhecimentoService,
    DemoAcertosService,
    DemoVisitanteService,
  ],
  exports: [DemoService],
})
export class DemoModule {}
