import { ErroApi } from '../../common/erros.js';
import type { Tx } from '../../database/database.service.js';
import {
  AutenticacaoCmd,
  AutenticacaoSimulada,
  ConfigCmd,
  emFaltaCmd,
  PIN_DEMONSTRACAO,
} from './autenticacao-cidadao.js';
import { gerarPdfComprovativo } from './comprovativo-pdf.js';
import {
  ErroSubmissao,
  SubmissaoBalcaoOnline,
  SubmissaoSimulada,
} from './submissao-balcao.js';

const semCmd: ConfigCmd = {
  protocolo: '',
  urlBase: '',
  clientId: '',
  samlEntityId: '',
  samlCertificado: '',
  samlChavePrivada: '',
  atributos: '',
  urlRetorno: 'http://api/v1/public/entregas/autenticacao/retorno',
};

const inicio = {
  state: 'estado-aleatorio',
  nonce: 'n',
  verificador: 'v'.repeat(43),
  urlPaginaEntrega: 'http://web/entrega/tok',
};

const esperado = {
  nome: 'Conceição Araújo',
  nif: '123456789',
  telefone: '+351912345567',
};

describe('AutenticacaoSimulada', () => {
  const a = new AutenticacaoSimulada();

  it('leva à página simulada com o state', async () => {
    const { url } = await a.iniciar(inicio);
    expect(url).toBe(
      'http://web/entrega/tok/autorizar?estado=estado-aleatorio',
    );
    expect(a.emFalta()).toEqual([]);
  });

  it('com o PIN de demonstração e o telefone certo devolve o requerente, nível simulado', async () => {
    const id = await a.retorno({
      parametros: { pin: PIN_DEMONSTRACAO, telefone: '912 345 567' },
      nonce: 'n',
      verificador: 'v',
      esperado,
    });
    expect(id).toEqual({
      nif: '123456789',
      nome: 'Conceição Araújo',
      nivel_garantia: 'simulado',
      fornecedor: 'simulacao',
      simulada: true,
    });
  });

  it('PIN errado ou outro telefone → recusa', async () => {
    await expect(
      a.retorno({
        parametros: { pin: '0000', telefone: '912345567' },
        nonce: '',
        verificador: '',
        esperado,
      }),
    ).rejects.toMatchObject({ codigo: 'pin_errado' });
    await expect(
      a.retorno({
        parametros: { pin: PIN_DEMONSTRACAO, telefone: '913000000' },
        nonce: '',
        verificador: '',
        esperado,
      }),
    ).rejects.toMatchObject({ codigo: 'telefone_diferente' });
  });

  it('sem NIF na câmara usa o NIF escrito (se for válido)', async () => {
    const sem = { ...esperado, nif: null, telefone: null };
    await expect(
      a.retorno({
        parametros: { pin: PIN_DEMONSTRACAO, nif: '123456780' },
        nonce: '',
        verificador: '',
        esperado: sem,
      }),
    ).rejects.toMatchObject({ codigo: 'nif_invalido' });
    const id = await a.retorno({
      parametros: { pin: PIN_DEMONSTRACAO, nif: '123456789' },
      nonce: '',
      verificador: '',
      esperado: sem,
    });
    expect(id.nif).toBe('123456789');
  });
});

describe('AutenticacaoCmd (esqueleto)', () => {
  it('sem configuração: "por configurar — falta a credenciação na AMA"', async () => {
    const a = new AutenticacaoCmd(semCmd);
    expect(a.emFalta()).toEqual([
      'CMD_PROTOCOLO',
      'CMD_URL_BASE',
      'CMD_ATRIBUTOS',
    ]);
    const err = await a.iniciar(inicio).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ErroApi);
    expect((err as ErroApi).codigo).toBe('autenticacao_por_configurar');
    expect((err as ErroApi).message).toBe(
      'Autenticação com Chave Móvel Digital por configurar — falta a credenciação na AMA.',
    );
    await expect(a.retorno()).rejects.toMatchObject({
      codigo: 'autenticacao_por_configurar',
    });
  });

  it('o que falta depende do protocolo', () => {
    expect(
      emFaltaCmd({
        ...semCmd,
        protocolo: 'saml',
        urlBase: 'x',
        atributos: 'nif',
      }),
    ).toEqual([
      'CMD_SAML_ENTITY_ID',
      'CMD_SAML_CERTIFICADO',
      'CMD_SAML_CHAVE_PRIVADA',
    ]);
    expect(
      emFaltaCmd({
        ...semCmd,
        protocolo: 'oauth2',
        urlBase: 'x',
        atributos: 'nif',
      }),
    ).toEqual(['CMD_CLIENT_ID']);
  });

  it('configurado em OAuth 2.0 monta o pedido, mas a validação fica por ligar', async () => {
    const a = new AutenticacaoCmd({
      ...semCmd,
      protocolo: 'oauth2',
      urlBase: 'https://preprod.exemplo.pt/',
      clientId: 'cliente',
      atributos: 'nif nome',
    });
    const { url } = await a.iniciar(inicio);
    const u = new URL(url);
    expect(u.origin).toBe('https://preprod.exemplo.pt');
    expect(u.searchParams.get('client_id')).toBe('cliente');
    expect(u.searchParams.get('state')).toBe('estado-aleatorio');
    expect(u.searchParams.get('redirect_uri')).toBe(semCmd.urlRetorno);
    expect(u.searchParams.get('code_challenge_method')).toBe('S256');
    await expect(a.retorno()).rejects.toMatchObject({
      codigo: 'autenticacao_por_ligar',
    });
  });
});

describe('Submissão', () => {
  const tx = {
    query: jest.fn().mockResolvedValue([{ ultimo: 42 }]),
  } as unknown as Tx;
  const pedido = {
    referencia: 'e1',
    municipioId: 'm1',
    tipo: { codigo: 'CP', nome: 'Comunicação prévia' },
    resumo: {
      tipo: { codigo: 'CP', nome: 'Comunicação prévia' },
      requerente: 'Conceição',
      campos: [],
      documentos: { entregues: ['Caderneta predial'], em_falta: [] },
    },
    processoNumero: 'CP 1/2026',
  };
  const id = {
    nif: '123456789',
    nome: 'Conceição',
    nivel_garantia: 'simulado' as const,
    fornecedor: 'simulacao',
    simulada: true,
  };

  it('simulada: número DEMO, documentos e NIF mascarado', async () => {
    const s = new SubmissaoSimulada(
      0,
      Math.random,
      () => new Date('2026-10-22T10:00:00Z'),
    );
    const c = await s.submeter(pedido, id, tx);
    expect(c).toEqual({
      numero_entrada: 'DEMO-2026/000042',
      recebido_em: '2026-10-22T10:00:00.000Z',
      documentos: ['Requerimento — Comunicação prévia', 'Caderneta predial'],
      requerente: { nome: 'Conceição', nif_mascarado: '******789' },
      destino: 'Balcão online da câmara (simulado)',
      simulado: true,
    });
  });

  it('simulada com taxa de falha 1: falha de demonstração', async () => {
    const s = new SubmissaoSimulada(1);
    await expect(s.submeter(pedido, id, tx)).rejects.toBeInstanceOf(
      ErroSubmissao,
    );
  });

  it('balcão real sem configuração: por configurar', async () => {
    const s = new SubmissaoBalcaoOnline({ url: '', credencial: '' });
    expect(s.emFalta()).toEqual(['BALCAO_URL', 'BALCAO_CREDENCIAL']);
    await expect(s.submeter()).rejects.toMatchObject({
      codigo: 'submissao_por_configurar',
    });
  });
});

describe('gerarPdfComprovativo', () => {
  it('gera o PDF com a marca de simulação', async () => {
    const pdf = await gerarPdfComprovativo({
      municipio: 'Município de Teste',
      comprovativo: {
        numero_entrada: 'DEMO-2026/000042',
        recebido_em: '2026-10-22T10:00:00.000Z',
        documentos: ['Requerimento — Comunicação prévia'],
        requerente: { nome: 'Conceição Araújo', nif_mascarado: '******789' },
        destino: 'Balcão online da câmara (simulado)',
        simulado: true,
      },
      resumo: {
        tipo: { codigo: 'CP', nome: 'Comunicação prévia' },
        requerente: 'Conceição Araújo',
        campos: [{ rotulo: 'Morada da obra', valor: 'Rua de São Dâmaso, 12' }],
        documentos: { entregues: [], em_falta: ['Termo de responsabilidade'] },
      },
      autorizacao: {
        em: new Date('2026-10-22T09:59:00Z'),
        fornecedor: 'simulacao',
        nivel_garantia: 'simulado',
        consentimento_em: new Date('2026-10-22T09:58:00Z'),
      },
      confirmacao: { em: new Date('2026-10-22T09:50:00Z'), canal: 'telefone' },
      processoNumero: 'CP 1/2026',
    });
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(1500);
  });
});
