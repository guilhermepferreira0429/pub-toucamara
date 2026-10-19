import {
  acaoAuditoria,
  FichaMunicipe,
  podeAnonimizarMunicipe,
  politicasEfetivas,
} from './retencao.js';

describe('políticas de retenção', () => {
  it('sem política do município valem as omissões do plano', () => {
    const p = politicasEfetivas([]);
    expect(p.map((x) => [x.objeto, x.guardar, x.acao, x.origem])).toEqual([
      ['gravacoes', '30 days', 'apagar', 'omissao'],
      ['transcricoes', '12 mons', 'anonimizar', 'omissao'],
      ['telefones_sem_processo', '30 days', 'anonimizar', 'omissao'],
      ['fotos_ocorrencias', '12 mons', 'apagar', 'omissao'],
    ]);
  });

  it('a política do município sobrepõe-se só ao seu objeto', () => {
    const p = politicasEfetivas([
      { objeto: 'gravacoes', guardar: '7 days', acao: 'apagar' },
    ]);
    expect(p[0]).toEqual({
      objeto: 'gravacoes',
      guardar: '7 days',
      acao: 'apagar',
      origem: 'municipio',
    });
    expect(p[1].origem).toBe('omissao');
  });

  it('gravações e fotos apagam-se; o resto anonimiza-se', () => {
    const [grav, transc, tel, fotos] = politicasEfetivas([]);
    expect(acaoAuditoria(grav)).toBe('apagar_retencao');
    expect(acaoAuditoria(fotos)).toBe('apagar_retencao');
    expect(acaoAuditoria(transc)).toBe('anonimizar');
    expect(acaoAuditoria(tel)).toBe('anonimizar');
  });
});

describe('podeAnonimizarMunicipe', () => {
  const limite = new Date('2026-09-19T00:00:00Z');
  const base: FichaMunicipe = {
    id: 'm1',
    criado_em: new Date('2026-08-01T10:00:00Z'),
    processos: 0,
    requerimentos: 0,
    marcacoes_futuras: 0,
    ocorrencias_abertas: 0,
    ultima_conversa_em: new Date('2026-08-02T10:00:00Z'),
  };

  it('sem nada pendente e sem contacto recente: anonimiza', () => {
    expect(podeAnonimizarMunicipe(base, limite)).toBe(true);
    expect(
      podeAnonimizarMunicipe({ ...base, ultima_conversa_em: null }, limite),
    ).toBe(true);
  });

  it('guarda quem tem processo, requerimento, marcação ou ocorrência aberta', () => {
    expect(podeAnonimizarMunicipe({ ...base, processos: 1 }, limite)).toBe(
      false,
    );
    expect(podeAnonimizarMunicipe({ ...base, requerimentos: 1 }, limite)).toBe(
      false,
    );
    expect(
      podeAnonimizarMunicipe({ ...base, marcacoes_futuras: 1 }, limite),
    ).toBe(false);
    expect(
      podeAnonimizarMunicipe({ ...base, ocorrencias_abertas: 1 }, limite),
    ).toBe(false);
  });

  it('guarda quem falou depois do limite ou é recente', () => {
    expect(
      podeAnonimizarMunicipe(
        { ...base, ultima_conversa_em: new Date('2026-10-01T00:00:00Z') },
        limite,
      ),
    ).toBe(false);
    expect(
      podeAnonimizarMunicipe(
        {
          ...base,
          criado_em: new Date('2026-10-01T00:00:00Z'),
          ultima_conversa_em: null,
        },
        limite,
      ),
    ).toBe(false);
  });
});
