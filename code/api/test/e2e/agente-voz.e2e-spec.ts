import { readFileSync } from 'fs';
import { join } from 'path';
import {
  ferramentasDoAgente,
  gerarFerramentas,
} from '../../src/agente-voz/configuracao';
import { validarElevenLabs } from '../../src/agente-voz/esquema-elevenlabs';
import { LIMITE_TOKENS, medir } from '../../src/agente-voz/medir';
import { AGENTES_VOZ } from '../../src/agente-voz/prompt-voz';
import { RegistoFerramentas } from '../../src/ferramentas/registo-ferramentas.service';
import { arrancarApp, Contexto, ferramenta, novaChamada } from './app';

/**
 * agente-voz/<agente>/ferramentas.json é o que sai do registo real das
 * ferramentas: se alguém muda uma ferramenta (nome, descrição, zod,
 * agentes) e não corre `npm run agente-voz -- gerar`, isto falha.
 */
describe('Agente de voz: entrada e saída (e2e)', () => {
  let ctx: Contexto;

  beforeAll(async () => {
    ctx = await arrancarApp();
  });
  afterAll(() => ctx.fechar());

  it.each(AGENTES_VOZ)(
    'gerar a partir do registo dá exatamente o ficheiro versionado (%s)',
    (agente) => {
      const registo = ctx.app.get(RegistoFerramentas);
      const gerado = gerarFerramentas(
        ferramentasDoAgente(registo.todas(), agente),
        agente,
      );
      const versionado = JSON.parse(
        readFileSync(
          join(__dirname, '..', '..', 'agente-voz', agente, 'ferramentas.json'),
          'utf8',
        ),
      ) as unknown;
      expect(JSON.parse(JSON.stringify(gerado))).toEqual(versionado);
      expect(medir(gerado.ferramentas).total).toBeLessThanOrEqual(
        LIMITE_TOKENS[agente],
      );
    },
  );

  it('o registo dá a cada agente o seu conjunto (o chat sem as das chamadas da câmara)', () => {
    const registo = ctx.app.get(RegistoFerramentas);
    const nomes = (a: 'entrada' | 'saida' | 'chat') =>
      registo.doAgente(a).map((f) => f.nome);
    const saida = nomes('saida');
    for (const n of [
      'motivo_da_chamada',
      'resposta_campanha',
      'resposta_emergencia',
      'explicar_momento',
      'nao_quero_chamadas',
      'procurar_conhecimento',
      'passar_a_humano',
      'emergencia',
      'estado_processo',
      'identificar_municipe',
      'encaminhar',
      'renovar_licenca',
    ]) {
      expect(saida).toContain(n);
    }
    expect(saida).not.toContain('pedir_licenca');
    expect(saida).not.toContain('marcar');
    const entrada = nomes('entrada');
    for (const n of [
      'motivo_da_chamada',
      'resposta_campanha',
      'explicar_momento',
    ])
      expect(entrada).not.toContain(n);
    expect(entrada).toEqual(
      expect.arrayContaining([
        'campos_da_licenca',
        'pedir_licenca',
        'renovar_licenca',
        'estado_familiar',
        'nao_quero_chamadas',
        'resposta_emergencia',
      ]),
    );
    const chat = nomes('chat');
    expect(chat).not.toContain('motivo_da_chamada');
    expect(chat).not.toContain('resposta_campanha');
    expect(chat).toEqual(
      expect.arrayContaining(['pedir_licenca', 'explicar_momento']),
    );
    // As antigas, uma por tipo, já não existem.
    expect(registo.todas().map((f) => f.nome)).not.toContain(
      'pedir_licenca_ruido',
    );
  });

  it('todas as ferramentas registadas convertem para o ElevenLabs', () => {
    const registo = ctx.app.get(RegistoFerramentas);
    const { ferramentas, avisos } = gerarFerramentas(registo.todas());
    expect(ferramentas.length).toBe(registo.todas().length);
    for (const f of ferramentas) {
      const corpo = f.api_schema.request_body_schema;
      if (corpo) expect(validarElevenLabs(corpo, f.name)).toEqual([]);
    }
    // A única perda conhecida: os campos livres do preencher_campo (z.record).
    expect(
      avisos
        .filter((a) => a.nivel === 'perda')
        .map((a) => `${a.ferramenta}.${a.caminho}`),
    ).toEqual(['preencher_campo.campos']);
    // Enums e opcionais passam (redigir: tipo obrigatório, destinatário opcional).
    const redigir = ferramentas.find((f) => f.name === 'redigir')!.api_schema
      .request_body_schema!;
    expect(redigir.properties.tipo).toEqual(
      expect.objectContaining({ enum: ['reclamacao', 'email', 'pedido'] }),
    );
    expect(redigir.required).not.toContain('destinatario');
  });

  it('uma ferramenta que não é do agente corre na mesma pelo nome (a rota é uma só)', async () => {
    const r = await ferramenta(ctx, novaChamada(), 'motivo_da_chamada').expect(
      200,
    );
    expect(r.body).toMatchObject({ chamada_de_saida: false });
  });
});
