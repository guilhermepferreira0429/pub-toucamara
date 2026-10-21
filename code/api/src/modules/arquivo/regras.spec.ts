import {
  comoConsultar,
  CONFIG_DEMONSTRACAO,
  euros,
  lerConfig,
  numeroPedido,
  podeDocumentos,
  smsEncerrado,
  smsRegisto,
  taxaCopia,
  textoEncontrados,
  textoLada,
  textoLerDeVolta,
} from './regras';

describe('regras do arquivo', () => {
  it('sem configuração (ou inválida): valores de demonstração, marcados', () => {
    expect(lerConfig(null)).toEqual(CONFIG_DEMONSTRACAO);
    expect(lerConfig({ prazo_resposta_dias_uteis: 'x' })).toEqual(
      CONFIG_DEMONSTRACAO,
    );
    expect(CONFIG_DEMONSTRACAO.demonstracao).toBe(true);
    expect(CONFIG_DEMONSTRACAO.prazo_resposta_dias_uteis).toBe(10);
    const como = comoConsultar(CONFIG_DEMONSTRACAO);
    expect(como.copia_certificada).toContain('valor de demonstração');
    expect(como.presencial).toContain('sem custos');
    const real = comoConsultar({ ...CONFIG_DEMONSTRACAO, demonstracao: false });
    expect(real.copia_certificada).not.toContain('demonstração');
  });

  it('taxa da cópia: primeira página + páginas a mais', () => {
    expect(taxaCopia(CONFIG_DEMONSTRACAO, 1)).toBe(500);
    expect(taxaCopia(CONFIG_DEMONSTRACAO, 4)).toBe(650);
    expect(taxaCopia(CONFIG_DEMONSTRACAO, 0)).toBe(500);
    expect(euros(650)).toBe('6,50 €');
  });

  it('número do pedido e quem vê documentos', () => {
    expect(numeroPedido(3, 2026)).toBe('ARQ 3/2026');
    expect(podeDocumentos('tecnico')).toBe(true);
    expect(podeDocumentos('chefe_divisao')).toBe(true);
    expect(podeDocumentos('atendimento')).toBe(false);
    expect(podeDocumentos('vereador')).toBe(false);
  });

  it('textos: a lei como "a confirmar", o que se leu de volta, o SMS', () => {
    expect(textoLada()).toContain('Lei n.º 26/2016');
    expect(textoLada()).toContain('a confirmar com o arquivo');
    const ler = textoLerDeVolta({
      nome: 'Rui Matos',
      morada: 'Rua de Santo António, 45',
      ano: 1987,
      requerente: 'José Conceição',
      qualidade: 'interesse_legitimo',
      interesse: 'vou comprar a casa',
      modalidade: 'copia_certificada',
    });
    expect(ler).toContain('Rui Matos');
    expect(ler).toContain('Rua de Santo António, 45');
    expect(ler).toContain('vou comprar a casa');
    expect(ler).toContain('cópia certificada');
    const sms = smsRegisto(
      'Câmara de Teste',
      'ARQ 3/2026',
      '2026-11-04',
      'presencial',
    );
    expect(sms).toContain('ARQ 3/2026');
    expect(sms).toContain('4 de novembro');
    expect(sms).toContain('o dia da consulta');
  });

  it('quantos documentos, sem dizer quais', () => {
    expect(textoEncontrados(0)).toContain('Não encontrei');
    expect(textoEncontrados(1)).toContain('um documento');
    expect(textoEncontrados(3)).toContain('3 documentos');
  });

  it('SMS ao encerrar: só quando a pessoa precisa de saber', () => {
    expect(
      smsEncerrado('C', 'ARQ 1/2026', 'recusado', 'falta a escritura'),
    ).toContain('falta a escritura');
    expect(smsEncerrado('C', 'ARQ 1/2026', 'sem_documentos', null)).toContain(
      'não encontrou',
    );
    expect(smsEncerrado('C', 'ARQ 1/2026', 'consultado', null)).toBeNull();
  });
});
