import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Injectable,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { z } from 'zod';
import { ErroApi } from '../../common/erros.js';
import { validar } from '../../common/validacao.js';
import { DatabaseService } from '../../database/database.service.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { resolverFreguesia } from '../consultas-publicas/regras.js';
import {
  PARAMETROS,
  ROTULOS_TIPO,
  TIPOS_SUBSCRICAO,
  type TipoSubscricao,
} from '../agora/agora.regras.js';
import { AgoraService } from '../agora/agora.service.js';
import type { SessaoApp } from './app-sessao.service.js';
import { App, SessaoAtual } from './app.guard.js';

/**
 * "Avisar-me" na app: um ponto (o GPS, ou o sítio de um item do feed) com um
 * raio, ou uma freguesia. A app já sabe as coordenadas: não se geocodifica.
 */
export const esquemaSubscricaoApp = z
  .object({
    tipos: z.array(z.enum(TIPOS_SUBSCRICAO)).min(1).max(4),
    lat: z.number().min(-90).max(90).optional(),
    lng: z.number().min(-180).max(180).optional(),
    raio_m: z.number().int().min(100).max(2_000).optional(),
    /** O que a pessoa reconhece ("Rua Direita", "perto de casa"). */
    descricao: z.string().trim().min(2).max(200).optional(),
    freguesia: z.string().trim().min(2).max(120).optional(),
  })
  .refine((e) => (e.lat === undefined) === (e.lng === undefined), {
    message: 'lat e lng vêm juntos.',
    path: ['lat'],
  })
  .refine((e) => e.lat !== undefined || e.freguesia !== undefined, {
    message: 'Indique o sítio (lat e lng) ou a freguesia.',
    path: ['lat'],
  });

@Injectable()
export class AppAgoraService {
  constructor(
    private readonly db: DatabaseService,
    private readonly agora: AgoraService,
    private readonly auditoria: AuditoriaService,
  ) {}

  async subscrever(s: SessaoApp, e: z.output<typeof esquemaSubscricaoApp>) {
    const m = s.municipio;
    let freguesia: string | null = null;
    if (e.freguesia) {
      const candidatas = await this.agora.freguesias(m.id);
      const f = resolverFreguesia(e.freguesia, candidatas);
      if (!candidatas.includes(f)) {
        throw new ErroApi(
          HttpStatus.UNPROCESSABLE_ENTITY,
          'freguesia_desconhecida',
          'Não conhecemos essa freguesia no concelho.',
          { freguesias: candidatas },
        );
      }
      freguesia = f;
    }
    const [mu] = await this.db.query<{ aceita_avisos: boolean }>(
      'SELECT aceita_avisos FROM municipes WHERE id = $1',
      [s.municipeId],
    );
    const ponto =
      e.lat !== undefined && e.lng !== undefined
        ? { lat: e.lat, lng: e.lng }
        : null;
    const raio = e.raio_m ?? PARAMETROS.raio_subscricao_m;
    const tipos = [...new Set(e.tipos)] as TipoSubscricao[];
    const descricao =
      e.descricao ??
      (ponto ? 'o sítio escolhido' : `freguesia de ${freguesia}`);
    const id = await this.agora.subscrever(m, s.municipeId, {
      local: {
        rua: ponto ? (e.descricao ?? null) : null,
        freguesia,
        ponto,
        descricao,
        origem: 'dita',
      },
      tipos,
      raio_m: raio,
      canal: 'app',
      aceitaAvisos: mu?.aceita_avisos ?? true,
    });
    const zona = ponto ? `${descricao} (${raio} m à volta)` : descricao;
    return {
      subscrito: true,
      subscricao_id: id,
      tipos,
      zona,
      mensagem:
        `Fica combinado: avisamos quando houver ${tipos.map((t) => ROTULOS_TIPO[t]).join(', ')} novos em ${zona}. ` +
        'Os avisos que não são de emergência só saem entre as 9h e as 21h.',
      parametros: {
        raio_subscricao_m: PARAMETROS.raio_subscricao_m,
        demonstracao: PARAMETROS.demonstracao,
      },
    };
  }

  async lista(s: SessaoApp) {
    const linhas = await this.db.query<{
      id: string;
      tipos: TipoSubscricao[];
      rua: string | null;
      freguesia: string | null;
      lat: number | null;
      lng: number | null;
      raio_m: number | null;
      canal: string;
      criada_em: Date;
    }>(
      `SELECT id, tipos, rua, freguesia, lat, lng, raio_m, canal, criada_em
       FROM agora_subscricoes
       WHERE municipio_id = $1 AND municipe_id = $2 AND ativa
       ORDER BY criada_em DESC LIMIT 50`,
      [s.municipio.id, s.municipeId],
    );
    return {
      subscricoes: linhas.map((l) => ({
        ...l,
        zona:
          l.lat !== null
            ? `${l.rua ?? 'Sítio escolhido'} (${l.raio_m} m à volta)`
            : `Freguesia de ${l.freguesia}`,
        tipos_ditos: l.tipos.map((t) => ROTULOS_TIPO[t]),
      })),
    };
  }

  async cancelar(s: SessaoApp, id: string) {
    await this.db.transaction(async (tx) => {
      const r = await tx.query<{ id: string }>(
        `UPDATE agora_subscricoes SET ativa = false, cancelada_em = now(), atualizada_em = now()
         WHERE id = $1 AND municipio_id = $2 AND municipe_id = $3 AND ativa
         RETURNING id`,
        [id, s.municipio.id, s.municipeId],
      );
      if (!r.length) {
        throw new ErroApi(
          HttpStatus.NOT_FOUND,
          'nao_encontrado',
          'Esse aviso não existe ou já foi cancelado.',
        );
      }
      await this.auditoria.registar(
        {
          municipioId: s.municipio.id,
          atorTipo: 'municipe',
          atorId: s.municipeId,
          acao: 'cancelar_subscricao_agora',
          objetoTipo: 'agora_subscricao',
          objetoId: id,
          dados: { canal: 'app' },
        },
        tx,
      );
    });
    return { cancelada: true };
  }
}

/** "Avisar-me" do feed "o que se passa perto de mim", na app. */
@Controller('app/agora/subscricoes')
@App()
export class AppAgoraController {
  constructor(private readonly svc: AppAgoraService) {}

  @Get()
  lista(@SessaoAtual() s: SessaoApp) {
    return this.svc.lista(s);
  }

  /** { tipos, lat?, lng?, raio_m?, descricao?, freguesia? } */
  @Post()
  @HttpCode(201)
  criar(@SessaoAtual() s: SessaoApp, @Body() body: unknown) {
    return this.svc.subscrever(s, validar(esquemaSubscricaoApp, body));
  }

  @Delete(':id')
  cancelar(
    @SessaoAtual() s: SessaoApp,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.svc.cancelar(s, id);
  }
}
