import {
  caminhoSemVersao,
  decidirFerramenta,
  painelDisponivel,
} from './funcionalidades.js';
import {
  abreviarNome,
  lerAgregado,
  normalizarFreguesia,
  resolverFreguesia,
  textoAtestado,
} from './regras.js';
import { freguesiaDoNome } from './juntas.service.js';

describe('funcionalidades por tipo de município', () => {
  it('tira a versão e a query do caminho', () => {
    expect(caminhoSemVersao('/v1/painel/licencas?estado=x')).toBe(
      '/painel/licencas',
    );
    expect(caminhoSemVersao('/painel/atestados')).toBe('/painel/atestados');
  });

  it('a junta não tem urbanismo, licenças nem PDM no painel', () => {
    for (const c of [
      '/v1/painel/licencas',
      '/v1/painel/licencas/123/aprovar',
      '/v1/painel/processos',
      '/v1/painel/ordenamento/zonas',
      '/v1/painel/fiscalizacao',
      '/v1/painel/taxas',
    ]) {
      expect(painelDisponivel('junta', c)).toBe(false);
      expect(painelDisponivel('camara', c)).toBe(true);
    }
  });

  it('a junta tem o atendimento, as ocorrências, o conhecimento e os atestados', () => {
    for (const c of [
      '/v1/painel/conversas',
      '/v1/painel/ocorrencias',
      '/v1/painel/conhecimento/fontes',
      '/v1/painel/agente',
      '/v1/painel/equipa',
      '/v1/painel/atestados',
      '/v1/painel/auth/eu',
    ]) {
      expect(painelDisponivel('junta', c)).toBe(true);
    }
  });

  it('a câmara não tem a página dos atestados; sem tipo conta como câmara', () => {
    expect(painelDisponivel('camara', '/v1/painel/atestados')).toBe(false);
    expect(painelDisponivel(undefined, '/v1/painel/atestados/x')).toBe(false);
    expect(painelDisponivel(undefined, '/v1/painel/licencas')).toBe(true);
  });

  it('não confunde prefixos parecidos', () => {
    expect(painelDisponivel('junta', '/v1/painel/processos-x')).toBe(true);
    expect(painelDisponivel('junta', '/v1/public/licencas/X')).toBe(true);
  });

  it('decide as ferramentas do agente', () => {
    expect(decidirFerramenta('junta', 'pedir_licenca', {})).toBe('so_camara');
    expect(decidirFerramenta('junta', 'o_que_posso_fazer', {})).toBe(
      'so_camara',
    );
    expect(decidirFerramenta('camara', 'pedir_licenca', {})).toBe('seguir');
    expect(decidirFerramenta('junta', 'procurar_conhecimento', {})).toBe(
      'seguir',
    );
    expect(decidirFerramenta('junta', 'registar_ocorrencia', {})).toBe(
      'seguir',
    );
    expect(
      decidirFerramenta('junta', 'pedir_servico', { area: 'escolas' }),
    ).toBe('so_camara');
    expect(
      decidirFerramenta('camara', 'pedir_servico', { area: 'escolas' }),
    ).toBe('seguir');
    expect(
      decidirFerramenta('camara', 'pedir_servico', { area: 'junta' }),
    ).toBe('area_junta');
    expect(decidirFerramenta('junta', 'outros_servicos', {})).toBe(
      'catalogo_junta',
    );
    expect(decidirFerramenta(undefined, 'outros_servicos', {})).toBe(
      'catalogo_camara',
    );
  });
});

describe('freguesias', () => {
  const juntas = [
    { id: 'j1', nome: 'Junta de Azurém', freguesias: ['Azurém'] },
    {
      id: 'j2',
      nome: 'União de Freguesias de Oliveira, São Paio e São Sebastião',
      freguesias: ['Oliveira do Castelo', 'São Paio', 'São Sebastião'],
    },
  ];
  const conhecidas = ['Creixomil', 'Urgezes', 'São Torcato', 'Azurém'];

  it('normaliza acentos e prefixos', () => {
    expect(normalizarFreguesia('Junta de Freguesia de Azurém')).toBe('azurem');
    expect(normalizarFreguesia('União das Freguesias de São Paio')).toBe(
      'sao paio',
    );
    expect(normalizarFreguesia('  AZURÉM ')).toBe('azurem');
    expect(freguesiaDoNome('Junta de Freguesia de Azurém')).toBe('Azurém');
    expect(freguesiaDoNome('União das Freguesias de Selho')).toBe('Selho');
  });

  it('pela freguesia dita, com a junta do sistema primeiro', () => {
    expect(resolverFreguesia('azurem', 'Rua X, 1', juntas, conhecidas)).toEqual(
      { freguesia: 'Azurém', junta: juntas[0] },
    );
    expect(resolverFreguesia('São Paio', null, juntas, conhecidas)).toEqual({
      freguesia: 'São Paio',
      junta: juntas[1],
    });
  });

  it('pela morada, quando não diz a freguesia', () => {
    expect(
      resolverFreguesia(
        undefined,
        'Rua Direita, 45, Azurém',
        juntas,
        conhecidas,
      )?.junta?.id,
    ).toBe('j1');
    expect(
      resolverFreguesia('', 'Largo da Igreja, São Torcato', juntas, conhecidas),
    ).toEqual({ freguesia: 'São Torcato', junta: null });
  });

  it('freguesia conhecida sem junta no sistema; desconhecida = null', () => {
    expect(resolverFreguesia('Creixomil', null, juntas, conhecidas)).toEqual({
      freguesia: 'Creixomil',
      junta: null,
    });
    expect(
      resolverFreguesia('Lisboa', 'Avenida da Liberdade', juntas, conhecidas),
    ).toBeNull();
  });

  it('não reconhece pedaços de palavras', () => {
    expect(
      resolverFreguesia(undefined, 'Rua de Azuremos', juntas, conhecidas),
    ).toBeNull();
  });
});

describe('atestados', () => {
  it('lê o agregado em "nome (parentesco)" ou "nome - parentesco"', () => {
    expect(
      lerAgregado(['Ana Silva (Filha)', 'Rui Silva - marido', 'Avó Rosa', ' ']),
    ).toEqual([
      { nome: 'Ana Silva', parentesco: 'filha' },
      { nome: 'Rui Silva', parentesco: 'marido' },
      { nome: 'Avó Rosa', parentesco: null },
    ]);
  });

  it('abrevia o nome nas páginas públicas', () => {
    expect(abreviarNome('Maria da Silva Costa')).toBe('Maria C.');
    expect(abreviarNome('Maria')).toBe('Maria');
  });

  it('escreve o texto do atestado com a base legal e a data', () => {
    const base = {
      nome: 'Maria Costa',
      morada: 'Rua Direita, 45',
      freguesia: 'Azurém',
      junta: 'Junta de Freguesia de Azurém',
      finalidade: 'apresentar na escola.',
      data: 'quinta-feira, 22 de outubro de 2026',
    };
    const r = textoAtestado({ ...base, tipo: 'residencia' });
    expect(r[0]).toBe(
      'A Junta de Freguesia de Azurém atesta, para os devidos efeitos, que Maria Costa reside em Rua Direita, 45, na freguesia de Azurém.',
    );
    expect(r).toContain(
      'O presente atestado destina-se a apresentar na escola.',
    );
    expect(r.join(' ')).toMatch(/Decreto-Lei n\.º 135\/99/);
    expect(r[r.length - 1]).toBe(
      'Azurém, quinta-feira, 22 de outubro de 2026.',
    );

    const ag = textoAtestado({
      ...base,
      tipo: 'agregado_familiar',
      agregado: [{ nome: 'Rui Costa', parentesco: 'marido' }],
    });
    expect(ag[0]).toContain(
      'é composto por: Maria Costa (requerente); Rui Costa (marido).',
    );

    const ec = textoAtestado({
      ...base,
      tipo: 'situacao_economica',
      rendimentoMensal: 650,
    });
    expect(ec[0]).toMatch(/rendimento mensal do agregado de 650,00\s€/);

    const pv = textoAtestado({
      ...base,
      tipo: 'prova_vida',
      finalidade: null,
      entidadePensao: 'Segurança Social',
      nota: 'Verificado presencialmente',
    });
    expect(pv[0]).toContain(
      'se encontra vivo(a) nesta data, para efeitos de Segurança Social.',
    );
    expect(pv).toContain('Verificado presencialmente.');
  });
});
