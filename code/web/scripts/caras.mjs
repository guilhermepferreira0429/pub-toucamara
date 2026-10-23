/*
 * As caras das pessoas fictícias da demonstração (retratos gerados).
 *
 *   node scripts/caras.mjs [pasta]      # por omissão public/caras
 *
 * Lê os retratos com o nome da chave da pessoa (sandra.jpg, albertina.png…),
 * procura o telefone dela no conteúdo da demonstração da API (demo.conteudo.ts
 * e demo.volume.ts) e grava public/caras/<n>.webp (256×256), onde n é o índice
 * na gama de teste (+351 910 000 n). No fim reescreve a lista de lib/caras.ts.
 * Os originais ficam como estão.
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const web = fileURLToPath(new URL("..", import.meta.url));
const pasta = process.argv[2] ?? join(web, "public/caras");
const demo = join(web, "../api/src/modules/demo");

const telefones = new Map();
for (const f of ["demo.conteudo.ts", "demo.volume.ts"]) {
  const texto = readFileSync(join(demo, f), "utf8");
  for (const m of texto.matchAll(/chave: '([a-z_]+)',\s*nome: '[^']+',\s*telefone: (\d+)/g)) {
    telefones.set(m[1], Number(m[2]));
  }
}

const feitas = new Set(
  readdirSync(pasta)
    .filter((f) => /^\d+\.webp$/.test(f))
    .map((f) => Number(basename(f, ".webp"))),
);
const semPessoa = [];
for (const f of readdirSync(pasta)) {
  if (!/\.(jpe?g|png|webp)$/i.test(f) || /^\d+\.webp$/.test(f)) continue;
  const chave = basename(f, extname(f)).toLowerCase();
  const n = telefones.get(chave);
  if (n === undefined) {
    semPessoa.push(f);
    continue;
  }
  await sharp(join(pasta, f))
    .resize(256, 256, { fit: "cover", position: "attention" })
    .webp({ quality: 82 })
    .toFile(join(pasta, `${n}.webp`));
  feitas.add(n);
  console.log(`${f} → ${n}.webp`);
}

const lista = [...feitas].sort((a, b) => a - b).join(", ");
const caminho = join(web, "lib/caras.ts");
const lib = readFileSync(caminho, "utf8").replace(
  /const COM_CARA = new Set<number>\(\[[^\]]*\]\);/,
  `const COM_CARA = new Set<number>([${lista}]);`,
);
writeFileSync(caminho, lib);
console.log(`${feitas.size} caras em lib/caras.ts.`);
if (semPessoa.length) console.log(`Sem pessoa da demonstração: ${semPessoa.join(", ")}`);
