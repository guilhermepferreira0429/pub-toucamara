import type { PedidoAntigo } from '../licencas/simulacao';
import type { RegrasZona } from './regras';
import {
  ConsultaAntiga,
  esquemaRegrasZona,
  simularZona,
} from './simulacao-pdm';

const ATUAIS: RegrasZona = {
  anexo: {
    degraus: [
      { controlo: 'isento', area_max_m2: 10 },
      { controlo: 'comunicacao_previa', area_max_m2: 30 },
    ],
    acima: 'licenca',
    notas: [],
  },
};

const consulta = (
  id: string,
  area_m2: number,
): PedidoAntigo<ConsultaAntiga> => ({
  id,
  referencia: id,
  pedido_em: '2026-05-01',
  dados: { obra: 'anexo', medidas: { area_m2 } },
  demonstracao: false,
});

describe('simularZona', () => {
  const consultas = [consulta('A', 8), consulta('B', 25), consulta('C', 40)];

  it('baixar o limite da comunicação prévia: o anexo de 25 m² passa a precisar de licença', () => {
    const propostas: RegrasZona = {
      anexo: {
        ...ATUAIS.anexo!,
        degraus: [
          { controlo: 'isento', area_max_m2: 10 },
          { controlo: 'comunicacao_previa', area_max_m2: 20 },
        ],
      },
    };
    const r = simularZona(ATUAIS, propostas, consultas);
    expect(r).toMatchObject({
      total: 3,
      mudam: 1,
      deixam_de_ser_aprovados: 1,
      aprovados: { antes: 2, depois: 1 },
    });
    expect(r.exemplos[0]).toMatchObject({
      id: 'B',
      antes: { decisao: 'precisa de uma comunicação prévia' },
      depois: { decisao: 'precisa de licença' },
    });
    expect(r.exemplos[0].resumo).toContain('25 m²');
  });

  it('mudar de isento para comunicação prévia muda a resposta, com o porquê', () => {
    const propostas: RegrasZona = {
      anexo: {
        ...ATUAIS.anexo!,
        degraus: [{ controlo: 'comunicacao_previa', area_max_m2: 30 }],
      },
    };
    const r = simularZona(ATUAIS, propostas, consultas);
    expect(r.mudam).toBe(1);
    expect(r.deixam_de_ser_aprovados).toBe(0);
    expect(r.exemplos[0].porque[0]).toContain(
      'passa de "não precisa de pedir nada',
    );
  });

  it('valida as regras propostas', () => {
    expect(esquemaRegrasZona.safeParse(ATUAIS).success).toBe(true);
    expect(
      esquemaRegrasZona.safeParse({ anexo: { degraus: [], acima: 'talvez' } })
        .success,
    ).toBe(false);
    expect(esquemaRegrasZona.safeParse({ garagem: ATUAIS.anexo }).success).toBe(
      false,
    );
  });
});
