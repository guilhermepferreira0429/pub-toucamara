/*
 * Auditoria automática de acessibilidade (WCAG 2.1 AA) com Playwright + axe-core.
 *
 *   npm run a11y                      # só as páginas sem dados (/, /chat, /ligar…)
 *   npm run a11y -- --paginas scripts/acessibilidade.paginas.json
 *
 * Variáveis:
 *   A11Y_URL        endereço da web (por omissão http://localhost:3000)
 *   A11Y_CHROMIUM   caminho do Chromium (por omissão o do Playwright instalado)
 *   A11Y_SAIDA      pasta do relatório (por omissão ./relatorio-acessibilidade)
 *   A11Y_TOKEN      token de um link mágico do painel (abre /entrar?token=…);
 *                   sem ele, as páginas do painel são saltadas.
 *   A11Y_LETRA      1 ou 2: audita o munícipe com a letra maior (A+ / A++)
 *   A11Y_CONTRASTE  "alto": audita o munícipe em alto contraste
 *
 * O ficheiro de páginas (JSON) diz os códigos dos links do SMS que existem na
 * BD onde se corre: { "municipe": ["/processo/ABC123", …], "painel": [ … ] }.
 *
 * Além do axe, mede duas coisas que o axe não vê:
 *  - reflow: a página a 320 px de largura não pode ter scroll horizontal;
 *  - alvos de toque < 44 px nas páginas do munícipe (WCAG 2.5.5, AAA, que
 *    seguimos por causa das pessoas idosas).
 *
 * O relatório (relatorio.md + relatorio.json) conta as violações por página e
 * por gravidade. Não substitui a verificação manual com leitor de ecrã.
 */
import { AxeBuilder } from "@axe-core/playwright";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Page } from "playwright-core";

type Gravidade = "critical" | "serious" | "moderate" | "minor";

interface Violacao {
  id: string;
  gravidade: Gravidade;
  ajuda: string;
  url: string;
  nos: number;
  exemplos: string[];
  wcag: string[];
}

interface Resultado {
  pagina: string;
  grupo: "municipe" | "painel";
  estado: number | null;
  violacoes: Violacao[];
  reflow320: boolean | null;
  alvosPequenos: string[];
  erro?: string;
}

const URL_BASE = (process.env.A11Y_URL ?? "http://localhost:3000").replace(/\/$/, "");
const SAIDA = process.env.A11Y_SAIDA ?? "relatorio-acessibilidade";
const TOKEN = process.env.A11Y_TOKEN ?? "";

const MUNICIPE_SEM_DADOS = [
  "/",
  "/chat",
  "/ligar",
  "/ligar/qr",
  "/acessibilidade",
  "/expirado",
  "/ia",
  "/aviso/CODIGOINEXISTENTE",
];
// /entrar não precisa de sessão; as outras só com A11Y_TOKEN.
const PAINEL_SEM_DADOS = [
  "/entrar",
  "/painel",
  "/painel/entrada",
  "/painel/conversas",
  "/painel/processos",
  "/painel/licencas",
  "/painel/marcacoes",
  "/painel/pagamentos",
  "/painel/ocorrencias",
  "/painel/reclamacoes",
  "/painel/conhecimento",
  "/painel/indicadores",
  "/painel/equipa",
  "/painel/agente",
  "/painel/campanhas",
  "/painel/avisos",
  "/painel/consultas",
  "/painel/chamadas",
  "/painel/apoios",
  "/painel/ordenamento",
  "/painel/relatorios",
];

function lerPaginas(): { municipe: string[]; painel: string[] } {
  const i = process.argv.indexOf("--paginas");
  const extra =
    i > 0
      ? (JSON.parse(readFileSync(process.argv[i + 1], "utf8")) as {
          municipe?: string[];
          painel?: string[];
        })
      : {};
  return {
    municipe: [...MUNICIPE_SEM_DADOS, ...(extra.municipe ?? [])],
    painel: [...PAINEL_SEM_DADOS, ...(extra.painel ?? [])],
  };
}

const ETIQUETAS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"];

async function esperarConteudo(p: Page) {
  await p.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
  // Os ecrãs "A abrir…"/"A carregar…" desaparecem quando os dados chegam.
  await p
    .waitForFunction(
      () => !/^(A abrir…|A carregar…)$/m.test(document.body.innerText.trim()),
      undefined,
      { timeout: 10_000 },
    )
    .catch(() => {});
  await p.waitForTimeout(400);
}

async function auditar(
  p: Page,
  caminho: string,
  grupo: "municipe" | "painel",
): Promise<Resultado> {
  const r: Resultado = {
    pagina: caminho,
    grupo,
    estado: null,
    violacoes: [],
    reflow320: null,
    alvosPequenos: [],
  };
  try {
    const resp = await p.goto(URL_BASE + caminho, { waitUntil: "domcontentloaded" });
    r.estado = resp?.status() ?? null;
    await esperarConteudo(p);
    const axe = await new AxeBuilder({ page: p }).withTags(ETIQUETAS).analyze();
    r.violacoes = axe.violations.map((v) => ({
      id: v.id,
      gravidade: (v.impact ?? "minor") as Gravidade,
      ajuda: v.help,
      url: v.helpUrl,
      nos: v.nodes.length,
      exemplos: v.nodes.slice(0, 3).map((n) => {
        // No contraste, junta as cores e o rácio (ajuda a saber que token mudar).
        const d = n.any[0]?.data as
          | { fgColor?: string; bgColor?: string; contrastRatio?: number }
          | undefined;
        const cores = d?.fgColor
          ? ` (${d.fgColor} sobre ${d.bgColor ?? "?"} = ${d.contrastRatio ?? "?"}:1)`
          : "";
        return n.target.join(" ") + cores;
      }),
      wcag: v.tags.filter((t) => /^wcag\d/.test(t)),
    }));

    if (grupo === "municipe") {
      // Alvos de toque: tudo o que se carrega tem de ter pelo menos 44×44 px
      // (os links dentro de um parágrafo de texto estão isentos).
      r.alvosPequenos = await p.evaluate(() => {
        const sel = 'a[href], button, input:not([type="hidden"]), select, textarea, [role="button"], summary';
        const fora: string[] = [];
        for (const el of Array.from(document.querySelectorAll<HTMLElement>(sel))) {
          const cx = el.getBoundingClientRect();
          if (cx.width === 0 || cx.height === 0) continue;
          const estilo = getComputedStyle(el);
          if (estilo.visibility === "hidden") continue;
          if (el.tagName === "A" && estilo.display === "inline" && el.closest("p, li")) continue;
          if (el.closest("[data-a11y-isento], [aria-hidden=\"true\"], .leaflet-control-attribution")) continue;
          if (cx.width <= 1 && cx.height <= 1) continue; // sr-only (ex.: input de ficheiro escondido)
          // Caixas e botões de opção: conta a etiqueta que os envolve.
          const alvo = el.closest("label") ?? el;
          const c = alvo.getBoundingClientRect();
          if (c.width < 43.5 || c.height < 43.5) {
            const nome = (el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 40);
            fora.push(`${el.tagName.toLowerCase()} "${nome}" ${Math.round(c.width)}×${Math.round(c.height)}`);
          }
        }
        return fora;
      });
    }

    // Reflow (WCAG 1.4.10): a 320 px não pode haver scroll horizontal.
    const tamanho = p.viewportSize();
    await p.setViewportSize({ width: 320, height: 800 });
    await p.waitForTimeout(300);
    r.reflow320 = await p.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
    );
    if (tamanho) await p.setViewportSize(tamanho);
  } catch (e) {
    r.erro = e instanceof Error ? e.message : String(e);
  }
  return r;
}

const ORDEM: Gravidade[] = ["critical", "serious", "moderate", "minor"];

function contar(v: Violacao[]) {
  const c: Record<Gravidade, number> = { critical: 0, serious: 0, moderate: 0, minor: 0 };
  for (const x of v) c[x.gravidade] += 1;
  return c;
}

function relatorio(resultados: Resultado[]): string {
  const linhas: string[] = [];
  const data = new Date().toISOString().slice(0, 16).replace("T", " ");
  linhas.push(`# Relatório de acessibilidade (axe-core)`, "", `Gerado em ${data} contra ${URL_BASE}.`, "");
  linhas.push(
    "| Página | Grupo | HTTP | Críticas | Sérias | Moderadas | Menores | Reflow 320 px | Alvos < 44 px |",
    "|---|---|---|---|---|---|---|---|---|",
  );
  const total: Record<Gravidade, number> = { critical: 0, serious: 0, moderate: 0, minor: 0 };
  for (const r of resultados) {
    const c = contar(r.violacoes);
    for (const g of ORDEM) total[g] += c[g];
    linhas.push(
      `| \`${r.pagina}\` | ${r.grupo} | ${r.estado ?? "—"} | ${c.critical} | ${c.serious} | ${c.moderate} | ${c.minor} | ${
        r.reflow320 === null ? "—" : r.reflow320 ? "ok" : "**não**"
      } | ${r.grupo === "municipe" ? r.alvosPequenos.length : "—"} |${r.erro ? ` erro: ${r.erro}` : ""}`,
    );
  }
  linhas.push(
    `| **Total** | | | ${total.critical} | ${total.serious} | ${total.moderate} | ${total.minor} | | |`,
    "",
    "Contam-se regras violadas por página (cada regra pode afetar vários elementos).",
    "",
  );
  for (const r of resultados) {
    if (!r.violacoes.length && !r.alvosPequenos.length && r.reflow320 !== false) continue;
    linhas.push(`## \`${r.pagina}\``, "");
    for (const v of [...r.violacoes].sort((a, b) => ORDEM.indexOf(a.gravidade) - ORDEM.indexOf(b.gravidade))) {
      linhas.push(
        `- **${v.gravidade}** \`${v.id}\` (${v.nos} elemento${v.nos === 1 ? "" : "s"}${v.wcag.length ? `, ${v.wcag.join(" ")}` : ""}): ${v.ajuda}`,
      );
      for (const ex of v.exemplos) linhas.push(`  - \`${ex}\``);
    }
    if (r.reflow320 === false) linhas.push("- **reflow**: scroll horizontal a 320 px");
    for (const a of r.alvosPequenos.slice(0, 10)) linhas.push(`- alvo pequeno: ${a}`);
    if (r.alvosPequenos.length > 10) linhas.push(`- … e mais ${r.alvosPequenos.length - 10} alvos pequenos`);
    linhas.push("");
  }
  return linhas.join("\n");
}

async function principal() {
  const paginas = lerPaginas();
  const browser = await chromium.launch({
    executablePath: process.env.A11Y_CHROMIUM || undefined,
  });
  const resultados: Resultado[] = [];
  try {
    // Munícipe: telemóvel (390×844), como quem abre o link do SMS.
    const tel = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "pt-PT" });
    // A11Y_LETRA=2 / A11Y_CONTRASTE=alto: audita com as opções de leitura ligadas.
    await tel.addInitScript(
      ([letra, contraste]) => {
        try {
          if (letra) localStorage.setItem("toucamara.letra", letra);
          if (contraste) localStorage.setItem("toucamara.contraste", contraste);
        } catch {}
      },
      [process.env.A11Y_LETRA ?? "", process.env.A11Y_CONTRASTE ?? ""],
    );
    const pt = await tel.newPage();
    for (const c of paginas.municipe) {
      const r = await auditar(pt, c, "municipe");
      resultados.push(r);
      console.log(`${c}: ${r.violacoes.length} regras violadas${r.erro ? ` (erro: ${r.erro})` : ""}`);
    }
    await tel.close();

    // Painel: computador (1280×800), com sessão pelo link mágico.
    const pc = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: "pt-PT" });
    const pp = await pc.newPage();
    const painel = paginas.painel.filter((c) => c === "/entrar");
    for (const c of painel) resultados.push(await auditar(pp, c, "painel"));
    if (TOKEN) {
      await pp.goto(`${URL_BASE}/entrar?token=${encodeURIComponent(TOKEN)}`);
      await pp.waitForURL(/\/painel/, { timeout: 30_000 });
      for (const c of paginas.painel.filter((x) => x !== "/entrar")) {
        const r = await auditar(pp, c, "painel");
        resultados.push(r);
        console.log(`${c}: ${r.violacoes.length} regras violadas${r.erro ? ` (erro: ${r.erro})` : ""}`);
      }
    } else if (paginas.painel.length > painel.length) {
      console.log("Sem A11Y_TOKEN: as páginas do painel com sessão foram saltadas.");
    }
    await pc.close();
  } finally {
    await browser.close();
  }
  mkdirSync(SAIDA, { recursive: true });
  writeFileSync(join(SAIDA, "relatorio.json"), JSON.stringify(resultados, null, 2));
  writeFileSync(join(SAIDA, "relatorio.md"), relatorio(resultados));
  const t = contar(resultados.flatMap((r) => r.violacoes));
  console.log(
    `\nTotal: ${t.critical} críticas, ${t.serious} sérias, ${t.moderate} moderadas, ${t.minor} menores. Relatório em ${SAIDA}/relatorio.md`,
  );
}

principal().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
