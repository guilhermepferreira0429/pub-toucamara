/*
 * Escolas, atividades e alunos de DEMONSTRAÇÃO (nomes e números fictícios,
 * a substituir pelos da câmara e dos agrupamentos).
 */
import type { Ano, Escalao } from './regras.js';

export const ESCOLAS_DEMO: {
  nome: string;
  agrupamento: string;
  nivel: 'pre_escolar' | '1_ciclo' | 'ambos';
  freguesia: string;
  morada: string;
  tem_cantina: boolean;
}[] = [
  {
    nome: 'EB de Azurém',
    agrupamento: 'Agrupamento de Escolas de Azurém (demonstração)',
    nivel: 'ambos',
    freguesia: 'Azurém',
    morada: 'Rua da Escola, Azurém',
    tem_cantina: true,
  },
  {
    nome: 'EB de Pevidém',
    agrupamento: 'Agrupamento de Escolas de Pevidém (demonstração)',
    nivel: '1_ciclo',
    freguesia: 'Selho S. Jorge',
    morada: 'Largo da Escola, Pevidém',
    tem_cantina: true,
  },
  {
    nome: 'EB das Taipas',
    agrupamento: 'Agrupamento de Escolas das Taipas (demonstração)',
    nivel: 'ambos',
    freguesia: 'Caldelas',
    morada: 'Avenida da Escola, Caldas das Taipas',
    tem_cantina: true,
  },
  {
    nome: 'Jardim de Infância de Creixomil',
    agrupamento: 'Agrupamento de Escolas de Creixomil (demonstração)',
    nivel: 'pre_escolar',
    freguesia: 'Creixomil',
    morada: 'Rua do Jardim, Creixomil',
    tem_cantina: true,
  },
];

export const ATIVIDADES_DEMO: {
  codigo: string;
  tipo: 'aec' | 'ferias';
  nome: string;
  descricao: string;
  escola: string | null;
  anos: string[];
  horario: string | null;
  /** Dias a partir de hoje (férias desportivas). */
  inicio_dias?: number;
  fim_dias?: number;
  vagas: number;
  preco_cent: number;
}[] = [
  {
    codigo: 'AEC-DESPORTO',
    tipo: 'aec',
    nome: 'Atividade física e desportiva',
    descricao: 'Jogos e iniciação ao desporto, depois das aulas.',
    escola: null,
    anos: ['1', '2', '3', '4'],
    horario: 'segundas e quartas, 16h30–17h30',
    vagas: 120,
    preco_cent: 0,
  },
  {
    codigo: 'AEC-MUSICA',
    tipo: 'aec',
    nome: 'Música',
    descricao: 'Expressão musical e iniciação a instrumentos.',
    escola: 'EB de Azurém',
    anos: ['1', '2', '3', '4'],
    horario: 'terças, 16h30–17h30',
    vagas: 20,
    preco_cent: 0,
  },
  {
    codigo: 'AEC-ROBOTICA',
    tipo: 'aec',
    nome: 'Robótica e programação',
    descricao: 'Construir e programar pequenos robôs.',
    escola: 'EB de Pevidém',
    anos: ['3', '4'],
    horario: 'quintas, 16h30–17h30',
    vagas: 2,
    preco_cent: 0,
  },
  {
    codigo: 'FERIAS-NATAL',
    tipo: 'ferias',
    nome: 'Férias desportivas de Natal',
    descricao: 'Natação, jogos e passeios no pavilhão e na piscina municipal.',
    escola: null,
    anos: ['1', '2', '3', '4'],
    horario: '9h–17h, com almoço',
    inicio_dias: 60,
    fim_dias: 70,
    vagas: 80,
    preco_cent: 3500,
  },
  {
    codigo: 'FERIAS-PASCOA',
    tipo: 'ferias',
    nome: 'Férias desportivas da Páscoa',
    descricao: 'Multidesportos e atividades ao ar livre.',
    escola: null,
    anos: ['1', '2', '3', '4'],
    horario: '9h–17h, com almoço',
    inicio_dias: 160,
    fim_dias: 170,
    vagas: 80,
    preco_cent: 3500,
  },
];

export interface AlunoDemo {
  /** Índice do encarregado na lista passada ao carregamento. */
  encarregado: number;
  nome: string;
  data_nascimento: string;
  escola: string | null;
  ano: Ano;
  escalao: Escalao;
  alergias?: string;
  saldo_cent?: number;
  cantina?: boolean;
  desmarcar_amanha?: boolean;
  atividades?: string[];
  pre_escolar?: string[];
  transporte?: { morada: string; distancia_km: number };
}

export const ALUNOS_DEMO: AlunoDemo[] = [
  {
    encarregado: 0,
    nome: 'Tomás Martins',
    data_nascimento: '2018-03-14',
    escola: 'EB de Azurém',
    ano: '3',
    escalao: 'B',
    alergias: 'Frutos secos',
    saldo_cent: 1460,
    cantina: true,
    atividades: ['AEC-MUSICA'],
  },
  {
    encarregado: 0,
    nome: 'Inês Martins',
    data_nascimento: '2022-05-02',
    escola: null,
    ano: 'pre',
    escalao: 'sem',
    pre_escolar: ['Jardim de Infância de Creixomil', 'EB de Azurém'],
  },
  {
    encarregado: 1,
    nome: 'Rafael Fulano',
    data_nascimento: '2019-09-21',
    escola: 'EB das Taipas',
    ano: '1',
    escalao: 'A',
    cantina: true,
    transporte: { morada: 'Rua do Monte, 120, Caldelas', distancia_km: 4.2 },
  },
  {
    encarregado: 2,
    nome: 'Beatriz Sicrano',
    data_nascimento: '2017-01-30',
    escola: 'EB de Pevidém',
    ano: '4',
    escalao: 'sem',
    cantina: true,
    desmarcar_amanha: true,
    atividades: ['AEC-ROBOTICA'],
    transporte: { morada: 'Travessa da Fonte, 8, Pevidém', distancia_km: 1.8 },
  },
  {
    encarregado: 3,
    nome: 'Gonçalo Beltrano',
    data_nascimento: '2018-11-05',
    escola: 'EB de Azurém',
    ano: '2',
    escalao: 'A',
    alergias: 'Intolerância à lactose',
    cantina: true,
  },
  {
    encarregado: 4,
    nome: 'Leonor Fulano',
    data_nascimento: '2021-06-18',
    escola: 'Jardim de Infância de Creixomil',
    ano: 'pre',
    escalao: 'B',
    cantina: true,
  },
];
