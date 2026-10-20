import type { ConfigService } from '@nestjs/config';
import { ErroApi } from '../../common/erros.js';
import type { DatabaseService, Tx } from '../../database/database.service.js';
import type { AuditoriaService } from '../auditoria/auditoria.service.js';
import type { MelhoriasService } from '../conhecimento/melhorias.service.js';
import type {
  Municipio,
  MunicipiosService,
} from '../municipios/municipios.service.js';
import { CONSULTAS, esquemaApi, ferramentasApi } from './catalogo.js';
import { ContextoConsulta, corresponde, escolher } from './consulta.js';
import { PerguntasChefiaService } from './perguntas-chefia.service.js';

const M: Municipio = {
  id: '00000000-0000-4000-8000-00000000000a',
  slug: 'a',
  nome: 'A',
  fuso: 'Europe/Lisbon',
};
const OUTRO = '00000000-0000-4000-8000-00000000000b';
const HOJE = '2026-10-19';

/** Todos os parâmetros a null (a API manda-os todos com strict). */
function nulos(nome: string, e: Record<string, unknown> = {}) {
  const c = CONSULTAS.find((x) => x.nome === nome)!;
  return {
    ...Object.fromEntries(Object.keys(c.entrada.shape).map((k) => [k, null])),
    ...e,
  };
}

/** Uma linha que responde 0 a qualquer coluna (e hoje às datas). */
const DATAS = new Set(['entrada', 'prazo_fim', 'registada']);
const linhaZero = new Proxy(
  {},
  {
    get: (_, k) => {
      if (k === 'then' || k === 'decisao') return undefined;
      return typeof k === 'string' && DATAS.has(k) ? HOJE : 0;
    },
  },
);

function contexto() {
  const chamadas: { sql: string; params: unknown[] }[] = [];
  const municipiosVistos: string[] = [];
  const db: Pick<Tx, 'query'> = {
    query: <T>(sql: string, params: unknown[] = []) => {
      chamadas.push({ sql, params });
      return Promise.resolve([linhaZero] as T[]);
    },
  };
  const painel = (nome: string) => (id: string) => {
    municipiosVistos.push(`${nome}:${id}`);
    return Promise.resolve(nome === 'trabalho' ? linhaZero : []);
  };
  const ctx = {
    municipio: M,
    hoje: HOJE,
    feriados: new Set<string>(),
    db,
    painel: {
      resultadosPorCanal: painel('resultadosPorCanal'),
      resultadosPorBalde: painel('resultadosPorBalde'),
      trabalho: painel('trabalho'),
      temas: painel('temas'),
      processosFases: painel('processosFases'),
      ocorrenciasAbertas: (id: string) => {
        municipiosVistos.push(`ocorrenciasAbertas:${id}`);
        return Promise.resolve(0);
      },
    },
    melhorias: {
      resumo: (id: string) => {
        municipiosVistos.push(`melhorias:${id}`);
        return Promise.resolve({});
      },
    },
  } as unknown as ContextoConsulta;
  return { ctx, chamadas, municipiosVistos };
}

describe('catálogo das consultas', () => {
  it('tem entre 10 e 15 consultas, com nomes únicos', () => {
    const nomes = CONSULTAS.map((c) => c.nome);
    expect(new Set(nomes).size).toBe(nomes.length);
    expect(nomes.length).toBeGreaterThanOrEqual(10);
    expect(nomes.length).toBeLessThanOrEqual(15);
  });

  it('nenhuma consulta tem parâmetro de município', () => {
    for (const c of CONSULTAS) {
      expect(Object.keys(c.entrada.shape).join(',')).not.toMatch(/municipio/i);
    }
  });

  it('as definições para a API são strict, sem extras e sem restrições não suportadas', () => {
    const verificar = (s: unknown): void => {
      if (Array.isArray(s)) return s.forEach(verificar);
      if (!s || typeof s !== 'object') return;
      const o = s as Record<string, unknown>;
      for (const k of [
        'minimum',
        'maximum',
        'minLength',
        'maxLength',
        'maxItems',
        'pattern',
        '$schema',
      ]) {
        expect(o).not.toHaveProperty(k);
      }
      if (o.type === 'object') {
        expect(o.additionalProperties).toBe(false);
        expect([...(o.required as string[])].sort()).toEqual(
          Object.keys(o.properties as object).sort(),
        );
      }
      Object.values(o).forEach(verificar);
    };
    const ferramentas = ferramentasApi() as unknown as {
      name: string;
      strict: boolean;
      input_schema: unknown;
    }[];
    expect(ferramentas.map((f) => f.name)).toContain('responder');
    for (const f of ferramentas) {
      expect(f.strict).toBe(true);
      verificar(f.input_schema);
    }
  });
});

describe('validação dos parâmetros', () => {
  it.each(CONSULTAS.map((c) => [c.nome]))(
    '%s: aceita tudo a null e recusa chaves a mais (ex.: municipio_id)',
    (nome) => {
      const c = CONSULTAS.find((x) => x.nome === nome)!;
      expect(c.entrada.safeParse(nulos(nome)).success).toBe(true);
      expect(
        c.entrada.safeParse({ ...nulos(nome), municipio_id: OUTRO }).success,
      ).toBe(false);
      expect(c.entrada.safeParse({}).success).toBe(false);
    },
  );

  it('recusa valores fora do esquema', () => {
    const c = (n: string) => CONSULTAS.find((x) => x.nome === n)!.entrada;
    expect(
      c('listar_processos').safeParse(
        nulos('listar_processos', { limite: 500 }),
      ).success,
    ).toBe(false);
    expect(
      c('contar_processos').safeParse(
        nulos('contar_processos', { fase: 'xpto' }),
      ).success,
    ).toBe(false);
    expect(
      c('conversas').safeParse(nulos('conversas', { de: 'ontem' })).success,
    ).toBe(false);
    expect(
      c('conversas').safeParse(nulos('conversas', { de: '2026-02-30' }))
        .success,
    ).toBe(false);
    expect(
      c('contar_processos').safeParse(
        nulos('contar_processos', { a_terminar_dias_uteis: 0 }),
      ).success,
    ).toBe(false);
    expect(
      c('contar_processos').safeParse(
        nulos('contar_processos', { tipo: 'x'.repeat(200) }),
      ).success,
    ).toBe(false);
  });
});

describe('o município é sempre o do pedido', () => {
  it.each(CONSULTAS.map((c) => [c.nome]))(
    '%s: todas as queries levam o município do contexto em $1',
    async (nome) => {
      const c = CONSULTAS.find((x) => x.nome === nome)!;
      const { ctx, chamadas, municipiosVistos } = contexto();
      await c.executar(ctx, c.entrada.parse(nulos(nome)));
      for (const q of chamadas) {
        expect(q.sql).toMatch(/municipio_id = \$1/);
        expect(q.params[0]).toBe(M.id);
      }
      for (const v of municipiosVistos)
        expect(v).toMatch(new RegExp(`:${M.id}$`));
      expect(chamadas.length + municipiosVistos.length).toBeGreaterThan(0);
    },
  );

  it('texto do modelo vai só como parâmetro, nunca no SQL', async () => {
    const c = CONSULTAS.find((x) => x.nome === 'contar_processos')!;
    const { ctx, chamadas } = contexto();
    const zona = "x'; DROP TABLE processos; --";
    await c.executar(ctx, c.entrada.parse(nulos('contar_processos', { zona })));
    expect(chamadas.some((q) => q.sql.includes('DROP'))).toBe(false);
    expect(chamadas.some((q) => q.params.includes(zona))).toBe(true);
  });

  it('o serviço recusa município injetado nos parâmetros antes de ir à BD', async () => {
    const transaction = jest.fn();
    const svc = new PerguntasChefiaService(
      {
        getOrThrow: () => ({ apiKey: '', modelo: 'x' }),
      } as unknown as ConfigService,
      { transaction } as unknown as DatabaseService,
      {} as MunicipiosService,
      {} as AuditoriaService,
      {} as MelhoriasService,
    );
    await expect(
      svc.executar(M, HOJE, new Set(), 'contar_processos', {
        ...nulos('contar_processos'),
        municipio_id: OUTRO,
      }),
    ).rejects.toMatchObject({ codigo: 'parametros_invalidos' });
    await expect(
      svc.executar(M, HOJE, new Set(), 'apagar_tudo', {}),
    ).rejects.toMatchObject({ codigo: 'consulta_desconhecida' });
    expect(transaction).not.toHaveBeenCalled();
  });

  it('cada consulta corre numa transação só de leitura e com tempo máximo', async () => {
    const sqls: string[] = [];
    const tx = {
      query: (sql: string) => {
        sqls.push(sql);
        return Promise.resolve([linhaZero]);
      },
    };
    const svc = new PerguntasChefiaService(
      {
        getOrThrow: () => ({ apiKey: '', modelo: 'x' }),
      } as unknown as ConfigService,
      {
        transaction: (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
      } as unknown as DatabaseService,
      {} as MunicipiosService,
      {} as AuditoriaService,
      {} as MelhoriasService,
    );
    await svc.executar(
      M,
      HOJE,
      new Set(),
      'carga_tecnicos',
      nulos('carga_tecnicos'),
    );
    expect(sqls[0]).toBe('SET TRANSACTION READ ONLY');
    expect(sqls[1]).toMatch(/SET LOCAL statement_timeout/);
  });
});

describe('corresponder palavras aos nomes da câmara', () => {
  it.each([
    ['Buraco na via', 'buracos', true],
    ['Comunicação prévia · obras de alteração', 'comunicações prévias', true],
    ['Comunicação prévia · obras de alteração', 'obras', true],
    ['Licença de obras', 'obras', true],
    ['Iluminação pública', 'luzes', false],
    ['Ocupação da via pública', 'obras', false],
    ['Ana Costa', 'ana', true],
    ['Ana Costa', 'rui', false],
  ])('%s ← "%s" = %s', (nome, termo, esperado) => {
    expect(corresponde(nome, termo)).toBe(esperado);
  });

  it('aceita o código e, sem nada, erra com a lista dos válidos', () => {
    const tipos = [
      { codigo: 'CP', nome: 'Comunicação prévia' },
      { codigo: 'LO', nome: 'Licença de obras' },
    ];
    expect(escolher(tipos, 'cp', 'tipo', 'tipo_desconhecido')).toEqual([
      tipos[0],
    ]);
    try {
      escolher(tipos, 'piscinas', 'tipo', 'tipo_desconhecido');
      throw new Error('devia falhar');
    } catch (e) {
      expect(e).toBeInstanceOf(ErroApi);
      expect((e as ErroApi).codigo).toBe('tipo_desconhecido');
      expect((e as ErroApi).detalhes).toEqual({
        validos: ['CP · Comunicação prévia', 'LO · Licença de obras'],
      });
    }
  });

  it('esquemaApi tira o $schema', () => {
    expect(esquemaApi(CONSULTAS[0].entrada)).not.toHaveProperty('$schema');
  });
});
