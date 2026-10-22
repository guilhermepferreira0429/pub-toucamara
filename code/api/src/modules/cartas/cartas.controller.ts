import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  StreamableFile,
} from '@nestjs/common';
import { z } from 'zod';
import { ErroApi } from '../../common/erros.js';
import { MunicipioAtual, UtilizadorAtual } from '../../common/pedido.js';
import type { UtilizadorPainel } from '../../common/pedido.js';
import { validar } from '../../common/validacao.js';
import { App, SessaoAtual } from '../app-municipe/app.guard.js';
import type { SessaoApp } from '../app-municipe/app-sessao.service.js';
import { Painel } from '../auth/painel.guard.js';
import { ChatService } from '../chat/chat.service.js';
import type { Municipio } from '../municipios/municipios.service.js';
import { MunicipiosService } from '../municipios/municipios.service.js';
import {
  bytesDeBase64,
  MAXIMO_PDF_BYTES,
} from '../requerimentos/verificacao-documentos.js';
import {
  CartasService,
  esquemaEditarResposta,
  esquemaFicheiro,
  esquemaLembrete,
  esquemaListaCartas,
  esquemaNovaResposta,
  esquemaRececao,
} from './cartas.service.js';

const esquemaTokenChat = z
  .string()
  .regex(/^[A-Za-z0-9_-]{20,64}$/, 'Sessão inválida.');

/** Antes do zod e da descodificação: um ficheiro enorme não passa daqui. */
function limitarCorpo(body: unknown) {
  const b64 = (body as { ficheiro_base64?: unknown } | null)?.ficheiro_base64;
  if (typeof b64 === 'string' && bytesDeBase64(b64) > MAXIMO_PDF_BYTES) {
    throw new ErroApi(
      HttpStatus.PAYLOAD_TOO_LARGE,
      'ficheiro_grande',
      'O ficheiro é demasiado grande (máximo 10 MB num PDF, 5 MB numa fotografia).',
      { maximo_bytes: MAXIMO_PDF_BYTES },
    );
  }
  return validar(esquemaFicheiro, body);
}

/**
 * Página /carta/{codigo} (sem login: o código é o segredo, vem no SMS ou
 * no chat): a explicação, o prazo, o rascunho e os próximos passos.
 */
@Controller('public/cartas')
export class CartasPublicoController {
  constructor(
    private readonly cartas: CartasService,
    private readonly municipios: MunicipiosService,
  ) {}

  /**
   * O ofício de demonstração em PDF (?municipio=slug ou X-Municipio): para
   * mostrar o fluxo sem uma carta real. Documento fictício, sem valor legal.
   */
  @Get('demonstracao/oficio.pdf')
  async oficioDemo(
    @Query('municipio') municipio: string | undefined,
    @Headers('x-municipio') cabecalho: string | undefined,
  ) {
    const { slug } = validar(
      z.object({ slug: z.string().trim().min(1).max(64) }),
      { slug: municipio ?? cabecalho },
    );
    const m = await this.municipios.porSlug(slug);
    const pdf = await this.cartas.pdfDemo(m);
    return new StreamableFile(pdf, {
      type: 'application/pdf',
      disposition: 'inline; filename="carta-demonstracao.pdf"',
      length: pdf.length,
    });
  }

  @Get(':codigo')
  ver(@Param('codigo') codigo: string) {
    return this.cartas.publico(codigo);
  }

  /** { mime, ficheiro_base64 } → lê a carta (fotografia ou PDF). */
  @Post(':codigo/ficheiro')
  @HttpCode(200)
  ficheiro(@Param('codigo') codigo: string, @Body() body: unknown) {
    return this.cartas.receberFicheiro(codigo, limitarCorpo(body));
  }

  /** { data: 'AAAA-MM-DD' }: o dia em que recebeu a carta. */
  @Post(':codigo/rececao')
  @HttpCode(200)
  rececao(@Param('codigo') codigo: string, @Body() body: unknown) {
    return this.cartas.definirRececao(
      codigo,
      validar(esquemaRececao, body).data,
    );
  }

  /** { lembrar: boolean }: lembrete antes do fim do prazo. */
  @Post(':codigo/lembrete')
  @HttpCode(200)
  lembrete(@Param('codigo') codigo: string, @Body() body: unknown) {
    return this.cartas.definirLembrete(
      codigo,
      validar(esquemaLembrete, body).lembrar,
    );
  }

  /** { tipo, argumentos?, dias? } → rascunho da resposta. */
  @Post(':codigo/respostas')
  @HttpCode(201)
  responder(@Param('codigo') codigo: string, @Body() body: unknown) {
    return this.cartas.prepararResposta(
      codigo,
      validar(esquemaNovaResposta, body),
    );
  }

  /** { texto }: a pessoa muda o rascunho. */
  @Patch(':codigo/respostas/:id')
  editar(
    @Param('codigo') codigo: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.cartas.editarResposta(
      codigo,
      id,
      validar(esquemaEditarResposta, body).texto,
    );
  }

  /** "Confirmar e entregar" (entrega simulada). */
  @Post(':codigo/respostas/:id/entregar')
  @HttpCode(200)
  entregar(
    @Param('codigo') codigo: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.cartas.entregarResposta(codigo, id);
  }
}

/**
 * Anexo no chat: a fotografia ou o PDF da carta. A carta fica ligada à
 * conversa; depois o chat manda "[carta CODIGO]" e o agente usa ler_carta.
 */
@Controller('chat/sessoes')
export class CartasChatController {
  constructor(
    private readonly cartas: CartasService,
    private readonly chat: ChatService,
  ) {}

  @Post(':sessao/carta')
  @HttpCode(201)
  async anexar(@Param('sessao') sessao: string, @Body() body: unknown) {
    const s = await this.chat.sessao(validar(esquemaTokenChat, sessao));
    return this.cartas.doChat(
      {
        municipio: s.municipio,
        canal: 'chat',
        conversaId: s.conversaId,
        municipeId: s.municipeId,
      },
      limitarCorpo(body),
    );
  }
}

/** App do munícipe: "Não percebi uma carta". */
@Controller('app/cartas')
@App()
export class CartasAppController {
  constructor(private readonly cartas: CartasService) {}

  @Get()
  async listar(@SessaoAtual() s: SessaoApp) {
    return { itens: await this.cartas.daApp(s.municipeId, s.municipio.id) };
  }

  /**
   * Com { mime, ficheiro_base64 }: cria e lê. Sem corpo: cria a carta à
   * espera (para enviar um PDF pela página /carta/{codigo}).
   */
  @Post()
  @HttpCode(201)
  async criar(@SessaoAtual() s: SessaoApp, @Body() body: unknown) {
    const origem = {
      municipio: s.municipio,
      canal: 'app' as const,
      conversaId: null,
      municipeId: s.municipeId,
    };
    const temFicheiro =
      !!body && typeof body === 'object' && 'ficheiro_base64' in body;
    if (temFicheiro) return this.cartas.doChat(origem, limitarCorpo(body));
    const { codigo } = await this.cartas.criar(origem);
    return this.cartas.publico(codigo);
  }

  @Get(':codigo')
  ver(@SessaoAtual() s: SessaoApp, @Param('codigo') codigo: string) {
    return this.cartas.publicoDaApp(s.municipeId, codigo);
  }
}

/** Painel: as cartas que os munícipes pediram para explicar. */
@Controller('painel/cartas')
@Painel('processos')
export class CartasPainelController {
  constructor(private readonly cartas: CartasService) {}

  /** ?processo_id=&limite=&cursor= */
  @Get()
  listar(@MunicipioAtual() m: Municipio, @Query() query: unknown) {
    return this.cartas.listar(m, validar(esquemaListaCartas, query));
  }

  /** Os ofícios que mais confundem (por modelo de ofício ou tipo de carta). */
  @Get('confusoes')
  confusoes(@MunicipioAtual() m: Municipio) {
    return this.cartas.confusoes(m);
  }

  @Get(':id')
  detalhe(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.cartas.detalhe(m, u, id);
  }
}
