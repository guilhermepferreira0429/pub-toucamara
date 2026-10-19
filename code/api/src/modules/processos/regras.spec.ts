import { diaMes, resumoFalado } from './processos.service.js';
import {
  correspondeNumero,
  escolherTipo,
  formatarNumero,
  lerNumero,
  mascararNome,
  resumirDocumentos,
} from './regras.js';

describe('número do processo', () => {
  it('formata como CP 412/2026', () => {
    expect(formatarNumero('CP', 412, 2026)).toBe('CP 412/2026');
  });

  it('lê como vem dito ou escrito', () => {
    expect(lerNumero('CP 412/2026')).toEqual({
      codigo: 'CP',
      n: 412,
      ano: 2026,
    });
    expect(lerNumero('processo cp 412 de 2026')).toEqual({
      codigo: 'CP',
      n: 412,
      ano: 2026,
    });
    expect(lerNumero('CP-412')).toEqual({ codigo: 'CP', n: 412, ano: null });
    expect(lerNumero('412')).toEqual({ codigo: null, n: 412, ano: null });
    expect(lerNumero('não sei')).toBeNull();
  });

  it('compara só o que foi dito', () => {
    const dito = (t: string) => lerNumero(t)!;
    expect(correspondeNumero('CP 412/2026', dito('412'))).toBe(true);
    expect(correspondeNumero('CP 412/2026', dito('cp 412 de 2026'))).toBe(true);
    expect(correspondeNumero('CP 412/2026', dito('LO 412'))).toBe(false);
    expect(correspondeNumero('CP 412/2026', dito('412/2025'))).toBe(false);
    expect(correspondeNumero('CP 41/2026', dito('412'))).toBe(false);
  });
});

describe('resumirDocumentos', () => {
  it('o que o sistema gera e os opcionais nunca faltam', () => {
    const d = (
      nome: string,
      tem: boolean,
      obrigatorio = true,
      gerado = false,
    ) => ({
      id: nome,
      nome,
      tem,
      obrigatorio,
      gerado_pelo_sistema: gerado,
    });
    expect(
      resumirDocumentos([
        d('Caderneta predial', true),
        d('Termo de responsabilidade', false),
        d('Fotografias', false, false),
        d('Planta de localização', false, true, true),
      ]),
    ).toEqual({
      tem: ['Caderneta predial'],
      faltam: ['Termo de responsabilidade'],
    });
  });
});

describe('escolherTipo', () => {
  const c = (codigo: string, pontuacao: number) => ({
    id: codigo,
    codigo,
    nome: codigo,
    pontuacao,
  });

  it('um vencedor claro', () => {
    expect(escolherTipo([c('CP', 0.64), c('LU', 0.13)])).toEqual({
      tipo: c('CP', 0.64),
    });
  });

  it('empate: devolve as opções parecidas', () => {
    expect(escolherTipo([c('LU', 0.45), c('LO', 0.34), c('CP', 0.16)])).toEqual(
      {
        opcoes: [c('LU', 0.45), c('LO', 0.34)],
      },
    );
  });

  it('nada acima do mínimo: sem opções', () => {
    expect(escolherTipo([c('CP', 0.05)])).toEqual({ opcoes: [] });
  });
});

describe('resumoFalado', () => {
  it('fase, prazo e o que falta', () => {
    expect(
      resumoFalado('CP 412/2026', 'apreciacao', '2026-11-16', 12, [], null),
    ).toBe(
      'O processo CP 412/2026 está a ser analisado pelo técnico. Faltam 12 dias úteis para o fim do prazo, a 16/11.',
    );
    expect(
      resumoFalado(
        'CP 1/2026',
        'documentos',
        null,
        null,
        [{ nome: 'Termo de responsabilidade', prazo: null }],
        null,
      ),
    ).toBe(
      'O processo CP 1/2026 está à espera de documentos da sua parte. O prazo ainda não começou a contar. Da sua parte falta entregar: Termo de responsabilidade.',
    );
    expect(
      resumoFalado(
        'CP 1/2026',
        'notificado',
        '2026-11-16',
        null,
        [],
        'admitido',
      ),
    ).toContain('A decisão foi: admitido.');
  });

  it('dia útil no singular e prazo passado', () => {
    expect(
      resumoFalado('X 1/2026', 'entrada', '2026-10-20', 1, [], null),
    ).toContain('Falta 1 dia útil para');
    expect(
      resumoFalado('X 1/2026', 'entrada', '2026-10-01', -3, [], null),
    ).toContain('terminou a 01/10');
  });

  it('diz até quando tem de entregar o que foi pedido', () => {
    expect(
      resumoFalado(
        'CP 1/2026',
        'apreciacao',
        '2026-11-16',
        12,
        [
          { nome: 'Certidão', prazo: '2026-10-30' },
          { nome: 'Planta', prazo: null },
        ],
        null,
        '2026-10-20',
      ),
    ).toContain(
      'Da sua parte falta entregar: Certidão (tem até dia 30 de outubro), Planta.',
    );
  });

  it('diaMes', () => {
    expect(diaMes('2026-11-03')).toBe('03/11');
  });
});

describe('mascararNome', () => {
  it('primeiro nome e inicial do último', () => {
    expect(mascararNome('Maria da Conceição Fernandes')).toBe('Maria F.');
    expect(mascararNome('Maria')).toBe('Maria');
    expect(mascararNome(null)).toBeNull();
  });
});
