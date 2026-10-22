/*
 * O agente de voz não pode ficar desalinhado da API: cada ferramenta
 * registada (`ferramenta({ nome: … })` em src/) tem de estar em
 * agente-voz/ferramentas.json, e o ficheiro não pode ter ferramentas que já
 * não existem. Se falhar: `npm run agente-voz -- gerar` e commit.
 * (O e2e agente-voz gera a partir do registo real e compara tudo.)
 */
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import type { FicheiroAgente, FicheiroFerramentas } from './configuracao.js';
import { validarElevenLabs } from './esquema-elevenlabs.js';
import { GRUPOS_FERRAMENTAS } from './prompt-voz.js';

const SRC = join(__dirname, '..');
const PASTA = join(__dirname, '..', '..', 'agente-voz');

function ficheirosTs(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return ficheirosTs(p);
    return /\.ts$/.test(n) && !/\.spec\.ts$/.test(n) ? [p] : [];
  });
}

/** Os nomes de todas as `ferramenta({ … nome: '…' … })` do código. */
function nomesNoCodigo(): string[] {
  const nomes: string[] = [];
  for (const f of ficheirosTs(SRC)) {
    const texto = readFileSync(f, 'utf8');
    const re = /\bferramenta\(\{/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(texto))) {
      const n = texto
        .slice(m.index, m.index + 400)
        .match(/\bnome:\s*['"`](\w+)['"`]/);
      if (n) nomes.push(n[1]);
    }
  }
  return nomes.sort();
}

const ferramentas = JSON.parse(
  readFileSync(join(PASTA, 'ferramentas.json'), 'utf8'),
) as FicheiroFerramentas;
const agente = JSON.parse(
  readFileSync(join(PASTA, 'agente.json'), 'utf8'),
) as FicheiroAgente;
const prompt = readFileSync(join(PASTA, 'prompt.md'), 'utf8');
const noFicheiro = ferramentas.ferramentas.map((f) => f.name).sort();

describe('agente-voz alinhado com a API', () => {
  it('encontra as ferramentas no código', () => {
    expect(nomesNoCodigo().length).toBeGreaterThan(40);
  });

  it('todas as ferramentas registadas estão em ferramentas.json (e só essas)', () => {
    const codigo = nomesNoCodigo();
    expect(codigo.filter((n) => !noFicheiro.includes(n))).toEqual([]);
    expect(noFicheiro.filter((n) => !codigo.includes(n))).toEqual([]);
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

  it('o prompt fala de todas as ferramentas, e os grupos não citam ferramentas que não existem', () => {
    for (const n of noFicheiro) expect(prompt).toContain(`\`${n}\``);
    const nosGrupos = GRUPOS_FERRAMENTAS.flatMap((g) =>
      g.itens.map(([n]) => n),
    );
    expect(nosGrupos.filter((n) => !noFicheiro.includes(n))).toEqual([]);
    // Ferramenta nova: põe-na num grupo em prompt-voz.ts.
    expect(prompt).not.toContain('### Outras');
  });

  it('todas as variáveis do prompt e dos headers têm valor por omissão', () => {
    const agenteCfg = agente.conversation_config.agent as {
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
