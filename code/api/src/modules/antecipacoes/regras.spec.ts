import {
  avaliar,
  Candidato,
  canalPreferido,
  chaveMomento,
  CONFIG_OMISSAO,
  configDe,
  recuarDiasUteis,
  regimeDe,
  somarMeses,
  textos,
  TIPOS_MOMENTO,
} from './regras.js';

const SEM_FERIADOS = new Set<string>();
// 2026-10-22 é quinta-feira; 2026-12-08 (terça) é feriado nacional.
const HOJE = '2026-10-22';

function cand(o: Partial<Candidato> = {}): Candidato {
  return {
    tipo: 'prazo_municipe',
    objeto_id: 'p1',
    municipio_id: 'm1',
    municipe_id: 'u1',
    processo: {
      id: 'proc1',
      numero: 'CP 12/2026',
      assunto: 'Muro',
      tipo_codigo: 'CP',
    },
    data_alvo: '2026-10-27',
    inicio: '2026-10-13',
    descricao: 'Certidão do registo predial',
    ...o,
  };
}

describe('antecipações · datas', () => {
  it('recua dias úteis saltando fins de semana', () => {
    // 27/10 (terça) − 3 úteis = 22/10 (quinta).
    expect(recuarDiasUteis('2026-10-27', 3, SEM_FERIADOS)).toBe('2026-10-22');
    // 26/10 (segunda) − 1 útil = 23/10 (sexta).
    expect(recuarDiasUteis('2026-10-26', 1, SEM_FERIADOS)).toBe('2026-10-23');
    expect(recuarDiasUteis('2026-10-26', 0, SEM_FERIADOS)).toBe('2026-10-26');
  });

  it('recua dias úteis saltando feriados', () => {
    const feriados = new Set(['2026-12-08']);
    // 10/12 (quinta) − 2 úteis: 09/12, (08/12 feriado) 07/12.
    expect(recuarDiasUteis('2026-12-10', 2, feriados)).toBe('2026-12-07');
    expect(recuarDiasUteis('2026-12-10', 2, SEM_FERIADOS)).toBe('2026-12-08');
  });

  it('soma meses com o fim do mês', () => {
    expect(somarMeses('2026-01-31', 1)).toBe('2026-02-28');
    expect(somarMeses('2026-10-22', -12)).toBe('2025-10-22');
    expect(somarMeses('2025-11-01', 12)).toBe('2026-11-01');
  });
});

describe('antecipações · avaliar', () => {
  const cfg = CONFIG_OMISSAO.prazo_municipe;

  it('prazo do munícipe: devido a 3 dias úteis do fim', () => {
    const m = avaliar(cand(), cfg, HOJE, SEM_FERIADOS)!;
    expect(m.contactar_em).toBe('2026-10-22');
    expect(m.faltam_dias_uteis).toBe(3);
    expect(m.devido).toBe(true);
    expect(m.gravidade).toBe('alta');
    expect(m.chave).toBe('prazo_municipe:p1:2026-10-27');
  });

  it('ainda não é devido antes da antecedência', () => {
    const m = avaliar(
      cand({ data_alvo: '2026-10-30' }),
      cfg,
      HOJE,
      SEM_FERIADOS,
    )!;
    expect(m.devido).toBe(false);
    expect(m.contactar_em).toBe('2026-10-27');
  });

  it('um feriado empurra o dia do contacto para trás', () => {
    // Alvo 10/12; 3 úteis antes sem feriado = 07/12; com o 08/12 = 04/12.
    const c = cand({ data_alvo: '2026-12-10', inicio: '2026-11-20' });
    expect(avaliar(c, cfg, '2026-12-04', SEM_FERIADOS)!.devido).toBe(false);
    expect(avaliar(c, cfg, '2026-12-04', new Set(['2026-12-08']))!.devido).toBe(
      true,
    );
  });

  it('a data já passou: não há momento', () => {
    expect(
      avaliar(cand({ data_alvo: '2026-10-21' }), cfg, HOJE, SEM_FERIADOS),
    ).toBeNull();
  });

  it('pedido curto (começou dentro da janela) não leva aviso', () => {
    const m = avaliar(cand({ inicio: '2026-10-23' }), cfg, HOJE, SEM_FERIADOS)!;
    expect(m.devido).toBe(false);
  });

  it('a antecedência configurável muda o dia do contacto', () => {
    const c = cand({ data_alvo: '2026-11-05', inicio: '2026-10-01' });
    expect(avaliar(c, cfg, HOJE, SEM_FERIADOS)!.devido).toBe(false);
    const m = avaliar(
      c,
      { ...cfg, antecedencia_dias_uteis: 10 },
      HOJE,
      SEM_FERIADOS,
    )!;
    expect(m.devido).toBe(true);
    expect(m.contactar_em).toBe('2026-10-22');
  });

  it('tipo desligado nunca é devido', () => {
    expect(
      avaliar(cand(), { ...cfg, ativo: false }, HOJE, SEM_FERIADOS)!.devido,
    ).toBe(false);
  });

  it('idempotência: a chave é a mesma para a mesma data alvo', () => {
    const a = avaliar(cand(), cfg, HOJE, SEM_FERIADOS)!;
    const b = avaliar(cand(), cfg, '2026-10-23', SEM_FERIADOS)!;
    expect(a.chave).toBe(b.chave);
    // Prazo prorrogado → nova data alvo → novo momento.
    expect(chaveMomento({ ...a, data_alvo: '2026-11-03' })).not.toBe(a.chave);
  });

  it('audiência prévia: contacta logo ao abrir (10 dias úteis)', () => {
    const m = avaliar(
      cand({
        tipo: 'audiencia_previa',
        objeto_id: 'proc1',
        inicio: HOJE,
        data_alvo: '2026-11-05',
      }),
      CONFIG_OMISSAO.audiencia_previa,
      HOJE,
      SEM_FERIADOS,
    )!;
    expect(m.devido).toBe(true);
    expect(m.confirmar_jurista).toBe(true);
  });

  it('prazo da câmara: sobe a alta a 1 dia útil', () => {
    const c = cand({ tipo: 'prazo_camara', data_alvo: '2026-10-26' });
    const m = avaliar(c, CONFIG_OMISSAO.prazo_camara, HOJE, SEM_FERIADOS)!;
    expect(m.faltam_dias_uteis).toBe(2);
    expect(m.gravidade).toBe('media');
    const m2 = avaliar(
      c,
      CONFIG_OMISSAO.prazo_camara,
      '2026-10-23',
      SEM_FERIADOS,
    )!;
    expect(m2.gravidade).toBe('alta');
  });

  it('caducidade: 20 dias úteis antes', () => {
    const m = avaliar(
      cand({ tipo: 'caducidade_alvara', data_alvo: '2026-11-03' }),
      CONFIG_OMISSAO.caducidade_alvara,
      HOJE,
      SEM_FERIADOS,
    )!;
    expect(m.devido).toBe(true);
    expect(m.fonte_legal).toMatch(/art\. 71\.º/);
  });

  it('pagamento a vencer e licença a expirar', () => {
    const p = avaliar(
      cand({ tipo: 'pagamento_a_vencer', data_alvo: '2026-10-26' }),
      CONFIG_OMISSAO.pagamento_a_vencer,
      HOJE,
      SEM_FERIADOS,
    )!;
    expect(p.devido).toBe(true);
    const l = avaliar(
      cand({ tipo: 'licenca_expira', data_alvo: '2026-10-30' }),
      CONFIG_OMISSAO.licenca_expira,
      HOJE,
      SEM_FERIADOS,
    )!;
    // As licenças contactam-se pelo job dos avisos das licenças.
    expect(l.devido).toBe(false);
  });
});

describe('antecipações · configuração', () => {
  it('sem nada guardado: valores por omissão, de demonstração', () => {
    const c = configDe({});
    for (const t of TIPOS_MOMENTO) {
      expect(c[t].demonstracao).toBe(true);
      expect(c[t].antecedencia_dias_uteis).toBe(
        CONFIG_OMISSAO[t].antecedencia_dias_uteis,
      );
    }
  });

  it('o guardado substitui; o inválido fica pela omissão', () => {
    const c = configDe({
      prazo_municipe: {
        ativo: false,
        antecedencia_dias_uteis: 5,
        canal: 'chamada',
      },
      prazo_camara: { antecedencia_dias_uteis: 999, canal: 'x' as never },
      licenca_expira: { antecedencia_dias_uteis: 9 },
    });
    expect(c.prazo_municipe).toEqual({
      ativo: false,
      antecedencia_dias_uteis: 5,
      canal: 'chamada',
      demonstracao: false,
    });
    expect(c.prazo_camara.antecedencia_dias_uteis).toBe(3);
    expect(c.prazo_camara.canal).toBe('auto');
    // A licença não se configura aqui.
    expect(c.licenca_expira.demonstracao).toBe(true);
    expect(c.licenca_expira.antecedencia_dias_uteis).toBe(0);
  });
});

describe('antecipações · canal', () => {
  it('auto: liga nos importantes e a quem não tem app', () => {
    expect(
      canalPreferido({ gravidade: 'alta', canal: 'auto', temApp: true }),
    ).toBe('chamada');
    expect(
      canalPreferido({ gravidade: 'media', canal: 'auto', temApp: false }),
    ).toBe('chamada');
    expect(
      canalPreferido({ gravidade: 'media', canal: 'auto', temApp: true }),
    ).toBe('notificacao');
    expect(
      canalPreferido({ gravidade: 'baixa', canal: 'auto', temApp: false }),
    ).toBe('notificacao');
  });

  it('a câmara pode fixar o canal', () => {
    expect(
      canalPreferido({
        gravidade: 'alta',
        canal: 'notificacao',
        temApp: false,
      }),
    ).toBe('notificacao');
    expect(
      canalPreferido({ gravidade: 'baixa', canal: 'chamada', temApp: true }),
    ).toBe('chamada');
  });
});

describe('antecipações · textos', () => {
  const d = { municipio: 'Câmara de Teste', link: 'https://x/r/abc' };

  it('prazo do munícipe: o que falta e até quando', () => {
    const m = avaliar(
      cand(),
      CONFIG_OMISSAO.prazo_municipe,
      HOJE,
      SEM_FERIADOS,
    )!;
    const t = textos(m, d);
    expect(t.sms).toContain('Certidão do registo predial');
    expect(t.sms).toContain('27/10');
    expect(t.sms).toContain(d.link);
    expect(t.dizer).toContain('27 de outubro');
    expect(t.o_que_pode_fazer).toMatch(/explique/);
  });

  it('prazo da câmara: regime e alerta interno sem prometer', () => {
    const base = cand({ tipo: 'prazo_camara', data_alvo: '2026-10-26' });
    const cp = textos(
      avaliar(base, CONFIG_OMISSAO.prazo_camara, HOJE, SEM_FERIADOS)!,
      d,
    );
    expect(cp.dizer).toMatch(/comunicação prévia/);
    expect(cp.dizer).toMatch(/confirme connosco/);
    expect(cp.alerta).toMatch(/comunicação prévia/);
    const lo = textos(
      avaliar(
        { ...base, processo: { ...base.processo!, tipo_codigo: 'LO' } },
        CONFIG_OMISSAO.prazo_camara,
        HOJE,
        SEM_FERIADOS,
      )!,
      d,
    );
    expect(lo.alerta).toBe(
      'O processo CP 12/2026 pode ficar tacitamente deferido em 2 dias úteis (26 de outubro) se não houver decisão.',
    );
    expect(lo.dizer).toMatch(/pode contar como aprovado/);
  });

  it('regime pelo código do tipo', () => {
    expect(regimeDe('CP')).toBe('comunicacao_previa');
    expect(regimeDe('LO')).toBe('licenciamento');
    expect(regimeDe('OV')).toBe('geral');
    expect(regimeDe(null)).toBe('geral');
  });

  it('taxa por pagar com o valor', () => {
    const t = textos(
      avaliar(
        cand({
          tipo: 'pagamento_a_vencer',
          valor_cent: 6470,
          data_alvo: '2026-10-26',
        }),
        CONFIG_OMISSAO.pagamento_a_vencer,
        HOJE,
        SEM_FERIADOS,
      )!,
      d,
    );
    expect(t.sms).toContain('64,70 €');
    expect(t.dizer).toContain('alvará');
  });
});
