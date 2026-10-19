import { ConfigService } from '@nestjs/config';
import { ErroApi } from '../common/erros.js';
import {
  blocoFicheiro,
  LeituraDocumento,
  VisaoService,
} from './visao.service.js';

const config = (apiKey: string) =>
  ({
    getOrThrow: () => ({ apiKey, modelo: 'modelo-de-teste' }),
  }) as unknown as ConfigService;

const leitura: LeituraDocumento = {
  tipo_reconhecido: 'Certidão do registo predial',
  corresponde_ao_esperado: true,
  confianca: 'alta',
  legivel: true,
  data_emissao: '2026-07-01',
  entidade_emissora: 'Conservatória do Registo Predial',
  tem_assinatura_ou_carimbo: true,
  nif_visivel: null,
  observacoes: 'Está legível.',
};

/** O que se verifica do pedido mandado à API. */
interface Pedido {
  model: string;
  fallbacks: string;
  output_config: { effort: string };
  messages: { content: [unknown, { text: string }] }[];
}

/** Cliente simulado: só o que o serviço usa. */
function comCliente(resposta: object) {
  const svc = new VisaoService(config(''));
  const parse = jest
    .fn<Promise<object>, [Pedido]>()
    .mockResolvedValue(resposta);
  Object.assign(svc, { cliente: { beta: { messages: { parse } } } });
  return { svc, parse };
}

const ficheiro = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

describe('VisaoService', () => {
  it('sem chave: 503 ia_indisponivel', async () => {
    const svc = new VisaoService(config(''));
    expect(svc.disponivel).toBe(false);
    await expect(
      svc.lerDocumento({ ficheiro, mime: 'image/jpeg', esperado: 'X' }),
    ).rejects.toMatchObject({ codigo: 'ia_indisponivel' });
  });

  it('manda a imagem e o documento esperado, devolve a leitura', async () => {
    const { svc, parse } = comCliente({
      stop_reason: 'end_turn',
      parsed_output: leitura,
    });
    const r = await svc.lerDocumento({
      ficheiro,
      mime: 'image/jpeg',
      esperado: 'Certidão do registo predial',
      verificacoes: ['data de emissão (validade)'],
    });
    expect(r).toEqual(leitura);
    const pedido = parse.mock.calls[0][0];
    expect(pedido.model).toBe('modelo-de-teste');
    expect(pedido.output_config.effort).toBe('medium');
    expect(pedido.fallbacks).toBe('default');
    expect(pedido.messages[0].content[0]).toEqual({
      type: 'image',
      source: {
        type: 'base64',
        media_type: 'image/jpeg',
        data: ficheiro.toString('base64'),
      },
    });
    expect(pedido.messages[0].content[1].text).toContain(
      'Certidão do registo predial',
    );
  });

  it('recusa e resposta sem formato dão erro', async () => {
    await expect(
      comCliente({
        stop_reason: 'refusal',
        stop_details: { category: 'x' },
      }).svc.lerDocumento({ ficheiro, mime: 'image/jpeg', esperado: 'X' }),
    ).rejects.toMatchObject({ codigo: 'ia_recusou' });
    await expect(
      comCliente({
        stop_reason: 'end_turn',
        parsed_output: null,
      }).svc.lerDocumento({ ficheiro, mime: 'image/jpeg', esperado: 'X' }),
    ).rejects.toBeInstanceOf(ErroApi);
  });

  it('PDF vai como documento', () => {
    expect(
      blocoFicheiro(Buffer.from('%PDF-'), 'application/pdf'),
    ).toMatchObject({
      type: 'document',
      source: { media_type: 'application/pdf' },
    });
  });
});
