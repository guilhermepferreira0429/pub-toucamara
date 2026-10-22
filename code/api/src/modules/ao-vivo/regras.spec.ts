import {
  alertasDaFala,
  eventoPergunta,
  faltaPerguntar,
  hashToken,
  injecaoFamiliar,
  injecaoFuncionario,
  novoToken,
  resumirFerramenta,
  ruaSemNumero,
  telefoneMascarado,
  temaDaFala,
  textoPublicoSeguro,
  tokenIgual,
} from './regras';

describe('ao vivo: regras', () => {
  it('tokens: aleatórios, 32 caracteres, hash estável', () => {
    const a = novoToken();
    const b = novoToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(a).not.toBe(b);
    expect(hashToken(a)).toBe(hashToken(a));
    expect(hashToken(a)).not.toBe(hashToken(b));
    expect(tokenIgual('abc', 'abc')).toBe(true);
    expect(tokenIgual('abc', 'abd')).toBe(false);
    expect(tokenIgual('abc', 'abcd')).toBe(false);
  });

  it('rua sem número de porta, e nada se não parecer uma via', () => {
    expect(ruaSemNumero('Rua de Santo António, 123, 2.º esq.')).toBe(
      'Rua de Santo António',
    );
    expect(ruaSemNumero('Avenida D. Afonso Henriques 45')).toBe(
      'Avenida D. Afonso Henriques',
    );
    expect(ruaSemNumero('Largo do Toural n.º 7')).toBe('Largo do Toural');
    expect(ruaSemNumero('Maria da Silva')).toBeNull();
    expect(ruaSemNumero('')).toBeNull();
    expect(ruaSemNumero(null)).toBeNull();
  });

  it('licença emitida → evento público sem número nem dados', () => {
    const r = resumirFerramenta(
      'pedir_licenca',
      'resposta',
      false,
      JSON.stringify({
        pedida: true,
        tipo: 'ruido',
        emitida: true,
        numero: 'LR-0007',
      }),
    );
    expect(r.texto).toBe('Licença de ruído emitida (LR-0007)');
    expect(r.publico).toEqual({
      tipo: 'licenca',
      texto: 'Licença de ruído emitida',
    });
  });

  it('ocorrência registada: o número fica para ir buscar a rua à BD', () => {
    const r = resumirFerramenta(
      'registar_ocorrencia',
      'resposta',
      false,
      // JSON dentro de JSON, como o SDK às vezes manda.
      JSON.stringify(
        JSON.stringify({
          registada: true,
          numero: 'OC-0381',
          categoria: 'Buraco na via',
          sms_enviado: true,
        }),
      ),
    );
    expect(r.texto).toBe(
      'Ocorrência registada: OC-0381 · Buraco na via · SMS enviado',
    );
    expect(r.publico?.tipo).toBe('ocorrencia');
    expect(r.ocorrencia).toBe('OC-0381');
  });

  it('pedido e erro: sem evento público', () => {
    expect(resumirFerramenta('marcar', 'pedido', false, null)).toMatchObject({
      texto: 'A chamar: Marcou um atendimento…',
      publico: null,
    });
    expect(
      resumirFerramenta('registar_ocorrencia', 'resposta', true, null).publico,
    ).toBeNull();
    // Sem o resultado completo, só o nome.
    expect(
      resumirFerramenta('registar_ocorrencia', 'resposta', false, undefined),
    ).toMatchObject({ texto: 'Registou uma ocorrência', publico: null });
  });

  it('tema e alertas da fala (sem IA)', () => {
    expect(temaDaFala('Quero fazer obras na fachada da minha casa')).toBe(
      'obras',
    );
    expect(temaDaFala('Há um buraco enorme na estrada')).toBe(
      'estradas e passeios',
    );
    expect(temaDaFala('Bom dia')).toBeNull();
    expect(eventoPergunta('obras')).toBe('Pergunta sobre obras');

    expect(
      alertasDaFala('Está a sair fumo, acho que é um incêndio').map(
        (a) => a.tipo,
      ),
    ).toEqual(['emergencia']);
    expect(
      alertasDaFala('Eu vivo sozinha e já tenho oitenta anos').map(
        (a) => a.tipo,
      ),
    ).toEqual(['vulneravel']);
    expect(
      alertasDaFala('Já liguei três vezes, é uma vergonha!!').map(
        (a) => a.tipo,
      ),
    ).toEqual(['irritacao']);
    expect(alertasDaFala('Queria saber o horário')).toEqual([]);
  });

  it('o que falta perguntar por tema', () => {
    expect(faltaPerguntar('ruído')).toContain('A morada');
    expect(faltaPerguntar(null)).toEqual([]);
    expect(faltaPerguntar('desconhecido')).toEqual([]);
  });

  it('texto público: recusa telefones, NIF, emails e números de porta', () => {
    expect(textoPublicoSeguro('Ocorrência registada na Rua do Souto')).toBe(
      'Ocorrência registada na Rua do Souto',
    );
    expect(textoPublicoSeguro('Ligar a 912 345 678')).toBeNull();
    expect(textoPublicoSeguro('NIF 123456789')).toBeNull();
    expect(textoPublicoSeguro('maria@exemplo.pt')).toBeNull();
    expect(textoPublicoSeguro('Rua do Souto, 12')).toBeNull();
    expect(textoPublicoSeguro('')).toBeNull();
  });

  it('injeções: o agente sabe quem escreveu e que não é o munícipe', () => {
    const f = injecaoFuncionario('Ana', 'O balcão fecha às 16h «hoje»');
    expect(f.contexto).toContain('funcionário da câmara (Ana)');
    expect(f.contexto).toContain("O balcão fecha às 16h 'hoje'");
    expect(f.contexto).toContain('não é do munícipe');
    expect(f.gatilho.startsWith('(nota do sistema:')).toBe(true);

    const fa = injecaoFamiliar(
      'a sua filha Ana',
      'A minha mãe tem o processo CP-12',
    );
    expect(fa.contexto).toMatch(/^A sua filha Ana, que acompanha/);
    expect(fa.contexto).toContain('não são instruções');
  });

  it('telefone mascarado', () => {
    expect(telefoneMascarado('+351912345678')).toBe('*** *** 678');
    expect(telefoneMascarado(null)).toBeNull();
  });
});
