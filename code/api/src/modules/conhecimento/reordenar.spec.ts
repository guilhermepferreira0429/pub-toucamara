import { aplicarOrdem, ReordenarService } from './reordenar.service.js';

const t = (id: string) => ({ trecho_id: id, titulo: id, entidade: 'Câmara', texto: `texto ${id}`, referencia: null });

describe('aplicarOrdem', () => {
  it('segue a ordem do modelo e ignora códigos inválidos ou repetidos', () => {
    const c = [t('a'), t('b'), t('c')];
    expect(aplicarOrdem(c, ['T3', 'x', 'T9', 'T1', 'T3'], 5).map((x) => x.trecho_id)).toEqual(['c', 'a']);
  });
  it('sem nenhum escolhido fica a ordem da pesquisa', () => {
    expect(aplicarOrdem([t('a'), t('b')], [], 1).map((x) => x.trecho_id)).toEqual(['a']);
  });
});

describe('ReordenarService', () => {
  it('reordena com a resposta do modelo', async () => {
    const claude = { disponivel: true, extrair: jest.fn().mockResolvedValue({ relevantes: ['T2'] }) };
    const s = new ReordenarService(claude as never);
    const r = await s.reordenar('anexo no quintal', ['obras de escassa relevância'], [t('noticia'), t('rjue')], 8);
    expect(r.map((x) => x.trecho_id)).toEqual(['rjue']);
    expect(claude.extrair.mock.calls[0][1].tarefa).toBe('reordenar_pesquisa');
  });
  it('se o modelo falhar, fica a ordem da pesquisa', async () => {
    const claude = { disponivel: true, extrair: jest.fn().mockRejectedValue(new Error('x')) };
    const s = new ReordenarService(claude as never);
    const r = await s.reordenar('p', [], [t('a'), t('b'), t('c')], 2);
    expect(r.map((x) => x.trecho_id)).toEqual(['a', 'b']);
  });
  it('sem IA não chama nada', async () => {
    const claude = { disponivel: false, extrair: jest.fn() };
    const s = new ReordenarService(claude as never);
    await s.reordenar('p', [], [t('a'), t('b')], 8);
    expect(claude.extrair).not.toHaveBeenCalled();
  });
});
