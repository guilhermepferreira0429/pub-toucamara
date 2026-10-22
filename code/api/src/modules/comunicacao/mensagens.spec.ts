import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../../database/database.service.js';
import { JobsService } from '../../jobs/jobs.service.js';
import { MensagensService } from './mensagens.service.js';

const SID = 'AC123';

function montar(
  twilio = { accountSid: SID, authToken: 'tok' },
  linha: Record<string, unknown> = { simulado: false },
) {
  const query = jest.fn((sql: string) =>
    Promise.resolve(
      sql.startsWith('SELECT')
        ? [
            {
              destino: '+351912345678',
              corpo: 'Ola',
              estado: 'pendente',
              canal: 'sms',
              ...linha,
            },
          ]
        : [],
    ),
  );
  const config = {
    get: () => 'production',
    getOrThrow: () => ({
      smsProvider: 'twilio',
      smsRemetente: 'TouCamara',
      smsTransliterar: true,
      twilio,
      smtp: {},
    }),
  };
  const servico = new MensagensService(
    { query } as unknown as DatabaseService,
    {} as JobsService,
    config as unknown as ConfigService,
  );
  return { servico, query };
}

function resposta(status: number, corpo: unknown) {
  return new Response(JSON.stringify(corpo), { status });
}

describe('MensagensService · Twilio', () => {
  const fetchOriginal = global.fetch;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock;
  });
  afterEach(() => {
    global.fetch = fetchOriginal;
  });

  it('envia com o remetente alfanumérico e guarda o SID', async () => {
    fetchMock.mockResolvedValue(resposta(201, { sid: 'SM999' }));
    const { servico, query } = montar();

    await servico.enviarAgora('m1');

    const [url, init] = fetchMock.mock.calls[0] as [
      string,
      { headers: Record<string, string>; body: URLSearchParams },
    ];
    expect(url).toBe(
      `https://api.twilio.com/2010-04-01/Accounts/${SID}/Messages.json`,
    );
    expect(init.headers.Authorization).toBe(
      `Basic ${Buffer.from(`${SID}:tok`).toString('base64')}`,
    );
    const corpo = new URLSearchParams(init.body);
    expect(corpo.get('To')).toBe('+351912345678');
    expect(corpo.get('From')).toBe('TouCamara');
    expect(corpo.get('Body')).toBe('Ola');
    expect(query).toHaveBeenLastCalledWith(
      expect.stringContaining("estado = 'enviada'"),
      ['m1', 'SM999'],
    );
  });

  it('recusa definitiva (4xx): fica falhou com o erro do Twilio', async () => {
    fetchMock.mockResolvedValue(
      resposta(400, { code: 21211, message: "Invalid 'To' Phone Number" }),
    );
    const { servico, query } = montar();

    await servico.enviarAgora('m1');

    expect(query).toHaveBeenLastCalledWith(
      expect.stringContaining("estado = 'falhou'"),
      ['m1', "Twilio 400 (21211): Invalid 'To' Phone Number"],
    );
  });

  it('429 e 5xx lançam, para a fila repetir', async () => {
    const { servico, query } = montar();
    fetchMock.mockResolvedValue(resposta(503, {}));
    await expect(servico.enviarAgora('m1')).rejects.toThrow('Twilio 503');
    fetchMock.mockResolvedValue(resposta(429, { message: 'Too Many' }));
    await expect(servico.enviarAgora('m1')).rejects.toThrow('Twilio 429');
    expect(query).toHaveBeenCalledTimes(2); // só os SELECT
  });

  it('sem credenciais não chama o Twilio e fica falhou', async () => {
    const { servico, query } = montar({ accountSid: '', authToken: '' });

    await servico.enviarAgora('m1');

    expect(fetchMock).not.toHaveBeenCalled();
    expect(query).toHaveBeenLastCalledWith(
      expect.stringContaining("estado = 'falhou'"),
      ['m1', expect.stringContaining('TWILIO_ACCOUNT_SID')],
    );
  });

  describe('destinos simulados (avisos de emergência com a fonte simulada)', () => {
    /** O fetch falso: qualquer pedido é uma falha do teste. */
    const proibido = () => {
      throw new Error('Pedido ao fornecedor para um número simulado!');
    };

    it('com o Twilio configurado, um SMS simulado fica enviado (simulado) e não sai', async () => {
      fetchMock.mockImplementation(proibido);
      const { servico, query } = montar(undefined, {
        destino: '+351919912345',
        simulado: true,
      });

      await servico.enviarAgora('m1');

      expect(fetchMock).not.toHaveBeenCalled();
      expect(query).toHaveBeenLastCalledWith(
        expect.stringMatching(/estado = 'enviada'.*provider_id = \$2/s),
        ['m1', 'simulado'],
      );
    });

    it('WhatsApp simulado também não sai', async () => {
      fetchMock.mockImplementation(proibido);
      const { servico } = montar(undefined, {
        canal: 'whatsapp',
        simulado: true,
      });
      await servico.enviarAgora('m1');
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('na dúvida (marca em falta) não se envia', async () => {
      fetchMock.mockImplementation(proibido);
      const { servico } = montar(undefined, { simulado: undefined });
      await servico.enviarAgora('m1');
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('a gama de demonstração (+351 910 000 xxx) também não sai (provider demonstracao)', async () => {
      fetchMock.mockImplementation(proibido);
      const { servico, query } = montar(undefined, {
        destino: '+351910000123',
        simulado: false,
      });
      await servico.enviarAgora('m1');
      expect(fetchMock).not.toHaveBeenCalled();
      expect(query).toHaveBeenLastCalledWith(
        expect.stringContaining("estado = 'enviada'"),
        ['m1', 'demonstracao'],
      );
    });

    it('o mesmo número sem a marca (pessoa real) sai normalmente', async () => {
      fetchMock.mockResolvedValue(resposta(201, { sid: 'SMreal' }));
      const { servico, query } = montar(undefined, {
        destino: '+351919912345',
        simulado: false,
      });
      await servico.enviarAgora('m1');
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(query).toHaveBeenLastCalledWith(
        expect.stringContaining("estado = 'enviada'"),
        ['m1', 'SMreal'],
      );
    });
  });
});
