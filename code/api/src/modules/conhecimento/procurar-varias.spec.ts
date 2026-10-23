import { ConhecimentoService } from './conhecimento.service.js';

const trecho = (id: string) => ({
  trecho_id: id,
  referencia: null,
  texto: id,
  titulo: id,
  url: `https://x/${id}`,
  tipo_fonte: 'pagina',
  entidade: 'Câmara',
  lida_em: '2026-10-01',
  pontuacao: 0.01,
});

describe('procurarVarias', () => {
  function servico(porConsulta: Record<string, string[]>) {
    const s = new ConhecimentoService({} as never, {} as never);
    const procurar = jest
      .spyOn(s, 'procurar')
      .mockImplementation(async (_m: string, q: string) => {
        const ids = porConsulta[q] ?? [];
        return { sem_fonte: ids.length === 0, respostas: [], trechos: ids.map(trecho) };
      });
    return { s, procurar };
  }

  it('junta as listas: o que aparece em várias consultas sobe', async () => {
    const { s, procurar } = servico({
      'anexo no quintal': ['noticia', 'rjue-6a'],
      'obras de escassa relevância urbanística': ['rjue-6a', 'rjue-4'],
    });
    const r = await s.procurarVarias('m', ['anexo no quintal', 'obras de escassa relevância urbanística'], 3);
    expect(procurar).toHaveBeenCalledTimes(2);
    expect(r.sem_fonte).toBe(false);
    expect(r.trechos.map((t) => t.trecho_id)).toEqual(['rjue-6a', 'noticia', 'rjue-4']);
  });

  it('sem termos úteis é a pesquisa normal; repetidos contam uma vez', async () => {
    const { s, procurar } = servico({ obras: ['a'] });
    await s.procurarVarias('m', ['obras', ' obras ', 'x'], 5);
    expect(procurar).toHaveBeenCalledTimes(1);
    expect(procurar).toHaveBeenCalledWith('m', 'obras', 5);
  });

  it('sem nada em nenhuma consulta dá sem_fonte', async () => {
    const { s } = servico({});
    const r = await s.procurarVarias('m', ['aaa', 'bbb'], 5);
    expect(r.sem_fonte).toBe(true);
  });
});
