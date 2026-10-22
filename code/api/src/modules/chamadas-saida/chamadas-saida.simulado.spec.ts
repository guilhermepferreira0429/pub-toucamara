import type { ConfigService } from '@nestjs/config';
import type { DatabaseService, Tx } from '../../database/database.service.js';
import type { AuditoriaService } from '../auditoria/auditoria.service.js';
import type { LinksCurtosService } from '../comunicacao/links-curtos.service.js';
import type { MensagensService } from '../comunicacao/mensagens.service.js';
import type { RetomarService } from '../conversas/retomar.service.js';
import type { MunicipiosService } from '../municipios/municipios.service.js';
import {
  ChamadasSaidaService,
  ERRO_SIMULADA,
} from './chamadas-saida.service.js';

/*
 * A barreira das chamadas para números simulados (avisos de emergência com a
 * fonte simulada dos operadores): com o ElevenLabs todo configurado, a
 * chamada nunca é pedida e o SMS de recurso também não sai.
 */
function montar(simulado: boolean | undefined) {
  const linha = {
    id: 'c1',
    municipio_id: 'm1',
    municipe_id: 'p1',
    telefone_e164: '+351919912345',
    motivo: 'campanha',
    processo_id: null,
    pedido_id: null,
    contexto: {},
    recurso: { corpo: 'x', chave: 'k', motivo: 'aviso', relacionado: {} },
    estado: 'agendada',
    tentativas: 0,
    forcar_horario: true,
    recurso_sms_id: null,
    simulado,
    aceita_chamadas: true,
    respondido: null,
    agent_id: 'agent_1',
    config: { ativo: true, motivos: [], numero_id: 'num_1', via: 'twilio' },
  };
  const consultas: string[] = [];
  const query = jest.fn((sql: string) => {
    consultas.push(sql);
    return Promise.resolve(sql.includes('FOR UPDATE OF c') ? [linha] : []);
  });
  const tx = { query } as unknown as Tx;
  const db = {
    transaction: <T>(fn: (t: Tx) => Promise<T>) => fn(tx),
    query,
  } as unknown as DatabaseService;
  const sms = jest.fn(() => Promise.resolve('sms1'));
  const config = {
    get: () => ({ elevenlabsApiKey: 'xi_chave' }),
  } as unknown as ConfigService;
  const municipios = {
    porId: () =>
      Promise.resolve({
        id: 'm1',
        slug: 'x',
        nome: 'X',
        fuso: 'Europe/Lisbon',
      }),
    feriados: () => Promise.resolve([]),
  } as unknown as MunicipiosService;
  const retomar = {
    inicioChamada: () => Promise.resolve({ dynamic_variables: {} }),
  } as unknown as RetomarService;
  const servico = new ChamadasSaidaService(
    db,
    config,
    municipios,
    { sms } as unknown as MensagensService,
    {} as LinksCurtosService,
    retomar,
    {} as AuditoriaService,
  );
  const buscar = jest.fn(() => {
    throw new Error('Pedido ao ElevenLabs para um número simulado!');
  });
  servico.buscar = buscar;
  return { servico, buscar, consultas, sms };
}

describe('ChamadasSaidaService · números simulados', () => {
  it('nunca liga a um número simulado (fica cancelada com o motivo) nem manda o SMS de recurso', async () => {
    const { servico, buscar, consultas, sms } = montar(true);
    await expect(servico.despachar('c1')).resolves.toBe(false);
    expect(buscar).not.toHaveBeenCalled();
    expect(sms).not.toHaveBeenCalled();
    expect(
      consultas.some((q) => q.includes('SET estado = $2, terminada_em')),
    ).toBe(true);
    expect(ERRO_SIMULADA).toMatch(/nunca sai/);
  });

  it('na dúvida (marca em falta) também não liga', async () => {
    const { servico, buscar } = montar(undefined);
    await servico.despachar('c1');
    expect(buscar).not.toHaveBeenCalled();
  });

  it('o mesmo número sem a marca (pessoa real) é ligado', async () => {
    const { servico, buscar } = montar(false);
    buscar.mockImplementation(
      () =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              success: true,
              message: 'ok',
              conversation_id: 'conv_1',
              callSid: 'CA1',
            }),
          ),
        ) as never,
    );
    await expect(servico.despachar('c1')).resolves.toBe(true);
    expect(buscar).toHaveBeenCalledTimes(1);
  });
});
