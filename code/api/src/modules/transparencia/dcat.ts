import type { DefConjunto } from './conjuntos.js';
import { FREQUENCIAS, LICENCA } from './regras.js';

/*
 * O catálogo DCAT-AP (JSON-LD) que o dados.gov.pt recolhe: um dcat:Catalog
 * com um dcat:Dataset por conjunto publicado e, em cada um, duas
 * dcat:Distribution (CSV e JSON). Puro, para testar a forma.
 */

export const CONTEXTO_DCAT = {
  dcat: 'http://www.w3.org/ns/dcat#',
  dct: 'http://purl.org/dc/terms/',
  foaf: 'http://xmlns.com/foaf/0.1/',
  vcard: 'http://www.w3.org/2006/vcard/ns#',
  xsd: 'http://www.w3.org/2001/XMLSchema#',
  rdfs: 'http://www.w3.org/2000/01/rdf-schema#',
} as const;

const EU = 'http://publications.europa.eu/resource/authority';
const LINGUA_PT = `${EU}/language/POR`;
const TEMA_GOVERNO = `${EU}/data-theme/GOVE`;
const FORMATOS = {
  csv: { uri: `${EU}/file-type/CSV`, mime: 'text/csv' },
  json: { uri: `${EU}/file-type/JSON`, mime: 'application/json' },
} as const;

export interface PublicacaoDcat {
  id: string;
  gerado_em: string;
  /** A primeira publicação deste conjunto (dct:issued). */
  primeira_em: string;
  periodo_de: string;
  periodo_ate: string;
  bytes_csv: number;
  bytes_json: number;
}

export interface EntradaDcat {
  municipio: { slug: string; nome: string; email: string | null };
  /** URL absoluta de /v1/public/dados/{municipio} (sem barra no fim). */
  base: string;
  /** O site da câmara ou do portal, se houver. */
  pagina: string | null;
  conjuntos: { def: DefConjunto; publicacao: PublicacaoDcat }[];
}

const data = (d: string) => ({ '@value': d, '@type': 'xsd:date' });
const dataHora = (d: string) => ({ '@value': d, '@type': 'xsd:dateTime' });

export function catalogoDcat(e: EntradaDcat): Record<string, unknown> {
  const editor = {
    '@id': `${e.base}#editor`,
    '@type': 'foaf:Agent',
    'foaf:name': `Município de ${e.municipio.nome}`,
  };
  const contacto = {
    '@type': 'vcard:Organization',
    'vcard:fn': `Município de ${e.municipio.nome}`,
    ...(e.municipio.email
      ? { 'vcard:hasEmail': { '@id': `mailto:${e.municipio.email}` } }
      : {}),
  };
  const modificado = e.conjuntos
    .map((c) => c.publicacao.gerado_em)
    .sort()
    .at(-1);

  return {
    '@context': CONTEXTO_DCAT,
    '@id': `${e.base}/catalogo.jsonld`,
    '@type': 'dcat:Catalog',
    'dct:title': {
      '@value': `Dados abertos do Município de ${e.municipio.nome}`,
      '@language': 'pt',
    },
    'dct:description': {
      '@value':
        'Números agregados do atendimento municipal (ocorrências, processos, atendimento, reclamações, consultas públicas e licenças), publicados automaticamente e sem dados pessoais.',
      '@language': 'pt',
    },
    'dct:publisher': editor,
    'dct:language': { '@id': LINGUA_PT },
    'dct:license': { '@id': LICENCA.uri },
    'foaf:homepage': { '@id': e.pagina ?? e.base },
    ...(modificado ? { 'dct:modified': dataHora(modificado) } : {}),
    'dcat:dataset': e.conjuntos.map(({ def, publicacao: p }) => {
      const url = `${e.base}/${def.id}`;
      const distribuicao = (f: 'csv' | 'json') => ({
        '@id': `${url}.${f}`,
        '@type': 'dcat:Distribution',
        'dct:title': {
          '@value': `${def.titulo} (${f.toUpperCase()})`,
          '@language': 'pt',
        },
        'dcat:accessURL': { '@id': url },
        'dcat:downloadURL': { '@id': `${url}.${f}` },
        'dcat:mediaType': {
          '@id': `https://www.iana.org/assignments/media-types/${FORMATOS[f].mime}`,
        },
        'dct:format': { '@id': FORMATOS[f].uri },
        'dct:license': { '@id': LICENCA.uri },
        'dct:modified': dataHora(p.gerado_em),
        'dcat:byteSize': {
          '@value': String(f === 'csv' ? p.bytes_csv : p.bytes_json),
          '@type': 'xsd:nonNegativeInteger',
        },
      });
      return {
        '@id': url,
        '@type': 'dcat:Dataset',
        'dct:identifier': `${e.municipio.slug}/${def.id}`,
        'dct:title': { '@value': def.titulo, '@language': 'pt' },
        'dct:description': { '@value': def.descricao, '@language': 'pt' },
        'dcat:keyword': def.palavras_chave.map((k) => ({
          '@value': k,
          '@language': 'pt',
        })),
        'dcat:theme': { '@id': TEMA_GOVERNO },
        'dct:publisher': { '@id': editor['@id'] },
        'dcat:contactPoint': contacto,
        'dct:language': { '@id': LINGUA_PT },
        'dct:accrualPeriodicity': { '@id': FREQUENCIAS[def.frequencia].uri },
        'dct:issued': dataHora(p.primeira_em),
        'dct:modified': dataHora(p.gerado_em),
        'dct:temporal': {
          '@type': 'dct:PeriodOfTime',
          'dcat:startDate': data(p.periodo_de),
          'dcat:endDate': data(p.periodo_ate),
        },
        'dcat:landingPage': { '@id': url },
        'dcat:distribution': [distribuicao('csv'), distribuicao('json')],
      };
    }),
  };
}
