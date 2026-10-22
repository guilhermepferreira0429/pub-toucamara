import { nifValido } from '../municipes/municipes.service';
import { CONVERSAS, PESSOAS } from './demo.conteudo';
import {
  chaveValida,
  demoAtiva,
  diaDemo,
  eTelefoneDemonstracao,
  instanteDemo,
  nifDemo,
  proximoDiaSemana,
  telefoneDemo,
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
