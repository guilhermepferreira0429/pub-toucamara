import {
  ErroGestaoDocumental,
  esperaAposFalha,
  esquemaConfigGd,
  MAX_TENTATIVAS,
  mensagemErro,
  numeroGd,
  ProcessoGd,
} from './gestao-documental.js';
import { GestaoDocumentalHttp } from './gestao-documental-http.js';
import { GestaoDocumentalSimulada } from './gestao-documental-simulada.js';

/** BD falsa: guarda as queries e responde como o Postgres responderia. */
function bdFalsa() {
  const queries: { sql: string; params: unknown[] }[] = [];
  let contador = 0;
  let id = 0;
  return {
    queries,
    query: <T>(sql: string, params: unknown[] = []): Promise<T[]> => {
      queries.push({ sql, params });
      if (sql.includes('gd_simulado_contadores')) {
        return Promise.resolve([{ ultimo: ++contador }] as T[]);
      }
      return Promise.resolve([{ id: String(++id) }] as T[]);
    },
  };
}

const PROCESSO: ProcessoGd = {
  id: 'p1',
  numero: 'CP 1/2026',
  tipo_codigo: 'CP',
  tipo_nome: 'Comunicação prévia',
  assunto: 'Porta',
  morada: 'Rua A',
  freguesia: null,
  fase: 'entrada',
  requerente: 'Ana',
  criado_em: '2026-10-20T10:00:00.000Z',
};

describe('numeroGd', () => {
  it("formato típico '2026/E/012345'", () => {
    expect(numeroGd(2026, 12345)).toBe('2026/E/012345');
    expect(numeroGd(2026, 1)).toBe('2026/E/000001');
  });
});

describe('esperaAposFalha', () => {
  it('15, 30, 60, 120 min e desiste à quinta', () => {
    const min = (t: number) => (esperaAposFalha(t) ?? 0) / 60_000;
    expect([1, 2, 3, 4].map(min)).toEqual([15, 30, 60, 120]);
    expect(MAX_TENTATIVAS).toBe(5);
    expect(esperaAposFalha(5)).toBeNull();
    expect(esperaAposFalha(9)).toBeNull();
  });
});

describe('esquemaConfigGd', () => {
  it('aceita os adaptadores conhecidos e a taxa entre 0 e 1', () => {
    expect(
      esquemaConfigGd.parse({ adaptador: 'simulado', taxa_falha: 0.3 }),
    ).toEqual({ adaptador: 'simulado', taxa_falha: 0.3 });
    expect(esquemaConfigGd.safeParse({ adaptador: 'mydoc' }).success).toBe(
      false,
    );
    expect(
      esquemaConfigGd.safeParse({ adaptador: 'simulado', taxa_falha: 2 })
        .success,
    ).toBe(false);
    expect(
      esquemaConfigGd.safeParse({ adaptador: 'nenhum', outro: 1 }).success,
    ).toBe(false);
  });
});

describe('mensagemErro', () => {
  it('uma linha, no máximo 500 caracteres', () => {
    expect(mensagemErro(new Error('a\n  b'))).toBe('a b');
    expect(mensagemErro('x'.repeat(900))).toHaveLength(500);
    expect(mensagemErro(new Error(''))).toBe('Erro desconhecido.');
  });
});

describe('GestaoDocumentalSimulada', () => {
  const agora = () => new Date('2026-10-20T10:00:00Z');

  it('regista com o número da série do município e grava o que recebeu', async () => {
    const db = bdFalsa();
    const gd = new GestaoDocumentalSimulada(db, 'm1', 0, () => 0.5, agora);
    expect(await gd.registarProcesso(PROCESSO)).toEqual({
      gd_id: '2026/E/000001',
    });
    expect(await gd.registarProcesso({ ...PROCESSO, id: 'p2' })).toEqual({
      gd_id: '2026/E/000002',
    });
    const r = await gd.anexarDocumento('2026/E/000001', {
      id: 'd1',
      nome: 'Planta',
      ficheiro_key: 'k',
      mime: 'application/pdf',
      tamanho: 10,
      origem: 'gerado',
      recebido_em: '2026-10-20T10:00:00.000Z',
    });
    expect(r.referencia).toMatch(/^2026\/E\/000001\/A\d+$/);
    await gd.atualizarEstado('2026/E/000001', 'apreciacao');

    const registos = db.queries.filter((q) =>
      q.sql.includes('gd_simulado_registos'),
    );
    expect(registos.map((q) => q.params[2])).toEqual([
      'registar',
      'registar',
      'anexar',
      'estado',
    ]);
    expect(JSON.parse(registos[0].params[3] as string)).toMatchObject({
      numero: 'CP 1/2026',
    });
    expect(registos.every((q) => q.params[0] === 'm1')).toBe(true);
  });

  it('falha de propósito na fração configurada, sem gravar nada', async () => {
    const db = bdFalsa();
    const sorteios = [0.1, 0.9];
    const gd = new GestaoDocumentalSimulada(
      db,
      'm1',
      0.5,
      () => sorteios.shift()!,
      agora,
    );
    await expect(gd.registarProcesso(PROCESSO)).rejects.toBeInstanceOf(
      ErroGestaoDocumental,
    );
    expect(db.queries).toHaveLength(0);
    await expect(gd.registarProcesso(PROCESSO)).resolves.toEqual({
      gd_id: '2026/E/000001',
    });
  });

  it('taxa 1 falha sempre; taxa 0 nunca', async () => {
    const sempre = new GestaoDocumentalSimulada(bdFalsa(), 'm1', 1);
    await expect(sempre.atualizarEstado('x', 'decisao')).rejects.toThrow(
      /simulada/,
    );
    const nunca = new GestaoDocumentalSimulada(bdFalsa(), 'm1', 0, () => 0);
    await expect(
      nunca.atualizarEstado('x', 'decisao'),
    ).resolves.toBeUndefined();
  });
});

describe('GestaoDocumentalHttp (esqueleto)', () => {
  it('não faz chamadas: recusa com ErroGestaoDocumental', async () => {
    const gd = new GestaoDocumentalHttp({
      url: 'https://gd.exemplo.pt/api',
      credencial: 'x',
      livro: 'E',
      classificacoes: {},
      etapas: {},
      lerFicheiro: () => Promise.resolve(Buffer.alloc(0)),
    });
    await expect(gd.registarProcesso(PROCESSO)).rejects.toBeInstanceOf(
      ErroGestaoDocumental,
    );
  });
});
