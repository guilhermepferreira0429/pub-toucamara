import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { checklistRegrasMarkdown } from './checklist-regras';
import { ELEMENTOS, GRANDEZAS } from './medidas';
import { DEFINICOES, PERFIS } from './perfis-verificacao';

// O jest corre em code/api: a checklist fica em docs/ na raiz do repositório.
const FICHEIRO = resolve(
  process.cwd(),
  '../../docs/VALIDAR_REGRAS_PROJETOS.md',
);

describe('checklist para os técnicos validarem as regras', () => {
  const md = checklistRegrasMarkdown();

  it('docs/VALIDAR_REGRAS_PROJETOS.md está igual ao código (senão: npm run checklist-regras)', () => {
    const noDisco = readFileSync(FICHEIRO, 'utf8');
    expect(noDisco).toBe(md);
  });

  it('tem cada tipo de operação, cada documento, cada medida e cada pergunta à IA', () => {
    for (const p of PERFIS) {
      const d = DEFINICOES[p];
      expect(md).toContain(`(\`${p}\`)`);
      for (const doc of d.documentos) expect(md).toContain(doc.nome);
      for (const g of d.grandezas) expect(md).toContain(GRANDEZAS[g].rotulo);
      for (const e of d.elementos) expect(md).toContain(ELEMENTOS[e].pergunta);
      for (const t of d.sempre_tecnico) expect(md).toContain(t);
      for (const x of d.procurar) expect(md).toContain(x);
    }
  });

  it('marca os valores de demonstração e deixa espaço para o técnico', () => {
    expect(md).toContain('**valor de demonstração**');
    expect(md).toContain('☐ certo ☐ errado');
    // Os valores atuais da zona de demonstração ERC aparecem com o sentido do limite.
    expect(md).toContain('ERC: ≤ 0,5 × área do lote');
    expect(md).toContain('ERC: ≥ 3 m');
    // Sem datas: o mesmo código dá sempre o mesmo ficheiro.
    expect(md).toBe(checklistRegrasMarkdown());
    expect(md).not.toMatch(/20\d\d-\d\d-\d\d/);
  });
});
