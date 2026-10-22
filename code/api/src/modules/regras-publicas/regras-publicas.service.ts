import { HttpStatus, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { hojeLisboa } from '../../common/dias-uteis.js';
import { ErroApi } from '../../common/erros.js';
import { validar } from '../../common/validacao.js';
import { DatabaseService } from '../../database/database.service.js';
import { formatarEuros } from '../pagamentos/taxas.js';
import {
  DADOS_PARA_DECIDIR,
  rotuloRegra,
  VIA_DITA,
} from '../licencas/decisao.js';
import {
  frasesCondicoes,
  frasesRegras,
  frasesTaxas,
  valoresRegras,
} from '../licencas/explicar.js';
import {
  ConfigComum,
  DadosComuns,
  entradaPedirRuido,
  LicencasService,
} from '../licencas/licencas.service.js';
import {
  DEFS,
  ENTRADAS,
  esquemaTipo,
  TipoLicenca,
  TIPOS,
} from '../licencas/tipos.js';
import type { Municipio } from '../municipios/municipios.service.js';
import { MunicipiosService } from '../municipios/municipios.service.js';
import { explicarZona } from '../ordenamento/explicar-zona.js';
import {
  OrdenamentoService,
  Zona,
} from '../ordenamento/ordenamento.service.js';
import { CONTROLO_DITO, Obra, OBRAS, passos } from '../ordenamento/regras.js';
import { CAMPOS_VERIFICADOR, completarPedido } from './verificador.js';
import {
  geracaoRegras,
  RegrasVersoesService,
  VersaoRegras,
} from './versoes.service.js';

/** A cache do resumo dura no máximo isto (e cai logo que haja uma versão nova). */
const CACHE_MS = 60_000;

export const esquemaVerificarZona = z.object({
  obra: z.enum(Object.keys(OBRAS) as [Obra, ...Obra[]]),
  area_m2: z.coerce.number().positive().max(100_000).optional(),
  altura_m: z.coerce.number().positive().max(100).optional(),
});

const APROVACAO_DITA = {
  automatica:
    'Os pedidos que cumprem todas as regras são decididos automaticamente. Só as exceções vão a uma pessoa.',
  funcionario:
    'Os pedidos que cumprem todas as regras são confirmados por um funcionário. As exceções vão a um técnico.',
} as const;

/**
 * "Regras públicas e verificáveis": as regras em vigor de cada licença e de
 * cada zona do PDM, em linguagem simples, com os valores, a fonte, desde
 * quando vigoram e o histórico de alterações; o verificador (o mesmo motor
 * que decide os pedidos reais) e o export JSON. Sem login.
 */
@Injectable()
export class RegrasPublicasService {
  private readonly cache = new Map<
    string,
    { geracao: number; em: number; dados: unknown }
  >();

  constructor(
    private readonly db: DatabaseService,
    private readonly municipios: MunicipiosService,
    private readonly licencas: LicencasService,
    private readonly ordenamento: OrdenamentoService,
    private readonly versoes: RegrasVersoesService,
  ) {}

  private async emCache<T>(chave: string, fazer: () => Promise<T>): Promise<T> {
    const c = this.cache.get(chave);
    const g = geracaoRegras();
    if (c && c.geracao === g && Date.now() - c.em < CACHE_MS) {
      return c.dados as T;
    }
    const dados = await fazer();
    this.cache.set(chave, { geracao: g, em: Date.now(), dados });
    return dados;
  }

  // ------------------------------------------------------------------
  // Leitura
  // ------------------------------------------------------------------

  /** Todas as regras em vigor (licenças e zonas), sem os históricos. */
  async resumo(slug: string) {
    const m = await this.municipios.porSlug(slug);
    return this.emCache(`resumo:${m.id}`, async () => {
      const [licencas, zonas] = await Promise.all([
        this.itensLicencas(m),
        this.itensZonas(m),
      ]);
      return {
        municipio: { slug: m.slug, nome: m.nome },
        gerado_em: new Date().toISOString(),
        licencas: licencas.map((x) => ({ ...x, historico: undefined })),
        zonas: zonas.map((x) => ({
          ...x,
          historico: undefined,
          poligono: undefined,
        })),
        nota: 'As mesmas regras que o assistente da câmara aplica aos pedidos. Os valores marcados como de demonstração ainda não são os do regulamento municipal.',
      };
    });
  }

  /** Um tipo de licença: as regras, o histórico e o que o verificador pede. */
  async licenca(slug: string, tipo: string) {
    const m = await this.municipios.porSlug(slug);
    const t = this.tipoDe(tipo);
    return this.emCache(`licenca:${m.id}:${t}`, async () => {
      const item = (await this.itensLicencas(m, t))[0];
      return {
        municipio: { slug: m.slug, nome: m.nome },
        ...item,
        verificador: CAMPOS_VERIFICADOR[t],
      };
    });
  }

  /** Uma zona do PDM: as regras por obra, o histórico e o mapa. */
  async zona(slug: string, codigo: string) {
    const m = await this.municipios.porSlug(slug);
    const z = await this.zonaPorCodigo(m, codigo);
    return this.emCache(`zona:${m.id}:${z.codigo}`, async () => {
      const item = (await this.itensZonas(m, z.codigo))[0];
      return {
        municipio: { slug: m.slug, nome: m.nome },
        ...item,
        obras_texto: OBRAS,
      };
    });
  }

  /** Tudo, com os históricos completos, para quem quiser auditar. */
  async exportar(slug: string) {
    const m = await this.municipios.porSlug(slug);
    return this.emCache(`export:${m.id}`, async () => {
      const [licencas, zonas] = await Promise.all([
        this.itensLicencas(m),
        this.itensZonas(m),
      ]);
      return {
        formato: 'toucamara.regras/1',
        municipio: { slug: m.slug, nome: m.nome },
        gerado_em: new Date().toISOString(),
        nota: 'Regras em vigor e histórico de alterações. "config" é exatamente o que o motor de decisão usa. Valores com demonstracao: true ainda não são os do regulamento municipal.',
        licencas: licencas.map((l) => ({
          tipo: l.tipo,
          nome: l.nome,
          versao: l.versao,
          vigor_desde: l.vigor_desde,
          aprovacao: l.aprovacao,
          demonstracao: l.demonstracao,
          fonte: l.fonte,
          regras: l.regras,
          taxas: l.taxas,
          valores: l.valores,
          config: l.config,
          historico: l.historico,
        })),
        zonas: zonas.map((z) => ({
          codigo: z.codigo,
          nome: z.nome,
          categoria: z.categoria,
          versao: z.versao,
          vigor_desde: z.vigor_desde,
          demonstracao: z.demonstracao,
          fonte: z.fonte,
          obras: z.obras,
          config: z.config,
          historico: z.historico,
        })),
      };
    });
  }

  // ------------------------------------------------------------------
  // Verificador (o mesmo motor que os pedidos reais)
  // ------------------------------------------------------------------

  async verificarLicenca(slug: string, tipo: string, body: unknown) {
    const m = await this.municipios.porSlug(slug);
    const t = this.tipoDe(tipo);
    const esquema = t === 'ruido' ? entradaPedirRuido : ENTRADAS[t];
    const dados = validar(
      esquema as z.ZodType<DadosComuns>,
      completarPedido(t, body),
    );
    const hoje = hojeLisboa();
    const { config, avaliacao, decisao, versao } =
      await this.licencas.avaliarPedido(m.id, t, dados, hoje);
    const frases = new Map(frasesRegras(t, config).map((f) => [f.id, f.texto]));
    const def = DEFS[t];
    const resultado =
      decisao.via === 'automatica'
        ? `Cumpre todas as regras: ${def.feminino ? 'seria aprovada' : 'seria aprovado'} automaticamente, logo que a taxa estivesse paga.`
        : decisao.via === 'funcionario'
          ? 'Cumpre todas as regras: um funcionário confirmaria e emitia.'
          : avaliacao.proposta === 'aprovar'
            ? 'Cumpre as regras, mas falta um dado: um funcionário confirmaria.'
            : 'Não cabe nas regras automáticas: iria a um técnico, que pode aprovar na mesma.';
    return {
      tipo: t,
      nome: def.nome,
      municipio: { slug: m.slug, nome: m.nome },
      verificado_em: hoje,
      versao,
      proposta: avaliacao.proposta,
      decisao: {
        via: decisao.via,
        dita: VIA_DITA[decisao.via],
        motivos: decisao.motivos,
      },
      resultado,
      regras: avaliacao.regras.map((r) => ({
        id: r.id,
        rotulo: rotuloRegra(t, r.id),
        ok: r.ok,
        texto: r.texto,
        regra: frases.get(r.id) ?? null,
      })),
      condicoes: avaliacao.condicoes,
      taxa: {
        total_cent: avaliacao.taxa.total_cent,
        texto: formatarEuros(avaliacao.taxa.total_cent),
        linhas: avaliacao.taxa.linhas,
      },
      demonstracao: config.demonstracao,
      fonte: config.fonte,
      nota: 'Isto não é um pedido: nada fica registado. A decisão final é sempre da câmara.',
    };
  }

  async verificarZona(slug: string, codigo: string, body: unknown) {
    const m = await this.municipios.porSlug(slug);
    const z = await this.zonaPorCodigo(m, codigo);
    const e = validar(esquemaVerificarZona, body);
    const a = this.ordenamento.avaliarNaZona(z, e.obra, {
      area_m2: e.area_m2,
      altura_m: e.altura_m,
    });
    return {
      zona: { codigo: z.codigo, nome: z.nome, demonstracao: z.demonstracao },
      obra: e.obra,
      obra_texto: OBRAS[e.obra],
      controlo: a.controlo,
      controlo_dito: a.controlo ? CONTROLO_DITO[a.controlo] : null,
      em_falta: a.em_falta,
      limites: a.limites,
      notas: a.notas,
      passos: a.controlo ? passos(a.controlo) : [],
      resultado: a.em_falta.length
        ? `Para saber, diga ${a.em_falta.map((x) => (x === 'area_m2' ? 'a área' : 'a altura')).join(' e ')}.`
        : a.controlo
          ? `${OBRAS[e.obra]} em ${z.nome}: ${CONTROLO_DITO[a.controlo]}.`
          : `Não há regra para esta obra em ${z.nome}: um técnico tem de ver o caso.`,
      fonte: z.fonte,
      nota: 'Isto não é um pedido: nada fica registado. A decisão final é sempre da câmara.',
    };
  }

  // ------------------------------------------------------------------

  private tipoDe(tipo: string): TipoLicenca {
    const r = esquemaTipo.safeParse(tipo);
    if (!r.success) {
      throw new ErroApi(
        HttpStatus.NOT_FOUND,
        'tipo_desconhecido',
        'Não há nenhuma licença com este nome.',
      );
    }
    return r.data;
  }

  private async zonaPorCodigo(m: Municipio, codigo: string): Promise<Zona> {
    const z = (await this.ordenamento.zonas(m.id)).find(
      (x) => x.codigo.toLowerCase() === codigo.trim().toLowerCase(),
    );
    if (!z) {
      throw new ErroApi(
        HttpStatus.NOT_FOUND,
        'zona_desconhecida',
        'Não há nenhuma zona com este código.',
      );
    }
    return z;
  }

  private async itensLicencas(m: Municipio, so?: TipoLicenca) {
    const inicio = await this.licencas.inicioMunicipio(this.db, m.id);
    const tipos = so ? [so] : [...TIPOS];
    return Promise.all(
      tipos.map(async (t) => {
        const config = (await this.licencas.configDe(m.id, t)) as ConfigComum &
          Record<string, unknown>;
        const historico = await this.versoes.historico(
          m.id,
          'licenca',
          t,
          config,
          inicio,
        );
        return {
          tipo: t,
          nome: DEFS[t].nome,
          ...this.cabecalhoVersao(historico),
          aprovacao: config.aprovacao,
          aprovacao_dita: APROVACAO_DITA[config.aprovacao],
          regras: frasesRegras(t, config),
          taxas: frasesTaxas(t, config),
          condicoes: frasesCondicoes(t, config),
          valores: valoresRegras(t, config),
          // O que tem de saber para o pedido se decidir sozinho.
          dados_necessarios: DADOS_PARA_DECIDIR[t]
            .filter((d) => d.ativo(config))
            .map((d) => d.rotulo),
          demonstracao: config.demonstracao,
          fonte: config.fonte,
          config,
          historico: historico.map((v) => this.versaoPublica(v)),
        };
      }),
    );
  }

  private async itensZonas(m: Municipio, so?: string) {
    const zonas = (await this.ordenamento.zonas(m.id)).filter(
      (z) => !so || z.codigo === so,
    );
    return Promise.all(
      zonas.map(async (z) => {
        const config = OrdenamentoService.configZona(z);
        const historico = await this.versoes.historico(
          m.id,
          'zona',
          z.codigo,
          config,
          await this.ordenamento.criadaEm(z.id),
        );
        return {
          codigo: z.codigo,
          nome: z.nome,
          categoria: z.categoria,
          descricao: z.descricao,
          ...this.cabecalhoVersao(historico),
          obras: explicarZona(z.regras),
          demonstracao: z.demonstracao,
          fonte: z.fonte,
          poligono: z.poligono,
          config,
          historico: historico.map((v) => this.versaoPublica(v)),
        };
      }),
    );
  }

  private cabecalhoVersao(h: VersaoRegras[]) {
    return {
      versao: h[0].versao,
      vigor_desde: h[0].vigor_desde,
      alteracoes: h.filter((v) => !v.inicial).length,
    };
  }

  /** Sem o id de quem mudou: só o cargo. */
  private versaoPublica(v: VersaoRegras) {
    return {
      versao: v.versao,
      vigor_desde: v.vigor_desde,
      cargo: v.cargo,
      inicial: v.inicial,
      nota: v.nota,
      alteracoes: v.alteracoes,
      config: v.config,
    };
  }
}
