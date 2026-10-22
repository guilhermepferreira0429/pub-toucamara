import {
  alteracoesLicenca,
  frasesRegras,
  frasesTaxas,
  horaDita,
  valoresRegras,
} from './explicar';
import { CONFIG_RUIDO_OMISSAO } from './regras';
import { DEFS, TIPOS } from './tipos';

describe('regras em linguagem simples', () => {
  it('as frases leem os números das regras em vigor', () => {
    const f = frasesRegras('ruido', {
      ...CONFIG_RUIDO_OMISSAO,
      pessoas_max: 80,
    });
    expect(f.find((x) => x.id === 'pessoas')?.texto).toContain(
      'Até 80 pessoas',
    );
    expect(f.find((x) => x.id === 'hora_fim')?.texto).toContain('à meia-noite');
    expect(f.find((x) => x.id === 'hora_fim')?.texto).toContain('às 2h');
  });

  it.each(TIPOS)(
    '%s: tem frases, taxas e valores (sem os avisos internos)',
    (t) => {
      expect(frasesRegras(t, DEFS[t].omissao).length).toBeGreaterThan(0);
      expect(frasesTaxas(t, DEFS[t].omissao).join(' ')).toMatch(/€/);
      const v = valoresRegras(t, DEFS[t].omissao);
      expect(v.length).toBeGreaterThan(0);
      expect(v.some((x) => x.chave.startsWith('aviso_'))).toBe(false);
    },
  );

  it('as regras que a câmara desliga desaparecem da página', () => {
    const c = DEFS.ocupacao_via.omissao as Record<string, unknown>;
    expect(frasesRegras('ocupacao_via', c).map((x) => x.id)).toContain(
      'estrada',
    );
    expect(
      frasesRegras('ocupacao_via', { ...c, estrada_vai_a_tecnico: false }).map(
        (x) => x.id,
      ),
    ).not.toContain('estrada');
  });

  it('horas ditas', () => {
    expect(horaDita('09:00')).toBe('9h');
    expect(horaDita('23:30')).toBe('23h30');
    expect(horaDita('00:00')).toBe('meia-noite');
  });

  it('o que mudou entre duas versões, com os valores como se leem', () => {
    const antes = CONFIG_RUIDO_OMISSAO;
    const depois = {
      ...antes,
      pessoas_max: 200,
      taxa_cent: 3000,
      aprovacao: 'funcionario' as const,
    };
    const a = alteracoesLicenca('ruido', antes, depois);
    expect(a).toEqual(
      expect.arrayContaining([
        {
          campo: 'pessoas_max',
          rotulo: 'Pessoas (sem análise)',
          antes: '150',
          depois: '200',
        },
        {
          campo: 'taxa_cent',
          rotulo: 'Taxa',
          antes: '25,00 €',
          depois: '30,00 €',
        },
        expect.objectContaining({
          campo: 'aprovacao',
          depois: 'um funcionário confirma',
        }),
      ]),
    );
    expect(a).toHaveLength(3);
    expect(alteracoesLicenca('ruido', antes, antes)).toEqual([]);
  });
});
