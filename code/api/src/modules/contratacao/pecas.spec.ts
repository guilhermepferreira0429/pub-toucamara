import { CONFIG_DEMONSTRACAO } from './config';
import { avaliarProcedimento } from './motor';
import {
  camposAPreencher,
  DadosPecas,
  pecasDaIa,
  pecasModelo,
  tituloPeca,
} from './pecas';
import { lerPerguntaContratacao, respostaContratacao } from './pergunta';

const dados: DadosPecas = {
  municipio: 'Município de Teste',
  procedimento: 'ajuste_direto',
  tipo: 'servicos',
  objeto: 'Manutenção dos jardins municipais',
  valor_estimado_cent: 4_000_000,
  prazo_meses: 12,
  servico_requerente: 'Divisão de Espaços Verdes',
  fundamentacao: null,
  entidade_nome: null,
  entidade_nif: null,
  prazo_propostas_dias: 5,
};

describe('peças sem IA (modelos fixos)', () => {
  it('convite e caderno, rascunho para revisão jurídica, com campos a preencher', () => {
    const [convite, caderno] = pecasModelo(dados);
    expect(convite.tipo).toBe('convite');
    expect(caderno.tipo).toBe('caderno_encargos');
    for (const p of [convite, caderno]) {
      expect(p.modo).toBe('modelo');
      expect(p.aviso).toMatch(/Rascunho para revisão jurídica/);
      expect(p.campos_a_preencher.length).toBeGreaterThan(2);
    }
    const texto = convite.secoes.map((s) => s.texto).join('\n');
    expect(texto).toContain('Manutenção dos jardins municipais');
    expect(texto).toContain('40 000,00 €, sem IVA');
    expect(texto).toContain('Pelo menos 5 dias (prazo de demonstração)');
    // Nenhum artigo inventado: a base legal fica por preencher.
    expect(convite.campos_a_preencher).toContain(
      'artigo e alínea, a confirmar pelo jurista',
    );
    expect(convite.campos_a_preencher).toContain(
      'entidade(s) a convidar e NIF',
    );
  });

  it('com entidade indicada, não a pede; na consulta prévia pede mais duas', () => {
    const [c] = pecasModelo({
      ...dados,
      entidade_nome: 'Jardins, Lda',
      entidade_nif: '501234560',
    });
    expect(
      c.secoes.find((s) => s.titulo === 'Entidade(s) convidada(s)')!.texto,
    ).toBe('Jardins, Lda, NIF 501234560');
    const [cp] = pecasModelo({
      ...dados,
      procedimento: 'consulta_previa',
      entidade_nif: '501234560',
    });
    expect(cp.campos_a_preencher).toContain('pelo menos mais duas entidades');
  });

  it('títulos por procedimento', () => {
    expect(tituloPeca('convite', 'ajuste_direto')).toBe('Convite');
    expect(tituloPeca('convite', 'concurso_publico')).toBe(
      'Programa do procedimento',
    );
    expect(tituloPeca('convite', 'ajuste_direto_simplificado')).toBe(
      'Pedido de proposta',
    );
    expect(tituloPeca('caderno_encargos', 'consulta_previa')).toBe(
      'Caderno de encargos',
    );
  });

  it('camposAPreencher: sem repetições, também nos títulos', () => {
    expect(
      camposAPreencher([
        {
          titulo: 'A [a preencher: x]',
          texto: '[a preencher: y] e [A preencher: x]',
        },
      ]),
    ).toEqual(['x', 'y']);
  });

  it('pecasDaIa: o texto da IA fica marcado como rascunho e com os campos em falta', () => {
    const r = pecasDaIa(dados, {
      convite: [
        { titulo: 'Objeto', texto: 'Jardins. Prazo: [a preencher: prazo]' },
      ],
      caderno_encargos: [
        { titulo: 'Cláusula 1.ª — Objeto', texto: 'Jardins.' },
      ],
    });
    expect(r[0]).toMatchObject({
      modo: 'ia',
      campos_a_preencher: ['prazo'],
      titulo: 'Convite',
    });
    expect(r[1].aviso).toMatch(/revisão jurídica/);
  });
});

describe('assistente: "cabe no ajuste direto?"', () => {
  it('não é sobre contratação, ou não tem valor → null', () => {
    expect(
      lerPerguntaContratacao('Como trato um pedido de cartão de residente?'),
    ).toBeNull();
    expect(lerPerguntaContratacao('Isto cabe no ajuste direto?')).toBeNull();
  });

  it.each([
    [
      'Um serviço de 60 mil euros cabe no ajuste direto?',
      'servicos',
      6_000_000,
      false,
    ],
    [
      'Cabe no ajuste direto uma obra de 25.000 €?',
      'empreitada',
      2_500_000,
      false,
    ],
    [
      'Comprar equipamento de 19 999,99 euros: ajuste direto?',
      'bens',
      1_999_999,
      false,
    ],
    ['Ajuste direto para 80 000€?', 'servicos', 8_000_000, true],
  ])('%s', (pergunta, tipo, valor, assumido) => {
    const p = lerPerguntaContratacao(pergunta)!;
    expect(p).toMatchObject({
      tipo,
      valor_estimado_cent: valor,
      tipo_assumido: assumido,
    });
  });

  it('lê o prazo e o NIF quando vêm na pergunta', () => {
    const p = lerPerguntaContratacao(
      'Posso fazer ajuste direto à 501234560 de um serviço de 30 mil euros por 2 anos?',
    )!;
    expect(p).toMatchObject({
      entidade_nif: '501234560',
      prazo_meses: 24,
      prazo_assumido: false,
    });
    expect(
      lerPerguntaContratacao('ajuste direto 123456780 por 100 €')!.entidade_nif,
    ).toBeNull();
  });

  it('a resposta diz sim ou não, porquê e que são valores de demonstração', () => {
    const p = lerPerguntaContratacao(
      'Um serviço de 60 mil euros cabe no ajuste direto?',
    )!;
    const sim = respostaContratacao(
      p,
      avaliarProcedimento(
        { ...p, contratos_anteriores: [], hoje: '2026-10-21' },
        CONFIG_DEMONSTRACAO,
      ),
    );
    expect(sim).toMatch(
      /^Sim, pelas regras configuradas cabe no ajuste direto\./,
    );
    expect(sim).toContain('um contrato de 12 meses');
    expect(sim).toContain('Valores de demonstração');
    const q = lerPerguntaContratacao(
      'Um serviço de 80 mil euros cabe no ajuste direto?',
    )!;
    const nao = respostaContratacao(
      q,
      avaliarProcedimento(
        { ...q, contratos_anteriores: [], hoje: '2026-10-21' },
        CONFIG_DEMONSTRACAO,
      ),
    );
    expect(nao).toMatch(/^Não cabe no ajuste direto: .* consulta prévia\./);
  });
});
