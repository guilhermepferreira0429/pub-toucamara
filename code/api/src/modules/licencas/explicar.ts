/*
 * As regras de cada tipo de licença em linguagem simples, para a página
 * pública "Regras públicas e verificáveis": uma frase por regra (com o
 * mesmo id que o avaliador devolve, para o verificador ligar o resultado à
 * regra), os valores como o painel os mostra e o que mudou entre duas
 * versões. Sem BD. As frases leem os mesmos números que o avaliador usa:
 * mudar uma regra no painel muda a página.
 */
import type { CampoRegra, TipoLicenca } from './tipos.js';
import { DEFS } from './tipos.js';
import type { ConfigRuido } from './regras.js';
import type { ConfigOcupacao } from './regras-ocupacao.js';
import { EQUIPAMENTOS } from './regras-ocupacao.js';
import type { ConfigEsplanada } from './regras-esplanada.js';
import type { ConfigDistico } from './regras-distico.js';
import type { ConfigPublicidade } from './regras-publicidade.js';
import { SUPORTES } from './regras-publicidade.js';
import type { ConfigRecinto } from './regras-recinto.js';
import { ESTRUTURAS } from './regras-recinto.js';
import { euros, num } from './comum.js';

export interface FraseRegra {
  /** O id da regra no avaliador ('antecedencia', 'area', ...). */
  id: string;
  texto: string;
}

export interface ValorRegra {
  chave: string;
  rotulo: string;
  valor: string;
}

/** "09:00" → "9h", "23:30" → "23h30", "00:00" → "meia-noite". */
export function horaDita(h: string): string {
  const [a, b] = h.split(':').map(Number);
  if (a === 0 && !b) return 'meia-noite';
  return b ? `${a}h${String(b).padStart(2, '0')}` : `${a}h`;
}

/** "às 9h", "à 1h", "à meia-noite". */
function aHora(h: string): string {
  const a = Number(h.split(':')[0]);
  return `${a === 0 || a === 1 ? 'à' : 'às'} ${horaDita(h)}`;
}

function lista(xs: string[]): string {
  if (xs.length <= 1) return xs.join('');
  return `${xs.slice(0, -1).join(', ')} e ${xs[xs.length - 1]}`;
}

/** Um valor das regras como se lê (o mesmo formato do painel). */
export function valorDito(c: CampoRegra, v: unknown): string {
  switch (c.tipo) {
    case 'euros':
      return euros(Number(v));
    case 'lista_euros':
      return (v as number[]).map((x) => euros(x)).join(' · ');
    case 'booleano':
      return v ? 'sim' : 'não';
    case 'opcoes':
      return (v as string[]).map((x) => c.opcoes?.[x] ?? x).join(', ');
    case 'hora':
      return horaDita(String(v));
    case 'inteiro':
    case 'decimal':
      return `${num(Number(v))}${c.unidade ? ` ${c.unidade}` : ''}`;
  }
}

const ANTECEDENCIA = (c: {
  antecedencia_min_dias_uteis: number;
  antecedencia_max_dias: number;
}): FraseRegra[] => [
  {
    id: 'antecedencia',
    texto: `Pede-se com pelo menos ${c.antecedencia_min_dias_uteis} ${c.antecedencia_min_dias_uteis === 1 ? 'dia útil' : 'dias úteis'} de antecedência.`,
  },
  {
    id: 'data',
    texto: `A data não pode já ter passado nem ser a mais de ${c.antecedencia_max_dias} dias.`,
  },
];

/** As regras de um tipo, uma frase por regra. */
export function frasesRegras(tipo: TipoLicenca, config: unknown): FraseRegra[] {
  switch (tipo) {
    case 'ruido': {
      const c = config as ConfigRuido;
      return [
        ...ANTECEDENCIA(c),
        {
          id: 'hora_inicio',
          texto: `Não começa antes das ${horaDita(c.hora_inicio_min)}.`,
        },
        {
          id: 'hora_fim',
          texto: `Acaba até ${aHora(c.hora_fim_max_semana)} de domingo a quinta, e até ${aHora(c.hora_fim_max_fds)} à sexta, ao sábado e na véspera de feriado.`,
        },
        {
          id: 'duracao',
          texto: `Dura no máximo ${c.duracao_max_horas} horas.`,
        },
        {
          id: 'pessoas',
          texto: `Até ${c.pessoas_max} pessoas. Com mais, um técnico analisa; sem dizer quantas, um funcionário confirma.`,
        },
        {
          id: 'atividade',
          texto: 'Obras com barulho fora de horas vão sempre a um técnico.',
        },
      ];
    }
    case 'ocupacao_via': {
      const c = config as ConfigOcupacao;
      return [
        ...ANTECEDENCIA(c),
        {
          id: 'equipamento',
          texto: `Sem técnico, só: ${lista(c.equipamentos.map((e) => EQUIPAMENTOS[e].toLowerCase()))}.`,
        },
        { id: 'area', texto: `Ocupa no máximo ${num(c.area_max_m2)} m².` },
        { id: 'dias', texto: `Fica no máximo ${c.dias_max} dias.` },
        {
          id: 'passeio',
          texto: `Ficam sempre pelo menos ${num(c.passeio_livre_min_m)} m de passeio livres para peões.`,
        },
        ...(c.estrada_vai_a_tecnico
          ? [
              {
                id: 'estrada',
                texto:
                  'Se ocupar a estrada ou lugares de estacionamento, vai a um técnico.',
              },
            ]
          : []),
      ];
    }
    case 'esplanada': {
      const c = config as ConfigEsplanada;
      return [
        ...ANTECEDENCIA(c),
        { id: 'area', texto: `Ocupa no máximo ${num(c.area_max_m2)} m².` },
        { id: 'mesas', texto: `Tem no máximo ${c.mesas_max} mesas.` },
        {
          id: 'passeio',
          texto: `Ficam sempre pelo menos ${num(c.passeio_livre_min_m)} m de passeio livres para peões.`,
        },
        { id: 'meses', texto: `Pede-se por ${c.meses_max} meses no máximo.` },
        ...(c.estrado_vai_a_tecnico
          ? [
              {
                id: 'estrado',
                texto: 'Com estrado ou estrutura fixa, vai a um técnico.',
              },
            ]
          : []),
        ...(c.centro_historico_vai_a_tecnico
          ? [
              {
                id: 'centro_historico',
                texto: 'No centro histórico, vai a um técnico do património.',
              },
            ]
          : []),
      ];
    }
    case 'distico_residente': {
      const c = config as ConfigDistico;
      return [
        { id: 'matricula', texto: 'A matrícula tem de ser portuguesa.' },
        ...(c.exige_morada_comprovada
          ? [
              {
                id: 'morada',
                texto:
                  'A morada tem de estar no cartão de cidadão ou num atestado de residência da junta.',
              },
            ]
          : []),
        ...(c.exige_viatura_em_nome
          ? [
              {
                id: 'viatura',
                texto:
                  'O carro tem de estar em nome de quem pede (ou com declaração da empresa ou do leasing).',
              },
            ]
          : []),
        {
          id: 'por_fogo',
          texto: `Até ${c.disticos_max_por_fogo} ${c.disticos_max_por_fogo === 1 ? 'dístico' : 'dísticos'} por casa sem análise.`,
        },
      ];
    }
    case 'publicidade': {
      const c = config as ConfigPublicidade;
      return [
        ...ANTECEDENCIA(c),
        {
          id: 'suporte',
          texto: `Sem técnico, só: ${lista(c.suportes.map((s) => SUPORTES[s].toLowerCase()))}.`,
        },
        ...(c.alheia_vai_a_tecnico
          ? [
              {
                id: 'proprio',
                texto:
                  'Anúncios que não são do próprio estabelecimento vão a um técnico.',
              },
            ]
          : []),
        {
          id: 'area',
          texto: `No máximo ${num(c.area_max_m2)} m². No próprio estabelecimento, até ${num(c.area_isenta_m2)} m² não precisa de licença (fica uma mera comunicação, sem taxa).`,
        },
        { id: 'meses', texto: `Pede-se por ${c.meses_max} meses no máximo.` },
        ...(c.centro_historico_vai_a_tecnico
          ? [
              {
                id: 'centro_historico',
                texto: 'No centro histórico, vai a um técnico do património.',
              },
            ]
          : []),
        ...(c.iluminado_vai_a_tecnico
          ? [
              {
                id: 'iluminado',
                texto: 'Anúncios iluminados vão a um técnico.',
              },
            ]
          : []),
      ];
    }
    case 'recinto_improvisado': {
      const c = config as ConfigRecinto;
      return [
        ...ANTECEDENCIA(c),
        {
          id: 'lotacao',
          texto: `Até ${c.lotacao_max} pessoas ao mesmo tempo sem vistoria.`,
        },
        { id: 'dias', texto: `Dura no máximo ${c.dias_max} dias.` },
        {
          id: 'estruturas',
          texto: c.estruturas.length
            ? `Estruturas aceites sem vistoria: ${lista(c.estruturas.map((e) => ESTRUTURAS[e].toLowerCase()))}. Outras vão a um técnico.`
            : 'Qualquer estrutura montada (palco, tenda...) vai a um técnico.',
        },
      ];
    }
  }
}

/** As taxas em frases ("10,00 € fixos e 0,50 € por m² e por dia"). */
export function frasesTaxas(tipo: TipoLicenca, config: unknown): string[] {
  const c = config as Record<string, unknown>;
  const e = (k: string) => euros(Number(c[k] ?? 0));
  switch (tipo) {
    case 'ruido':
      return [`${e('taxa_cent')} por licença.`];
    case 'ocupacao_via':
      return [
        `${e('taxa_base_cent')} fixos, mais ${e('taxa_m2_dia_cent')} por m² e por dia.`,
      ];
    case 'esplanada':
      return [
        `${e('taxa_m2_mes_cent')} por m² e por mês, com um mínimo de ${e('taxa_minima_cent')}.`,
      ];
    case 'distico_residente': {
      const t = (c.taxa_por_ordem_cent as number[]) ?? [];
      return [
        `Por ano: ${t.map((v, i) => `${i + 1}.º dístico da casa ${euros(v)}`).join(', ')}${t.length > 1 ? ' (os seguintes pagam como o último)' : ''}.`,
        `Vale ${String(c.validade_meses)} meses.`,
      ];
    }
    case 'publicidade':
      return [
        `${e('taxa_m2_mes_cent')} por m² e por mês (${e('taxa_iluminado_m2_mes_cent')} se for iluminado), com um mínimo de ${e('taxa_minima_cent')}.`,
        'O anúncio pequeno do próprio estabelecimento não paga.',
      ];
    case 'recinto_improvisado':
      return [
        `${e('taxa_base_cent')} fixos, mais ${e('taxa_dia_cent')} por dia.`,
      ];
  }
}

/** Condições que não decidem o pedido, mas vêm na licença (ex.: hora de recolher). */
export function frasesCondicoes(tipo: TipoLicenca, config: unknown): string[] {
  if (tipo === 'ruido') {
    const c = config as ConfigRuido;
    return [
      `Música amplificada no exterior só até ${aHora(c.musica_exterior_ate)}.`,
    ];
  }
  if (tipo === 'esplanada') {
    const c = config as ConfigEsplanada;
    return [`Mesas e cadeiras recolhidas até ${aHora(c.hora_fecho)}.`];
  }
  return [];
}

/** Os números das regras, como o painel os mostra (sem os avisos internos). */
export function valoresRegras(
  tipo: TipoLicenca,
  config: unknown,
): ValorRegra[] {
  const c = config as Record<string, unknown>;
  return DEFS[tipo].campos
    .filter((campo) => !campo.chave.startsWith('aviso_'))
    .map((campo) => ({
      chave: campo.chave,
      rotulo: campo.rotulo,
      valor: valorDito(campo, c[campo.chave]),
    }));
}

/** JSON com as chaves por ordem: o jsonb da BD não guarda a ordem das chaves. */
export function estavel(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(estavel).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v)
      .sort()
      .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
      .map(
        (k) =>
          `${JSON.stringify(k)}:${estavel((v as Record<string, unknown>)[k])}`,
      )
      .join(',')}}`;
  }
  return JSON.stringify(v ?? null);
}

export interface Alteracao {
  campo: string;
  rotulo: string;
  antes: string;
  depois: string;
}

const APROVACAO_DITA: Record<string, string> = {
  automatica: 'decide sozinho dentro das regras',
  funcionario: 'um funcionário confirma',
};

/** O que mudou entre duas versões das regras de um tipo, em linguagem simples. */
export function alteracoesLicenca(
  tipo: TipoLicenca,
  antes: unknown,
  depois: unknown,
): Alteracao[] {
  const a = antes as Record<string, unknown>;
  const d = depois as Record<string, unknown>;
  const igual = (k: string) => estavel(a[k]) === estavel(d[k]);
  const out: Alteracao[] = DEFS[tipo].campos
    .filter((campo) => !igual(campo.chave))
    .map((campo) => ({
      campo: campo.chave,
      rotulo: campo.rotulo,
      antes:
        a[campo.chave] === undefined ? '—' : valorDito(campo, a[campo.chave]),
      depois:
        d[campo.chave] === undefined ? '—' : valorDito(campo, d[campo.chave]),
    }));
  if (!igual('aprovacao')) {
    out.push({
      campo: 'aprovacao',
      rotulo: 'Pedidos dentro das regras',
      antes: APROVACAO_DITA[String(a.aprovacao)] ?? String(a.aprovacao),
      depois: APROVACAO_DITA[String(d.aprovacao)] ?? String(d.aprovacao),
    });
  }
  if (!igual('demonstracao')) {
    out.push({
      campo: 'demonstracao',
      rotulo: 'Valores de demonstração',
      antes: a.demonstracao ? 'sim' : 'não',
      depois: d.demonstracao ? 'sim' : 'não',
    });
  }
  if (!igual('fonte')) {
    const t = (x: unknown) =>
      (x as { titulo?: string } | undefined)?.titulo ?? '—';
    out.push({
      campo: 'fonte',
      rotulo: 'Base legal',
      antes: t(a.fonte),
      depois: t(d.fonte),
    });
  }
  return out;
}
