/*
 * Fogos, inquilinos, candidaturas e reparações de DEMONSTRAÇÃO (moradas,
 * rendas e rendimentos fictícios, a substituir pelos da câmara).
 */
import type { CategoriaReparacao, DadosCandidatura, Regime } from './regras.js';

export const FOGOS_DEMO: {
  codigo: string;
  morada: string;
  freguesia: string;
  tipologia: string;
  area_m2: number;
  estado: 'ocupado' | 'livre' | 'em_obras';
}[] = [
  {
    codigo: 'AZ-A-1E',
    morada: 'Bairro Municipal de Azurém, Bloco A, 1.º Esq.',
    freguesia: 'Azurém',
    tipologia: 'T2',
    area_m2: 68,
    estado: 'ocupado',
  },
  {
    codigo: 'AZ-A-2D',
    morada: 'Bairro Municipal de Azurém, Bloco A, 2.º Dto.',
    freguesia: 'Azurém',
    tipologia: 'T3',
    area_m2: 82,
    estado: 'ocupado',
  },
  {
    codigo: 'AZ-B-RC',
    morada: 'Bairro Municipal de Azurém, Bloco B, R/C',
    freguesia: 'Azurém',
    tipologia: 'T1',
    area_m2: 48,
    estado: 'livre',
  },
  {
    codigo: 'CX-3-1D',
    morada: 'Rua das Hortas, 3, 1.º Dto., Creixomil',
    freguesia: 'Creixomil',
    tipologia: 'T2',
    area_m2: 71,
    estado: 'ocupado',
  },
  {
    codigo: 'CX-3-2E',
    morada: 'Rua das Hortas, 3, 2.º Esq., Creixomil',
    freguesia: 'Creixomil',
    tipologia: 'T2',
    area_m2: 71,
    estado: 'em_obras',
  },
  {
    codigo: 'UR-12',
    morada: 'Rua Nova de Urgezes, 12 (renda acessível)',
    freguesia: 'Urgezes',
    tipologia: 'T1',
    area_m2: 55,
    estado: 'livre',
  },
];

export const CONTRATOS_DEMO: {
  fogo: string;
  /** Índice da pessoa na lista passada ao carregamento. */
  inquilino: number;
  regime: Regime;
  inicio_anos: number;
  renda_cent: number;
  rendimento_mensal_cent: number;
  agregado: number;
  em_divida_cent: number;
}[] = [
  {
    fogo: 'AZ-A-1E',
    inquilino: 0,
    regime: 'apoiado',
    inicio_anos: 6,
    renda_cent: 8650,
    rendimento_mensal_cent: 82000,
    agregado: 2,
    em_divida_cent: 0,
  },
  {
    fogo: 'AZ-A-2D',
    inquilino: 1,
    regime: 'apoiado',
    inicio_anos: 3,
    renda_cent: 12400,
    rendimento_mensal_cent: 110000,
    agregado: 4,
    em_divida_cent: 24800,
  },
  {
    fogo: 'CX-3-1D',
    inquilino: 2,
    regime: 'apoiado',
    inicio_anos: 11,
    renda_cent: 523,
    rendimento_mensal_cent: 0,
    agregado: 1,
    em_divida_cent: 0,
  },
];

export const REPARACOES_DEMO: {
  contrato: number;
  categoria: CategoriaReparacao;
  descricao: string;
  estado: 'registada' | 'atribuida' | 'em_curso' | 'concluida';
  atribuida_a?: string;
  dias: number;
}[] = [
  {
    contrato: 1,
    categoria: 'agua',
    descricao:
      'Fuga de água por baixo do lava-loiça, já molhou o chão da cozinha.',
    estado: 'registada',
    dias: 0,
  },
  {
    contrato: 0,
    categoria: 'humidade',
    descricao: 'Bolor no teto do quarto das crianças.',
    estado: 'atribuida',
    atribuida_a: 'Equipa de manutenção — pintura',
    dias: 6,
  },
  {
    contrato: 2,
    categoria: 'portas_janelas',
    descricao: 'A janela da sala não fecha bem e entra frio.',
    estado: 'concluida',
    atribuida_a: 'Equipa de manutenção — carpintaria',
    dias: 20,
  },
];

export const CANDIDATURAS_DEMO: (DadosCandidatura & {
  pessoa: number;
  estado: 'submetida' | 'em_analise' | 'admitida' | 'excluida';
})[] = [
  {
    pessoa: 3,
    regime: 'apoiado',
    agregado: 3,
    rendimento_anual_cent: 980_000,
    situacao: 'sem_condicoes',
    menores: 2,
    anos_residencia: 6,
    estado: 'em_analise',
  },
  {
    pessoa: 4,
    regime: 'apoiado',
    agregado: 1,
    rendimento_anual_cent: 620_000,
    situacao: 'despejo',
    idosos_ou_deficiencia: 1,
    anos_residencia: 30,
    estado: 'submetida',
  },
  {
    pessoa: 5,
    regime: 'acessivel',
    agregado: 2,
    rendimento_anual_cent: 2_400_000,
    situacao: 'renda_excessiva',
    anos_residencia: 2,
    estado: 'submetida',
  },
];
