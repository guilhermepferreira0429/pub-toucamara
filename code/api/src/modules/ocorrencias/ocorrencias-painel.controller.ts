import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
  UseInterceptors,
} from '@nestjs/common';
import { z } from 'zod';
import { Coluna, ficheiroCsv, gerarCsv, nomeCsv } from '../../common/csv.js';
import {
  esquemaPaginacao,
  Pagina,
  todasAsPaginas,
} from '../../common/paginacao.js';
import { IdempotenciaInterceptor } from '../../common/idempotencia.interceptor.js';
import { MunicipioAtual, UtilizadorAtual } from '../../common/pedido.js';
import type { UtilizadorPainel } from '../../common/pedido.js';
import { validar } from '../../common/validacao.js';
import { Painel } from '../auth/painel.guard.js';
import type { Municipio } from '../municipios/municipios.service.js';
import { ESTADOS_OCORRENCIA } from './ocorrencias.regras.js';
import { OcorrenciasService } from './ocorrencias.service.js';

/** 'minLng,minLat,maxLng,maxLat', como o Leaflet/MapLibre dão a caixa visível. */
export const esquemaBbox = z
  .string()
  .transform((s) => s.split(',').map((x) => Number(x.trim())))
  .refine(
    (v) =>
      v.length === 4 &&
      v.every(Number.isFinite) &&
      v[0] < v[2] &&
      v[1] < v[3] &&
      Math.abs(v[1]) <= 90 &&
      Math.abs(v[3]) <= 90,
    'bbox: minLng,minLat,maxLng,maxLat',
  )
  .transform((v) => v as [number, number, number, number]);

const esquemaLista = esquemaPaginacao.extend({
  bbox: esquemaBbox.optional(),
  estado: z.enum(ESTADOS_OCORRENCIA).optional(),
  categoria_id: z.guid().optional(),
  desde: z.coerce.date().optional(),
});

/** Uma linha da lista (sem caixa do mapa), para o CSV. */
interface LinhaOcorrencia {
  numero: string;
  estado: string;
  categoria: string;
  descricao: string | null;
  morada: string | null;
  servico: string | null;
  prevista_para: string | null;
  criada_em: Date;
  resolvida_em: Date | null;
  duplicados: number;
  canal: string | null;
  fotos: number;
}

const ESTADOS_CSV: Record<string, string> = {
  nova: 'Nova',
  com_equipa: 'Com a equipa',
  resolvida: 'Resolvida',
  duplicada: 'Duplicada',
  rejeitada: 'Rejeitada',
};

/** Sem munícipe nem contacto: só a ocorrência. */
const COLUNAS_CSV: Coluna<LinhaOcorrencia>[] = [
  { titulo: 'Número', valor: (o) => o.numero },
  { titulo: 'Registada em', valor: (o) => o.criada_em },
  { titulo: 'Estado', valor: (o) => ESTADOS_CSV[o.estado] ?? o.estado },
  { titulo: 'Categoria', valor: (o) => o.categoria },
  { titulo: 'Morada', valor: (o) => o.morada },
  { titulo: 'Descrição', valor: (o) => o.descricao },
  { titulo: 'Serviço', valor: (o) => o.servico },
  { titulo: 'Prevista para', valor: (o) => o.prevista_para },
  { titulo: 'Resolvida em', valor: (o) => o.resolvida_em },
  { titulo: 'Avisos repetidos', valor: (o) => o.duplicados },
  { titulo: 'Fotografias', valor: (o) => o.fotos },
  { titulo: 'Canal', valor: (o) => o.canal },
];

const esquemaAlteracao = z
  .object({
    // 'duplicada' só a deteção automática põe.
    estado: z.enum(['nova', 'com_equipa', 'resolvida', 'rejeitada']).optional(),
    servico_id: z.guid().nullable().optional(),
    prevista_para: z.iso.date().nullable().optional(),
  })
  .refine(
    (a) => Object.values(a).some((v) => v !== undefined),
    'Nada para alterar.',
  );

const esquemaId = z.guid();

@Controller('painel/ocorrencias')
// A app da equipa de campo reenvia o que guardou sem rede com Idempotency-Key.
@UseInterceptors(IdempotenciaInterceptor)
export class OcorrenciasPainelController {
  constructor(private readonly ocorrencias: OcorrenciasService) {}

  // As rotas fixas antes de ':id'.
  @Get('categorias')
  @Painel('ocorrencias_ver')
  categorias(@MunicipioAtual() m: Municipio) {
    return this.ocorrencias.categoriasPainel(m.id);
  }

  @Get('resumo')
  @Painel('ocorrencias_ver')
  resumo(@MunicipioAtual() m: Municipio) {
    return this.ocorrencias.resumo(m.id);
  }

  @Get()
  @Painel('ocorrencias_ver')
  lista(@MunicipioAtual() m: Municipio, @Query() query: unknown) {
    return this.ocorrencias.lista(m.id, validar(esquemaLista, query));
  }

  /** A lista com os mesmos filtros (sem a caixa do mapa), em CSV. */
  @Get('exportar.csv')
  @Painel('ocorrencias_ver')
  async exportar(@MunicipioAtual() m: Municipio, @Query() query: unknown) {
    const f = validar(esquemaLista.omit({ bbox: true }), query);
    const itens = await todasAsPaginas(
      async (p) =>
        (await this.ocorrencias.lista(m.id, {
          ...f,
          ...p,
        })) as unknown as Pagina<LinhaOcorrencia>,
    );
    return ficheiroCsv(
      gerarCsv(COLUNAS_CSV, itens, m.fuso),
      nomeCsv('ocorrencias', new Date(), m.fuso),
    );
  }

  @Get(':id')
  @Painel('ocorrencias_ver')
  detalhe(@MunicipioAtual() m: Municipio, @Param('id') id: string) {
    return this.ocorrencias.detalhe(m.id, validar(esquemaId, id));
  }

  @Patch(':id')
  @Painel('ocorrencias')
  alterar(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.ocorrencias.alterar(
      m,
      u,
      validar(esquemaId, id),
      validar(esquemaAlteracao, body),
    );
  }
}
