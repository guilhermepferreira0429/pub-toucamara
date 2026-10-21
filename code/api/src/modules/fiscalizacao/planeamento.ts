/*
 * Planear o dia do fiscal: ordena as visitas por proximidade (vizinho mais
 * próximo a partir do ponto de partida, normalmente o edifício da câmara),
 * com o tempo de deslocação estimado a uma velocidade média e a duração de
 * cada tipo de visita. Respeita as janelas marcadas (ex.: "entre as 10h e
 * as 11h, com o requerente"). Sem BD nem rede, para testar à parte.
 *
 * É uma heurística, não um ótimo: chega para 5 a 15 visitas por dia e o
 * fiscal pode sempre trocar a ordem.
 */

export interface Ponto {
  lat: number;
  lng: number;
}

export interface VisitaParaPlano {
  id: string;
  lat: number | null;
  lng: number | null;
  /** Minutos no local. */
  duracao_min: number;
  /** 'HH:MM': chegar a partir de... */
  janela_inicio?: string | null;
  /** 'HH:MM': ...e começar até. */
  janela_fim?: string | null;
}

export interface OpcoesPlano {
  /** Sem ponto de partida começa na visita mais afastada do centro do conjunto. */
  partida: Ponto | null;
  /** 'HH:MM'. */
  hora_inicio: string;
  /** 'HH:MM': o que acaba depois fica marcado (`depois_da_hora`). */
  hora_fim: string;
  velocidade_kmh: number;
  /** A estrada é mais comprida do que a linha reta (1,3 = mais 30 %). */
  fator_percurso: number;
  /** Voltar à partida no fim do dia. */
  regressar: boolean;
}

export interface Paragem {
  id: string;
  ordem: number;
  /** Desde a paragem anterior (ou da partida), em km pela estrada (estimativa). */
  distancia_km: number;
  deslocacao_min: number;
  chegada: string;
  espera_min: number;
  inicio: string;
  fim: string;
  janela: { inicio: string | null; fim: string | null } | null;
  depois_da_hora: boolean;
}

export interface Plano {
  paragens: Paragem[];
  regresso: {
    distancia_km: number;
    deslocacao_min: number;
    chegada: string;
  } | null;
  /** Visitas com janela que já não se consegue cumprir neste dia. */
  janelas_perdidas: string[];
  /** Sem coordenadas: não entram no percurso (localizar primeiro). */
  sem_localizacao: string[];
  totais: {
    distancia_km: number;
    deslocacao_min: number;
    trabalho_min: number;
    espera_min: number;
    termina: string;
  };
}

const RAIO_TERRA_KM = 6371;

/** Distância em linha reta (haversine), em km. */
export function haversineKm(a: Ponto, b: Ponto): number {
  const rad = (g: number) => (g * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * RAIO_TERRA_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Minutos de carro, arredondados para cima (0 se for o mesmo sítio). */
export function minutosDeslocacao(
  km: number,
  velocidadeKmh: number,
  fatorPercurso: number,
): number {
  if (km <= 0) return 0;
  return Math.ceil(((km * fatorPercurso) / velocidadeKmh) * 60);
}

export function paraMinutos(hhmm: string): number {
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm);
  if (!m) throw new Error(`Hora inválida: ${hhmm}`);
  return Number(m[1]) * 60 + Number(m[2]);
}

export function paraHora(minutos: number): string {
  const m = Math.round(minutos);
  const h = Math.floor(m / 60);
  return `${String(h).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

const arred = (km: number) => Math.round(km * 10) / 10;

interface Candidata {
  v: VisitaParaPlano & { lat: number; lng: number };
  km: number;
  desloc: number;
  chegada: number;
  inicio: number;
  fim: number;
  limite: number | null;
}

/**
 * Vizinho mais próximo com janelas:
 * 1. de onde está, calcula para cada visita por fazer a chegada e o início
 *    (esperando que a janela abra, se for cedo);
 * 2. as que já não cabem na janela ficam em `janelas_perdidas`;
 * 3. escolhe a que começa mais cedo (sem janelas é a mais próxima), a não
 *    ser que ir lá faça perder a janela de outra: então vai primeiro à
 *    janela que fecha mais cedo.
 */
export function planearDia(visitas: VisitaParaPlano[], o: OpcoesPlano): Plano {
  const comLocal = visitas.filter(
    (v): v is VisitaParaPlano & { lat: number; lng: number } =>
      v.lat != null && v.lng != null,
  );
  const semLocal = visitas
    .filter((v) => v.lat == null || v.lng == null)
    .map((v) => v.id);

  const partida = o.partida ?? pontoMaisAfastado(comLocal);
  const fimDia = paraMinutos(o.hora_fim);
  let aqui: Ponto | null = partida;
  let agora = paraMinutos(o.hora_inicio);
  const porFazer = [...comLocal];
  const paragens: Paragem[] = [];
  const perdidas: string[] = [];
  let espera = 0;

  const avaliar = (
    v: VisitaParaPlano & { lat: number; lng: number },
    de: Ponto | null,
    t: number,
  ): Candidata => {
    const km = de ? haversineKm(de, v) : 0;
    const desloc = minutosDeslocacao(km, o.velocidade_kmh, o.fator_percurso);
    const chegada = t + desloc;
    const abre = v.janela_inicio ? paraMinutos(v.janela_inicio) : null;
    const inicio = abre != null ? Math.max(chegada, abre) : chegada;
    return {
      v,
      km,
      desloc,
      chegada,
      inicio,
      fim: inicio + v.duracao_min,
      limite: v.janela_fim ? paraMinutos(v.janela_fim) : null,
    };
  };

  while (porFazer.length) {
    const cands = porFazer.map((v) => avaliar(v, aqui, agora));
    // Janelas que já não se cumprem saem do percurso.
    for (const c of cands) {
      if (c.limite != null && c.inicio > c.limite) {
        perdidas.push(c.v.id);
        porFazer.splice(porFazer.indexOf(c.v), 1);
      }
    }
    const validas = cands.filter((c) => porFazer.includes(c.v));
    if (!validas.length) break;

    validas.sort(
      (a, b) =>
        a.inicio - b.inicio || a.km - b.km || a.v.id.localeCompare(b.v.id),
    );
    let escolhida = validas[0];
    // Ir à mais próxima faz perder a janela de outra? Então essa primeiro.
    const apertadas = validas
      .filter((c) => c !== escolhida && c.limite != null)
      .filter((c) => {
        const depois = avaliar(c.v, escolhida.v, escolhida.fim);
        return depois.inicio > (c.limite as number);
      })
      .sort((a, b) => (a.limite as number) - (b.limite as number));
    if (apertadas.length) escolhida = apertadas[0];

    const c = escolhida;
    espera += c.inicio - c.chegada;
    paragens.push({
      id: c.v.id,
      ordem: paragens.length + 1,
      distancia_km: arred(c.km * o.fator_percurso),
      deslocacao_min: c.desloc,
      chegada: paraHora(c.chegada),
      espera_min: c.inicio - c.chegada,
      inicio: paraHora(c.inicio),
      fim: paraHora(c.fim),
      janela:
        c.v.janela_inicio || c.v.janela_fim
          ? {
              inicio: c.v.janela_inicio ?? null,
              fim: c.v.janela_fim ?? null,
            }
          : null,
      depois_da_hora: c.fim > fimDia,
    });
    aqui = c.v;
    agora = c.fim;
    porFazer.splice(porFazer.indexOf(c.v), 1);
  }

  let regresso: Plano['regresso'] = null;
  if (o.regressar && o.partida && aqui && paragens.length) {
    const km = haversineKm(aqui, o.partida);
    const desloc = minutosDeslocacao(km, o.velocidade_kmh, o.fator_percurso);
    regresso = {
      distancia_km: arred(km * o.fator_percurso),
      deslocacao_min: desloc,
      chegada: paraHora(agora + desloc),
    };
    agora += desloc;
  }

  const deslocacao =
    paragens.reduce((s, p) => s + p.deslocacao_min, 0) +
    (regresso?.deslocacao_min ?? 0);
  const distancia =
    paragens.reduce((s, p) => s + p.distancia_km, 0) +
    (regresso?.distancia_km ?? 0);
  const trabalho = paragens.reduce(
    (s, p) => s + (paraMinutos(p.fim) - paraMinutos(p.inicio)),
    0,
  );
  return {
    paragens,
    regresso,
    janelas_perdidas: perdidas,
    sem_localizacao: semLocal,
    totais: {
      distancia_km: arred(distancia),
      deslocacao_min: deslocacao,
      trabalho_min: trabalho,
      espera_min: espera,
      termina: paraHora(agora),
    },
  };
}

/** Sem ponto de partida: a visita mais afastada do centro (uma ponta do percurso). */
function pontoMaisAfastado(pontos: Ponto[]): Ponto | null {
  if (!pontos.length) return null;
  const centro = {
    lat: pontos.reduce((s, p) => s + p.lat, 0) / pontos.length,
    lng: pontos.reduce((s, p) => s + p.lng, 0) / pontos.length,
  };
  let melhor = pontos[0];
  for (const p of pontos) {
    if (haversineKm(centro, p) > haversineKm(centro, melhor)) melhor = p;
  }
  return { lat: melhor.lat, lng: melhor.lng };
}
