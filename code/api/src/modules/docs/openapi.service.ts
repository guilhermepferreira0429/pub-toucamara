import { Injectable } from '@nestjs/common';
import {
  GUARDS_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants.js';
import { RequestMethod } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import { RegistoFerramentas } from '../../ferramentas/registo-ferramentas.service.js';

type Seguranca = 'painel' | 'agente' | 'publico';

interface Rota {
  metodo: string;
  caminho: string;
  controlador: string;
  seguranca: Seguranca;
  recurso: string | null;
}

/** Nome do guard (comparado pelo nome da classe, sem importar os módulos). */
const GUARD_PAINEL = 'PainelGuard';
const GUARD_AGENTE = 'SegredoAgenteGuard';
const RECURSO = 'painel:recurso';

const METODOS: Partial<Record<RequestMethod, string>> = {
  [RequestMethod.GET]: 'get',
  [RequestMethod.POST]: 'post',
  [RequestMethod.PUT]: 'put',
  [RequestMethod.PATCH]: 'patch',
  [RequestMethod.DELETE]: 'delete',
};

function juntar(...partes: (string | undefined)[]): string {
  const c = partes
    .filter((p): p is string => !!p && p !== '/')
    .map((p) => p.replace(/^\/|\/$/g, ''))
    .filter(Boolean)
    .join('/');
  return `/${c}`.replace(/:([A-Za-z_]+)/g, '{$1}');
}

function lista<T>(v: T | T[] | undefined): T[] {
  if (v === undefined) return [];
  return Array.isArray(v) ? v : [v];
}

/**
 * OpenAPI 3.1 da API, gerado a partir das rotas do Nest (descobertas no
 * arranque) e do registo das ferramentas. As ferramentas do agente saem com
 * o corpo completo em JSON Schema (o mesmo zod que valida), que é o que o
 * ElevenLabs precisa; as outras rotas saem com o método, o caminho, os
 * parâmetros do caminho e quem pode chamar (os corpos validam-se com zod
 * dentro dos controllers e não estão descritos aqui).
 */
@Injectable()
export class OpenApiService {
  private cache: object | null = null;

  constructor(
    private readonly descoberta: DiscoveryService,
    private readonly scanner: MetadataScanner,
    private readonly reflector: Reflector,
    private readonly registo: RegistoFerramentas,
    private readonly config: ConfigService,
  ) {}

  rotas(): Rota[] {
    const rotas: Rota[] = [];
    for (const w of this.descoberta.getControllers()) {
      const classe = w.metatype as (new (...a: never[]) => unknown) | null;
      if (!classe || !w.instance) continue;
      const base = lista<string>(
        Reflect.getMetadata(PATH_METADATA, classe) as string | string[],
      );
      const proto = Object.getPrototypeOf(w.instance) as object;
      for (const nome of this.scanner.getAllMethodNames(proto)) {
        const fn = (proto as Record<string, unknown>)[nome] as object;
        const metodo = Reflect.getMetadata(METHOD_METADATA, fn) as
          RequestMethod | undefined;
        if (metodo === undefined || !METODOS[metodo]) continue;
        const caminhos = lista<string>(
          Reflect.getMetadata(PATH_METADATA, fn) as string | string[],
        );
        const guards = [
          ...lista<{ name?: string }>(
            Reflect.getMetadata(GUARDS_METADATA, classe) as { name?: string }[],
          ),
          ...lista<{ name?: string }>(
            Reflect.getMetadata(GUARDS_METADATA, fn) as { name?: string }[],
          ),
        ].map((g) => g?.name);
        const seguranca: Seguranca = guards.includes(GUARD_PAINEL)
          ? 'painel'
          : guards.includes(GUARD_AGENTE)
            ? 'agente'
            : 'publico';
        const recurso =
          this.reflector.getAllAndOverride<string | undefined>(RECURSO, [
            fn as () => void,
            classe,
          ]) ?? null;
        for (const b of base.length ? base : ['']) {
          for (const c of caminhos.length ? caminhos : ['']) {
            const raiz = b === 'r' ? '' : 'v1';
            rotas.push({
              metodo: METODOS[metodo],
              caminho: juntar(raiz, b, c),
              controlador: classe.name.replace(/Controller$/, ''),
              seguranca,
              recurso: seguranca === 'painel' ? recurso : null,
            });
          }
        }
      }
    }
    return rotas.sort(
      (a, b) =>
        a.caminho.localeCompare(b.caminho) || a.metodo.localeCompare(b.metodo),
    );
  }

  documento(): object {
    if (this.cache) return this.cache;
    const paths: Record<string, Record<string, object>> = {};
    for (const r of this.rotas()) {
      if (r.caminho === '/v1/agent/tools/{nome}' && r.metodo === 'post') {
        continue; // sai abaixo, uma por ferramenta
      }
      const parametros = [...r.caminho.matchAll(/\{([A-Za-z_]+)\}/g)].map(
        (m) => ({
          name: m[1],
          in: 'path',
          required: true,
          schema: { type: 'string' },
        }),
      );
      (paths[r.caminho] ??= {})[r.metodo] = {
        tags: [r.controlador],
        operationId: `${r.metodo}_${r.caminho}`.replace(/[^A-Za-z0-9_]/g, '_'),
        ...(r.recurso ? { description: `Permissão: ${r.recurso}.` } : {}),
        ...(parametros.length ? { parameters: parametros } : {}),
        security: SEGURANCA[r.seguranca],
        responses: { default: { $ref: '#/components/responses/Erro' } },
      };
    }
    for (const f of this.registo.catalogo()) {
      const esquema = { ...f.entrada };
      delete esquema['$schema'];
      paths[f.caminho] = {
        post: {
          tags: ['Ferramentas do agente'],
          operationId: f.nome,
          summary: f.nome,
          description: f.descricao,
          security: SEGURANCA.agente,
          parameters: [
            { $ref: '#/components/parameters/Municipio' },
            { $ref: '#/components/parameters/ConversaId' },
            { $ref: '#/components/parameters/Telefone' },
            { $ref: '#/components/parameters/TelefoneWeb' },
          ],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: esquema } },
          },
          responses: {
            '200': {
              description:
                'Resultado para o modelo (com `dizer` quando há texto para dizer).',
              content: { 'application/json': { schema: { type: 'object' } } },
            },
            default: { $ref: '#/components/responses/Erro' },
          },
        },
      };
    }
    this.cache = {
      openapi: '3.1.0',
      info: {
        title: 'Tou, Câmara? · API',
        version: '1',
        description:
          'Ferramentas do agente (voz e chat), painel da câmara, páginas públicas e webhooks. Erros: { erro: { codigo, mensagem, detalhes } }.',
      },
      servers: [{ url: this.config.get<string>('app.apiUrl') ?? '' }],
      paths,
      components: {
        securitySchemes: {
          painel: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
          agente: { type: 'apiKey', in: 'header', name: 'X-Agente-Segredo' },
        },
        parameters: {
          Municipio: {
            name: 'X-Municipio',
            in: 'header',
            required: true,
            schema: { type: 'string' },
            description: 'Slug do município.',
          },
          ConversaId: {
            name: 'X-Conversa-Id',
            in: 'header',
            required: false,
            schema: { type: 'string' },
            description:
              'Id da conversa no ElevenLabs ({{system__conversation_id}}).',
          },
          Telefone: {
            name: 'X-Telefone',
            in: 'header',
            required: false,
            schema: { type: 'string' },
            description: 'Número de quem liga ({{system__caller_id}}).',
          },
          TelefoneWeb: {
            name: 'X-Telefone-Web',
            in: 'header',
            required: false,
            schema: { type: 'string' },
            description:
              'Na chamada web (página /ligar): o número que a pessoa escreveu.',
          },
        },
        responses: {
          Erro: {
            description: 'Erro',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    erro: {
                      type: 'object',
                      properties: {
                        codigo: { type: 'string' },
                        mensagem: { type: 'string' },
                        detalhes: {},
                      },
                      required: ['codigo', 'mensagem'],
                    },
                  },
                },
              },
            },
          },
        },
      },
    };
    return this.cache;
  }
}

const SEGURANCA: Record<Seguranca, object[]> = {
  painel: [{ painel: [] }],
  agente: [{ agente: [] }],
  publico: [],
};
