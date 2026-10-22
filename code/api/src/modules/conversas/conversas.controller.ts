import {
  Body,
  Controller,
  Get,
  HttpCode,
  Ip,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { z } from 'zod';
import { Coluna, ficheiroCsv, gerarCsv, nomeCsv } from '../../common/csv.js';
import { esquemaPaginacao, todasAsPaginas } from '../../common/paginacao.js';
import { MunicipioAtual, UtilizadorAtual } from '../../common/pedido.js';
import type { UtilizadorPainel } from '../../common/pedido.js';
import { validar } from '../../common/validacao.js';
import { Painel } from '../auth/painel.guard.js';
import type { Municipio } from '../municipios/municipios.service.js';
import { PainelConversasService } from './painel-conversas.service.js';

// Query strings chegam como texto: 'true'/'false' → booleano.
const booleano = z
  .enum(['true', 'false'])
  .transform((v) => v === 'true')
  .optional();

const esquemaFiltros = esquemaPaginacao.extend({
  canal: z
    .enum(['telefone', 'chat', 'sms', 'email', 'balcao', 'whatsapp'])
    .optional(),
  resultado: z
    .enum([
      'em_curso',
      'resolvida',
      'passada_funcionario',
      'sem_resposta',
      'marcacao',
      'emergencia',
      'caiu',
    ])
    .optional(),
  tema_id: z.uuid().optional(),
  de: z.coerce.date().optional(),
  ate: z.coerce.date().optional(),
  texto: z.string().trim().min(2).max(200).optional(),
  fora_de_horas: booleano,
  revisao: z.enum(['certa', 'errada', 'por_rever']).optional(),
});

type ConversaLista = Awaited<
  ReturnType<PainelConversasService['listar']>
>['itens'][number];

const CANAIS: Record<string, string> = {
  telefone: 'Telefone',
  chat: 'Chat',
  sms: 'SMS',
  email: 'Email',
  balcao: 'Balcão',
  whatsapp: 'WhatsApp',
};

const RESULTADOS: Record<string, string> = {
  em_curso: 'Em curso',
  resolvida: 'Resolvida',
  passada_funcionario: 'Passada a funcionário',
  sem_resposta: 'Sem resposta',
  marcacao: 'Marcação feita',
  emergencia: 'Emergência',
  caiu: 'Chamada caiu',
};

const REVISOES: Record<string, string> = { certa: 'Certa', errada: 'Errada' };

/** Colunas do CSV: sem nome nem NIF; o telefone mascarado, como no painel. */
const COLUNAS_CSV: Coluna<ConversaLista>[] = [
  { titulo: 'Início', valor: (c) => c.iniciada_em },
  { titulo: 'Canal', valor: (c) => CANAIS[c.canal] ?? c.canal },
  {
    titulo: 'Duração (min)',
    valor: (c) =>
      c.duracao_s === null ? null : Math.round(c.duracao_s / 6) / 10,
  },
  { titulo: 'Resultado', valor: (c) => RESULTADOS[c.resultado] ?? c.resultado },
  { titulo: 'Tema', valor: (c) => c.tema?.nome },
  { titulo: 'Fora de horas', valor: (c) => c.fora_de_horas },
  { titulo: 'Telefone', valor: (c) => c.municipe?.telefone },
  { titulo: 'Resumo', valor: (c) => c.resumo },
  {
    titulo: 'Revisão',
    valor: (c) => (c.revisao ? (REVISOES[c.revisao] ?? c.revisao) : null),
  },
  { titulo: 'Fonte citada', valor: (c) => c.fonte?.titulo },
];

const esquemaRevisao = z.object({
  revisao: z.enum(['certa', 'errada']),
  nota: z.string().trim().max(2000).optional(),
});

@Controller('painel/conversas')
@Painel('conversas')
export class PainelConversasController {
  constructor(private readonly conversas: PainelConversasService) {}

  @Get()
  listar(@MunicipioAtual() m: Municipio, @Query() query: unknown) {
    return this.conversas.listar(m.id, validar(esquemaFiltros, query));
  }

  /** A lista com os mesmos filtros, em CSV para o Excel (sem paginação). */
  @Get('exportar.csv')
  async exportar(@MunicipioAtual() m: Municipio, @Query() query: unknown) {
    const f = validar(esquemaFiltros, query);
    const itens = await todasAsPaginas((p) =>
      this.conversas.listar(m.id, { ...f, ...p }),
    );
    return ficheiroCsv(
      gerarCsv(COLUNAS_CSV, itens, m.fuso),
      nomeCsv('conversas', new Date(), m.fuso),
    );
  }

  @Get(':id')
  detalhe(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('id', ParseUUIDPipe) id: string,
    @Ip() ip: string,
  ) {
    return this.conversas.detalhe(m.id, id, u, ip);
  }

  @Get(':id/gravacao')
  @Painel('gravacoes')
  gravacao(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('id', ParseUUIDPipe) id: string,
    @Ip() ip: string,
  ) {
    return this.conversas.gravacao(m.id, id, u, ip);
  }

  @Post(':id/revisao')
  @HttpCode(200)
  rever(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    const { revisao, nota } = validar(esquemaRevisao, body);
    return this.conversas.rever(m.id, id, u, revisao, nota || null);
  }
}

@Controller('public/resumos')
export class ResumosPublicosController {
  constructor(private readonly conversas: PainelConversasService) {}

  /** Ecrã "O que tem de fazer", aberto pelo código do link do SMS. */
  @Get(':codigo')
  resumo(@Param('codigo') codigo: string) {
    const c = validar(
      z.string().regex(/^[0-9A-Za-z]{4,12}$/, 'Código inválido.'),
      codigo,
    );
    return this.conversas.publico(c);
  }
}
