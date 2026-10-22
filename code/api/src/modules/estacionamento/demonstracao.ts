/*
 * Dados de demonstração do estacionamento em Guimarães: parques e zona
 * tarifada (nomes de sítios reais, mas lugares, horários e tarifas
 * INVENTADOS, marcados `demonstracao: true`) e multas de exemplo.
 */
import type { Horario } from '../marcacoes/vagas.js';
import type { Tarifa } from './regras.js';

export interface ParqueDemo {
  chave: string;
  nome: string;
  tipo: 'parque' | 'zona_tarifada';
  morada: string;
  zonas: string[];
  lat: number;
  lng: number;
  lugares: number | null;
  lugares_deficiencia: number | null;
  horario: Horario;
  tarifa: Tarifa;
  pagamento_telemovel: boolean;
  notas: string | null;
}

const TODOS_OS_DIAS = (f: string): Horario => ({
  seg: [f],
  ter: [f],
  qua: [f],
  qui: [f],
  sex: [f],
  sab: [f],
  dom: [f],
});

export const PARQUES_DEMO: ParqueDemo[] = [
  {
    chave: 'zona_centro',
    nome: 'Zona de estacionamento tarifado do centro',
    tipo: 'zona_tarifada',
    morada: 'Ruas do centro (Toural, Alameda, Santo António, Paio Galvão)',
    zonas: [
      'centro',
      'toural',
      'alameda',
      'santo antonio',
      'paio galvao',
      'oliveira',
      'camara',
    ],
    lat: 41.4425,
    lng: -8.2952,
    lugares: null,
    lugares_deficiencia: null,
    horario: {
      seg: ['08:00-19:00'],
      ter: ['08:00-19:00'],
      qua: ['08:00-19:00'],
      qui: ['08:00-19:00'],
      sex: ['08:00-19:00'],
      sab: ['08:00-13:00'],
    },
    tarifa: { primeira_hora_cent: 80, hora_seguinte_cent: 100 },
    pagamento_telemovel: true,
    notas:
      'Paga-se no parquímetro ou pelo telemóvel (app de estacionamento). Máximo de 2 horas seguidas no mesmo lugar. Fora do horário e aos domingos e feriados é grátis.',
  },
  {
    chave: 'parque_mumadona',
    nome: 'Parque da Mumadona',
    tipo: 'parque',
    morada: 'Largo da Mumadona',
    zonas: [
      'mumadona',
      'paco dos duques',
      'castelo',
      'camara municipal',
      'conego jose maria gomes',
    ],
    lat: 41.4464,
    lng: -8.2915,
    lugares: 320,
    lugares_deficiencia: 8,
    horario: TODOS_OS_DIAS('00:00-24:00'),
    tarifa: {
      primeira_hora_cent: 90,
      hora_seguinte_cent: 70,
      maximo_dia_cent: 800,
      minutos_gratis: 15,
    },
    pagamento_telemovel: false,
    notas: 'Coberto. Mais perto do edifício da câmara e do Paço dos Duques.',
  },
  {
    chave: 'parque_sao_francisco',
    nome: 'Parque de São Francisco',
    tipo: 'parque',
    morada: 'Largo de São Francisco',
    zonas: [
      'sao francisco',
      'toural',
      'alameda',
      'centro historico',
      'teatro jordao',
    ],
    lat: 41.4418,
    lng: -8.2925,
    lugares: 260,
    lugares_deficiencia: 6,
    horario: TODOS_OS_DIAS('07:00-24:00'),
    tarifa: {
      primeira_hora_cent: 100,
      hora_seguinte_cent: 80,
      maximo_dia_cent: 900,
    },
    pagamento_telemovel: true,
    notas: 'Subterrâneo, a dois minutos do Toural.',
  },
  {
    chave: 'parque_caldeiroa',
    nome: 'Parque da Caldeiroa',
    tipo: 'parque',
    morada: 'Rua da Caldeiroa',
    zonas: ['caldeiroa', 'mercado', 'senhora da guia', 'avenida d joao iv'],
    lat: 41.4398,
    lng: -8.2968,
    lugares: 180,
    lugares_deficiencia: 4,
    horario: {
      seg: ['07:30-21:00'],
      ter: ['07:30-21:00'],
      qua: ['07:30-21:00'],
      qui: ['07:30-21:00'],
      sex: ['07:30-21:00'],
      sab: ['08:00-14:00'],
    },
    tarifa: {
      primeira_hora_cent: 60,
      hora_seguinte_cent: 50,
      maximo_dia_cent: 500,
    },
    pagamento_telemovel: false,
    notas: 'Ao ar livre. O mais barato do centro.',
  },
  {
    chave: 'parque_plataforma',
    nome: 'Parque da Plataforma das Artes',
    tipo: 'parque',
    morada: 'Avenida Conde Margaride',
    zonas: [
      'plataforma das artes',
      'conde margaride',
      'mercado',
      'toural',
      'vila flor',
    ],
    lat: 41.4407,
    lng: -8.2988,
    lugares: 400,
    lugares_deficiencia: 10,
    horario: TODOS_OS_DIAS('00:00-24:00'),
    tarifa: {
      primeira_hora_cent: 80,
      hora_seguinte_cent: 60,
      maximo_dia_cent: 700,
      minutos_gratis: 15,
    },
    pagamento_telemovel: true,
    notas:
      'Subterrâneo. Bom para o Centro Cultural Vila Flor e a Plataforma das Artes.',
  },
];

export interface MultaDemo {
  chave: string;
  numero_auto: string;
  matricula: string;
  infracao: string;
  norma: string;
  local: string;
  /** Há quantos dias foi verificada. */
  dias_atras: number;
  hora: string;
  valor_cent: number;
  valor_maximo_cent: number;
  estado: 'por_pagar' | 'paga';
}

export const MULTAS_DEMO: MultaDemo[] = [
  {
    chave: 'zona_sem_titulo',
    numero_auto: 'EST-DEMO-0001',
    matricula: 'AA-12-BC',
    infracao:
      'Estacionamento em zona tarifada sem título de estacionamento válido',
    norma:
      'Código da Estrada, art. 71.º, n.º 1, al. d) (valores de demonstração)',
    local: 'Rua de Santo António',
    dias_atras: 3,
    hora: '10:40',
    valor_cent: 3000,
    valor_maximo_cent: 15000,
    estado: 'por_pagar',
  },
  {
    chave: 'tempo_excedido',
    numero_auto: 'EST-DEMO-0002',
    matricula: 'AA-12-BC',
    infracao: 'Tempo de estacionamento pago excedido',
    norma: 'Regulamento municipal de estacionamento (valores de demonstração)',
    local: 'Alameda de São Dâmaso',
    dias_atras: 9,
    hora: '16:15',
    valor_cent: 3000,
    valor_maximo_cent: 15000,
    estado: 'por_pagar',
  },
  {
    chave: 'lugar_deficiencia',
    numero_auto: 'EST-DEMO-0003',
    matricula: '45-ZX-90',
    infracao: 'Estacionamento em lugar reservado a pessoas com deficiência',
    norma: 'Código da Estrada, art. 50.º e 145.º (valores de demonstração)',
    local: 'Largo do Toural',
    dias_atras: 5,
    hora: '12:05',
    valor_cent: 6000,
    valor_maximo_cent: 30000,
    estado: 'por_pagar',
  },
  {
    chave: 'paga',
    numero_auto: 'EST-DEMO-0004',
    matricula: '10-AB-20',
    infracao:
      'Estacionamento em zona tarifada sem título de estacionamento válido',
    norma:
      'Código da Estrada, art. 71.º, n.º 1, al. d) (valores de demonstração)',
    local: 'Rua Paio Galvão',
    dias_atras: 20,
    hora: '09:30',
    valor_cent: 3000,
    valor_maximo_cent: 15000,
    estado: 'paga',
  },
];
