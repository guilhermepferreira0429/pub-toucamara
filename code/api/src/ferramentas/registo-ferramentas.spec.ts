import { z } from 'zod';
import type { ContextoFerramenta } from './ferramenta.js';
import { ferramenta } from './ferramenta.js';
import { RegistoFerramentas } from './registo-ferramentas.service.js';

const ctx = {
  municipio: { id: 'm1', slug: 'x', nome: 'X', fuso: 'Europe/Lisbon' },
  canal: 'chat',
  conversaId: null,
  municipeId: null,
  telefone: null,
} satisfies ContextoFerramenta;

function registoComEco() {
  const registo = new RegistoFerramentas();
  registo.registar(
    ferramenta({
      nome: 'eco',
      descricao: 'Devolve o texto.',
      entrada: z.object({ texto: z.string().min(1).describe('O texto.') }),
      executar: (_, { texto }) => Promise.resolve({ texto }),
    }),
  );
  return registo;
}

describe('RegistoFerramentas', () => {
  it('valida a entrada e corre', async () => {
    await expect(
      registoComEco().executar('eco', ctx, { texto: 'olá' }),
    ).resolves.toEqual({ texto: 'olá' });
    await expect(
      registoComEco().executar('eco', ctx, { texto: '' }),
    ).rejects.toMatchObject({ codigo: 'pedido_invalido' });
  });

  it('recusa nomes repetidos e desconhecidos', () => {
    const registo = registoComEco();
    expect(() => registo.registar(registo.obter('eco'))).toThrow(
      'registada duas vezes',
    );
    expect(() => registo.obter('nada')).toThrow(
      expect.objectContaining({ codigo: 'ferramenta_desconhecida' }) as Error,
    );
  });

  it('exporta o catálogo em JSON Schema', () => {
    const [eco] = registoComEco().catalogo();
    expect(eco).toMatchObject({
      nome: 'eco',
      caminho: '/v1/agent/tools/eco',
      entrada: { type: 'object', required: ['texto'] },
    });
  });
});
