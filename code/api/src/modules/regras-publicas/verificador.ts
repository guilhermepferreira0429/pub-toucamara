/*
 * O verificador público: que dados de um pedido hipotético pede, por tipo
 * de licença, e como os completa antes de os passar ao MESMO motor que
 * decide os pedidos reais (`LicencasService.avaliarPedido`). Sem BD.
 *
 * Só se pedem os dados que as regras usam; os textos livres que a licença
 * leva (morada, descrição...) vêm preenchidos com "de teste", porque não
 * mudam a decisão.
 */
import { ATIVIDADES } from '../licencas/regras.js';
import { EQUIPAMENTOS } from '../licencas/regras-ocupacao.js';
import { SUPORTES } from '../licencas/regras-publicidade.js';
import { ESTRUTURAS } from '../licencas/regras-recinto.js';
import type { TipoLicenca } from '../licencas/tipos.js';

export interface CampoVerificador {
  chave: string;
  rotulo: string;
  tipo:
    | 'data'
    | 'hora'
    | 'inteiro'
    | 'decimal'
    | 'booleano'
    | 'opcao'
    | 'opcoes'
    | 'texto';
  /** Sem ele o motor corre na mesma, mas pode não decidir sozinho. */
  opcional?: boolean;
  unidade?: string;
  ajuda?: string;
  opcoes?: Record<string, string>;
  min?: number;
}

const data = (chave: string, rotulo: string): CampoVerificador => ({
  chave,
  rotulo,
  tipo: 'data',
});

export const CAMPOS_VERIFICADOR: Record<TipoLicenca, CampoVerificador[]> = {
  ruido: [
    {
      chave: 'atividade',
      rotulo: 'O que é',
      tipo: 'opcao',
      opcoes: ATIVIDADES,
    },
    data('data', 'Dia'),
    { chave: 'hora_inicio', rotulo: 'Começa às', tipo: 'hora' },
    {
      chave: 'hora_fim',
      rotulo: 'Acaba às',
      tipo: 'hora',
      ajuda: 'Pode passar da meia-noite (ex.: 01:00).',
    },
    {
      chave: 'pessoas',
      rotulo: 'Quantas pessoas',
      tipo: 'inteiro',
      opcional: true,
      min: 1,
    },
    {
      chave: 'musica_amplificada',
      rotulo: 'Há música alta ou colunas?',
      tipo: 'booleano',
      opcional: true,
    },
  ],
  ocupacao_via: [
    {
      chave: 'equipamento',
      rotulo: 'O que fica na rua',
      tipo: 'opcao',
      opcoes: EQUIPAMENTOS,
    },
    data('data_inicio', 'Primeiro dia'),
    { chave: 'dias', rotulo: 'Quantos dias', tipo: 'inteiro', min: 1 },
    {
      chave: 'area_m2',
      rotulo: 'Área ocupada',
      tipo: 'decimal',
      unidade: 'm²',
    },
    {
      chave: 'passeio_livre_m',
      rotulo: 'Passeio que fica livre',
      tipo: 'decimal',
      unidade: 'm',
      min: 0,
    },
    {
      chave: 'ocupa_estrada',
      rotulo: 'Ocupa a estrada ou lugares de estacionamento?',
      tipo: 'booleano',
      opcional: true,
    },
  ],
  esplanada: [
    data('data_inicio', 'A partir de'),
    { chave: 'meses', rotulo: 'Quantos meses', tipo: 'inteiro', min: 1 },
    { chave: 'area_m2', rotulo: 'Área', tipo: 'decimal', unidade: 'm²' },
    { chave: 'mesas', rotulo: 'Quantas mesas', tipo: 'inteiro', min: 1 },
    {
      chave: 'passeio_livre_m',
      rotulo: 'Passeio que fica livre',
      tipo: 'decimal',
      unidade: 'm',
      min: 0,
    },
    {
      chave: 'estrado',
      rotulo: 'Leva estrado ou estrutura fixa?',
      tipo: 'booleano',
      opcional: true,
    },
    {
      chave: 'centro_historico',
      rotulo: 'Fica no centro histórico?',
      tipo: 'booleano',
      opcional: true,
    },
  ],
  distico_residente: [
    {
      chave: 'matricula',
      rotulo: 'Matrícula',
      tipo: 'texto',
      ajuda: 'Por exemplo AA-12-BB.',
    },
    {
      chave: 'disticos_ja_tem',
      rotulo: 'Dísticos que a casa já tem',
      tipo: 'inteiro',
      min: 0,
    },
    {
      chave: 'morada_comprovada',
      rotulo: 'A morada está no cartão de cidadão (ou tem atestado)?',
      tipo: 'booleano',
    },
    {
      chave: 'viatura_em_nome',
      rotulo: 'O carro está em seu nome (ou tem declaração)?',
      tipo: 'booleano',
    },
  ],
  publicidade: [
    {
      chave: 'suporte',
      rotulo: 'Tipo de anúncio',
      tipo: 'opcao',
      opcoes: SUPORTES,
    },
    { chave: 'largura_m', rotulo: 'Largura', tipo: 'decimal', unidade: 'm' },
    { chave: 'altura_m', rotulo: 'Altura', tipo: 'decimal', unidade: 'm' },
    { chave: 'iluminado', rotulo: 'É iluminado?', tipo: 'booleano' },
    {
      chave: 'no_proprio_estabelecimento',
      rotulo: 'Fica no próprio estabelecimento e anuncia-o?',
      tipo: 'booleano',
    },
    {
      chave: 'centro_historico',
      rotulo: 'Fica no centro histórico?',
      tipo: 'booleano',
      opcional: true,
    },
    data('data_inicio', 'A partir de'),
    { chave: 'meses', rotulo: 'Quantos meses', tipo: 'inteiro', min: 1 },
  ],
  recinto_improvisado: [
    data('data_inicio', 'Primeiro dia'),
    { chave: 'dias', rotulo: 'Quantos dias', tipo: 'inteiro', min: 1 },
    {
      chave: 'lotacao',
      rotulo: 'Pessoas ao mesmo tempo (no máximo)',
      tipo: 'inteiro',
      min: 1,
    },
    {
      chave: 'estruturas',
      rotulo: 'O que vai montar',
      tipo: 'opcoes',
      opcoes: ESTRUTURAS,
    },
    { chave: 'musica', rotulo: 'Há música ou som?', tipo: 'booleano' },
  ],
};

/** Os textos que a licença leva mas que não decidem nada. */
const DE_TESTE: Record<string, string> = {
  morada: 'Morada de teste (verificador)',
  descricao: 'Pedido de teste no verificador',
  estabelecimento: 'Estabelecimento de teste',
  mensagem: 'Anúncio de teste',
};

/**
 * Só os campos do verificador (o resto é ignorado: nada de nomes nem
 * telefones), com os textos de teste. A validação é a da ferramenta.
 */
export function completarPedido(
  tipo: TipoLicenca,
  entrada: unknown,
): Record<string, unknown> {
  const e = (entrada && typeof entrada === 'object' ? entrada : {}) as Record<
    string,
    unknown
  >;
  const dados: Record<string, unknown> = { ...DE_TESTE };
  for (const c of CAMPOS_VERIFICADOR[tipo]) {
    const v = e[c.chave];
    if (v === undefined || v === null || v === '') continue;
    dados[c.chave] = v;
  }
  return dados;
}
