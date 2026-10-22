/**
 * Escreve a checklist para os técnicos validarem as regras da análise de
 * projetos (V4 #2) em docs/VALIDAR_REGRAS_PROJETOS.md, a partir do código.
 *   npm run checklist-regras
 * O teste `checklist-regras.spec.ts` falha se o ficheiro ficar desatualizado.
 */
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { checklistRegrasMarkdown } from '../modules/processos/checklist-regras.js';

async function main() {
  // O comando corre em code/api: o ficheiro fica em docs/ na raiz.
  const destino = resolve(
    process.cwd(),
    '../../docs/VALIDAR_REGRAS_PROJETOS.md',
  );
  await writeFile(destino, checklistRegrasMarkdown(), 'utf8');
  console.log(`Checklist escrita em ${destino}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
