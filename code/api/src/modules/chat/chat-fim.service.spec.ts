import { ChatFimService, FILA_FECHAR_CHATS, INATIVIDADE_CHAT_MIN } from './chat-fim.service.js';

describe('ChatFimService', () => {
  function montar(linhas: { id: string; resumir: boolean }[]) {
    const db = { query: jest.fn().mockResolvedValue(linhas) };
    const jobs = { trabalhar: jest.fn(), agendar: jest.fn(), enviar: jest.fn().mockResolvedValue('j') };
    const s = new ChatFimService(db as never, jobs as never);
    return { s, db, jobs };
  }

  it('agenda o fecho a cada 5 minutos', () => {
    const { s, jobs } = montar([]);
    s.onModuleInit();
    expect(jobs.agendar).toHaveBeenCalledWith(FILA_FECHAR_CHATS, '*/5 * * * *');
    expect(jobs.trabalhar).toHaveBeenCalledWith(FILA_FECHAR_CHATS, expect.any(Function));
  });

  it('fecha as conversas paradas e só manda para resumo as que contam', async () => {
    const { s, db, jobs } = montar([
      { id: 'a', resumir: true },
      { id: 'b', resumir: false },
    ]);
    expect(await s.fechar()).toEqual({ fechadas: 2, resumos: 1 });
    expect(db.query.mock.calls[0][1]).toEqual([INATIVIDADE_CHAT_MIN, 200]);
    expect(jobs.enviar).toHaveBeenCalledTimes(1);
    expect(jobs.enviar).toHaveBeenCalledWith('resumir_conversa', { conversaId: 'a' }, { singletonKey: 'a' });
  });
});
