import {
  codigoResumo,
  confereIdentidade,
  confirmacaoClara,
  ESTADOS,
  estadoEfetivo,
  expirou,
  final,
  mascararNif,
  mascararTelefone,
  numeroEntradaDemo,
  podePassar,
  ResumoPedido,
  resumoFalado,
  validadeHoras,
} from './regras.js';

const resumo: ResumoPedido = {
  tipo: { codigo: 'CP', nome: 'Comunicação prévia' },
  requerente: 'Conceição Araújo',
  campos: [
    { rotulo: 'Morada da obra', valor: 'Rua Direita, 10' },
    { rotulo: 'Descrição', valor: 'Abrir uma porta' },
  ],
  documentos: { entregues: [], em_falta: ['Termo de responsabilidade'] },
};

describe('estados da entrega', () => {
  it('segue preparado → à espera → autorizado → entregue', () => {
    expect(podePassar('preparado', 'a_espera_autorizacao')).toBe(true);
    expect(podePassar('a_espera_autorizacao', 'autorizado')).toBe(true);
    expect(podePassar('autorizado', 'entregue')).toBe(true);
  });

  it('não entrega sem autorização nem duas vezes', () => {
    expect(podePassar('preparado', 'entregue')).toBe(false);
    expect(podePassar('a_espera_autorizacao', 'entregue')).toBe(false);
    expect(podePassar('entregue', 'entregue')).toBe(false);
    expect(podePassar('expirado', 'autorizado')).toBe(false);
    expect(podePassar('cancelado', 'a_espera_autorizacao')).toBe(false);
  });

  it('uma falha depois de autorizado tenta-se de novo; entregue não se cancela', () => {
    expect(podePassar('autorizado', 'falhou')).toBe(true);
    expect(podePassar('falhou', 'entregue')).toBe(true);
    expect(podePassar('entregue', 'cancelado')).toBe(false);
    expect(podePassar('autorizado', 'cancelado')).toBe(false);
  });

  it('finais: entregue, expirado e cancelado', () => {
    expect(ESTADOS.filter(final)).toEqual([
      'entregue',
      'expirado',
      'cancelado',
    ]);
  });
});

describe('expiração do link', () => {
  const limite = new Date('2026-10-22T10:00:00Z');
  it('só expira o que está à espera da pessoa', () => {
    const depois = new Date('2026-10-22T10:00:01Z');
    expect(expirou('a_espera_autorizacao', limite, depois)).toBe(true);
    expect(expirou('preparado', limite, depois)).toBe(true);
    expect(expirou('autorizado', limite, depois)).toBe(false);
    expect(expirou('entregue', limite, depois)).toBe(false);
    expect(estadoEfetivo('a_espera_autorizacao', limite, depois)).toBe(
      'expirado',
    );
  });
  it('antes do limite continua à espera', () => {
    const antes = new Date('2026-10-22T09:59:59Z');
    expect(estadoEfetivo('a_espera_autorizacao', limite, antes)).toBe(
      'a_espera_autorizacao',
    );
  });
  it('validade em horas: 24 por omissão, entre 1 h e 7 dias', () => {
    expect(validadeHoras(undefined)).toBe(24);
    expect(validadeHoras('')).toBe(24);
    expect(validadeHoras('2')).toBe(2);
    expect(validadeHoras('0')).toBe(24);
    expect(validadeHoras('999')).toBe(24);
    expect(validadeHoras('abc')).toBe(24);
  });
});

describe('resumo confirmado', () => {
  it('o código muda quando os dados mudam, não quando chega um documento', () => {
    const c = codigoResumo(resumo);
    expect(c).toMatch(/^[0-9a-f]{10}$/);
    expect(
      codigoResumo({
        ...resumo,
        documentos: { entregues: ['Termo de responsabilidade'], em_falta: [] },
      }),
    ).toBe(c);
    expect(
      codigoResumo({
        ...resumo,
        campos: [{ rotulo: 'Morada da obra', valor: 'Rua Torta, 1' }],
      }),
    ).not.toBe(c);
  });

  it('o resumo falado diz o pedido, os dados e o que falta', () => {
    const t = resumoFalado(resumo);
    expect(t).toContain('Comunicação prévia');
    expect(t).toContain('Conceição Araújo');
    expect(t).toContain('Morada da obra: Rua Direita, 10');
    expect(t).toContain('Ainda falta entregar: Termo de responsabilidade');
  });

  it.each([
    'Sim, pode entregar',
    'sim',
    'Confirmo.',
    'Está certo, avance',
    'Autorizo',
  ])('"%s" é uma confirmação clara', (p) => {
    expect(confirmacaoClara(p)).toBe(true);
  });

  it.each([
    'Não',
    'não, espere',
    'talvez depois',
    'hmm',
    '',
    'sim... não, não entregue',
  ])('"%s" não chega para entregar', (p) => {
    expect(confirmacaoClara(p)).toBe(false);
  });
});

describe('identidade', () => {
  it('mascara o NIF e o telefone', () => {
    expect(mascararNif('123456789')).toBe('******789');
    expect(mascararNif(null)).toBeNull();
    expect(mascararTelefone('+351912345567')).toBe('+3519•• ••• 567');
  });

  it('com NIF na câmara tem de ser o mesmo', () => {
    expect(
      confereIdentidade(
        { nif: '123456789' },
        { tem_nif: true, mesmoNif: true },
      ),
    ).toEqual({ ok: true, nif_confirmado: true });
    expect(
      confereIdentidade(
        { nif: '123456789' },
        { tem_nif: true, mesmoNif: false },
      ),
    ).toMatchObject({ ok: false, codigo: 'outra_pessoa' });
  });

  it('sem NIF na câmara aceita o da autenticação; sem NIF nenhum recusa', () => {
    expect(
      confereIdentidade(
        { nif: '123456789' },
        { tem_nif: false, mesmoNif: null },
      ),
    ).toEqual({ ok: true, nif_confirmado: false });
    expect(
      confereIdentidade({ nif: null }, { tem_nif: true, mesmoNif: null }),
    ).toMatchObject({ ok: false, codigo: 'sem_nif' });
  });
});

describe('número de entrada de demonstração', () => {
  it('começa por DEMO', () => {
    expect(numeroEntradaDemo(2026, 7)).toBe('DEMO-2026/000007');
  });
});
