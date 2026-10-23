import { nifValido } from '../municipes/municipes.service';
import {
  EXECUCOES_AVALIACAO,
  FONTES_DEMO,
  PERGUNTAS_AVALIACAO,
  RESPOSTAS_DEMO,
} from './demo.conhecimento';
import { CONVERSAS, NOMES_ANTIGOS, PESSOAS } from './demo.conteudo';
import {
  chaveValida,
  demoAtiva,
  diaDemo,
  escolherResposta,
  eTelefoneDemonstracao,
  instanteConversaDemo,
  instanteDemo,
  nifDemo,
  numeracaoContinua,
  proximoDiaSemana,
  telefoneDemo,
  trocarNomes,
} from './demo.regras';
import { passosDemo } from './demo.service';
import { pngDemonstracao } from './imagens-demo';

describe('demo · regras', () => {
  it('ligada fora de produção; em produção só com DEMO_ATIVA=true', () => {
    expect(demoAtiva('development', undefined)).toBe(true);
    expect(demoAtiva('test', '')).toBe(true);
    expect(demoAtiva('production', undefined)).toBe(false);
    expect(demoAtiva('production', 'true')).toBe(true);
    expect(demoAtiva('production', 'TRUE ')).toBe(true);
    expect(demoAtiva('development', 'false')).toBe(false);
  });

  it('telefones na gama de teste', () => {
    expect(telefoneDemo(7)).toBe('+351910000007');
    expect(eTelefoneDemonstracao('+351910000123')).toBe(true);
    expect(eTelefoneDemonstracao('+351910001123')).toBe(false);
    expect(eTelefoneDemonstracao('+351912345678')).toBe(false);
    expect(eTelefoneDemonstracao(null)).toBe(false);
    expect(() => telefoneDemo(1000)).toThrow();
  });

  it('NIF fictícios válidos no algoritmo e todos diferentes', () => {
    const nifs = Array.from({ length: 100 }, (_, i) => nifDemo(i));
    expect(nifs.every(nifValido)).toBe(true);
    expect(new Set(nifs).size).toBe(100);
    expect(nifs[0].startsWith('299999')).toBe(true);
  });

  it('datas relativas: nunca no futuro', () => {
    const agora = new Date('2026-10-22T08:00:00Z'); // 09:00 em Lisboa
    const ontem = instanteDemo(agora, 'Europe/Lisbon', 1, '15:30');
    expect(ontem.toISOString()).toBe('2026-10-21T14:30:00.000Z');
    const hojeMaisTarde = instanteDemo(agora, 'Europe/Lisbon', 0, '18:00', 40);
    expect(hojeMaisTarde.getTime()).toBe(agora.getTime() - 40 * 60_000);
    expect(diaDemo(agora, 'Europe/Lisbon', 5)).toBe('2026-10-27');
    // Quinta 22 → o próximo sábado a pelo menos 10 dias é 7 de novembro.
    expect(proximoDiaSemana(agora, 'Europe/Lisbon', 6, 10)).toBe('2026-11-07');
  });

  it('conversas: uma de hoje a uma hora que ainda não chegou fica ontem, à mesma hora', () => {
    const agora = new Date('2026-10-23T05:37:00Z'); // 06:37 em Lisboa
    const c = (dias: number, hhmm: string) =>
      instanteConversaDemo(agora, 'Europe/Lisbon', dias, hhmm).toISOString();
    // Ainda não chegou: ontem às 09:45 (e não de madrugada, "agora").
    expect(c(0, '09:45')).toBe('2026-10-22T08:45:00.000Z');
    // Já passou: fica hoje.
    expect(c(0, '06:00')).toBe('2026-10-23T05:00:00.000Z');
    // Outros dias: como estão.
    expect(c(3, '21:30')).toBe('2026-10-20T20:30:00.000Z');
  });

  it('conteúdo coerente: chaves válidas e únicas, pessoas que existem', () => {
    const chaves = passosDemo().flatMap((p) => p.chaves);
    expect(chaves.every(chaveValida)).toBe(true);
    expect(new Set(chaves).size).toBe(chaves.length);
    const pessoas = new Set(PESSOAS.map((p) => p.chave));
    expect(CONVERSAS.every((c) => pessoas.has(c.pessoa))).toBe(true);
    expect(new Set(PESSOAS.map((p) => p.telefone)).size).toBe(PESSOAS.length);
    const canais = new Set(CONVERSAS.map((c) => c.canal));
    expect([...canais].sort()).toEqual(['chat', 'sms', 'telefone', 'whatsapp']);
    expect(Math.max(...CONVERSAS.map((c) => c.dias))).toBeLessThanOrEqual(30);
  });

  it('a ilustração é um PNG', () => {
    for (const t of ['buraco', 'candeeiro', 'contentor'] as const) {
      const png = pngDemonstracao(t);
      expect(png.subarray(1, 4).toString('ascii')).toBe('PNG');
      expect(png.readUInt32BE(16)).toBe(480);
      expect(png.length).toBeGreaterThan(1000);
    }
  });
});

describe('demo · coerência', () => {
  const respostas = [
    {
      chave: 'a',
      tema: 'obras',
      estado: 'no_ar',
      trechos: [1],
      palavras: /cozinha/i,
    },
    {
      chave: 'b',
      tema: 'obras',
      estado: 'no_ar',
      trechos: [1],
      palavras: /porta/i,
    },
    { chave: 'c', tema: 'eventos', estado: 'rascunho', trechos: [] },
    { chave: 'd', tema: 'vias', estado: 'no_ar', trechos: [] },
  ];

  it('a conversa cita a resposta do tema com as suas palavras (ou a primeira)', () => {
    expect(
      escolherResposta(respostas, 'obras', 'Quero abrir uma porta')?.chave,
    ).toBe('b');
    expect(
      escolherResposta(respostas, 'obras', 'Em que fase está?')?.chave,
    ).toBe('a');
    // Rascunhos e respostas sem fonte não se citam.
    expect(escolherResposta(respostas, 'eventos', 'piscina')).toBeNull();
    expect(escolherResposta(respostas, 'vias', 'buraco')).toBeNull();
  });

  it('os nomes de teste dão lugar a nomes plausíveis, em todo o lado', () => {
    expect(
      trocarNomes(
        '{"nome": "Café Sicrano, Lda", "titular": "Maria Fulana"}',
        NOMES_ANTIGOS,
      ),
    ).toBe('{"nome": "Café Pereira, Lda", "titular": "Maria Fernandes"}');
    const todos = PESSOAS.map((p) => p.nome).join(' ');
    expect(todos).not.toMatch(/Fulan|Sicran|Beltran/);
    expect(new Set(PESSOAS.map((p) => p.nome)).size).toBe(PESSOAS.length);
  });

  it('numeração contínua: 1, 2, 3 por ano de entrada', () => {
    const p = (id: string, numero: string, dia: string) => ({
      id,
      numero,
      dia,
      registado: true,
    });
    expect(
      numeracaoContinua(
        [
          p('x', 'CP 6/2026', '2025-09-29'),
          p('a', 'CP 3/2026', '2026-09-22'),
          p('b', 'CP 1/2026', '2026-10-06'),
          p('c', 'CP 412/2026', '2026-10-22'),
        ],
        true,
      ),
    ).toEqual([
      { id: 'x', numero: 'CP 1/2025' },
      { id: 'a', numero: 'CP 1/2026' },
      { id: 'b', numero: 'CP 2/2026' },
      { id: 'c', numero: 'CP 3/2026' },
    ]);
    // Já contínua: nada a mudar.
    expect(
      numeracaoContinua(
        [p('a', 'CP 1/2026', '2026-01-02'), p('b', 'CP 2/2026', '2026-02-02')],
        true,
      ),
    ).toEqual([]);
  });

  it('com processos que não são da demo, só mudam os números de design e de ano errado', () => {
    const r = numeracaoContinua(
      [
        {
          id: 'real',
          numero: 'CP 412/2026',
          dia: '2026-10-01',
          registado: false,
        },
        {
          id: 'porta',
          numero: 'CP DEMO-412/2026',
          dia: '2026-10-22',
          registado: true,
        },
        {
          id: 'velho',
          numero: 'CP 6/2026',
          dia: '2025-09-29',
          registado: true,
        },
        { id: 'ok', numero: 'CP 7/2026', dia: '2026-10-01', registado: true },
      ],
      false,
    );
    expect(r).toEqual([
      { id: 'porta', numero: 'CP 0/2026' },
      { id: 'velho', numero: 'CP 0/2025' },
    ]);
  });

  it('as respostas citam secções que existem nas fontes, e o teste de qualidade é coerente', () => {
    const fontes = new Set(['regulamento', ...FONTES_DEMO.map((f) => f.chave)]);
    for (const r of RESPOSTAS_DEMO) {
      for (const [f, ref] of r.trechos) {
        expect(fontes).toContain(f);
        if (f !== 'regulamento') {
          const fonte = FONTES_DEMO.find((x) => x.chave === f)!;
          expect(fonte.texto).toContain(`## ${ref}`);
        }
      }
    }
    for (const e of EXECUCOES_AVALIACAO) expect(e.dias).toBeGreaterThan(0);
    // A última execução passa os 80%; a primeira não (o gate parou-a).
    const taxa = (falhas: number) =>
      (100 * (PERGUNTAS_AVALIACAO.length - falhas)) /
      PERGUNTAS_AVALIACAO.length;
    const ultima = EXECUCOES_AVALIACAO[EXECUCOES_AVALIACAO.length - 1];
    expect(taxa(Object.keys(ultima.falhas).length)).toBeGreaterThanOrEqual(80);
    expect(
      taxa(Object.keys(EXECUCOES_AVALIACAO[0].falhas).length),
    ).toBeLessThan(80);
  });
});
