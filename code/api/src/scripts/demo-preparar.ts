/**
 * Prepara a câmara de demonstração sem HTTP (o mesmo DemoService do painel).
 *   npm run demo:preparar -- [--municipio guimaraes] [--limpar] [--confirmar]
 *   npm run demo:preparar -- --repor
 * Sem --confirmar é um ensaio: mostra o que faria e não muda nada.
 * --repor volta a mostrar o que "--limpar" escondeu.
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module.js';
import type { UtilizadorPainel } from '../common/pedido.js';
import { DatabaseService } from '../database/database.service.js';
import { DemoService } from '../modules/demo/demo.service.js';
import { MunicipiosService } from '../modules/municipios/municipios.service.js';

function arg(nome: string): string | undefined {
  const i = process.argv.indexOf(`--${nome}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const tem = (nome: string) => process.argv.includes(`--${nome}`);

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  try {
    const m = await app
      .get(MunicipiosService)
      .porSlug(arg('municipio') ?? 'guimaraes');
    // O autor nas auditorias: a chefia do município (ou a administração).
    const [u] = await app.get(DatabaseService).query<{
      id: string;
      nome: string;
      email: string;
      perfil: UtilizadorPainel['perfil'];
      municipio_id: string | null;
    }>(
      `SELECT id, nome, email, perfil, municipio_id FROM utilizadores
       WHERE ativo AND (municipio_id = $1 OR municipio_id IS NULL)
         AND perfil IN ('chefe_divisao', 'admin', 'equipa_toucamara')
       ORDER BY (municipio_id IS NULL), (perfil <> 'chefe_divisao'), criado_em
       LIMIT 1`,
      [m.id],
    );
    if (!u) {
      throw new Error(
        `${m.nome} não tem um utilizador de chefia ou administração para assinar a preparação.`,
      );
    }
    const utilizador: UtilizadorPainel = {
      id: u.id,
      nome: u.nome,
      email: u.email,
      perfil: u.perfil,
      municipioId: u.municipio_id,
    } as UtilizadorPainel;
    const demo = app.get(DemoService);
    const r = tem('repor')
      ? await demo.reporOcultos(m, utilizador)
      : await demo.preparar(m, utilizador, {
          limpar_testes: tem('limpar'),
          confirmar: tem('confirmar'),
        });
    console.log(`${m.nome} · como ${u.nome} (${u.perfil})`);
    console.log(JSON.stringify(r, null, 2));
  } finally {
    await app.close();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
