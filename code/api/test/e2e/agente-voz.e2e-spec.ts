import { readFileSync } from 'fs';
import { join } from 'path';
import { gerarFerramentas } from '../../src/agente-voz/configuracao';
import { validarElevenLabs } from '../../src/agente-voz/esquema-elevenlabs';
import { RegistoFerramentas } from '../../src/ferramentas/registo-ferramentas.service';
import { arrancarApp, Contexto } from './app';

/**
 * agente-voz/ferramentas.json é o que sai do registo real das ferramentas:
 * se alguém muda uma ferramenta (nome, descrição, zod) e não corre
 * `npm run agente-voz -- gerar`, isto falha.
 */
describe('Agente de voz: ferramentas.json (e2e)', () => {
  let ctx: Contexto;

  beforeAll(async () => {
    ctx = await arrancarApp();
  });
  afterAll(() => ctx.fechar());

  it('gerar a partir do registo dá exatamente o ficheiro versionado', () => {
    const registo = ctx.app.get(RegistoFerramentas);
    const gerado = gerarFerramentas(registo.todas());
    const versionado = JSON.parse(
      readFileSync(
        join(__dirname, '..', '..', 'agente-voz', 'ferramentas.json'),
        'utf8',
      ),
    ) as unknown;
    expect(JSON.parse(JSON.stringify(gerado))).toEqual(versionado);
  });

  it('todas as ferramentas registadas convertem para o ElevenLabs', () => {
    const { ferramentas, avisos } = gerarFerramentas(
      ctx.app.get(RegistoFerramentas).todas(),
    );
    expect(ferramentas.length).toBe(
      ctx.app.get(RegistoFerramentas).todas().length,
    );
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
});
