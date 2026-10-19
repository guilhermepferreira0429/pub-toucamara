import {
  conteudoClassificacao,
  DadosClassificacao,
  MAX_CORPO,
  normalizarClassificacao,
  textoDeHtml,
} from './emails.classificacao.js';
import { enderecos } from './emails.controller.js';
import { assuntoResposta } from './emails.service.js';

const dados: DadosClassificacao = {
  de: 'ana@exemplo.pt',
  assunto: 'Licença para obras',
  corpo: 'Quero abrir uma porta na sala.',
  anexos: [{ nome: 'planta.pdf' }],
  servicos: [
    { id: 's1', nome: 'Obras particulares', extra: 'Câmara' },
    { id: 's2', nome: 'Ambiente', extra: 'Câmara' },
  ],
  entidades: [
    { id: 'e1', nome: 'Empresa da água', extra: 'empresa_municipal' },
  ],
  temas: [{ id: 't1', nome: 'Obras dentro de casa' }],
  trechos: [
    {
      trecho_id: 'tr1',
      titulo: 'RJUE',
      referencia: 'art. 6.º',
      entidade: 'Estado',
      texto: 'Isenção de controlo prévio...',
    },
    {
      trecho_id: 'tr2',
      titulo: 'Regulamento municipal',
      referencia: null,
      entidade: 'Câmara',
      texto: '...',
    },
  ],
};

describe('conteudoClassificacao', () => {
  it('lista serviços, entidades, temas e fontes numeradas', () => {
    const c = conteudoClassificacao(dados);
    expect(c).toContain('- s1: Obras particulares (Câmara)');
    expect(c).toContain('- e1: Empresa da água (empresa_municipal)');
    expect(c).toContain('[F1] RJUE, art. 6.º (Estado)');
    expect(c).toContain('[F2] Regulamento municipal (Câmara)');
    expect(c).toContain('Anexos: planta.pdf');
    expect(c).toContain('Quero abrir uma porta na sala.');
  });

  it('corta textos enormes e diz que cortou', () => {
    const c = conteudoClassificacao({
      ...dados,
      corpo: 'x'.repeat(MAX_CORPO + 50),
    });
    expect(c).toContain('[... texto cortado: 50 caracteres]');
  });
});

describe('normalizarClassificacao', () => {
  it('valida ids, liga o tema e passa as fontes a trechos', () => {
    const r = normalizarClassificacao(
      {
        servico_id: 's1',
        entidade_id: 'inventada',
        tema: 'obras DENTRO de casa',
        confianca: 1.7,
        rascunho_resposta: '  Exmo. Senhor... ',
        fontes_usadas: ['F1', '[F2]', 'F9', 'F1'],
      },
      dados,
    );
    expect(r).toEqual({
      servico_id: 's1',
      entidade_id: null,
      tema_id: 't1',
      tema: 'obras DENTRO de casa',
      confianca: 1,
      rascunho_resposta: 'Exmo. Senhor...',
      trechos_citados: ['tr1', 'tr2'],
    });
  });

  it('tema novo fica só como texto', () => {
    const r = normalizarClassificacao(
      {
        servico_id: null,
        entidade_id: 'e1',
        tema: 'Contador de água',
        confianca: 0.456,
        rascunho_resposta: null,
        fontes_usadas: [],
      },
      dados,
    );
    expect(r.tema_id).toBeNull();
    expect(r.tema).toBe('Contador de água');
    expect(r.entidade_id).toBe('e1');
    expect(r.confianca).toBe(0.46);
  });
});

describe('email geral: utilitários', () => {
  it('textoDeHtml tira etiquetas e entidades', () => {
    expect(
      textoDeHtml(
        '<p>Bom dia,</p><p>Rua&nbsp;A &amp; B</p><script>x()</script>',
      ),
    ).toBe('Bom dia,\nRua A & B');
  });

  it('enderecos aceita "Nome <a@b>" e listas', () => {
    expect(enderecos('Ana <Ana@Ex.pt>, geral@cm-x.pt')).toEqual([
      'ana@ex.pt',
      'geral@cm-x.pt',
    ]);
    expect(enderecos(['x@y.pt', 'lixo'])).toEqual(['x@y.pt']);
    expect(enderecos(undefined)).toEqual([]);
  });

  it('assuntoResposta não repete o Re:', () => {
    expect(assuntoResposta('Obras')).toBe('Re: Obras');
    expect(assuntoResposta('RE: Obras')).toBe('RE: Obras');
    expect(assuntoResposta(null)).toBe('Resposta da Câmara Municipal');
  });
});
