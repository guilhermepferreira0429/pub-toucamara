import { Injectable, Logger, Optional } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service.js';
import { Descarga, DescarregadorService } from './descarregador.service.js';
import {
  dentroDoSite,
  ErroFonte,
  FiltroSite,
  lerPagina,
  lerSitemap,
  tituloDoEndereco,
} from './recolha.js';
import { descodificarBytes, ePdf } from './texto.js';

export const JOB_DESCOBRIR = 'descobrir_site';

export interface DadosDescobrir {
  site_id: string;
}

interface Site extends FiltroSite {
  id: string;
  municipio_id: string;
  entidade_id: string;
  sitemap_url: string | null;
  profundidade: number;
  max_paginas: number;
  tipo_fontes: string;
}

/** Sitemaps dentro de sitemaps: até aqui. */
const NIVEIS_SITEMAP = 3;

/**
 * Descoberta das páginas de um site (`fonte_sites`): o sitemap (o indicado,
 * ou /sitemap.xml) e, sem ele, os links a partir do endereço inicial até
 * `profundidade`. Só o que está no mesmo domínio e dentro dos prefixos, no
 * máximo `max_paginas`. Cada página nova passa a ser uma fonte, lida pela
 * ingestão como as outras (com o título trocado pelo da página na 1.ª
 * leitura). As que deixarem de aparecer não se apagam: se a página acabar,
 * a leitura dá 404 e a fonte fica em erro, à vista no painel.
 */
@Injectable()
export class DescobertaService {
  private readonly logger = new Logger(DescobertaService.name);

  constructor(
    private readonly db: DatabaseService,
    @Optional()
    private readonly descarregador: DescarregadorService = new DescarregadorService(),
  ) {}

  /** Os sites ativos cuja descoberta venceu (para o tick). */
  async vencidos(): Promise<string[]> {
    const r = await this.db.query<{ id: string }>(
      `SELECT id FROM fonte_sites
       WHERE ativo AND coalesce(proxima_descoberta_em, '-infinity') <= now()`,
    );
    return r.map((s) => s.id);
  }

  async descobrir(
    siteId: string,
  ): Promise<{ encontradas: number; novas: number; municipio_id?: string }> {
    const [site] = await this.db.query<Site>(
      `SELECT id, municipio_id, entidade_id, url_inicial, sitemap_url, incluir, excluir,
              profundidade, max_paginas, tipo_fontes
       FROM fonte_sites WHERE id = $1`,
      [siteId],
    );
    if (!site) return { encontradas: 0, novas: 0 };
    try {
      const urls = await this.pelosSitemaps(site);
      const paginas = urls.size ? urls : await this.pelosLinks(site);
      const lista = [...paginas].slice(0, site.max_paginas);
      const novas = await this.gravar(site, lista);
      await this.db.query(
        `UPDATE fonte_sites SET ultima_descoberta_em = now(), paginas_encontradas = $2, erro = NULL,
                proxima_descoberta_em = now() + descobrir_a_cada
         WHERE id = $1`,
        [site.id, lista.length],
      );
      this.logger.log(
        `Site ${site.url_inicial}: ${lista.length} páginas, ${novas} novas.`,
      );
      return {
        encontradas: lista.length,
        novas,
        municipio_id: site.municipio_id,
      };
    } catch (e) {
      const erro = (e as Error).message.slice(0, 500);
      await this.db.query(
        `UPDATE fonte_sites SET erro = $2, ultima_descoberta_em = now(),
                proxima_descoberta_em = now() + interval '1 day'
         WHERE id = $1`,
        [site.id, erro],
      );
      if (!(e instanceof ErroFonte))
        this.logger.warn(`Site ${site.id}: ${erro}`);
      return { encontradas: 0, novas: 0 };
    }
  }

  /** Páginas do(s) sitemap(s), já filtradas. Vazio se não houver sitemap. */
  private async pelosSitemaps(site: Site): Promise<Set<string>> {
    const paginas = new Set<string>();
    const indicado = site.sitemap_url;
    let fila = [indicado ?? `${new URL(site.url_inicial).origin}/sitemap.xml`];
    const vistos = new Set<string>();
    for (let nivel = 0; nivel < NIVEIS_SITEMAP && fila.length; nivel++) {
      const seguintes: string[] = [];
      for (const url of fila) {
        if (vistos.has(url) || paginas.size >= site.max_paginas) continue;
        vistos.add(url);
        let xml: string;
        try {
          const d = await this.descarregador.obter(url);
          if (d.estado !== 'ok') continue;
          xml = descodificarBytes(d.bytes, d.tipo);
        } catch (e) {
          // O indicado à mão tem de existir; o /sitemap.xml por omissão, não.
          if (indicado && nivel === 0) throw e;
          continue;
        }
        const s = lerSitemap(xml);
        seguintes.push(...s.sitemaps);
        for (const p of s.paginas) {
          const u = dentroDoSite(p, site);
          if (u) paginas.add(u);
          if (paginas.size >= site.max_paginas) break;
        }
      }
      fila = seguintes;
    }
    return paginas;
  }

  /** Sem sitemap: segue os links, em largura, até à profundidade do site. */
  private async pelosLinks(site: Site): Promise<Set<string>> {
    const inicial = dentroDoSite(site.url_inicial, {
      ...site,
      incluir: [],
      excluir: [],
    });
    const paginas = new Set<string>(inicial ? [inicial] : []);
    let nivel = inicial ? [inicial] : [];
    for (let p = 0; p < site.profundidade && nivel.length; p++) {
      const seguinte: string[] = [];
      for (const url of nivel) {
        if (paginas.size >= site.max_paginas) break;
        let d: Descarga;
        try {
          d = await this.descarregador.obter(url);
        } catch (e) {
          if (url === inicial) throw e;
          continue;
        }
        if (d.estado !== 'ok' || ePdf(d.bytes, d.tipo, url)) continue;
        if (!/html|xml|^$/i.test(d.tipo)) continue;
        const { links } = lerPagina(descodificarBytes(d.bytes, d.tipo), url);
        for (const l of links) {
          const u = dentroDoSite(l, site);
          if (!u || paginas.has(u)) continue;
          paginas.add(u);
          seguinte.push(u);
          if (paginas.size >= site.max_paginas) break;
        }
      }
      nivel = seguinte;
    }
    return paginas;
  }

  /** As páginas novas viram fontes; as que já existem ficam como estão. */
  private async gravar(site: Site, urls: string[]): Promise<number> {
    if (!urls.length) return 0;
    const r = await this.db.query(
      `INSERT INTO fontes (municipio_id, entidade_id, titulo, tipo, url, ler_a_cada,
         leitura_automatica, site_id, titulo_automatico)
       SELECT $1, $2, x.titulo, $3, x.url, s.ler_a_cada, true, s.id, true
       FROM unnest($4::text[], $5::text[]) AS x(url, titulo)
       JOIN fonte_sites s ON s.id = $6
       ON CONFLICT (municipio_id, url) DO NOTHING
       RETURNING id`,
      [
        site.municipio_id,
        site.entidade_id,
        site.tipo_fontes,
        urls,
        urls.map(tituloDoEndereco),
        site.id,
      ],
    );
    return r.length;
  }
}
