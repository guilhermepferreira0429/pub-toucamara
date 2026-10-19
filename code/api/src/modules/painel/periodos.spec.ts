import { ErroApi } from '../../common/erros.js';
import {
  agruparPorOmissao,
  baldes,
  diaDaSemana,
  diasNoPeriodo,
  hojeNoFuso,
  indicador,
  inicioSemana,
  lerPeriodo,
  percentagem,
  periodoAnterior,
  semanaAteHoje,
  variacao,
} from './periodos.js';

describe('períodos', () => {
  it('período anterior do mesmo tamanho, colado antes', () => {
    expect(periodoAnterior({ de: '2026-10-13', ate: '2026-10-19' })).toEqual({
      de: '2026-10-06',
      ate: '2026-10-12',
    });
    // atravessa meses e o ano bissexto
    expect(periodoAnterior({ de: '2028-03-01', ate: '2028-03-31' })).toEqual({
      de: '2028-01-30',
      ate: '2028-02-29',
    });
    expect(periodoAnterior({ de: '2026-10-19', ate: '2026-10-19' })).toEqual({
      de: '2026-10-18',
      ate: '2026-10-18',
    });
  });

  it('conta os dias com os dois extremos e atravessa a mudança de hora', () => {
    expect(diasNoPeriodo({ de: '2026-10-19', ate: '2026-10-19' })).toBe(1);
    expect(diasNoPeriodo({ de: '2026-10-20', ate: '2026-10-30' })).toBe(11);
  });

  it('semana começa à segunda', () => {
    expect(diaDaSemana('2026-10-19')).toBe(1);
    expect(diaDaSemana('2026-10-25')).toBe(7);
    expect(inicioSemana('2026-10-25')).toBe('2026-10-19');
    expect(semanaAteHoje('2026-10-21')).toEqual({
      de: '2026-10-19',
      ate: '2026-10-21',
    });
  });

  it('baldes ao dia e à semana', () => {
    expect(baldes({ de: '2026-10-18', ate: '2026-10-20' }, 'dia')).toEqual([
      '2026-10-18',
      '2026-10-19',
      '2026-10-20',
    ]);
    expect(baldes({ de: '2026-10-18', ate: '2026-10-27' }, 'semana')).toEqual([
      '2026-10-12',
      '2026-10-19',
      '2026-10-26',
    ]);
    expect(agruparPorOmissao({ de: '2026-10-01', ate: '2026-10-31' })).toBe(
      'dia',
    );
    expect(agruparPorOmissao({ de: '2026-09-01', ate: '2026-10-31' })).toBe(
      'semana',
    );
  });

  it('hoje no fuso do município', () => {
    const agora = new Date('2026-10-19T23:30:00Z');
    expect(hojeNoFuso('Europe/Lisbon', agora)).toBe('2026-10-20');
    expect(hojeNoFuso('Atlantic/Azores', agora)).toBe('2026-10-19');
  });
});

describe('variações', () => {
  it('em % com uma casa; sem base é null', () => {
    expect(variacao(120, 100)).toBe(20);
    expect(variacao(2, 3)).toBe(-33.3);
    expect(variacao(5, 0)).toBeNull();
    expect(variacao(0, 0)).toBeNull();
    expect(percentagem(1, 3)).toBe(33.3);
    expect(percentagem(1, 0)).toBeNull();
  });

  it('percentagens variam em pontos', () => {
    expect(indicador(62.5, 60, 'pct')).toEqual({
      valor: 62.5,
      anterior: 60,
      variacao: 2.5,
      unidade: 'pct',
    });
    expect(indicador(10, 8).variacao).toBe(25);
    expect(indicador(null, 8).variacao).toBeNull();
  });
});

describe('lerPeriodo', () => {
  const hoje = '2026-10-19';

  it('por omissão, os últimos 7 dias até hoje', () => {
    expect(lerPeriodo({}, hoje)).toEqual({
      de: '2026-10-13',
      ate: '2026-10-19',
      agrupar: undefined,
    });
    expect(lerPeriodo({ ate: '2026-10-10' }, hoje)).toMatchObject({
      de: '2026-10-04',
      ate: '2026-10-10',
    });
  });

  it('recusa datas inválidas, trocadas ou longas demais', () => {
    const codigo = (q: object) => {
      try {
        lerPeriodo(q, hoje);
      } catch (e) {
        return (e as ErroApi).codigo;
      }
      return null;
    };
    expect(codigo({ de: '2026-02-31' })).toBe('periodo_invalido');
    expect(codigo({ de: '19/10/2026' })).toBe('pedido_invalido');
    expect(codigo({ de: '2026-10-20', ate: '2026-10-19' })).toBe(
      'periodo_invalido',
    );
    expect(codigo({ de: '2024-01-01', ate: '2026-10-19' })).toBe(
      'periodo_demasiado_longo',
    );
    expect(codigo({ agrupar: 'mes' })).toBe('pedido_invalido');
  });
});
