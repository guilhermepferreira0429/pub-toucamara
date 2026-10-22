/*
 * Animais (V4 #9): regras puras, sem BD. O canil/gatil municipal (valores
 * de demonstração), que dias se pode visitar, como dizer um animal e a
 * informação do registo e da vacina antirrábica (o SIAC é nacional).
 */
import { diaDito, diasEntre } from '../servicos-municipais/comum.js';

export const ESPECIES = ['cao', 'gato'] as const;
export type Especie = (typeof ESPECIES)[number];
export const ESPECIES_REPORTE = ['cao', 'gato', 'outro'] as const;
export const PORTES = ['pequeno', 'medio', 'grande'] as const;
export const PERIODOS = ['manha', 'tarde'] as const;
export type Periodo = (typeof PERIODOS)[number];
export const TIPOS_REPORTE = ['perdido', 'encontrado', 'abandonado'] as const;
export const SITUACOES_VIA = ['ferido', 'agressivo'] as const;

/**
 * O canil/gatil municipal. VALORES DE DEMONSTRAÇÃO: nome, morada e horário
 * das visitas por confirmar pela câmara (sem telefone: não se inventa).
 */
export const CANIL_DEMONSTRACAO = {
  nome: 'Centro de Recolha Oficial de Animais (canil e gatil municipal)',
  morada: 'morada por confirmar pela câmara',
  /** Visitas para adoção: dias (0 = domingo) e períodos. */
  visitas: {
    1: ['manha', 'tarde'],
    2: ['manha', 'tarde'],
    3: ['manha', 'tarde'],
    4: ['manha', 'tarde'],
    5: ['manha', 'tarde'],
    6: ['manha'],
  } as Record<number, Periodo[]>,
  horario_dito:
    'visitas de segunda a sexta, de manhã (10:00 às 12:30) e de tarde (14:00 às 17:00), e ao sábado de manhã',
  demonstracao: true,
} as const;

/** Até quantos dias à frente se pode pedir uma visita. */
export const DIAS_MAX_VISITA = 60;

export const PERIODOS_DITOS: Record<Periodo, string> = {
  manha: 'de manhã',
  tarde: 'à tarde',
};

export type ValidacaoVisita =
  | { ok: true }
  | { ok: false; motivo: 'passado' | 'longe' | 'fechado'; dizer: string };

/** O dia e o período pedidos servem? (dia AAAA-MM-DD, hoje na hora local) */
export function validarVisita(
  dia: string,
  periodo: Periodo,
  hoje: string,
  feriados: ReadonlySet<string>,
): ValidacaoVisita {
  const d = diasEntre(hoje, dia);
  if (d < 1) {
    return {
      ok: false,
      motivo: 'passado',
      dizer:
        'As visitas marcam-se a partir de amanhã. Que outro dia lhe dava jeito?',
    };
  }
  if (d > DIAS_MAX_VISITA) {
    return {
      ok: false,
      motivo: 'longe',
      dizer: `Só se marcam visitas até ${DIAS_MAX_VISITA} dias à frente. Pode escolher um dia mais próximo?`,
    };
  }
  const [a, m, di] = dia.split('-').map(Number);
  const semana = new Date(Date.UTC(a, m - 1, di)).getUTCDay();
  const periodos = CANIL_DEMONSTRACAO.visitas[semana] ?? [];
  if (feriados.has(dia) || !periodos.includes(periodo)) {
    return {
      ok: false,
      motivo: 'fechado',
      dizer: `Nesse dia ${PERIODOS_DITOS[periodo]} o canil não recebe visitas (${CANIL_DEMONSTRACAO.horario_dito}). Que outro dia lhe dava jeito?`,
    };
  }
  return { ok: true };
}

export function visitaDita(dia: string, periodo: Periodo): string {
  return `${diaDito(dia)}, ${PERIODOS_DITOS[periodo]}`;
}

const ESPECIES_DITAS: Record<string, [string, string]> = {
  cao: ['cão', 'cadela'],
  gato: ['gato', 'gata'],
};
const PORTES_DITOS: Record<string, string> = {
  pequeno: 'pequeno',
  medio: 'médio',
  grande: 'grande',
};

export interface AnimalBase {
  nome: string;
  especie: string;
  sexo: string | null;
  porte: string | null;
  idade: string | null;
}

/** "Tejo, cão de porte médio, cerca de 3 anos". */
export function animalDito(a: AnimalBase): string {
  const [macho, femea] = ESPECIES_DITAS[a.especie] ?? [a.especie, a.especie];
  const especie = a.sexo === 'femea' ? femea : macho;
  const porte = a.porte ? ` de porte ${PORTES_DITOS[a.porte] ?? a.porte}` : '';
  return `${a.nome}, ${especie}${porte}${a.idade ? `, ${a.idade}` : ''}`;
}

/** O tipo de aviso que pode corresponder a este (perdido ↔ encontrado/abandonado). */
export function tiposCorrespondentes(tipo: string): string[] {
  if (tipo === 'perdido') return ['encontrado', 'abandonado'];
  if (tipo === 'encontrado' || tipo === 'abandonado') return ['perdido'];
  return [];
}

/**
 * Registo e vacina antirrábica: a câmara não regista animais (o SIAC é
 * nacional, faz-se no veterinário). Fontes legais citadas; a campanha de
 * vacinação municipal tem datas por confirmar.
 */
export const INFO_REGISTO = {
  registo:
    'Cães, gatos e furões têm de estar identificados com chip e registados no SIAC, o Sistema de Informação de Animais de Companhia, que é nacional. O registo faz-se no médico veterinário, que coloca o chip e regista o animal; as mudanças de dono ou de morada também ficam no SIAC.',
  vacina:
    'A vacina contra a raiva é obrigatória para os cães a partir dos 3 meses de idade e renova-se conforme indicar o veterinário.',
  campanha:
    'A câmara pode fazer campanhas de vacinação antirrábica com o médico veterinário municipal; as datas ainda não estão carregadas aqui.',
  fontes: [
    'Decreto-Lei n.º 82/2019, de 27 de junho (identificação e registo de animais de companhia, SIAC)',
    'Decreto-Lei n.º 314/2003, de 17 de dezembro (programa de luta contra a raiva animal)',
  ],
} as const;
