import { gerarConsultasDemonstracao } from './consultas-demonstracao';
import { avaliarObra, OBRAS, ZONAS_DEMONSTRACAO, zonaDe } from './regras';

describe('gerarConsultasDemonstracao', () => {
  const lista = gerarConsultasDemonstracao('2026-10-21');

  it('é sempre a mesma lista (gerador com semente)', () => {
    expect(gerarConsultasDemonstracao('2026-10-21')).toEqual(lista);
    expect(lista.length).toBe(80);
  });

  it('cada morada cai mesmo na zona de demonstração indicada', () => {
    for (const c of lista) {
      expect(zonaDe([c.lat, c.lng], ZONAS_DEMONSTRACAO)?.codigo).toBe(c.zona);
    }
    // As quatro zonas têm perguntas.
    expect(new Set(lista.map((c) => c.zona))).toEqual(
      new Set(['CH', 'ERC', 'EA', 'EF']),
    );
  });

  it('obras conhecidas, datas nos últimos dois anos e por ordem', () => {
    for (const c of lista) {
      expect(Object.keys(OBRAS)).toContain(c.obra);
      expect(c.criada_em >= '2024-10-21' && c.criada_em < '2026-10-21').toBe(
        true,
      );
    }
    const datas = lista.map((c) => c.criada_em);
    expect([...datas].sort()).toEqual(datas);
  });

  it('as medidas chegam para responder com as regras de demonstração', () => {
    for (const c of lista) {
      const zona = ZONAS_DEMONSTRACAO.find((z) => z.codigo === c.zona)!;
      expect(avaliarObra(zona.regras[c.obra], c.medidas).em_falta).toEqual([]);
    }
  });

  it('há anexos residenciais dos dois lados do limite de 30 m² (a simulação tem o que mostrar)', () => {
    const anexos = lista.filter((c) => c.zona === 'ERC' && c.obra === 'anexo');
    expect(anexos.some((c) => c.medidas.area_m2! <= 30)).toBe(true);
    expect(anexos.some((c) => c.medidas.area_m2! > 20)).toBe(true);
  });
});
