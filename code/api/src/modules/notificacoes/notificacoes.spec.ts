import type { DatabaseService } from '../../database/database.service.js';
import type {
  PushService,
  ResultadoPush,
} from '../app-municipe/push.service.js';
import {
  CanalNotificacao,
  CanalPush,
  NotificacoesService,
} from './notificacoes.service.js';

const MUNICIPE = '11111111-1111-4111-8111-111111111111';

function montar(resultadoPush: ResultadoPush) {
  const paraMunicipe = jest.fn().mockResolvedValue(resultadoPush);
  const push = new CanalPush({ paraMunicipe } as unknown as PushService);
  const enviarSms = jest.fn().mockResolvedValue({ enviada: true, id: 'msg-1' });
  const sms: CanalNotificacao = { nome: 'sms', enviar: enviarSms };
  const db = {
    query: jest.fn().mockResolvedValue([
      {
        municipio_id: 'm',
        telefone_e164: '+351912345678',
        aceita_avisos: true,
        anonimizado: false,
      },
    ]),
  } as unknown as DatabaseService;
  const servico = new NotificacoesService(db, [push, sms]);
  return { servico, paraMunicipe, enviarSms };
}

const aviso = {
  titulo: 'Obras perto de si',
  corpo: 'CM Teste: Obras na Rua X. Mais info: https://t.pt/a/1',
  link: 'https://t.pt/a/1',
  tipo: 'agora:obras',
};

describe('NotificacoesService com push e SMS', () => {
  it('com a app vai por push (sem o link no texto) e não manda SMS', async () => {
    const { servico, paraMunicipe, enviarSms } = montar({
      dispositivos: 1,
      enviados: 1,
    });
    const r = await servico.notificar(MUNICIPE, aviso, { chave: 'k1' });
    expect(r).toEqual({ enviada: true, canal: 'push', id: null });
    expect(paraMunicipe).toHaveBeenCalledWith(MUNICIPE, {
      tipo: 'avisos',
      titulo: 'Obras perto de si',
      corpo: 'CM Teste: Obras na Rua X.',
      link: 'https://t.pt/a/1',
      origem: 'agora:obras',
      chave: 'notificacao:k1',
    });
    expect(enviarSms).not.toHaveBeenCalled();
  });

  it('sem a app cai no SMS', async () => {
    const { servico, enviarSms } = montar({
      dispositivos: 0,
      enviados: 0,
      motivo: 'sem_app',
    });
    const r = await servico.notificar(MUNICIPE, aviso);
    expect(r).toEqual({ enviada: true, canal: 'sms', id: 'msg-1' });
    expect(enviarSms).toHaveBeenCalled();
  });

  it('push repetido (já tinha saído) não manda SMS por cima', async () => {
    const { servico, enviarSms } = montar({
      dispositivos: 1,
      enviados: 0,
      motivo: 'ja_enviado',
    });
    const r = await servico.notificar(MUNICIPE, aviso, { chave: 'k1' });
    expect(r.canal).toBe('push');
    expect(enviarSms).not.toHaveBeenCalled();
  });

  it('urgente vai no canal urgente', async () => {
    const { servico, paraMunicipe } = montar({ dispositivos: 1, enviados: 1 });
    await servico.notificar(MUNICIPE, aviso, { urgente: true });
    expect(paraMunicipe).toHaveBeenCalledWith(
      MUNICIPE,
      expect.objectContaining({ tipo: 'urgente' }),
    );
  });
});
