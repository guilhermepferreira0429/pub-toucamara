import { HttpStatus } from '@nestjs/common';
import type { PedidoIa } from '../../ia/claude.service';
import { ErroApi } from '../../common/erros';
import { analisarPdf } from './analise-pdf';
import {
  leituraPerfeita,
  pdfDigitalizado,
  REF,
} from './ajudas-leitura.ajuda-spec';
import {
  avaliar,
  avaliarCaso,
  CasoAvaliacao,
  casosDemonstracao,
  ClienteLeitura,
  compararLeitura,
  contar,
  relatorioMarkdown,
  tabelaTexto,
} from './avaliacao-projetos';
import { DEFINICOES, PERFIS } from './perfis-verificacao';
import {
  interpretarLeitura,
  LeituraProjeto,
  SISTEMA_LEITURA_PROJETO,
} from './verificacoes';

/** IA falsa: responde pelo assunto do pedido (como a dos e2e). */
class IaFalsa implements ClienteLeitura {
  pedidos: PedidoIa[] = [];
  constructor(
    private readonly casos: CasoAvaliacao[],
    private readonly mexer: (
      chave: string,
      l: LeituraProjeto,
    ) => LeituraProjeto = (_c, l) => l,
  ) {}
  extrair(_esquema: unknown, pedido: PedidoIa): Promise<unknown> {
    this.pedidos.push(pedido);
    const assunto = /Assunto: (.*)/.exec(pedido.conteudo)?.[1];
    const c = this.casos.find((x) => x.assunto === assunto)!;
    return Promise.resolve(this.mexer(c.chave, leituraPerfeita(c.esperado!)));
  }
}

const relogio = () => {
  let t = Date.UTC(2026, 9, 22, 10, 0, 0);
  return () => new Date((t += 1500));
};

describe('casos de demonstração (os 8 tipos de operação)', () => {
  const casos = casosDemonstracao();

  it('um caso por tipo de operação, pela ordem dos perfis, todos com gabarito', () => {
    expect(casos.map((c) => c.perfil)).toEqual([...PERFIS]);
    for (const c of casos) {
      expect(c.esperado).not.toBeNull();
      expect(c.esperado!.tecnico).toBeTruthy();
      // O termo vai sempre no fim (como nas verificações).
      expect(c.documentos[c.documentos.length - 1].nome).toMatch(/termo/i);
    }
  });

  it('os PDF existem, têm texto e poucas páginas', async () => {
    for (const c of casos) {
      for (const d of c.documentos) {
        const a = analisarPdf(await d.ficheiro());
        expect(a).toMatchObject({ pdf: true, tem_texto: true });
        expect(a.paginas).toBeGreaterThan(0);
        expect(a.paginas).toBeLessThanOrEqual(3);
      }
    }
  });

  it('o gabarito cobre as medidas e os elementos de cada perfil', () => {
    for (const c of casos) {
      const d = DEFINICOES[c.perfil!];
      for (const g of d.grandezas)
        expect(c.esperado!.medicoes).toHaveProperty(g);
      for (const e of d.elementos)
        expect(c.esperado!.elementos).toHaveProperty(e);
    }
    // A fachada não tem a cércea cotada: a IA não pode pôr número.
    expect(
      casos.find((c) => c.chave === 'fachada')!.esperado!.medicoes,
    ).toEqual({ cercea_m: null });
    // A ampliação usa o valor do desenho (236 m²), não o da memória (230 m²).
    expect(
      casos.find((c) => c.chave === 'ampliacao')!.esperado!.medicoes
        .area_construcao_m2,
    ).toBe(236);
  });
});

describe('compararLeitura', () => {
  const caso = casosDemonstracao().find((c) => c.chave === 'construcao_nova')!;
  const docs = [
    { id: 'a', nome: 'Projeto de arquitetura', paginas: 3 },
    { id: 'b', nome: 'Termo de responsabilidade', paginas: 1 },
  ];
  const comparar = (l: unknown) =>
    compararLeitura({
      caso: caso.chave,
      perfil: caso.perfil,
      esperado: caso.esperado!,
      bruto: l,
      interpretado: interpretarLeitura(l, docs),
    });
  const por = (ls: ReturnType<typeof comparar>) =>
    Object.fromEntries(ls.map((l) => [l.campo, l]));

  it('a leitura perfeita acerta em tudo', () => {
    const ls = comparar(leituraPerfeita(caso.esperado!));
    expect(ls.every((l) => l.resultado === 'certo')).toBe(true);
    expect(contar(ls)).toMatchObject({
      errado: 0,
      em_falta: 0,
      inventado: 0,
      acerto: 1,
    });
  });

  it('errado, em falta, posto de parte e tolerância', () => {
    const l = leituraPerfeita(caso.esperado!);
    l.medicoes = l.medicoes
      .filter((m) => m.grandeza !== 'cercea_m')
      .map((m) =>
        m.grandeza === 'pisos'
          ? { ...m, valor: 3 }
          : m.grandeza === 'area_implantacao_m2'
            ? { ...m, valor: 181 } // dentro dos 2%
            : m.grandeza === 'afastamento_frente_m'
              ? { ...m, referencia: null } // sem folha: posto de parte
              : m,
      );
    const v = por(comparar(l));
    expect(v['medida:pisos']).toMatchObject({
      resultado: 'errado',
      lido: '3 pisos',
    });
    expect(v['medida:area_implantacao_m2'].resultado).toBe('certo');
    expect(v['medida:cercea_m']).toMatchObject({
      resultado: 'em_falta',
      lido: '—',
    });
    expect(v['medida:afastamento_frente_m']).toMatchObject({
      resultado: 'em_falta',
      nota: expect.stringContaining('sem indicação da folha') as unknown,
    });
  });

  it('um número que não está nos desenhos é "inventado"', () => {
    const fachada = casosDemonstracao().find((c) => c.chave === 'fachada')!;
    const l = leituraPerfeita(fachada.esperado!);
    l.medicoes.push({
      grandeza: 'cercea_m',
      valor: 9.2,
      unidade: 'm',
      referencia: REF,
    });
    const ls = compararLeitura({
      caso: 'fachada',
      perfil: 'fachada',
      esperado: fachada.esperado!,
      bruto: l,
      interpretado: interpretarLeitura(l, docs),
    });
    expect(ls.find((x) => x.campo === 'medida:cercea_m')).toMatchObject({
      resultado: 'inventado',
      esperado: 'não está nos desenhos',
      lido: '9,2 m',
    });
  });

  it('sem resposta válida: tudo em falta, nada inventado', () => {
    const ls = comparar({ legivel: true });
    expect(ls.length).toBeGreaterThan(5);
    expect(
      ls.every(
        (x) =>
          x.resultado === 'em_falta' || x.esperado === 'não está nos desenhos',
      ),
    ).toBe(true);
    expect(contar(ls).inventado).toBe(0);
    expect(ls[0].nota).toBe('sem resposta válida da IA');
  });

  it('elementos "incerto" contam como em falta; técnico com acentos e número com espaços', () => {
    const dem = casosDemonstracao().find((c) => c.chave === 'demolicao')!;
    const l = leituraPerfeita(dem.esperado!);
    l.elementos = [
      {
        elemento: 'plano_demolicao',
        resposta: 'incerto',
        descricao: '?',
        referencia: null,
      },
      {
        elemento: 'amianto',
        resposta: 'nao',
        descricao: 'Não refere.',
        referencia: null,
      },
    ];
    l.tecnico_autor = {
      ...l.tecnico_autor!,
      nome: 'Eng.ª CARLA NUNES',
      numero_inscricao: '78 901',
    };
    const v = por(
      compararLeitura({
        caso: 'demolicao',
        perfil: 'demolicao',
        esperado: dem.esperado!,
        bruto: l,
        interpretado: interpretarLeitura(l, docs),
      }),
    );
    expect(v['elemento:plano_demolicao'].resultado).toBe('em_falta');
    expect(v['elemento:amianto'].resultado).toBe('errado');
    expect(v.tecnico_nome.resultado).toBe('certo');
    expect(v.tecnico_numero.resultado).toBe('certo');
  });
});

describe('avaliar (com uma IA falsa)', () => {
  const casos = casosDemonstracao();

  it('manda o mesmo pedido das verificações e dá 100% com a leitura perfeita', async () => {
    const ia = new IaFalsa(casos);
    const r = await avaliar(casos, ia, {
      modelo: 'modelo-de-teste',
      agora: relogio(),
    });
    expect(ia.pedidos).toHaveLength(8);
    for (const p of ia.pedidos) {
      expect(p.sistema).toBe(SISTEMA_LEITURA_PROJETO);
      expect(p.maxTokens).toBe(16000);
      expect(p.conteudo).toMatch(/1\. .*\(PDF, \d páginas?\)/);
      expect(p.conteudo).toContain('Operação a analisar:');
    }
    expect(r.total).toMatchObject({
      errado: 0,
      em_falta: 0,
      inventado: 0,
      acerto: 1,
    });
    expect(r.por_perfil.map((x) => x.perfil)).toEqual([...PERFIS]);
    expect(r.casos.every((c) => c.erro === null && c.segundos === 1.5)).toBe(
      true,
    );
    expect(r.modelo).toBe('modelo-de-teste');
  });

  it('tabela e Markdown: acerto por perfil e por campo, e o que falhou', async () => {
    const ia = new IaFalsa(casos, (chave, l) =>
      chave === 'piscina'
        ? {
            ...l,
            medicoes: l.medicoes.map((m) => ({
              ...m,
              valor: m.grandeza === 'afastamento_extremas_m' ? 3 : m.valor,
            })),
          }
        : l,
    );
    const r = await avaliar(casos, ia, { agora: relogio() });
    const t = tabelaTexto(r);
    expect(t).toContain('Acerto por tipo de operação');
    expect(t).toContain('Acerto por campo');
    expect(t).toMatch(/piscina\s+\d+\s+\d+\s+1\s+0\s+0\s+\d+%/);
    expect(t).toContain(
      '[errado] piscina · Afastamento às extremas (o menor): esperado 1,5 m, lido 3 m',
    );
    const md = relatorioMarkdown(r);
    expect(md).toContain('# Leitura de projetos pela IA: avaliação');
    expect(md).toContain('| **Total** |');
    expect(md).toContain('### CP 414 · Piscina no logradouro');
    expect(md).toContain('**errado**');
  });

  it('erro da IA: fica registado e nada se inventa', async () => {
    const ia: ClienteLeitura = {
      extrair: () =>
        Promise.reject(
          new ErroApi(
            HttpStatus.BAD_GATEWAY,
            'ia_resposta_cortada',
            'Cortada.',
          ),
        ),
    };
    const r = await avaliarCaso(casos[0], ia, { agora: relogio() });
    expect(r.erro).toBe('ia_resposta_cortada: Cortada.');
    expect(
      r.linhas.every(
        (l) =>
          l.resultado !== 'certo' || l.esperado === 'não está nos desenhos',
      ),
    ).toBe(true);
    expect(
      tabelaTexto({
        gerado_em: 'x',
        modelo: null,
        casos: [r],
        total: contar(r.linhas),
        por_perfil: [],
        por_campo: [],
      }),
    ).toContain('- interior: ia_resposta_cortada: Cortada.');
  });

  it('variante digitalizada: o projeto vai sem texto e a IA é avisada', async () => {
    const ia = new IaFalsa(casos);
    const r = await avaliarCaso(casos[0], ia, {
      digitalizar: () => pdfDigitalizado(3),
      agora: relogio(),
    });
    expect(r.caso).toBe('interior (digitalizado)');
    expect(r.documentos[0]).toMatchObject({ paginas: 3, sem_texto: true });
    expect(r.documentos[1].sem_texto).toBe(false);
    expect(ia.pedidos[0].conteudo).toContain('digitalizado, sem texto');
  });

  it('caso sem gabarito: só o que a IA leu', async () => {
    const semGabarito: CasoAvaliacao = {
      ...casos[3],
      chave: 'fora',
      titulo: 'fora.pdf',
      esperado: null,
    };
    const ia: ClienteLeitura = {
      extrair: () => Promise.resolve(leituraPerfeita(casos[3].esperado!)),
    };
    const r = await avaliar([semGabarito], ia, { agora: relogio() });
    expect(r.casos[0].linhas).toEqual([]);
    expect(r.casos[0].lidas).toContainEqual({
      campo: 'Área da obra',
      valor: '32 m²',
    });
    expect(tabelaTexto(r)).toContain(
      'fora.pdf (sem gabarito: só o que a IA leu)',
    );
  });
});
