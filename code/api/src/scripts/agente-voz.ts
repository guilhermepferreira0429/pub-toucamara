/**
 * A configuração do agente de voz (ElevenLabs) a partir do código.
 *   npm run agente-voz -- gerar        [--municipio guimaraes] [--sem-bd]
 *   npm run agente-voz -- diff         [--municipio …] [--agente <id>]
 *   npm run agente-voz -- sincronizar  [--municipio …] [--agente <id>] [--confirmar] [--criar-segredo]
 *   (diff e sincronizar aceitam --base <url> para outra região da API do ElevenLabs)
 *
 * Os três geram primeiro `code/api/agente-voz/` (ferramentas.json, prompt.md,
 * agente.json). `diff` e `sincronizar` precisam de ELEVENLABS_API_KEY; sem
 * `--confirmar` o `sincronizar` só mostra o que faria. Ver agente-voz/README.md.
 */
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { AppModule } from '../app.module.js';
import {
  aplicar,
  ClienteElevenLabs,
  Desejado,
  Plano,
  planear,
  semAlteracoes,
  URL_ELEVENLABS,
} from '../agente-voz/cliente-elevenlabs.js';
import {
  DadosMunicipio,
  gerarAgente,
  gerarFerramentas,
  resolver,
  SEGREDO_AGENTE,
  segredosReferidos,
} from '../agente-voz/configuracao.js';
import { Aviso } from '../agente-voz/esquema-elevenlabs.js';
import { gerarPrompt } from '../agente-voz/prompt-voz.js';
import { DatabaseService } from '../database/database.service.js';
import { RegistoFerramentas } from '../ferramentas/registo-ferramentas.service.js';

function arg(nome: string): string | undefined {
  const i = process.argv.indexOf(`--${nome}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const tem = (nome: string) => process.argv.includes(`--${nome}`);

/** code/api/agente-voz (o script corre de dist/scripts ou de src/scripts). */
export const PASTA = join(__dirname, '..', '..', 'agente-voz');

async function dadosMunicipio(
  db: DatabaseService,
  slug: string,
): Promise<{ dados: DadosMunicipio; erro: string | null }> {
  const vazio: DadosMunicipio = {
    slug,
    nome: null,
    nome_agente: null,
    saudacao: null,
    trata_por: null,
    idiomas: null,
    voz_id: null,
    voz_nome: null,
    ritmo: null,
    elevenlabs_agent_id: null,
    fuso: null,
  };
  try {
    const [m] = await db.query<Omit<DadosMunicipio, 'slug'>>(
      `SELECT m.nome, m.fuso, a.nome AS nome_agente, a.saudacao, a.trata_por, a.idiomas,
              a.voz_id, a.voz_nome, a.ritmo, a.elevenlabs_agent_id
       FROM municipios m LEFT JOIN agente_config a ON a.municipio_id = m.id
       WHERE m.slug = $1`,
      [slug],
    );
    if (!m)
      return { dados: vazio, erro: `O município "${slug}" não existe na BD.` };
    return { dados: { ...vazio, ...m, slug }, erro: null };
  } catch (e) {
    return { dados: vazio, erro: `BD inacessível (${(e as Error).message}).` };
  }
}

function json(v: unknown): string {
  return `${JSON.stringify(v, null, 2)}\n`;
}

function mostrarAvisos(avisos: Aviso[]) {
  if (avisos.length === 0) return;
  const perdas = avisos.filter((a) => a.nivel === 'perda');
  const notas = avisos.filter((a) => a.nivel === 'nota');
  if (perdas.length) {
    console.log(
      `\n⚠ ${perdas.length} parâmetro(s) que o ElevenLabs não consegue exprimir:`,
    );
    for (const a of perdas)
      console.log(`  - ${a.ferramenta}.${a.caminho}: ${a.mensagem}`);
  }
  if (notas.length) {
    console.log(
      `\n· ${notas.length} ajuste(s) (ver "avisos" em ferramentas.json):`,
    );
    for (const a of notas)
      console.log(`  - ${a.ferramenta}.${a.caminho}: ${a.mensagem}`);
  }
}

function mostrarPlano(p: Plano, comAgente: boolean) {
  const lista = (titulo: string, itens: string[]) => {
    if (itens.length)
      console.log(
        `\n${titulo} (${itens.length}):\n${itens.map((i) => `  - ${i}`).join('\n')}`,
      );
  };
  console.log(`\nFerramentas iguais: ${p.iguais.length}`);
  lista(
    'Em falta no ElevenLabs (criar)',
    p.criar.map((f) => f.name),
  );
  lista(
    'Alteradas (atualizar)',
    p.atualizar.map(
      (a) =>
        `${a.ferramenta.name}: ${a.campos.slice(0, 4).join(', ')}${a.campos.length > 4 ? ` (+${a.campos.length - 4})` : ''}`,
    ),
  );
  lista(
    'Nome ocupado por uma ferramenta que não é nossa (não se mexe; apaga ou muda o nome à mão)',
    p.conflitos.map((c) => `${c.nome} → ${c.url ?? 'sem URL'} (${c.id})`),
  );
  lista(
    'Nossas que já não existem na API (saem do agente; não se apagam)',
    p.obsoletas.map((o) => `${o.nome} (${o.id})`),
  );
  if (!comAgente) {
    console.log(
      '\nSem id do agente: não se compara o prompt nem a lista de ferramentas do agente.',
    );
    return;
  }
  lista('Por ligar ao agente', p.porLigar);
  lista('A mais no agente (por desligar)', p.porDesligar);
  lista(
    'Outras ferramentas do agente (ficam)',
    p.alheiasNoAgente.map((a) => a.nome),
  );
  if (p.prompt && !p.prompt.igual) {
    console.log(
      `\nPrompt diferente: +${p.prompt.linhasNovas.length} / -${p.prompt.linhasSaem.length} linhas`,
    );
    for (const l of p.prompt.linhasNovas.slice(0, 8))
      console.log(`  + ${l.slice(0, 120)}`);
    for (const l of p.prompt.linhasSaem.slice(0, 8))
      console.log(`  - ${l.slice(0, 120)}`);
  } else if (p.prompt) {
    console.log('\nPrompt igual.');
  }
  lista('Definições do agente diferentes (agente.json)', p.agente);
}

async function main() {
  const comando = process.argv[2];
  if (comando !== 'gerar' && comando !== 'diff' && comando !== 'sincronizar') {
    throw new Error(
      'Uso: npm run agente-voz -- gerar | diff | sincronizar [--municipio guimaraes] [--agente <id>] [--confirmar] [--criar-segredo]',
    );
  }
  process.env.MIGRACOES_NO_ARRANQUE = 'false';
  process.env.JOBS_WORKERS = 'false';
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error'],
  });
  try {
    const slug = arg('municipio') ?? 'guimaraes';
    const registadas = app.get(RegistoFerramentas).todas();
    const { dados, erro } = await dadosMunicipio(
      app.get(DatabaseService),
      slug,
    );
    const ferramentas = gerarFerramentas(registadas);
    mkdirSync(PASTA, { recursive: true });
    writeFileSync(join(PASTA, 'ferramentas.json'), json(ferramentas));
    if (erro && !tem('sem-bd')) {
      // Sem os dados do município, o prompt e o agente.json perdiam valores:
      // ficam como estão (--sem-bd escreve-os na mesma, com null).
      console.log(
        `⚠ ${erro} Só se escreveu o ferramentas.json (${ferramentas.ferramentas.length} ferramentas); prompt.md e agente.json ficaram como estavam. Use --sem-bd para os gerar com null.`,
      );
      mostrarAvisos(ferramentas.avisos);
      if (comando !== 'gerar') {
        throw new Error(
          'Sem a BD não se sabe o agente nem o prompt: não se compara.',
        );
      }
      return;
    }
    const prompt = gerarPrompt(dados, registadas);
    const agente = gerarAgente(dados);
    writeFileSync(join(PASTA, 'prompt.md'), prompt);
    writeFileSync(join(PASTA, 'agente.json'), json(agente));
    console.log(
      `Gerado em ${PASTA}: ${ferramentas.ferramentas.length} ferramentas, prompt.md e agente.json (${slug}).`,
    );
    mostrarAvisos(ferramentas.avisos);
    if (comando === 'gerar') return;

    const config = app.get(ConfigService);
    const apiKey = config.get<string>('webhooks.elevenlabsApiKey') ?? '';
    if (!apiKey) {
      console.log(
        '\nSem ELEVENLABS_API_KEY: só se geraram os ficheiros. Não se leu nem mudou nada no ElevenLabs.',
      );
      return;
    }
    const apiUrl = config.get<string>('app.apiUrl') ?? '';
    const publico =
      /^https:\/\//.test(apiUrl) && !/localhost|127\.0\.0\.1/.test(apiUrl);
    if (!publico) {
      console.log(
        `\n⚠ API_URL = ${apiUrl}: o ElevenLabs só chega a um endereço HTTPS público.`,
      );
    }
    const agenteId = arg('agente') ?? dados.elevenlabs_agent_id;
    // --base: outra região do ElevenLabs (ex.: residência de dados na UE).
    const cliente = new ClienteElevenLabs(
      apiKey,
      fetch,
      arg('base') ?? URL_ELEVENLABS,
    );

    let segredos = await cliente.segredos();
    const faltam = segredosReferidos([ferramentas, agente]).filter(
      (n) => !segredos.has(n),
    );
    if (faltam.length) {
      if (
        comando === 'sincronizar' &&
        tem('confirmar') &&
        tem('criar-segredo') &&
        faltam.includes(SEGREDO_AGENTE)
      ) {
        const valor = config.get<string>('agente.segredo') ?? '';
        if (!valor)
          throw new Error(
            'AGENTE_SEGREDO vazio: não há o que guardar no ElevenLabs.',
          );
        await cliente.criarSegredo(SEGREDO_AGENTE, valor);
        console.log(`✓ Segredo "${SEGREDO_AGENTE}" criado no ElevenLabs.`);
        segredos = await cliente.segredos();
      } else {
        console.log(
          `\n⚠ Falta(m) no ElevenLabs o(s) segredo(s): ${faltam.join(', ')}. Cria em Agents › Secrets com o valor do AGENTE_SEGREDO (ou usa sincronizar --confirmar --criar-segredo).`,
        );
        // Para o diff: compara com um id fictício, para mostrar o resto.
        for (const n of faltam) segredos.set(n, `(em falta: ${n})`);
      }
    }
    const resolucao = { apiUrl, municipio: slug, segredos };
    const desejado: Desejado = {
      ferramentas: resolver(ferramentas.ferramentas, resolucao),
      prompt,
      agente: resolver(
        {
          conversation_config: agente.conversation_config,
          platform_settings: agente.platform_settings,
        },
        resolucao,
      ),
    };
    const remotas = await cliente.ferramentas();
    const remoto = agenteId ? await cliente.agente(agenteId) : null;
    if (!agenteId)
      console.log(
        '\n⚠ Sem id do agente (agente_config.elevenlabs_agent_id ou --agente).',
      );
    const plano = planear(desejado, remotas, remoto);
    mostrarPlano(plano, !!remoto);

    if (semAlteracoes(plano)) {
      console.log('\n✓ O ElevenLabs está igual ao repositório.');
      return;
    }
    if (comando === 'diff') return;
    if (!tem('confirmar')) {
      console.log(
        '\nNada foi alterado. Para aplicar: npm run agente-voz -- sincronizar --confirmar',
      );
      return;
    }
    if (
      faltam.some(
        (n) => !segredos.get(n) || segredos.get(n)!.startsWith('(em falta'),
      )
    ) {
      throw new Error(
        'Não se sincroniza sem o segredo das ferramentas no ElevenLabs.',
      );
    }
    if (!publico)
      throw new Error('API_URL tem de ser HTTPS público para sincronizar.');
    const r = await aplicar(
      cliente,
      plano,
      desejado,
      remotas,
      agenteId ?? null,
      remoto,
    );
    console.log(
      `\n✓ Sincronizado: ${r.criadas.length} criadas, ${r.atualizadas.length} atualizadas${r.agenteAtualizado ? `, agente com ${r.toolIds.length} ferramentas e o prompt novo` : ''}.`,
    );
  } finally {
    await app.close();
  }
}

main().catch((e: Error) => {
  console.error(`✗ ${e.message}`);
  process.exit(1);
});
