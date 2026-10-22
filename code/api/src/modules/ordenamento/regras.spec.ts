import {
  avaliarObra,
  dentro,
  Ponto,
  ZONAS_DEMONSTRACAO,
  zonaDe,
} from './regras';

const ERC = ZONAS_DEMONSTRACAO.find((z) => z.codigo === 'ERC')!;
const CH = ZONAS_DEMONSTRACAO.find((z) => z.codigo === 'CH')!;

describe('ordenamento', () => {
  it('ponto no polígono', () => {
    const q: Ponto[] = [
      [0, 0],
      [0, 1],
      [1, 1],
      [1, 0],
    ];
    expect(dentro([0.5, 0.5], q)).toBe(true);
    expect(dentro([1.5, 0.5], q)).toBe(false);
  });

  it('zonas umas dentro das outras: ganha a mais pequena (o centro histórico)', () => {
    // Largo da Oliveira: dentro do residencial e do centro histórico.
    expect(zonaDe([41.4432, -8.2947], ZONAS_DEMONSTRACAO)?.codigo).toBe('CH');
    expect(zonaDe([41.45, -8.305], ZONAS_DEMONSTRACAO)?.codigo).toBe('ERC');
    expect(zonaDe([41.3, -8.1], ZONAS_DEMONSTRACAO)).toBeNull();
  });

  it('anexo no residencial: sem área pergunta; 8 m² isento; 25 m² comunicação prévia; 40 m² licença', () => {
    expect(avaliarObra(ERC.regras.anexo, {})).toMatchObject({
      controlo: null,
      em_falta: ['area_m2', 'altura_m'],
    });
    expect(
      avaliarObra(ERC.regras.anexo, { area_m2: 8, altura_m: 2 }).controlo,
    ).toBe('isento');
    expect(
      avaliarObra(ERC.regras.anexo, { area_m2: 25, altura_m: 2.5 }).controlo,
    ).toBe('comunicacao_previa');
    expect(
      avaliarObra(ERC.regras.anexo, { area_m2: 40, altura_m: 2.5 }).controlo,
    ).toBe('licenca');
  });

  it('regra sem degraus responde logo, sem perguntar medidas', () => {
    expect(avaliarObra(CH.regras.anexo, {})).toMatchObject({
      controlo: 'nao_permitido',
      em_falta: [],
    });
    expect(avaliarObra(undefined, {}).controlo).toBeNull();
  });

  it('muro: só a altura importa', () => {
    expect(avaliarObra(ERC.regras.muro, {}).em_falta).toEqual(['altura_m']);
    expect(avaliarObra(ERC.regras.muro, { altura_m: 1.5 }).controlo).toBe(
      'isento',
    );
    expect(avaliarObra(ERC.regras.muro, { altura_m: 2 }).controlo).toBe(
      'comunicacao_previa',
    );
  });
});
