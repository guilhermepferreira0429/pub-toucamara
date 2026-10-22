/**
 * Avalia a leitura de projetos pela IA (V4 #2) com o Claude a sério.
 *   npm run verificar-projetos -- [--digitalizado] [--so piscina,muro] [--saida <caminho>] [projeto.pdf ...]
 *   npm run verificar-projetos -- --ajuda
 * Sem ANTHROPIC_API_KEY explica o que fazer e sai com o código 2.
 * A lógica (e os testes) estão em `modules/processos/verificar-projetos-cli.ts`.
 */
import { execFile } from 'node:child_process';
import {
  access,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import type { ConfigService } from '@nestjs/config';
import { iaConfig } from '../config/configuration.js';
import { ClaudeService } from '../ia/claude.service.js';
import { novoPdf, terminarPdf } from '../modules/processos/pdf-demonstracao.js';
import { principal } from '../modules/processos/verificar-projetos-cli.js';

const executar = promisify(execFile);

async function temPdftoppm(): Promise<boolean> {
  try {
    await executar('pdftoppm', ['-v']);
    return true;
  } catch {
    return false;
  }
}

/**
 * Um PDF "digitalizado": cada página passa a imagem (110 ppp, cinzentos) e
 * volta a PDF sem texto, como sai de um digitalizador.
 */
async function digitalizar(pdf: Buffer): Promise<Buffer> {
  const pasta = await mkdtemp(join(tmpdir(), 'digitalizar-'));
  const entrada = join(pasta, 'entrada.pdf');
  await writeFile(entrada, pdf);
  await executar('pdftoppm', [
    '-r',
    '110',
    '-gray',
    '-png',
    entrada,
    join(pasta, 'pagina'),
  ]);
  const paginas = (await readdir(pasta))
    .filter((f) => f.endsWith('.png'))
    .sort();
  const doc = novoPdf('Digitalizado', 'portrait');
  for (const f of paginas) {
    const img = await readFile(join(pasta, f));
    // Largura e altura do PNG (cabeçalho IHDR), para a página ter o tamanho da folha.
    const l = img.readUInt32BE(16);
    const a = img.readUInt32BE(20);
    const w = (l / 110) * 72;
    const h = (a / 110) * 72;
    doc.addPage({ size: [w, h], margin: 0 });
    doc.image(img, 0, 0, { width: w, height: h });
  }
  return terminarPdf(doc);
}

async function main() {
  const codigo = await principal(process.argv.slice(2), {
    env: process.env,
    cliente: () => {
      const config = {
        getOrThrow: () => iaConfig(),
      } as unknown as ConfigService;
      return new ClaudeService(config);
    },
    ler: (c) => readFile(c),
    existe: async (c) => {
      try {
        await access(c);
        return true;
      } catch {
        return false;
      }
    },
    escrever: async (c, conteudo) => {
      await mkdir(dirname(c), { recursive: true });
      await writeFile(c, conteudo, 'utf8');
    },
    // O comando corre em code/api: o relatório vai para docs/avaliacao na raiz.
    pasta_relatorios: resolve(process.cwd(), '../../docs/avaliacao'),
    digitalizar: (await temPdftoppm()) ? digitalizar : undefined,
    log: (t) => console.log(t),
    erro: (t) => console.error(t),
    agora: () => new Date(),
  });
  process.exit(codigo);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
