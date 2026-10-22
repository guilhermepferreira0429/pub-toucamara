import { PONTOS_DEMO, TEMAS_DEMO } from './turismo.conteudo';
import {
  esquemaMetaTurismo,
  LINGUAS,
  linguaDe,
  normalizar,
  Ponto,
  ROTEIROS_PRONTOS,
  seccoes,
  sugerirRoteiro,
} from './turismo.regras';

const pontos = (l: (typeof LINGUAS)[number] = 'pt'): Ponto[] =>
  PONTOS_DEMO.map((p) => ({ ...p, nome: p.nome[l] }));

describe('linguaDe', () => {
  it('reduz à língua base e só aceita as que têm conteúdo', () => {
    expect(linguaDe('en-US')).toBe('en');
    expect(linguaDe('pt-PT')).toBe('pt');
    expect(linguaDe('FR')).toBe('fr');
    expect(linguaDe('es_ES')).toBe('es');
    expect(linguaDe('uk')).toBeNull();
    expect(linguaDe(null)).toBeNull();
  });
});

describe('seccoes', () => {
  it('parte pelos "## " e guarda a introdução sem título', () => {
    const s = seccoes('Intro.\n\n## A\nTexto A\n\n## B\nTexto B');
    expect(s).toEqual([
      { titulo: null, texto: 'Intro.' },
      { titulo: 'A', texto: 'Texto A' },
      { titulo: 'B', texto: 'Texto B' },
    ]);
  });
});

describe('conteúdo de demonstração', () => {
  it('cada tema tem as 4 línguas e cada ponto tem a sua secção em cada língua', () => {
    for (const t of TEMAS_DEMO) {
      for (const l of LINGUAS) {
        const texto = t.texto[l];
        expect(texto.length).toBeGreaterThan(200);
        const titulos = seccoes(texto).map((s) => normalizar(s.titulo ?? ''));
        for (const chave of t.pontos ?? []) {
          const p = PONTOS_DEMO.find((x) => x.chave === chave)!;
          expect(titulos).toContain(normalizar(p.nome[l]));
        }
      }
    }
  });

  it('não traz horários nem preços inventados (só "consulte no local")', () => {
    for (const t of TEMAS_DEMO) {
      for (const l of LINGUAS) {
        expect(t.texto[l]).not.toMatch(/\d+\s*(€|euros?\b|EUR)/i);
        expect(t.texto[l]).not.toMatch(/\b\d{1,2}[h:]\d{2}\b/);
      }
    }
  });

  it('os pontos validam com o esquema guardado na fonte', () => {
    const r = esquemaMetaTurismo.safeParse({
      tema: 'x',
      ordem: 1,
      pontos: pontos(),
    });
    expect(r.success).toBe(true);
  });
});

describe('sugerirRoteiro', () => {
  it('cabe no tempo e vem pela ordem a pé, com os imperdíveis', () => {
    const r = sugerirRoteiro(pontos(), {
      minutos: 120,
      interesses: ['historia'],
      mobilidade_reduzida: false,
    });
    expect(r.minutos_total).toBeLessThanOrEqual(120);
    const chaves = r.paragens.map((p) => p.chave);
    expect(chaves).toEqual(expect.arrayContaining(['castelo', 'paco']));
    const ordens = r.paragens.map((p) => p.ordem);
    expect([...ordens].sort((a, b) => a - b)).toEqual(ordens);
    expect(chaves).not.toContain('citania');
    expect(r.paragens[0].chegada_min).toBe(0);
  });

  it('com mobilidade reduzida tira os de acesso difícil e prefere os fáceis', () => {
    const r = sugerirRoteiro(pontos(), {
      minutos: 180,
      interesses: [],
      mobilidade_reduzida: true,
    });
    const chaves = r.paragens.map((p) => p.chave);
    expect(chaves).not.toContain('castelo');
    expect(r.excluidos_mobilidade).toContain('Castelo de Guimarães');
    expect(r.paragens.every((p) => p.acessibilidade !== 'dificil')).toBe(true);
    expect(chaves).toEqual(expect.arrayContaining(['toural', 'oliveira']));
  });

  it('a Penha leva o teleférico e só entra se couber', () => {
    const curto = sugerirRoteiro(pontos(), {
      minutos: 60,
      interesses: ['natureza'],
      mobilidade_reduzida: false,
    });
    expect(curto.paragens.map((p) => p.chave)).not.toContain('penha');
    const longo = sugerirRoteiro(pontos(), {
      minutos: 240,
      interesses: ['natureza'],
      mobilidade_reduzida: false,
    });
    const chaves = longo.paragens.map((p) => p.chave);
    expect(chaves).toEqual(expect.arrayContaining(['teleferico', 'penha']));
    expect(chaves.indexOf('teleferico')).toBeLessThan(chaves.indexOf('penha'));
  });

  it('fora do centro só com o dia todo', () => {
    const meio = sugerirRoteiro(pontos(), {
      minutos: 240,
      interesses: ['historia'],
      mobilidade_reduzida: false,
    });
    expect(meio.paragens.map((p) => p.chave)).not.toContain('citania');
    const dia = sugerirRoteiro(pontos(), {
      minutos: 720,
      interesses: ['historia'],
      mobilidade_reduzida: false,
    });
    expect(dia.paragens.map((p) => p.chave)).toContain('citania');
  });

  it('os roteiros prontos têm sempre paragens', () => {
    for (const r of ROTEIROS_PRONTOS) {
      expect(
        sugerirRoteiro(pontos('en'), r.pedido).paragens.length,
      ).toBeGreaterThan(1);
    }
  });
});
