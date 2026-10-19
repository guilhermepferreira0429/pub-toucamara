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
import { ESTADOS_MELHORIA } from './melhorias.js';
import { MelhoriasService } from './melhorias.service.js';
import {
  exigirEquipaInterna,
  PainelConhecimentoService,
} from './painel-conhecimento.service.js';

const uuid = new ParseUUIDPipe();

const texto = (max: number) => z.string().trim().min(1).max(max);
const data = z.iso.date();

const esquemaResposta = z.object({
  pergunta_tipo: z.string().trim().min(3).max(300),
  tema_id: z.uuid().nullish(),
  texto_voz: texto(4000),
  texto_sms: z.string().trim().max(640).nullish(),
  passa_a_pessoa_quando: z.array(texto(200)).max(20).default([]),
  trechos: z.array(z.uuid()).max(30).default([]),
  frases: z.array(z.string().trim().min(2).max(300)).max(50).default([]),
});

const esquemaVersao = z.object({
  texto_voz: texto(4000),
  texto_sms: z.string().trim().max(640).nullish(),
  passa_a_pessoa_quando: z.array(texto(200)).max(20).optional(),
  trechos: z.array(z.uuid()).max(30).optional(),
  frases: z.array(z.string().trim().min(2).max(300)).max(50).optional(),
});

const ESTADOS_RESPOSTA = [
  'rascunho',
  'em_teste',
  'no_ar',
  'arquivada',
] as const;
const ESTADOS_PSR = [
  'nova',
  'com_equipa',
  'espera_camara',
  'resolvida',
  'fora_ambito',
] as const;
const TIPOS_FONTE = [
  'lei',
  'regulamento',
  'tabela',
  'pagina',
  'formulario',
  'plano',
  'contactos',
] as const;

/**
 * Conhecimento no painel (secção 5.7). Ler: 'conhecimento_ver'. Escrever:
 * 'conhecimento'. Respostas curadas: na V1 também perfil admin ou
 * equipa_toucamara.
 */
@Controller('painel/conhecimento')
export class PainelConhecimentoController {
  constructor(
    private readonly svc: PainelConhecimentoService,
    private readonly melhorias: MelhoriasService,
  ) {}

  @Get('mapa')
  @Painel('conhecimento_ver')
  mapa(@MunicipioAtual() m: Municipio) {
    return this.svc.mapa(m.id);
  }

  // --- Respostas curadas ---------------------------------------------------

  @Get('respostas')
  @Painel('conhecimento_ver')
  respostas(@MunicipioAtual() m: Municipio, @Query() q: unknown) {
    const f = validar(
      esquemaPaginacao.extend({
        estado: z.enum(ESTADOS_RESPOSTA).optional(),
        tema_id: z.uuid().optional(),
        q: z.string().trim().min(1).max(100).optional(),
      }),
      q,
    );
    return this.svc.respostas(m.id, f, f.limite, f.cursor);
  }

  @Get('respostas/:id')
  @Painel('conhecimento_ver')
  resposta(@MunicipioAtual() m: Municipio, @Param('id', uuid) id: string) {
    return this.svc.resposta(m.id, id);
  }

  @Post('respostas')
  @Painel('conhecimento')
  criarResposta(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Body() body: unknown,
  ) {
    exigirEquipaInterna(u);
    return this.svc.criarResposta(m.id, u, validar(esquemaResposta, body));
  }

  @Post('respostas/:id/versoes')
  @Painel('conhecimento')
  novaVersao(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('id', uuid) id: string,
    @Body() body: unknown,
  ) {
    exigirEquipaInterna(u);
    return this.svc.novaVersao(m.id, u, id, validar(esquemaVersao, body));
  }

  /**
   * Corpo: { versao_id, forcar? }. Só publica com uma avaliação do agente
   * (versão atual, taxa ≥ 80%); `forcar` salta o gate (equipa interna, auditado).
   */
  @Post('respostas/:id/publicar')
  @HttpCode(200)
  @Painel('conhecimento')
  publicar(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('id', uuid) id: string,
    @Body() body: unknown,
  ) {
    exigirEquipaInterna(u);
    const { versao_id, forcar } = validar(
      z.object({ versao_id: z.uuid(), forcar: z.boolean().default(false) }),
      body,
    );
    return this.svc.publicar(m.id, u, id, versao_id, forcar);
  }

  // --- Perguntas sem resposta ---------------------------------------------

  @Get('sem-resposta')
  @Painel('conhecimento_ver')
  semResposta(@MunicipioAtual() m: Municipio, @Query() q: unknown) {
    const f = validar(
      esquemaPaginacao.extend({ estado: z.enum(ESTADOS_PSR).optional() }),
      q,
    );
    return this.svc.semResposta(m.id, f.estado, f.limite, f.cursor);
  }

  @Post('sem-resposta/:id/pedir-equipa')
  @HttpCode(200)
  @Painel('conhecimento')
  pedirEquipa(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('id', uuid) id: string,
  ) {
    return this.svc.atualizarSemResposta(m.id, u, id, { estado: 'com_equipa' });
  }

  @Patch('sem-resposta/:id')
  @Painel('conhecimento')
  atualizarSemResposta(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('id', uuid) id: string,
    @Body() body: unknown,
  ) {
    const d = validar(
      z
        .object({
          estado: z.enum(ESTADOS_PSR).optional(),
          o_que_falta: z.string().trim().max(1000).nullable().optional(),
          resposta_id: z.uuid().nullable().optional(),
        })
        .refine((x) => Object.keys(x).length > 0, 'Nada para mudar.'),
      body,
    );
    return this.svc.atualizarSemResposta(m.id, u, id, d);
  }

  // --- Melhorias ao portal (perguntas sem resposta → portal) ---------------

  /** Métrica: propostas, enviadas, publicadas e perguntas resolvidas por elas. */
  @Get('melhorias/resumo')
  @Painel('conhecimento_ver')
  resumoMelhorias(@MunicipioAtual() m: Municipio, @Query() q: unknown) {
    const f = validar(
      z.object({ de: data.optional(), ate: data.optional() }),
      q,
    );
    return this.melhorias.resumo(m.id, f.de, f.ate);
  }

  @Get('melhorias')
  @Painel('conhecimento_ver')
  listarMelhorias(@MunicipioAtual() m: Municipio, @Query() q: unknown) {
    const f = validar(
      esquemaPaginacao.extend({ estado: z.enum(ESTADOS_MELHORIA).optional() }),
      q,
    );
    return this.melhorias.listar(m.id, f.estado, f.limite, f.cursor);
  }

  /** Põe o job `propor_melhorias` na fila para o município (sem IA: 503). */
  @Post('melhorias/gerar')
  @HttpCode(202)
  @Painel('conhecimento')
  gerarMelhorias(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
  ) {
    return this.melhorias.gerar(m.id, u);
  }

  @Get('melhorias/:id')
  @Painel('conhecimento_ver')
  melhoria(@MunicipioAtual() m: Municipio, @Param('id', uuid) id: string) {
    return this.melhorias.ver(m.id, id);
  }

  /** Publicada → as perguntas abertas ligadas passam a 'resolvida'. */
  @Patch('melhorias/:id')
  @Painel('conhecimento')
  atualizarMelhoria(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('id', uuid) id: string,
    @Body() body: unknown,
  ) {
    const d = validar(
      z
        .object({
          estado: z.enum(ESTADOS_MELHORIA).optional(),
          titulo: texto(200).optional(),
          sugestao: texto(8000).optional(),
          onde: z.string().trim().max(300).nullable().optional(),
          entidade_id: z.uuid().nullable().optional(),
          servico_id: z.uuid().nullable().optional(),
          notas: z.string().trim().max(2000).nullable().optional(),
        })
        .refine((x) => Object.keys(x).length > 0, 'Nada para mudar.'),
      body,
    );
    return this.melhorias.atualizar(m.id, u, id, d);
  }

  /**
   * Corpo opcional: { email? }. Sem email vai para o do serviço ou, sem
   * serviço, para o da entidade responsável.
   */
  @Post('melhorias/:id/enviar')
  @HttpCode(200)
  @Painel('conhecimento')
  enviarMelhoria(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('id', uuid) id: string,
    @Body() body: unknown,
  ) {
    const { email } = validar(
      z.object({ email: z.email().optional() }),
      body ?? {},
    );
    return this.melhorias.enviar(m.id, u, id, email);
  }

  // --- Fontes --------------------------------------------------------------

  @Get('fontes')
  @Painel('conhecimento_ver')
  fontes(@MunicipioAtual() m: Municipio, @Query() q: unknown) {
    const f = validar(
      z.object({
        estado: z.enum(['em_dia', 'mudou', 'erro']).optional(),
        entidade_id: z.uuid().optional(),
      }),
      q,
    );
    return this.svc.fontes(m.id, f);
  }

  @Post('fontes')
  @Painel('conhecimento')
  criarFonte(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Body() body: unknown,
  ) {
    const d = validar(
      z.object({
        entidade_id: z.uuid(),
        titulo: texto(200),
        tipo: z.enum(TIPOS_FONTE),
        url: z.url({ protocol: /^https?$/ }),
        ler_a_cada_horas: z
          .number()
          .int()
          .min(1)
          .max(24 * 365)
          .default(24),
        leitura_automatica: z.boolean().default(true),
      }),
      body,
    );
    return this.svc.criarFonte(m.id, u, d);
  }

  /** Lê já todas as fontes vencidas do município. */
  @Post('fontes/ler')
  @HttpCode(202)
  @Painel('conhecimento')
  lerVencidas(@MunicipioAtual() m: Municipio) {
    return this.svc.lerVencidas(m.id);
  }

  @Post('fontes/:id/ler')
  @HttpCode(202)
  @Painel('conhecimento')
  lerFonte(@MunicipioAtual() m: Municipio, @Param('id', uuid) id: string) {
    return this.svc.lerFonte(m.id, id);
  }

  @Post('fontes/:id/texto')
  @HttpCode(200)
  @Painel('conhecimento')
  colarTexto(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('id', uuid) id: string,
    @Body() body: unknown,
  ) {
    const d = validar(
      z.object({
        texto: z.string().min(80).max(5_000_000),
        vigor_desde: data.nullish(),
        vigor_ate: data.nullish(),
      }),
      body,
    );
    return this.svc.colarTexto(m.id, u, id, d);
  }

  // --- Alterações ----------------------------------------------------------

  @Get('alteracoes')
  @Painel('conhecimento_ver')
  alteracoes(@MunicipioAtual() m: Municipio, @Query() q: unknown) {
    const f = validar(
      esquemaPaginacao.extend({
        estado: z.enum(['por_rever', 'aprovada', 'ignorada']).optional(),
      }),
      q,
    );
    return this.svc.alteracoes(m.id, f.estado, f.limite, f.cursor);
  }

  @Get('alteracoes/:id')
  @Painel('conhecimento_ver')
  alteracao(@MunicipioAtual() m: Municipio, @Param('id', uuid) id: string) {
    return this.svc.alteracao(m.id, id);
  }

  /**
   * Corpo opcional: { rejeitar: [resposta_id], forcar? }. Publicar propostas
   * passa pelo mesmo gate de avaliação que `respostas/:id/publicar`.
   */
  @Post('alteracoes/:id/aprovar')
  @HttpCode(200)
  @Painel('conhecimento')
  aprovar(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('id', uuid) id: string,
    @Body() body: unknown,
  ) {
    const { rejeitar, forcar } = validar(
      z.object({
        rejeitar: z.array(z.uuid()).max(200).default([]),
        forcar: z.boolean().default(false),
      }),
      body ?? {},
    );
    return this.svc.aprovar(m.id, u, id, rejeitar, forcar);
  }

  @Post('alteracoes/:id/ignorar')
  @HttpCode(200)
  @Painel('conhecimento')
  ignorar(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('id', uuid) id: string,
  ) {
    return this.svc.ignorar(m.id, u, id);
  }

  // --- Contradições, qualidade, reindexar ------------------------------------

  @Get('contradicoes')
  @Painel('conhecimento_ver')
  contradicoes(@MunicipioAtual() m: Municipio, @Query() q: unknown) {
    const f = validar(
      esquemaPaginacao.extend({
        estado: z.enum(['aberta', 'avisada', 'resolvida']).optional(),
      }),
      q,
    );
    return this.svc.contradicoes(m.id, f.estado, f.limite, f.cursor);
  }

  @Patch('contradicoes/:id')
  @Painel('conhecimento')
  atualizarContradicao(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('id', uuid) id: string,
    @Body() body: unknown,
  ) {
    const d = validar(
      z
        .object({
          estado: z.enum(['aberta', 'avisada', 'resolvida']).optional(),
          usar: z.enum(['a', 'b']).optional(),
        })
        .refine((x) => x.estado || x.usar, 'Nada para mudar.'),
      body,
    );
    return this.svc.atualizarContradicao(m.id, u, id, d);
  }

  /** Resultados do avaliador para o nosso agente (nunca sistemas de outros). */
  @Get('qualidade')
  @Painel('conhecimento_ver')
  qualidade(@MunicipioAtual() m: Municipio) {
    return this.svc.qualidade(m.id);
  }

  /** Calcula embeddings em falta (ou todos, ao mudar de modelo). Equipa interna. */
  @Post('reindexar')
  @HttpCode(202)
  @Painel('conhecimento')
  reindexar(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Body() body: unknown,
  ) {
    exigirEquipaInterna(u);
    const { todos } = validar(
      z.object({ todos: z.boolean().default(false) }),
      body ?? {},
    );
    return this.svc.reindexar(m.id, todos);
  }
}
