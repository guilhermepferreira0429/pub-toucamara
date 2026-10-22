import type { PedidoIa } from '../../ia/claude.service';
import { leituraPerfeita } from './ajudas-leitura.ajuda-spec';
import { casosDemonstracao, ClienteLeitura } from './avaliacao-projetos';
import { gerarProjetoDemonstracao } from './projeto-demonstracao-pdf';
import {
  AJUDA,
  caminhosSaida,
  Dependencias,
  lerArgumentos,
  principal,
  SEM_CHAVE,
} from './verificar-projetos-cli';
import type { LeituraProjeto } from './verificacoes';

function deps(
  extra: Partial<Dependencias> = {},
  resposta?: (p: PedidoIa) => LeituraProjeto,
) {
  const escritos = new Map<string, string>();
  const ficheiros = new Map<string, Buffer>();
  const saida: string[] = [];
  const erros: string[] = [];
  const casos = casosDemonstracao();
  const pedidos: PedidoIa[] = [];
  const cliente: ClienteLeitura = {
    extrair: (_e, p) => {
      pedidos.push(p);
      if (resposta) return Promise.resolve(resposta(p));
      const assunto = /Assunto: (.*)/.exec(p.conteudo)?.[1];
      const c = casos.find((x) => x.assunto === assunto);
      return Promise.resolve(c ? leituraPerfeita(c.esperado!) : null);
    },
  };
  const d: Dependencias = {
    env: { ANTHROPIC_API_KEY: 'chave-de-teste', ANTHROPIC_MODEL: 'modelo-x' },
    cliente: () => cliente,
    ler: (c) =>
      ficheiros.has(c)
        ? Promise.resolve(ficheiros.get(c)!)
        : Promise.reject(new Error(`não existe: ${c}`)),
    existe: (c) => Promise.resolve(ficheiros.has(c)),
    escrever: (c, t) => {
      escritos.set(c, t);
      return Promise.resolve();
    },
    pasta_relatorios: '/docs/avaliacao',
    log: (t) => saida.push(t),
    erro: (t) => erros.push(t),
    agora: () => new Date(Date.UTC(2026, 9, 22, 12, 0, 0)),
    ...extra,
  };
  return { d, escritos, ficheiros, saida, erros, pedidos };
}

describe('npm run verificar-projetos', () => {
  it('sem ANTHROPIC_API_KEY explica o que fazer e sai com 2 (sem chamar a IA)', async () => {
    const x = deps();
    let criou = false;
    x.d.env = { ANTHROPIC_API_KEY: '  ' };
    x.d.cliente = () => {
      criou = true;
      throw new Error('não devia');
    };
    expect(await principal([], x.d)).toBe(2);
    expect(x.erros).toEqual([SEM_CHAVE]);
    expect(SEM_CHAVE).toContain('export ANTHROPIC_API_KEY=');
    expect(SEM_CHAVE).toContain('npm run verificar-projetos');
    expect(criou).toBe(false);
    expect(x.escritos.size).toBe(0);
  });

  it('--ajuda mostra o uso; opção desconhecida sai com 2', async () => {
    const a = deps();
    expect(await principal(['--ajuda'], a.d)).toBe(0);
    expect(a.saida).toEqual([AJUDA]);
    const b = deps();
    expect(await principal(['--castelo'], b.d)).toBe(2);
    expect(b.erros[0]).toContain('Opção desconhecida: --castelo');
    expect(() => lerArgumentos(['--so', 'piscina,castelo'])).toThrow(/castelo/);
  });

  it('corre os 8 projetos, imprime a tabela e grava JSON e Markdown em docs/avaliacao', async () => {
    const x = deps();
    expect(await principal([], x.d)).toBe(0);
    expect(x.pedidos).toHaveLength(8);
    const md = x.escritos.get(
      '/docs/avaliacao/verificar-projetos-2026-10-22.md',
    )!;
    const json = JSON.parse(
      x.escritos.get('/docs/avaliacao/verificar-projetos-2026-10-22.json')!,
    ) as { total: unknown };
    expect(md).toContain('com o modelo `modelo-x`');
    expect(json.total).toMatchObject({ acerto: 1, inventado: 0 });
    expect(x.saida.join('\n')).toContain('Acerto por tipo de operação');
    expect(x.saida.some((l) => l.startsWith('✓ muro'))).toBe(true);
  });

  it('número inventado → código 1', async () => {
    const casos = casosDemonstracao();
    const fachada = casos.find((c) => c.chave === 'fachada')!;
    const x = deps({}, () => {
      const l = leituraPerfeita(fachada.esperado!);
      l.medicoes.push({
        grandeza: 'cercea_m',
        valor: 9,
        unidade: 'm',
        referencia: { documento: 1, pagina: 1, folha: '1' },
      });
      return l;
    });
    expect(
      await principal(['--so', 'fachada', '--saida', '/tmp/r.json'], x.d),
    ).toBe(1);
    expect(x.escritos.has('/tmp/r.json')).toBe(true);
    expect(x.escritos.has('/tmp/r.md')).toBe(true);
  });

  it('PDF de fora com gabarito ao lado (.esperado.json) e sem gabarito', async () => {
    const x = deps({}, () => ({
      ...leituraPerfeita({
        medicoes: { area_obra_m2: 30 },
        elementos: { casa_maquinas: 'sim' },
      }),
    }));
    const pdf = await gerarProjetoDemonstracao();
    x.ficheiros.set('/p/piscina.pdf', pdf);
    x.ficheiros.set(
      '/p/piscina.pdf.esperado.json',
      Buffer.from(
        JSON.stringify({
          perfil: 'piscina',
          medicoes: { area_obra_m2: 32, afastamento_extremas_m: null },
          elementos: { casa_maquinas: 'sim' },
        }),
      ),
    );
    x.ficheiros.set('/p/outro.pdf', pdf);
    expect(
      await principal(
        [
          '--sem-demonstracao',
          '/p/piscina.pdf',
          '/p/outro.pdf',
          '--perfil',
          'interior',
        ],
        x.d,
      ),
    ).toBe(0);
    expect(x.pedidos).toHaveLength(2);
    expect(x.pedidos[0].conteudo).toContain('Operação a analisar: Piscina.');
    expect(x.pedidos[1].conteudo).toContain(
      'Operação a analisar: Alteração interior.',
    );
    const t = x.saida.join('\n');
    expect(t).toContain(
      '[errado] piscina.pdf · Área da obra: esperado 32 m², lido 30 m²',
    );
    expect(t).toContain('outro.pdf (sem gabarito: só o que a IA leu)');
  });

  it('gabarito inválido ou ficheiro que não é PDF nem imagem: código 2', async () => {
    const x = deps();
    x.ficheiros.set('/p/a.pdf', Buffer.from('%PDF-1.4'));
    x.ficheiros.set(
      '/p/a.pdf.esperado.json',
      Buffer.from('{"medicoes":{"altura":1}}'),
    );
    expect(await principal(['--sem-demonstracao', '/p/a.pdf'], x.d)).toBe(2);
    const y = deps();
    expect(await principal(['/p/a.docx'], y.d)).toBe(2);
    expect(y.erros[0]).toContain('só PDF ou imagens');
  });

  it('--digitalizado sem pdftoppm: diz o que falta', async () => {
    const x = deps();
    expect(await principal(['--digitalizado'], x.d)).toBe(2);
    expect(x.erros[0]).toContain('pdftoppm');
  });

  it('caminhos de saída', () => {
    const dia = new Date(Date.UTC(2026, 9, 22));
    expect(caminhosSaida(null, '/d', dia)).toEqual({
      json: '/d/verificar-projetos-2026-10-22.json',
      md: '/d/verificar-projetos-2026-10-22.md',
    });
    expect(caminhosSaida('/x/', '/d', dia).md).toBe(
      '/x/verificar-projetos-2026-10-22.md',
    );
    expect(caminhosSaida('/x/r.md', '/d', dia)).toEqual({
      json: '/x/r.json',
      md: '/x/r.md',
    });
  });
});
