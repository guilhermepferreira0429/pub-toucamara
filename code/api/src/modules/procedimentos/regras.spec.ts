import {
  esquemaConteudo,
  guiao,
  lerContacto,
  lerOndeEsta,
  montarRascunho,
  palavras,
  partirLista,
  proximaDoGuiao,
  termosPesquisa,
  textoPesquisa,
  trechosRelevantes,
} from './regras';

describe('procedimentos · regras', () => {
  describe('guião', () => {
    it('tem as sete perguntas, com a área no texto', () => {
      const g = guiao('Ocupação da via pública');
      expect(g.map((p) => p.chave)).toEqual([
        'o_que',
        'passos',
        'onde',
        'contactos',
        'excecoes',
        'erros',
        'notas',
      ]);
      expect(g[0].pergunta).toContain('Ocupação da via pública');
    });

    it('a próxima é a primeira ainda não feita; no fim, null', () => {
      expect(proximaDoGuiao('X', [])?.chave).toBe('o_que');
      expect(proximaDoGuiao('X', ['o_que', 'passos'])?.chave).toBe('onde');
      expect(
        proximaDoGuiao(
          'X',
          guiao('X').map((p) => p.chave),
        ),
      ).toBeNull();
    });
  });

  describe('partirLista', () => {
    it('uma linha por item, sem marcadores nem pontuação final', () => {
      expect(
        partirLista(
          '1. Receber o pedido.\n2) Ver o seguro;\n- Mandar à fiscalização',
        ),
      ).toEqual(['Receber o pedido', 'Ver o seguro', 'Mandar à fiscalização']);
    });

    it('numa linha só: parte por ";" ou por "depois" (como se fala)', () => {
      expect(partirLista('ver a planta; pedir o seguro; emitir guia')).toEqual([
        'Ver a planta',
        'Pedir o seguro',
        'Emitir guia',
      ]);
      expect(
        partirLista(
          'Recebo o pedido, depois confirmo a planta e a seguir emito a guia',
        ),
      ).toEqual(['Recebo o pedido', 'Confirmo a planta', 'Emito a guia']);
    });

    it('vazio dá lista vazia', () => {
      expect(partirLista('')).toEqual([]);
      expect(partirLista(null)).toEqual([]);
    });
  });

  it('lerContacto: nome, papel e contacto (extensão, email ou telefone)', () => {
    expect(lerContacto('D. Rosa, Fiscalização, ext. 214')).toEqual({
      nome: 'D. Rosa',
      papel: 'Fiscalização',
      contacto: 'ext. 214',
    });
    expect(lerContacto('Eng. Paulo (Obras) paulo.silva@cm-teste.pt')).toEqual({
      nome: 'Eng. Paulo',
      papel: 'Obras',
      contacto: 'paulo.silva@cm-teste.pt',
    });
    expect(lerContacto('A chefe de divisão')).toEqual({
      nome: 'A chefe de divisão',
      papel: null,
      contacto: null,
    });
  });

  it('lerOndeEsta: "o quê: onde" e "o quê fica na ..."', () => {
    expect(lerOndeEsta('Minutas: pasta partilhada Obras/Minutas')).toEqual({
      o_que: 'Minutas',
      onde: 'pasta partilhada Obras/Minutas',
    });
    expect(
      lerOndeEsta('O livro de registos fica no armário do balcão 2'),
    ).toEqual({
      o_que: 'O livro de registos',
      onde: 'no armário do balcão 2',
    });
    expect(lerOndeEsta('Programa de expediente')).toEqual({
      o_que: 'Programa de expediente',
      onde: '',
    });
  });

  describe('montarRascunho (sem IA)', () => {
    const respostas = [
      {
        chave: 'o_que',
        resposta: 'Licença para ocupar o passeio com esplanadas ou andaimes.',
      },
      {
        chave: 'passos',
        resposta:
          '1. Receber o pedido\n2. Confirmar a planta\n3. Emitir a guia',
      },
      {
        chave: 'onde',
        resposta: 'Minutas: pasta Obras/Minutas\nPlantas: SIG interno',
      },
      { chave: 'contactos', resposta: 'D. Rosa, Fiscalização, ext. 214' },
      {
        chave: 'excecoes',
        resposta: 'Sem seguro: pedir antes de emitir; Festas: isenção da junta',
      },
      { chave: 'erros', resposta: 'Esquecer a caução' },
      { chave: 'erros', resposta: 'Não confirmar a largura do passeio' },
      { chave: 'notas', resposta: '' },
    ];

    it('cada resposta vai para o seu campo, partida em itens', () => {
      const r = montarRascunho('Ocupação da via pública', respostas);
      expect(r).toEqual({
        titulo: 'Como tratar: Ocupação da via pública',
        area: 'Ocupação da via pública',
        servico_id: null,
        resumo: 'Licença para ocupar o passeio com esplanadas ou andaimes.',
        passos: ['Receber o pedido', 'Confirmar a planta', 'Emitir a guia'],
        onde_esta: [
          { o_que: 'Minutas', onde: 'pasta Obras/Minutas' },
          { o_que: 'Plantas', onde: 'SIG interno' },
        ],
        contactos: [
          { nome: 'D. Rosa', papel: 'Fiscalização', contacto: 'ext. 214' },
        ],
        excecoes: [
          'Sem seguro: pedir antes de emitir',
          'Festas: isenção da junta',
        ],
        erros_comuns: [
          'Esquecer a caução',
          'Não confirmar a largura do passeio',
        ],
        notas: '',
      });
    });

    it('o rascunho é um conteúdo válido', () => {
      const r = montarRascunho('Ocupação da via pública', respostas);
      expect(esquemaConteudo.safeParse(r).success).toBe(true);
    });

    it('sem respostas: só o título e a área', () => {
      const r = montarRascunho('Cemitérios', []);
      expect(r.passos).toEqual([]);
      expect(r.titulo).toBe('Como tratar: Cemitérios');
    });
  });

  describe('pesquisa', () => {
    const c = montarRascunho('Ocupação da via pública', [
      { chave: 'o_que', resposta: 'Esplanadas e andaimes no passeio.' },
      {
        chave: 'passos',
        resposta:
          'Receber o pedido\nConfirmar a planta de localização\nEmitir a guia de pagamento',
      },
      { chave: 'contactos', resposta: 'D. Rosa, Fiscalização, ext. 214' },
      {
        chave: 'excecoes',
        resposta: 'Quando falta o seguro, pedir por email antes de emitir',
      },
    ]);

    it('palavras: sem acentos, sem palavras vazias, com radical', () => {
      expect(palavras('Como trato as esplanadas?')).toEqual(
        palavras('esplanada'),
      );
      expect(palavras('Como trato as esplanadas?')).toHaveLength(1);
      expect(palavras('Ocupação')).toEqual(palavras('ocupacao'));
    });

    it('termosPesquisa tira as palavras de "como se faz"', () => {
      expect(
        termosPesquisa('Como trato um pedido de ocupação da via pública?'),
      ).toBe('ocupação via pública');
      expect(termosPesquisa('Como se faz?')).toBe('');
    });

    it('textoPesquisa junta todas as secções', () => {
      const t = textoPesquisa(c);
      expect(t).toContain('Ocupação da via pública');
      expect(t).toContain('D. Rosa');
      expect(t).toContain('seguro');
    });

    it('trechosRelevantes: o trecho que toca na pergunta vem primeiro', () => {
      const t = trechosRelevantes(c, 'E se faltar o seguro?');
      expect(t[0]).toMatchObject({
        seccao: 'excecoes',
        nome_seccao: 'Exceções',
      });
      expect(t[0].texto).toContain('seguro');
      const p = trechosRelevantes(c, 'Onde peço a planta de localização?', 1);
      expect(p).toHaveLength(1);
      expect(p[0]).toMatchObject({
        seccao: 'passos',
        texto: '2. Confirmar a planta de localização',
      });
    });

    it('sem palavras em comum: o resumo e os primeiros passos', () => {
      const t = trechosRelevantes(c, 'xyz qwerty', 2);
      expect(t.map((x) => x.seccao)).toEqual(['resumo', 'passos']);
      expect(t.every((x) => x.pontuacao === 0)).toBe(true);
    });
  });
});
