import {
  anoCompleto,
  chaveMorada,
  juntarMetadados,
  lerAno,
  lerArtigoMatricial,
  lerFreguesia,
  lerMorada,
  lerNumeroAntigo,
  lerRequerente,
  lerTipo,
  mesmaMorada,
  METADADOS_VAZIOS,
  metadadosDoTexto,
  semAcentos,
  termosProcura,
  textoPesquisa,
} from './metadados';

const REQUERIMENTO = `Câmara Municipal de Guimarães
Processo de obras n.º 123/1987
Exmo. Senhor Presidente da Câmara Municipal
José da Silva Conceição, casado, residente na Rua de Santo
António, n.º 45, freguesia de Oliveira do Castelo, deste concelho,
contribuinte n.º 123456789, vem requerer a V. Ex.ª licença de construção
de uma moradia unifamiliar no prédio urbano sito na Rua de Santo António, 45,
inscrito na matriz predial urbana sob o artigo 1234 da freguesia de Oliveira do Castelo.
Guimarães, 12 de março de 1987`;

describe('metadados sem IA (regras)', () => {
  it('lê tudo de um requerimento típico', () => {
    expect(metadadosDoTexto(REQUERIMENTO, 2026)).toEqual({
      numero_antigo: '123/1987',
      ano: 1987,
      tipo: 'obras',
      requerente: 'José da Silva Conceição',
      morada: 'Rua de Santo António, 45',
      freguesia: 'Oliveira do Castelo',
      artigo_matricial: '1234',
    });
  });

  it('número do processo: várias formas de o escrever', () => {
    expect(lerNumeroAntigo('Proc. n.º 45/82')).toBe('45/82');
    expect(lerNumeroAntigo('PROCESSO Nº 0012-1990')).toBe('12/1990');
    expect(lerNumeroAntigo('Processo de licenciamento de obras n.º 7/75')).toBe(
      '7/75',
    );
    expect(lerNumeroAntigo('Obra n.º 301/1969')).toBe('301/1969');
    expect(lerNumeroAntigo('Sem número nenhum')).toBeNull();
  });

  it('ano: do número (dois algarismos) ou da data mais antiga', () => {
    expect(anoCompleto('82', 2026)).toBe(1982);
    expect(anoCompleto('05', 2026)).toBe(2005);
    expect(lerAno('', '45/82', 2026)).toBe(1982);
    expect(
      lerAno(
        'Entrada em 03/05/1979. Despacho de 12 de junho de 1980.',
        null,
        2026,
      ),
    ).toBe(1979);
    expect(lerAno('No ano de 1964 foi construída', null, 2026)).toBe(1964);
    expect(lerAno('Telefone 253 421 200', null, 2026)).toBeNull();
  });

  it('tipo de processo pelas palavras do pedido', () => {
    expect(lerTipo('requer licença de utilização para habitação')).toBe(
      'utilizacao',
    );
    expect(lerTipo('Alvará de loteamento n.º 3')).toBe('loteamento');
    expect(lerTipo('pedido de demolição do anexo')).toBe('demolicao');
    expect(lerTipo('ocupação da via pública com andaime')).toBe('ocupacao_via');
    expect(lerTipo('ampliação da moradia')).toBe('obras');
    expect(lerTipo('pedido de certidão')).toBeNull();
  });

  it('requerente: "Requerente:" ou "Nome, residente em"', () => {
    expect(
      lerRequerente('Requerente: Maria Fernanda Costa; Morada: Rua X'),
    ).toBe('Maria Fernanda Costa');
    expect(
      lerRequerente('requerido por António Joaquim Pereira, em 1975'),
    ).toBe('António Joaquim Pereira');
    expect(
      lerRequerente(
        'Exmo. Senhor Presidente. Manuel Ribeiro Lopes, viúvo, residente no Largo da Oliveira',
      ),
    ).toBe('Manuel Ribeiro Lopes');
    expect(lerRequerente('sem nome aqui')).toBeNull();
  });

  it('morada: prefere o local da obra à residência', () => {
    expect(
      lerMorada(
        'residente na Rua A, 1, vem requerer obras no prédio sito na Avenida D. Afonso Henriques, 200, freguesia de Azurém',
      ),
    ).toBe('Avenida D. Afonso Henriques, 200');
    expect(lerMorada('Morada: Travessa do Picoto, 3; Telefone')).toBe(
      'Travessa do Picoto, 3',
    );
    expect(lerMorada('Rua Dr. Alfredo Pimenta, 12. Guimarães')).toBe(
      'Rua Dr. Alfredo Pimenta, 12',
    );
    expect(lerMorada('sem morada')).toBeNull();
  });

  it('freguesia e artigo matricial', () => {
    expect(
      lerFreguesia('freguesia de São Sebastião, concelho de Guimarães'),
    ).toBe('São Sebastião');
    expect(lerFreguesia('da freguesia de Creixomil.')).toBe('Creixomil');
    expect(lerArtigoMatricial('artigo matricial n.º 567')).toBe('567');
    expect(
      lerArtigoMatricial(
        'inscrito na matriz predial rústica sob o artigo R-89',
      ),
    ).toBe('R-89');
    expect(lerArtigoMatricial('artigo 5.º do regulamento')).toBeNull();
  });

  it('juntar: a IA ganha, as regras completam', () => {
    const ia = { ...METADADOS_VAZIOS, requerente: 'Ana Sousa', ano: 1990 };
    const regras = {
      ...METADADOS_VAZIOS,
      requerente: 'Outra',
      morada: 'Rua B',
      ano: 1991,
    };
    expect(juntarMetadados(ia, regras)).toMatchObject({
      requerente: 'Ana Sousa',
      ano: 1990,
      morada: 'Rua B',
    });
  });
});

describe('mesma morada', () => {
  it('normaliza abreviaturas, acentos, "de/da" e o número', () => {
    expect(
      chaveMorada('R. de Santo António, n.º 45, 1.º Esq., 4800-123 Guimarães'),
    ).toEqual({
      rua: 'rua santo antonio',
      porta: '45',
    });
    expect(chaveMorada('Rua Santo Antonio 45')).toEqual({
      rua: 'rua santo antonio',
      porta: '45',
    });
    expect(chaveMorada('Av. Dom Afonso Henriques')).toEqual({
      rua: 'avenida dom afonso henriques',
      porta: null,
    });
    expect(chaveMorada('')).toBeNull();
    expect(chaveMorada('12')).toBeNull();
  });

  it('mesma rua; o número só conta se os dois o tiverem', () => {
    const a = chaveMorada('Rua de Santo António, 45');
    expect(mesmaMorada(a, chaveMorada('R. Santo Antonio 45'))).toBe(true);
    expect(mesmaMorada(a, chaveMorada('Rua de Santo António'))).toBe(true);
    expect(mesmaMorada(a, chaveMorada('Rua de Santo António, 47'))).toBe(false);
    expect(mesmaMorada(a, chaveMorada('Rua de Santa Luzia, 45'))).toBe(false);
  });
});

describe('pesquisa pelo agente', () => {
  it('termos: rua sem o tipo de via, nome, número antigo', () => {
    expect(
      termosProcura({
        morada: 'Rua de Santo António, 45',
        requerente: 'José Conceição',
        numero_antigo: '123/87',
      }),
    ).toEqual(['santo', 'antonio', 'jose', 'conceicao', '123/87']);
    expect(termosProcura({})).toEqual([]);
  });

  it('o texto de pesquisa tem os metadados e o texto, sem acentos', () => {
    const t = textoPesquisa('Licença de construção', {
      ...METADADOS_VAZIOS,
      requerente: 'José Conceição',
      ano: 1987,
    });
    expect(t).toContain('jose conceicao');
    expect(t).toContain('1987');
    expect(t).toContain('licenca de construcao');
    expect(semAcentos('  Órgão  Nº ')).toBe('orgao n');
  });
});
