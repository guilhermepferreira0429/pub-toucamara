/*
 * Cemitérios de demonstração (Preparar demo): nomes de pessoas claramente
 * fictícios ("Exemplo", "Fictício", "Demonstração"), cemitérios e horários
 * por confirmar pela câmara. As datas são relativas a hoje.
 */

export interface CemiterioDemo {
  chave: string;
  nome: string;
  freguesia: string;
  morada: string;
  horario: Record<string, string>;
  nota_horario: string;
}

export interface SepulturaDemo {
  cemiterio: string;
  tipo: 'sepultura' | 'jazigo' | 'gavetao' | 'ossario';
  talhao: string;
  numero: string;
  concessao: 'temporaria' | 'perpetua';
  titular: string;
  /** Anos desde o início (para trás). */
  inicio_ha_anos: number;
  /** Dias até ao fim (negativo = já terminou); null = perpétua. */
  fim_em_dias: number | null;
  divida_cent: number;
  divida_desde: number | null;
  inumados: { nome: string; ano: number; mes: number; dia: number }[];
}

export const CEMITERIOS_DEMO: readonly CemiterioDemo[] = [
  {
    chave: 'central',
    nome: 'Cemitério Municipal Central (demonstração)',
    freguesia: 'Oliveira, São Paio e São Sebastião',
    morada: 'Rua do Cemitério, s/n (morada de demonstração)',
    horario: { 'seg-dom': '08:00-18:00' },
    nota_horario: 'Entre abril e setembro fecha às 19:00.',
  },
  {
    chave: 'azurem',
    nome: 'Cemitério de Azurém (demonstração)',
    freguesia: 'Azurém',
    morada: 'Largo da Igreja, Azurém (morada de demonstração)',
    horario: { 'seg-sab': '08:30-17:30', dom: '09:00-13:00' },
    nota_horario: 'No dia de Todos os Santos está aberto das 8:00 às 20:00.',
  },
];

export const SEPULTURAS_DEMO: readonly SepulturaDemo[] = [
  {
    cemiterio: 'central',
    tipo: 'sepultura',
    talhao: '3',
    numero: '120',
    concessao: 'temporaria',
    titular: 'Maria Exemplo Fernandes',
    inicio_ha_anos: 5,
    fim_em_dias: 90,
    divida_cent: 4500,
    divida_desde: new Date().getFullYear() - 3,
    inumados: [
      { nome: 'Joaquim Exemplo Fernandes', ano: 2019, mes: 3, dia: 14 },
    ],
  },
  {
    cemiterio: 'central',
    tipo: 'sepultura',
    talhao: '3',
    numero: '121',
    concessao: 'perpetua',
    titular: 'Teresa Fictícia Ribeiro',
    inicio_ha_anos: 16,
    fim_em_dias: null,
    divida_cent: 0,
    divida_desde: null,
    inumados: [
      { nome: 'Joaquim Fictício Ribeiro', ano: 2010, mes: 11, dia: 2 },
    ],
  },
  {
    cemiterio: 'central',
    tipo: 'jazigo',
    talhao: '1',
    numero: '12',
    concessao: 'perpetua',
    titular: 'Alberto Demonstração Sousa',
    inicio_ha_anos: 30,
    fim_em_dias: null,
    divida_cent: 1500,
    divida_desde: new Date().getFullYear() - 1,
    inumados: [
      { nome: 'Ana Fictícia Sousa', ano: 2008, mes: 6, dia: 21 },
      { nome: 'Albano Fictício Sousa', ano: 2015, mes: 1, dia: 9 },
    ],
  },
  {
    cemiterio: 'azurem',
    tipo: 'sepultura',
    talhao: 'B',
    numero: '45',
    concessao: 'temporaria',
    titular: 'Rosa Exemplo Martins',
    inicio_ha_anos: 2,
    fim_em_dias: 3 * 365,
    divida_cent: 0,
    divida_desde: null,
    inumados: [{ nome: 'Manuel Exemplo Martins', ano: 2021, mes: 9, dia: 30 }],
  },
  {
    cemiterio: 'azurem',
    tipo: 'gavetao',
    talhao: 'A',
    numero: '7',
    concessao: 'temporaria',
    titular: 'Carlos Fictício Lopes',
    inicio_ha_anos: 10,
    fim_em_dias: -60,
    divida_cent: 3000,
    divida_desde: new Date().getFullYear() - 2,
    inumados: [{ nome: 'Isabel Fictícia Lopes', ano: 2016, mes: 4, dia: 5 }],
  },
];
