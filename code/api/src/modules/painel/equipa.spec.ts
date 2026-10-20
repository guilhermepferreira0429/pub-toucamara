import { agruparPorServico } from './equipa.service.js';

describe('agruparPorServico', () => {
  const servico = (id: string, nome: string) => ({
    id,
    nome,
    entidade: 'Câmara',
    email: null,
    telefone: null,
  });
  const membro = (id: string, servico_id: string | null) => ({
    id,
    nome: `Pessoa ${id}`,
    perfil: 'tecnico',
    foto_url: null,
    servico_id,
  });

  it('põe cada membro no seu serviço, pela ordem, e os outros em sem_servico', () => {
    const r = agruparPorServico(
      [servico('s1', 'Obras'), servico('s2', 'Vias')],
      [
        membro('a', 's2'),
        membro('b', null),
        membro('c', 's2'),
        membro('d', 'x'),
      ],
    );
    expect(r.itens.map((s) => [s.id, s.tecnicos.map((t) => t.id)])).toEqual([
      ['s1', []],
      ['s2', ['a', 'c']],
    ]);
    // Serviço desconhecido (de outro município) conta como sem serviço.
    expect(r.sem_servico.map((t) => t.id)).toEqual(['b', 'd']);
    expect(r.itens[1].tecnicos[0]).toEqual({
      id: 'a',
      nome: 'Pessoa a',
      perfil: 'tecnico',
      foto_url: null,
    });
  });
});
