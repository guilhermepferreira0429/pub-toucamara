import { z } from 'zod';
import {
  converterZod,
  validarElevenLabs,
} from '../../agente-voz/esquema-elevenlabs.js';
import {
  camposDaLicenca,
  entradaCamposLicenca,
  entradaPedirLicenca,
  ESQUEMAS_LICENCA,
  respostaCampos,
  respostaFaltas,
  validarLicenca,
} from './ferramentas.js';
import { TIPOS } from './tipos.js';

/** Um pedido válido de cada tipo (os mesmos dados dos e2e). */
const VALIDOS: Record<(typeof TIPOS)[number], Record<string, unknown>> = {
  ruido: {
    atividade: 'festa_privada',
    descricao: 'Festa de anos no quintal',
    morada: 'Rua Nova 5, Guimarães',
    data: '2026-12-05',
    hora_inicio: '20h',
    hora_fim: '23:00',
  },
  ocupacao_via: {
    equipamento: 'andaime',
    descricao: 'Pintar a fachada',
    morada: 'Rua de Santa Maria 10, Guimarães',
    data_inicio: '2026-12-01',
    dias: 10,
    area_m2: 8,
    passeio_livre_m: 1.5,
    ocupa_estrada: false,
  },
  esplanada: {
    estabelecimento: 'Café Central',
    morada: 'Largo do Toural 5, Guimarães',
    data_inicio: '2026-12-01',
    meses: 6,
    area_m2: 12,
    mesas: 4,
    passeio_livre_m: 2,
  },
  distico_residente: {
    morada: 'Rua da Rainha 20, Guimarães',
    matricula: 'AA-12-BB',
    disticos_ja_tem: 0,
    morada_comprovada: true,
    viatura_em_nome: true,
  },
  publicidade: {
    suporte: 'placa',
    estabelecimento: 'Sapataria Moderna',
    mensagem: 'Nome da loja',
    morada: 'Rua de Santo António 40, Guimarães',
    largura_m: 1,
    altura_m: 0.5,
    iluminado: false,
    no_proprio_estabelecimento: true,
    centro_historico: false,
    data_inicio: '2026-12-01',
    meses: 12,
  },
  recinto_improvisado: {
    descricao: 'Arraial de São João',
    morada: 'Largo da Oliveira, Guimarães',
    data_inicio: '2026-12-20',
    dias: 2,
    lotacao: 300,
    estruturas: ['palco', 'barracas'],
    musica: true,
  },
};

describe('licenças em duas ferramentas', () => {
  it.each(TIPOS)(
    'campos_da_licenca(%s): os campos do zod, com pergunta e formato',
    (tipo) => {
      const campos = camposDaLicenca(tipo);
      const forma = Object.keys(ESQUEMAS_LICENCA[tipo].shape);
      expect(campos.map((c) => c.campo)).toEqual(forma);
      for (const c of campos) {
        expect(c.pergunta.length).toBeGreaterThan(3);
        expect(c.formato).toBeTruthy();
      }
      // Os obrigatórios são os do zod (o que o pedido válido tem de ter).
      const obrigatorios = campos
        .filter((c) => c.obrigatorio)
        .map((c) => c.campo);
      for (const o of obrigatorios) expect(VALIDOS[tipo]).toHaveProperty(o);
      const r = respostaCampos(tipo);
      expect(r.instrucao).toContain(`tipo ${tipo}`);
    },
  );

  it('formatos e valores em linguagem simples', () => {
    const ruido = new Map(camposDaLicenca('ruido').map((c) => [c.campo, c]));
    expect(ruido.get('data')!.formato).toBe('data AAAA-MM-DD');
    expect(ruido.get('hora_inicio')!.formato).toBe('hora HH:MM');
    expect(ruido.get('atividade')!.valores).toEqual([
      'festa_privada',
      'evento',
      'obra',
    ]);
    expect(ruido.get('musica_amplificada')).toMatchObject({
      formato: 'sim ou não',
      obrigatorio: false,
    });
    const esplanada = new Map(
      camposDaLicenca('esplanada').map((c) => [c.campo, c]),
    );
    expect(esplanada.get('meses')!.formato).toBe('número inteiro (1 a 24)');
    const recinto = new Map(
      camposDaLicenca('recinto_improvisado').map((c) => [c.campo, c]),
    );
    expect(recinto.get('estruturas')!.valores).toEqual(
      expect.arrayContaining(['palco', 'tenda']),
    );
    expect(respostaCampos('publicidade').notas?.[0]).toMatch(
      /mera comunicação/,
    );
    expect(respostaCampos('recinto_improvisado').notas?.[0]).toMatch(/ruído/);
  });

  it.each(TIPOS)(
    'pedir_licenca(%s): dados completos passam no esquema do tipo',
    (tipo) => {
      // Primeiro o envelope (o que o registo valida), depois o tipo.
      const e = entradaPedirLicenca.parse({ tipo, dados: VALIDOS[tipo] });
      const v = validarLicenca(e.tipo, e.dados);
      expect(v).toMatchObject({ ok: true });
    },
  );

  it('a hora dita "20h" chega normalizada, como nas regras', () => {
    const v = validarLicenca('ruido', VALIDOS.ruido);
    expect(v.ok && v.dados.hora_inicio).toBe('20:00');
  });

  it('o que falta vem com a pergunta, em português, e sem pedir nada', () => {
    const { mesas: _m, passeio_livre_m: _p, ...semDois } = VALIDOS.esplanada;
    void _m;
    void _p;
    const v = validarLicenca('esplanada', semDois);
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.em_falta.map((f) => f.campo)).toEqual([
      'mesas',
      'passeio_livre_m',
    ]);
    const r = respostaFaltas('esplanada', v);
    expect(r).toMatchObject({ pedida: false, motivo: 'faltam_dados' });
    expect(r.instrucao).toContain('Ainda não se pediu a licença de esplanada');
    expect(r.instrucao).toContain('quantas mesas');
  });

  it('valores fora das regras do esquema → invalidos, com o problema dito', () => {
    const v = validarLicenca('esplanada', {
      ...VALIDOS.esplanada,
      meses: 40,
      data_inicio: '1 de dezembro',
    });
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.em_falta).toEqual([]);
    expect(v.invalidos).toEqual(
      expect.arrayContaining([
        { campo: 'meses', problema: 'tem de ser no máximo 24' },
        {
          campo: 'data_inicio',
          problema: 'formato errado (data AAAA-MM-DD)',
        },
      ]),
    );
    expect(respostaFaltas('esplanada', v).motivo).toBe('dados_invalidos');
  });

  it('os vazios que o modelo manda nos campos que não sabe não contam', () => {
    const v = validarLicenca('distico_residente', {
      ...VALIDOS.distico_residente,
      nome: '',
      metodo: null,
      mesas: undefined,
    });
    expect(v.ok).toBe(true);
  });

  it('o envelope tem todos os campos de todos os tipos, opcionais e curtos', () => {
    const j = z.toJSONSchema(entradaPedirLicenca, {
      io: 'input',
    }) as unknown as {
      properties: {
        dados: { properties: Record<string, unknown>; required?: string[] };
      };
    };
    const dados = j.properties.dados;
    for (const t of TIPOS) {
      for (const campo of Object.keys(ESQUEMAS_LICENCA[t].shape)) {
        expect(dados.properties).toHaveProperty(campo);
      }
    }
    expect(dados.required ?? []).toEqual([]);
  });

  it('as duas convertem para o ElevenLabs sem perdas', () => {
    for (const [nome, e] of [
      ['pedir_licenca', entradaPedirLicenca],
      ['campos_da_licenca', entradaCamposLicenca],
    ] as const) {
      const { esquema, avisos } = converterZod(nome, e);
      expect(avisos.filter((a) => a.nivel === 'perda')).toEqual([]);
      expect(validarElevenLabs(esquema!)).toEqual([]);
    }
  });
});
