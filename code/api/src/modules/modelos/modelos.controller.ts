import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { z } from 'zod';
import { esquemaPaginacao } from '../../common/paginacao.js';
import { MunicipioAtual, UtilizadorAtual } from '../../common/pedido.js';
import type { UtilizadorPainel } from '../../common/pedido.js';
import { validar } from '../../common/validacao.js';
import { Painel } from '../auth/painel.guard.js';
import type { Municipio } from '../municipios/municipios.service.js';
import { CANAIS_MODELO, ESTADOS_MODELO, VARIAVEIS } from './modelos.js';
import { ModelosService } from './modelos.service.js';

const uuid = new ParseUUIDPipe();

const nome = z.string().trim().min(3).max(200);
// O limite dos SMS (CORPO_SMS_MAX) vê-se no serviço, que sabe o canal.
const corpo = z.string().trim().min(1).max(20_000);

const esquemaNovo = z.object({ canal: z.enum(CANAIS_MODELO), nome, corpo });

const esquemaMudanca = z
  .object({
    nome: nome.optional(),
    corpo: corpo.optional(),
    estado: z.enum(['rascunho', 'a_rever', 'aprovado']).optional(),
  })
  .refine((x) => Object.keys(x).length > 0, 'Nada para mudar.');

/**
 * Modelos de resposta aprovados pela câmara (ofícios, emails, SMS). Ler:
 * 'processos' (técnico e chefe de divisão). Escrever e aprovar:
 * 'conhecimento' (chefe de divisão). Estados: rascunho → a_rever →
 * aprovado; editar um aprovado cria a versão seguinte.
 */
@Controller('painel/modelos')
export class ModelosController {
  constructor(private readonly svc: ModelosService) {}

  /** As variáveis que um corpo pode usar, com o que cada uma vale. */
  @Get('variaveis')
  @Painel('processos')
  variaveis() {
    return {
      itens: Object.entries(VARIAVEIS).map(([n, v]) => ({
        nome: n,
        marcador: `{${n}}`,
        ...v,
      })),
    };
  }

  @Get()
  @Painel('processos')
  listar(@MunicipioAtual() m: Municipio, @Query() q: unknown) {
    const f = validar(
      esquemaPaginacao.extend({
        canal: z.enum(CANAIS_MODELO).optional(),
        estado: z.enum(ESTADOS_MODELO).optional(),
        q: z.string().trim().min(1).max(100).optional(),
      }),
      q,
    );
    return this.svc.listar(m.id, f, f.limite, f.cursor);
  }

  @Post()
  @Painel('conhecimento')
  criar(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Body() body: unknown,
  ) {
    return this.svc.criar(m.id, u, validar(esquemaNovo, body));
  }

  @Get(':id')
  @Painel('processos')
  ver(@MunicipioAtual() m: Municipio, @Param('id', uuid) id: string) {
    return this.svc.ver(m.id, id);
  }

  /** Corpo: { nome?, corpo?, estado? }. */
  @Patch(':id')
  @Painel('conhecimento')
  atualizar(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('id', uuid) id: string,
    @Body() body: unknown,
  ) {
    return this.svc.atualizar(m.id, u, id, validar(esquemaMudanca, body));
  }

  /** Corpo: { processo_id }. O texto preenchido com os dados do processo. */
  @Post(':id/pre-visualizar')
  @HttpCode(200)
  @Painel('processos')
  preVisualizar(
    @MunicipioAtual() m: Municipio,
    @Param('id', uuid) id: string,
    @Body() body: unknown,
  ) {
    const { processo_id } = validar(z.object({ processo_id: z.uuid() }), body);
    return this.svc.preVisualizar(m, id, processo_id);
  }
}
