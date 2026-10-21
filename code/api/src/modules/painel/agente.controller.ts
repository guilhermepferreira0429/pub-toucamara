import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Ip,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import { z } from 'zod';
import { MunicipioAtual, UtilizadorAtual } from '../../common/pedido.js';
import type { UtilizadorPainel } from '../../common/pedido.js';
import { validar } from '../../common/validacao.js';
import { Painel } from '../auth/painel.guard.js';
import type { Municipio } from '../municipios/municipios.service.js';
import { AgenteService } from './agente.service.js';
import {
  COMPORTAMENTOS,
  PerguntasCamaraService,
} from './perguntas-camara.service.js';

const esquemaConfig = z.object({
  nome: z.string().trim().min(1).max(60),
  saudacao: z.string().trim().min(1).max(500),
  trata_por: z.string().trim().min(1).max(40),
  idiomas: z
    .array(z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/, 'Ex.: pt-PT, en, es.'))
    .min(1)
    .max(10),
  voz_id: z.string().trim().max(100).nullish(),
  voz_nome: z.string().trim().max(80).nullish(),
  ritmo: z.enum(['calmo', 'normal', 'rapido']).default('normal'),
});

const esquemaPerguntaCamara = z.object({
  texto: z.string().trim().min(5).max(500),
  comportamento: z.enum(COMPORTAMENTOS).default('responder'),
  nota: z.string().trim().max(300).nullish(),
});

const esquemaPronuncias = z.object({
  itens: z
    .array(
      z.object({
        termo: z.string().trim().min(1).max(100),
        como_se_diz: z.string().trim().min(1).max(200),
      }),
    )
    .max(500),
});

const esquemaRegra = z.object({
  assunto: z.string().trim().min(2).max(200),
  entidade_id: z.uuid(),
  contacto_id: z.uuid().nullish(),
  passa_a_pessoa: z.string().trim().max(300).nullish(),
  prioridade: z.number().int().min(0).max(1000).optional(),
  ativo: z.boolean().optional(),
});

const esquemaAlterarRegra = esquemaRegra
  .partial()
  .refine((r) => Object.keys(r).length > 0, 'Nada para alterar.');

/**
 * Agente: configuração, pronúncias e "Quem trata de quê". Quem tem o recurso
 * 'agente' vê; na v1 só admin/equipa_toucamara grava (403 so_equipa_interna).
 */
@Controller('painel/agente')
@Painel('agente')
export class AgenteController {
  constructor(
    private readonly agente: AgenteService,
    private readonly perguntasCamara: PerguntasCamaraService,
  ) {}

  @Get()
  obter(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
  ) {
    return this.agente.obter(m, u);
  }

  @Put()
  gravar(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Body() body: unknown,
    @Ip() ip: string,
  ) {
    return this.agente.gravarConfig(m, u, validar(esquemaConfig, body), ip);
  }

  @Get('pronuncias')
  async pronuncias(@MunicipioAtual() m: Municipio) {
    return { itens: await this.agente.pronuncias(m) };
  }

  /** Substitui a lista inteira. */
  @Put('pronuncias')
  async gravarPronuncias(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Body() body: unknown,
    @Ip() ip: string,
  ) {
    const { itens } = validar(esquemaPronuncias, body);
    return { itens: await this.agente.gravarPronuncias(m, u, itens, ip) };
  }

  @Get('regras')
  async regras(@MunicipioAtual() m: Municipio) {
    return { itens: await this.agente.regras(m) };
  }

  @Post('regras')
  criarRegra(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Body() body: unknown,
    @Ip() ip: string,
  ) {
    return this.agente.criarRegra(m, u, validar(esquemaRegra, body), ip);
  }

  @Patch('regras/:id')
  alterarRegra(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @Ip() ip: string,
  ) {
    return this.agente.alterarRegra(
      m,
      u,
      id,
      validar(esquemaAlterarRegra, body),
      ip,
    );
  }

  @Delete('regras/:id')
  @HttpCode(204)
  async apagarRegra(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('id', ParseUUIDPipe) id: string,
    @Ip() ip: string,
  ) {
    await this.agente.apagarRegra(m, u, id, ip);
  }

  // --- As perguntas da câmara (corridas pelo avaliador) -------------------

  @Get('perguntas')
  perguntas(@MunicipioAtual() m: Municipio) {
    return this.perguntasCamara.listar(m);
  }

  @Post('perguntas')
  acrescentarPergunta(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Body() body: unknown,
  ) {
    return this.perguntasCamara.acrescentar(
      m,
      u,
      validar(esquemaPerguntaCamara, body),
    );
  }

  @Delete('perguntas/:id')
  removerPergunta(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.perguntasCamara.remover(m, u, id);
  }
}
