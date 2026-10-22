/*
 * Os agentes de voz não podem ficar desalinhados da API: cada ferramenta
 * registada (`ferramenta({ nome: … })` em src/) tem de estar no
 * agente-voz/<agente>/ferramentas.json dos agentes que a sua lista
 * `agentes` diz (por omissão entrada e chat), e os ficheiros não podem ter
 * ferramentas a mais. Se falhar: `npm run agente-voz -- gerar` e commit.
 * (O e2e agente-voz gera a partir do registo real e compara tudo.)
 *
 * Também trava o peso: cada agente tem um limite de tokens de ferramentas
 * (medir.ts). Subir o limite é uma decisão: ver agente-voz/README.md.
 */
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { AGENTES_OMISSAO, type Agente } from '../ferramentas/ferramenta.js';
import type { FicheiroAgente, FicheiroFerramentas } from './configuracao.js';
import { validarElevenLabs } from './esquema-elevenlabs.js';
import { LIMITE_TOKENS, medir } from './medir.js';
import { AGENTES_VOZ, GRUPOS_FERRAMENTAS } from './prompt-voz.js';

const SRC = join(__dirname, '..');
const PASTA = join(__dirname, '..', '..', 'agente-voz');

function ficheirosTs(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return ficheirosTs(p);
    return /\.ts$/.test(n) && !/\.spec\.ts$/.test(n) ? [p] : [];
  });
}

interface NoCodigo {
  nome: string;
  agentes: readonly Agente[];
}

/** As `ferramenta({ … nome: '…', … agentes: [...] … })` do código. */
function noCodigo(): NoCodigo[] {
  const lista: NoCodigo[] = [];
  for (const f of ficheirosTs(SRC)) {
    const texto = readFileSync(f, 'utf8');
    const re = /\bferramenta\(\{/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(texto))) {
      const resto = texto.slice(m.index);
      // O bloco até ao executar (onde estão nome, descrição e agentes).
      const bloco = resto.slice(0, Math.max(resto.search(/\bexecutar\b/), 0));
      const n = bloco.match(/\bnome:\s*['"`](\w+)['"`]/);
      if (!n) continue;
      const a = bloco.match(/\bagentes:\s*\[([^\]]*)\]/);
      const agentes = a
        ? ([...a[1].matchAll(/'(\w+)'/g)].map((x) => x[1]) as Agente[])
        : AGENTES_OMISSAO;
      lista.push({ nome: n[1], agentes });
    }
  }
  return lista.sort((a, b) => a.nome.localeCompare(b.nome));
}

function ler<T>(agente: string, ficheiro: string): T {
  const texto = readFileSync(join(PASTA, agente, ficheiro), 'utf8');
  return (ficheiro.endsWith('.json') ? JSON.parse(texto) : texto) as T;
}

const codigo = noCodigo();
const todos = new Set(codigo.map((c) => c.nome));

describe('agente-voz alinhado com a API', () => {
  it('encontra as ferramentas no código', () => {
    expect(codigo.length).toBeGreaterThan(40);
  });

  it('nenhuma ferramenta fica sem agente de voz nem chat por engano', () => {
    for (const c of codigo) expect(c.agentes.length).toBeGreaterThan(0);
  });

  describe.each(AGENTES_VOZ)('agente de %s', (agente) => {
    const ferramentas = ler<FicheiroFerramentas>(agente, 'ferramentas.json');
    const config = ler<FicheiroAgente>(agente, 'agente.json');
    const prompt = ler<string>(agente, 'prompt.md');
    const noFicheiro = ferramentas.ferramentas.map((f) => f.name).sort();
    const esperadas = codigo
      .filter((c) => c.agentes.includes(agente))
      .map((c) => c.nome);

    it('tem as ferramentas com `agentes` a incluí-lo (e só essas)', () => {
      expect(noFicheiro).toEqual(esperadas);
      expect(config.agente).toBe(agente);
    });

    it(`não passa de ${LIMITE_TOKENS[agente]} tokens de ferramentas`, () => {
      const peso = medir(ferramentas.ferramentas, prompt);
      expect(peso.total).toBeLessThanOrEqual(LIMITE_TOKENS[agente]);
    });

    it('nenhuma ferramenta sem descrição (nem parâmetro sem descrição)', () => {
      for (const f of ferramentas.ferramentas) {
        expect(f.description.trim().length).toBeGreaterThan(20);
      }
      // Parâmetros sem descrição no zod: o gerador usa o nome do campo e
      // avisa. Só se aceitam os do envelope de pedir_licenca (os campos de
      // cada tipo, com a pergunta em campos_da_licenca).
      const semDescricao = ferramentas.avisos
        .filter((a) => /sem descrição/.test(a.mensagem))
        .filter((a) => a.ferramenta !== 'pedir_licenca');
      expect(semDescricao).toEqual([]);
    });

    it('cada ferramenta aponta para a sua rota, com o segredo por referência', () => {
      for (const f of ferramentas.ferramentas) {
        expect(f.api_schema.url).toBe(`\${API_URL}/v1/agent/tools/${f.name}`);
        expect(f.api_schema.request_headers['X-Agente-Segredo']).toEqual({
          secret_id: '${SEGREDO:toucamara_agente_segredo}',
        });
      }
      // Nenhum valor de segredo no ficheiro.
      expect(JSON.stringify(ferramentas)).not.toMatch(
        /"secret_id":\s*"(?!\$\{SEGREDO:)/,
      );
    });

    it('todos os esquemas são válidos para o ElevenLabs', () => {
      const erros = ferramentas.ferramentas.flatMap((f) =>
        f.api_schema.request_body_schema
          ? validarElevenLabs(f.api_schema.request_body_schema, f.name)
          : [],
      );
      expect(erros).toEqual([]);
    });

    it('o prompt fala de cada ferramenta dele e só de ferramentas que ele tem', () => {
      for (const n of noFicheiro) expect(prompt).toContain(`\`${n}\``);
      // Ferramenta nova: põe-na num grupo em prompt-voz.ts.
      expect(prompt).not.toContain('### Outras');
      const citadas = new Set(
        [...prompt.matchAll(/\b[a-z]+(?:_[a-z]+)+\b/g)]
          .map((m) => m[0])
          .filter((p) => todos.has(p)),
      );
      expect([...citadas].filter((n) => !noFicheiro.includes(n))).toEqual([]);
    });

    it('todas as variáveis do prompt e dos headers têm valor por omissão', () => {
      const agenteCfg = config.conversation_config.agent as {
        dynamic_variables: {
          dynamic_variable_placeholders: Record<string, string>;
        };
      };
      const placeholders =
        agenteCfg.dynamic_variables.dynamic_variable_placeholders;
      const usadas = new Set<string>();
      for (const m of prompt.matchAll(/\{\{(\w+)\}\}/g)) usadas.add(m[1]);
      for (const m of JSON.stringify(ferramentas.ferramentas).matchAll(
        /"(?:variable_name|dynamic_variable)":"(\w+)"/g,
      )) {
        usadas.add(m[1]);
      }
      const semValor = [...usadas].filter(
        (v) => !v.startsWith('system__') && !(v in placeholders),
      );
      expect(semValor).toEqual([]);
    });
  });

  it('os grupos do prompt não citam ferramentas que não existem', () => {
    const nosGrupos = GRUPOS_FERRAMENTAS.flatMap((g) =>
      g.itens.map(([n]) => n),
    );
    expect(nosGrupos.filter((n) => !todos.has(n))).toEqual([]);
  });

  it('as exclusivas das chamadas da câmara não estão no agente de entrada nem no chat', () => {
    const de = (n: string) => codigo.find((c) => c.nome === n)!.agentes;
    for (const n of ['motivo_da_chamada', 'resposta_campanha']) {
      expect(de(n)).toEqual(['saida']);
    }
    expect(de('explicar_momento')).not.toContain('entrada');
  });
});
