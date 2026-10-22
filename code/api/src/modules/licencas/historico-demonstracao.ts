/*
 * Pedidos antigos de DEMONSTRAÇÃO, para a simulação ("testar uma lei antes
 * de a aprovar") ter histórico. Numa câmara a sério vinham do sistema
 * antigo (os pedidos dos últimos anos); aqui são inventados, sempre os
 * mesmos (gerador com semente) e marcados como demonstração.
 */
import { somarDias } from './comum.js';
import type { TipoLicenca } from './tipos.js';
import { DEFS } from './tipos.js';

export interface PedidoHistorico {
  referencia: string;
  pedido_em: string;
  dados: Record<string, unknown>;
}

/** Gerador pseudo-aleatório com semente (mulberry32). */
function gerador(semente: number) {
  let s = semente >>> 0;
  const r = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const entre = (a: number, b: number) => a + Math.floor(r() * (b - a + 1));
  const um = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];
  const pesado = <T>(xs: readonly [T, number][]): T => {
    const total = xs.reduce((s2, [, p]) => s2 + p, 0);
    let x = r() * total;
    for (const [v, p] of xs) {
      if ((x -= p) < 0) return v;
    }
    return xs[xs.length - 1][0];
  };
  return { r, entre, um, pesado, sim: (p: number) => r() < p };
}

const RUAS = [
  'Rua de Santo António',
  'Rua Dr. Avelino Germano',
  'Avenida D. Afonso Henriques',
  'Rua da Rainha',
  'Rua de Camões',
  'Largo do Toural',
  'Rua Gil Vicente',
  'Rua Francisco Agra',
  'Rua de Vila Flor',
  'Avenida Conde Margaride',
  'Rua Padre António Caldas',
  'Rua da Liberdade',
];
const FREGUESIAS = [
  'Oliveira, São Paio e São Sebastião',
  'Azurém',
  'Creixomil',
  'Urgezes',
  'Caldelas',
  'Ponte',
  'Silvares',
  'Fermentões',
];
const CAFES = [
  'Café Central',
  'Pastelaria Douro',
  'Snack-Bar O Largo',
  'Restaurante A Tasquinha',
  'Café Avenida',
  'Bar do Toural',
  'Gelataria Vila Flor',
  'Tasca do Zé',
];
const LOJAS = [
  'Sapataria Moderna',
  'Farmácia do Toural',
  'Óptica Vimaranense',
  'Barbearia Afonso',
  'Florista Vila Flor',
  'Mercearia da Rainha',
  'Cabeleireiro Linda',
  'Livraria Gil Vicente',
];
const EVENTOS = [
  'Arraial de São João da associação',
  'Festa da freguesia',
  'Concerto ao ar livre no largo',
  'Festival de folclore',
  'Feira medieval',
  'Noite de fados no adro',
];
const LETRAS = 'ABCDEFGHIJLMNOPRSTUVXZ';

const SEMENTE: Record<TipoLicenca, number> = {
  ruido: 11,
  ocupacao_via: 23,
  esplanada: 37,
  distico_residente: 41,
  publicidade: 53,
  recinto_improvisado: 67,
};

/** n pedidos espalhados pelos últimos `anos` anos antes de `hoje`. */
export function gerarHistoricoDemonstracao(
  tipo: TipoLicenca,
  hoje: string,
  n = 120,
  anos = 3,
): PedidoHistorico[] {
  const g = gerador(SEMENTE[tipo]);
  const contadores = new Map<string, number>();
  const morada = () =>
    `${g.um(RUAS)} ${g.entre(1, 240)}, ${g.um(FREGUESIAS)}, Guimarães`;
  const lista: PedidoHistorico[] = [];
  for (let i = 0; i < n; i++) {
    const pedidoEm = somarDias(hoje, -g.entre(10, 365 * anos));
    const ano = pedidoEm.slice(0, 4);
    const seq = (contadores.get(ano) ?? 0) + 1;
    contadores.set(ano, seq);
    lista.push({
      referencia: `${DEFS[tipo].codigo}-H ${seq}/${ano}`,
      pedido_em: pedidoEm,
      dados: dados(tipo, g, pedidoEm, morada),
    });
  }
  return lista.sort((a, b) => a.pedido_em.localeCompare(b.pedido_em));
}

function dados(
  tipo: TipoLicenca,
  g: ReturnType<typeof gerador>,
  pedidoEm: string,
  morada: () => string,
): Record<string, unknown> {
  switch (tipo) {
    case 'ruido': {
      const atividade = g.pesado([
        ['festa_privada', 80],
        ['evento', 15],
        ['obra', 5],
      ] as const);
      return {
        atividade,
        descricao:
          atividade === 'festa_privada'
            ? g.um([
                'Festa de anos no quintal',
                'Casamento',
                'Batizado',
                'Festa de família',
              ])
            : atividade === 'evento'
              ? g.um([
                  'Arraial de São João',
                  'Concerto no largo',
                  'Festa da rua',
                ])
              : 'Betonagem fora de horas',
        morada: morada(),
        data: somarDias(
          pedidoEm,
          g.pesado([
            [g.entre(1, 3), 15],
            [g.entre(4, 14), 60],
            [g.entre(15, 45), 25],
          ]),
        ),
        hora_inicio: g.pesado([
          ['14:00', 15],
          ['18:00', 20],
          ['19:00', 20],
          ['20:00', 30],
          ['21:00', 10],
          ['08:00', 5],
        ]),
        hora_fim: g.pesado([
          ['23:00', 20],
          ['00:00', 30],
          ['01:00', 25],
          ['02:00', 20],
          ['03:00', 5],
        ]),
        pessoas: g.pesado([
          [g.entre(10, 60), 55],
          [g.entre(61, 150), 30],
          [g.entre(151, 400), 15],
        ]),
        musica_amplificada: g.sim(0.7),
      };
    }
    case 'ocupacao_via': {
      const equipamento = g.pesado([
        ['andaime', 45],
        ['contentor', 35],
        ['materiais', 15],
        ['plataforma', 5],
      ] as const);
      return {
        equipamento,
        descricao: g.um([
          'Pintar a fachada',
          'Substituir o telhado',
          'Obras no interior da loja',
          'Reabilitação do prédio',
          'Trocar as janelas',
        ]),
        morada: morada(),
        data_inicio: somarDias(pedidoEm, g.entre(3, 30)),
        dias: g.um([3, 5, 7, 10, 14, 15, 20, 30, 30, 45, 60]),
        area_m2: g.pesado([
          [g.entre(2, 12), 60],
          [g.entre(13, 20), 25],
          [g.entre(21, 40), 15],
        ]),
        passeio_livre_m: g.um([0.8, 1, 1.2, 1.2, 1.5, 1.5, 2, 2.5]),
        ocupa_estrada: g.sim(0.15),
      };
    }
    case 'esplanada': {
      const area = g.pesado([
        [g.entre(6, 20), 55],
        [g.entre(21, 30), 25],
        [g.entre(31, 50), 20],
      ]);
      return {
        estabelecimento: g.um(CAFES),
        morada: morada(),
        data_inicio: somarDias(pedidoEm, g.entre(5, 40)),
        meses: g.um([3, 6, 6, 12, 12, 12]),
        area_m2: area,
        mesas: Math.max(1, Math.round(area / g.um([2.5, 3, 3.5]))),
        passeio_livre_m: g.um([1, 1.2, 1.5, 1.5, 1.8, 2, 3]),
        estrado: g.sim(0.1),
        centro_historico: g.sim(0.25),
      };
    }
    case 'distico_residente': {
      const l = () => LETRAS[g.entre(0, LETRAS.length - 1)];
      const d = () => String(g.entre(0, 9));
      return {
        morada: morada(),
        matricula: `${l()}${l()}-${d()}${d()}-${l()}${l()}`,
        disticos_ja_tem: g.pesado([
          [0, 60],
          [1, 30],
          [2, 10],
        ]),
        morada_comprovada: g.sim(0.9),
        viatura_em_nome: g.sim(0.92),
      };
    }
    case 'publicidade': {
      const suporte = g.pesado([
        ['placa', 30],
        ['letras', 20],
        ['tabuleta', 20],
        ['toldo', 10],
        ['lona', 10],
        ['bandeirola', 5],
        ['cavalete', 5],
      ] as const);
      const [largura, altura] = g.pesado([
        [[g.um([0.5, 0.6, 0.8, 1]), g.um([0.4, 0.5, 0.8, 1])], 55],
        [[g.um([1.5, 2, 2.5, 3]), g.um([0.5, 0.8, 1, 1.5])], 30],
        [[g.um([3, 4, 5]), g.um([1.5, 2, 3])], 15],
      ] as const);
      return {
        suporte,
        estabelecimento: g.um(LOJAS),
        mensagem: 'Nome e logótipo do estabelecimento',
        morada: morada(),
        largura_m: largura,
        altura_m: altura,
        iluminado: g.sim(0.3),
        no_proprio_estabelecimento: g.sim(0.85),
        centro_historico: g.sim(0.25),
        data_inicio: somarDias(pedidoEm, g.entre(2, 30)),
        meses: g.um([6, 12, 12, 12]),
      };
    }
    case 'recinto_improvisado': {
      const estruturas = (
        ['palco', 'tenda', 'barracas', 'bancadas'] as const
      ).filter((_, i) => g.sim([0.7, 0.5, 0.6, 0.12][i]));
      return {
        descricao: g.um(EVENTOS),
        morada: morada(),
        data_inicio: somarDias(
          pedidoEm,
          g.pesado([
            [g.entre(3, 12), 25],
            [g.entre(13, 40), 55],
            [g.entre(41, 90), 20],
          ]),
        ),
        dias: g.pesado([
          [1, 40],
          [2, 25],
          [3, 20],
          [g.entre(4, 10), 15],
        ]),
        lotacao: g.pesado([
          [g.entre(50, 300), 65],
          [g.entre(301, 1000), 25],
          [g.entre(1001, 3000), 10],
        ]),
        estruturas,
        musica: g.sim(0.85),
      };
    }
  }
}
