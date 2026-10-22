import { z } from 'zod';
import { RegistoServicos, servico } from '../../ferramentas/servicos.js';
import type { ContextoFerramenta } from '../../ferramentas/ferramenta.js';
import { respostaCatalogo, respostaPedido } from './catalogo.js';

const ctx = {} as ContextoFerramenta;

function registo() {
  const r = new RegistoServicos();
  r.registar(
    servico({
      area: 'cemiterios',
      acao: 'procurar_sepultura',
      titulo: 'Onde está sepultada uma pessoa',
      quando: 'Quando quer saber onde está a sepultura de um familiar.',
      entrada: z.object({
        nome: z.string().min(3).describe('Nome da pessoa falecida.'),
        ano: z
          .number()
          .int()
          .min(1900)
          .optional()
          .describe('Ano em que faleceu.'),
        perpetua: z.boolean().optional().describe('A sepultura é perpétua?'),
        datas: z.array(z.string()).optional().describe('Datas.'),
      }),
      executar: (_c, e) => Promise.resolve({ feito: true, recebido: e }),
    }),
  );
  return r;
}

describe('catálogo de serviços', () => {
  it('sem área: só as áreas com ações; com área: os campos a perguntar', () => {
    const r = registo();
    const todas = respostaCatalogo(r) as {
      areas: { area: string; acoes: unknown[] }[];
    };
    expect(todas.areas.map((a) => a.area)).toEqual(['cemiterios']);
    const c = respostaCatalogo(r, 'cemiterios') as {
      acoes: { campos: unknown[] }[];
    };
    expect(c.acoes[0].campos).toEqual([
      {
        campo: 'nome',
        pergunta: 'Nome da pessoa falecida.',
        obrigatorio: true,
        formato: 'texto',
      },
      {
        campo: 'ano',
        pergunta: 'Ano em que faleceu.',
        obrigatorio: false,
        formato: 'número inteiro (a partir de 1900)',
      },
      {
        campo: 'perpetua',
        pergunta: 'A sepultura é perpétua?',
        obrigatorio: false,
        formato: 'sim ou não',
      },
      {
        campo: 'datas',
        pergunta: 'Datas.',
        obrigatorio: false,
        formato: 'lista separada por vírgulas',
      },
    ]);
    expect(respostaCatalogo(r, 'escolas')).toMatchObject({ acoes: [] });
  });

  it('pedir: converte o texto para o tipo do campo e corre', async () => {
    const r = await respostaPedido(
      registo(),
      ctx,
      'cemiterios',
      'procurar_sepultura',
      [
        { campo: 'nome', valor: 'Maria Fulana' },
        { campo: 'ano', valor: '1998' },
        { campo: 'perpetua', valor: 'sim' },
        { campo: 'datas', valor: '2020-01-01, 2021-02-02' },
      ],
    );
    expect(r).toEqual({
      feito: true,
      recebido: {
        nome: 'Maria Fulana',
        ano: 1998,
        perpetua: true,
        datas: ['2020-01-01', '2021-02-02'],
      },
    });
  });

  it('pedir: o que falta e o que está mal em português, sem correr', async () => {
    const r = await respostaPedido(
      registo(),
      ctx,
      'cemiterios',
      'procurar_sepultura',
      [{ campo: 'ano', valor: '1800' }],
    );
    expect(r).toMatchObject({
      feito: false,
      motivo: 'faltam_dados',
      em_falta: [{ campo: 'nome' }],
      invalidos: [{ campo: 'ano', problema: 'tem de ser pelo menos 1900' }],
    });
  });

  it('ação ou área desconhecida → servico_desconhecido com as ações que há', async () => {
    await expect(
      respostaPedido(registo(), ctx, 'cemiterios', 'xpto', []),
    ).rejects.toMatchObject({
      codigo: 'servico_desconhecido',
    });
  });
});
