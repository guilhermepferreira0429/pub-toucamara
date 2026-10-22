/*
 * Equipamentos e sessões de demonstração. Nomes genéricos e horários,
 * preços e lotações INVENTADOS (`demonstracao: true`): a câmara substitui
 * pelos seus no painel.
 */
import type { Horario } from '../marcacoes/vagas.js';
import type { TipoEquipamento } from './regras.js';

export interface EquipamentoDemo {
  chave: string;
  nome: string;
  tipo: TipoEquipamento;
  morada: string;
  descricao: string;
  lotacao: number | null;
  horario: Horario;
  duracao_slot_min: number;
  duracao_max_horas: number;
  antecedencia_horas: number;
  preco_hora_cent: number;
  entrada_cent: number | null;
  notas: string | null;
  aprovacao: 'automatica' | 'funcionario';
}

const SEMANA = (f: string[]): Horario => ({
  seg: f,
  ter: f,
  qua: f,
  qui: f,
  sex: f,
});

export const EQUIPAMENTOS_DEMO: EquipamentoDemo[] = [
  {
    chave: 'pavilhao',
    nome: 'Pavilhão Municipal',
    tipo: 'pavilhao',
    morada: 'Avenida dos Desportos, Guimarães',
    descricao:
      'Recinto para futsal, andebol, basquetebol e voleibol, com balneários.',
    lotacao: 300,
    horario: {
      ...SEMANA(['18:00-23:00']),
      sab: ['09:00-20:00'],
      dom: ['09:00-13:00'],
    },
    duracao_slot_min: 60,
    duracao_max_horas: 3,
    antecedencia_horas: 24,
    preco_hora_cent: 2500,
    entrada_cent: null,
    notas: 'Durante o dia está reservado às escolas e aos clubes.',
    aprovacao: 'automatica',
  },
  {
    chave: 'campo_sintetico',
    nome: 'Campo de futebol sintético municipal',
    tipo: 'campo',
    morada: 'Rua do Estádio, Guimarães',
    descricao: 'Campo de futebol de 7, relvado sintético, com iluminação.',
    lotacao: null,
    horario: {
      ...SEMANA(['09:00-23:00']),
      sab: ['09:00-23:00'],
      dom: ['09:00-20:00'],
    },
    duracao_slot_min: 60,
    duracao_max_horas: 2,
    antecedencia_horas: 24,
    preco_hora_cent: 3000,
    entrada_cent: null,
    notas: null,
    aprovacao: 'automatica',
  },
  {
    chave: 'piscina',
    nome: 'Piscina Municipal',
    tipo: 'piscina',
    morada: 'Rua das Piscinas, Guimarães',
    descricao:
      'Piscina coberta de 25 metros; reserva-se uma pista para clubes e grupos.',
    lotacao: 120,
    horario: {
      ...SEMANA(['07:00-09:00', '19:00-22:00']),
      sab: ['14:00-19:00'],
    },
    duracao_slot_min: 60,
    duracao_max_horas: 2,
    antecedencia_horas: 48,
    preco_hora_cent: 1500,
    entrada_cent: 250,
    notas:
      'Entrada livre para nadar: 2,50 € (crianças até aos 12 anos e maiores de 65: 1,50 €). Aulas de natação para bebés ao sábado às 10h, com inscrição na receção.',
    aprovacao: 'funcionario',
  },
  {
    chave: 'auditorio',
    nome: 'Auditório Municipal',
    tipo: 'auditorio',
    morada: 'Largo da Cultura, Guimarães',
    descricao: 'Auditório com 200 lugares, palco, som e projetor.',
    lotacao: 200,
    horario: { ...SEMANA(['09:00-23:00']), sab: ['09:00-23:00'] },
    duracao_slot_min: 60,
    duracao_max_horas: 6,
    antecedencia_horas: 72,
    preco_hora_cent: 4000,
    entrada_cent: null,
    notas:
      'Associações do concelho podem pedir isenção da taxa ao serviço de cultura.',
    aprovacao: 'funcionario',
  },
  {
    chave: 'sala_biblioteca',
    nome: 'Sala de reuniões da Biblioteca Municipal',
    tipo: 'sala',
    morada: 'Largo da Biblioteca, Guimarães',
    descricao:
      'Sala para 20 pessoas, com mesa e ecrã. Gratuita para associações e munícipes.',
    lotacao: 20,
    horario: { ...SEMANA(['09:00-19:00']), sab: ['10:00-13:00'] },
    duracao_slot_min: 60,
    duracao_max_horas: 3,
    antecedencia_horas: 24,
    preco_hora_cent: 0,
    entrada_cent: null,
    notas: null,
    aprovacao: 'automatica',
  },
];

export interface SessaoDemo {
  chave: string;
  titulo: string;
  local: string;
  /** Dias a partir de hoje. */
  dias: number;
  inicio: string;
  fim: string;
  lotacao: number;
  preco_cent: number;
  max_por_pessoa: number;
  /** Liga ao evento de demonstração do feed com este título, se existir. */
  evento_titulo?: string;
}

export const SESSOES_DEMO: SessaoDemo[] = [
  {
    chave: 'visita_guiada',
    titulo: 'Visita guiada ao centro histórico',
    local: 'Largo da Oliveira',
    dias: 4,
    inicio: '10:30',
    fim: '12:00',
    lotacao: 25,
    preco_cent: 0,
    max_por_pessoa: 4,
    evento_titulo: 'Visita guiada ao centro histórico',
  },
  {
    chave: 'concerto_auditorio',
    titulo: 'Concerto da Orquestra Juvenil no Auditório Municipal',
    local: 'Auditório Municipal',
    dias: 9,
    inicio: '21:30',
    fim: '23:00',
    lotacao: 200,
    preco_cent: 500,
    max_por_pessoa: 6,
  },
  {
    chave: 'teatro_infantil',
    titulo: 'Teatro infantil "O Castelo Encantado"',
    local: 'Auditório Municipal',
    dias: 12,
    inicio: '16:00',
    fim: '17:00',
    lotacao: 80,
    preco_cent: 300,
    max_por_pessoa: 6,
  },
];
