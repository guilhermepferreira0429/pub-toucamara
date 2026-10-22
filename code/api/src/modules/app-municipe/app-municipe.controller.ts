import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Ip,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  UseInterceptors,
} from '@nestjs/common';
import { IdempotenciaInterceptor } from '../../common/idempotencia.interceptor.js';
import { MunicipioAtual } from '../../common/pedido.js';
import { validar } from '../../common/validacao.js';
import { Painel } from '../auth/painel.guard.js';
import type { Municipio } from '../municipios/municipios.service.js';
import {
  AppMunicipeService,
  esquemaDispositivo,
  esquemaNovaOcorrencia,
  esquemaPreferencias,
  esquemaSessaoChat,
} from './app-municipe.service.js';
import {
  AppSessaoService,
  esquemaEntrarApp,
  esquemaPedirCodigoApp,
} from './app-sessao.service.js';
import type { SessaoApp } from './app-sessao.service.js';
import { App, SessaoAtual } from './app.guard.js';
import { PushService } from './push.service.js';

/** Entrar na app com o telemóvel (sem sessão). */
@Controller('public/app')
export class AppPublicoController {
  constructor(private readonly sessoes: AppSessaoService) {}

  /** { municipio, telefone } → SMS com o código de 6 dígitos */
  @Post('codigo')
  @HttpCode(202)
  codigo(@Body() body: unknown, @Ip() ip: string) {
    return this.sessoes.pedirCodigo(validar(esquemaPedirCodigoApp, body), ip);
  }

  /** { municipio, telefone, codigo, dispositivo } → o token da sessão (só esta vez) */
  @Post('entrar')
  @HttpCode(201)
  entrar(@Body() body: unknown, @Ip() ip: string) {
    return this.sessoes.entrar(validar(esquemaEntrarApp, body), ip);
  }
}

/**
 * A app do munícipe (`Authorization: Bearer tca_…`): só os dados da pessoa
 * da sessão.
 */
@Controller('app')
@App()
export class AppController {
  constructor(
    private readonly app: AppMunicipeService,
    private readonly sessoes: AppSessaoService,
  ) {}

  @Post('sair')
  @HttpCode(200)
  sair(@SessaoAtual() s: SessaoApp, @Ip() ip: string) {
    return this.sessoes.sair(s, ip);
  }

  @Get('eu')
  eu(@SessaoAtual() s: SessaoApp) {
    return this.app.eu(s);
  }

  /** { tipos?: { avisos?, processos? }, zona?: { freguesia, morada, lat, lng } | null } */
  @Put('eu/preferencias')
  preferencias(@SessaoAtual() s: SessaoApp, @Body() body: unknown) {
    return this.app.preferencias(s, validar(esquemaPreferencias, body));
  }

  /** { fcm_token, plataforma: 'android', idioma, versao_app } (upsert pelo token) */
  @Post('dispositivos')
  @HttpCode(201)
  registarDispositivo(@SessaoAtual() s: SessaoApp, @Body() body: unknown) {
    return this.app.registarDispositivo(s, validar(esquemaDispositivo, body));
  }

  @Delete('dispositivos/:id')
  removerDispositivo(
    @SessaoAtual() s: SessaoApp,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.app.removerDispositivo(s, id);
  }

  @Get('processos')
  processos(@SessaoAtual() s: SessaoApp) {
    return this.app.listaProcessos(s);
  }

  @Get('processos/:id')
  processo(
    @SessaoAtual() s: SessaoApp,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.app.processo(s, id);
  }

  @Get('ocorrencias')
  ocorrencias(@SessaoAtual() s: SessaoApp) {
    return this.app.listaOcorrencias(s);
  }

  @Get('ocorrencias/categorias')
  categorias(@SessaoAtual() s: SessaoApp) {
    return this.app.categoriasOcorrencia(s);
  }

  /** { categoria, descricao, lat, lng, morada?, ponto_referencia?, foto_mime? } */
  @Post('ocorrencias')
  @HttpCode(201)
  // A app reenvia da fila sem rede com a mesma Idempotency-Key: não duplica.
  @UseInterceptors(IdempotenciaInterceptor)
  novaOcorrencia(@SessaoAtual() s: SessaoApp, @Body() body: unknown) {
    return this.app.novaOcorrencia(s, validar(esquemaNovaOcorrencia, body));
  }

  @Get('marcacoes')
  marcacoes(@SessaoAtual() s: SessaoApp) {
    return this.app.marcacoes(s);
  }

  @Get('pagamentos')
  pagamentos(@SessaoAtual() s: SessaoApp) {
    return this.app.pagamentos(s);
  }

  @Get('licencas')
  licencas(@SessaoAtual() s: SessaoApp) {
    return this.app.licencas(s);
  }

  @Get('reclamacoes')
  reclamacoes(@SessaoAtual() s: SessaoApp) {
    return this.app.reclamacoes(s);
  }

  @Get('conversas')
  conversas(@SessaoAtual() s: SessaoApp) {
    return this.app.listaConversas(s);
  }

  @Get('avisos')
  avisos(@SessaoAtual() s: SessaoApp) {
    return this.app.avisos(s);
  }

  /** Sessão de chat já identificada; depois as rotas /v1/chat/sessoes/:sessao/... */
  @Post('chat/sessoes')
  @HttpCode(201)
  chat(@SessaoAtual() s: SessaoApp, @Body() body: unknown) {
    return this.app.criarSessaoChat(s, validar(esquemaSessaoChat, body ?? {}));
  }
}

/** Painel: quantas pessoas usam a app e o que saiu por push. */
@Controller('painel/app')
@Painel('indicadores')
export class AppPainelController {
  constructor(private readonly push: PushService) {}

  @Get('estatisticas')
  estatisticas(@MunicipioAtual() m: Municipio) {
    return this.push.estatisticas(m);
  }
}
