import { ErroApi } from '../../common/erros.js';
import { podeEditarAgente, proximaVersao } from './agente.service.js';
import { validarAlteracao } from './equipa.service.js';

describe('versão do agente', () => {
  it('dia + contador, recomeça a cada dia', () => {
    expect(proximaVersao(null, '2026-10-19')).toBe('2026-10-19.1');
    expect(proximaVersao('2026-10-19.1', '2026-10-19')).toBe('2026-10-19.2');
    expect(proximaVersao('2026-10-19.9', '2026-10-19')).toBe('2026-10-19.10');
    expect(proximaVersao('2026-10-18.4', '2026-10-19')).toBe('2026-10-19.1');
    expect(proximaVersao('v1-seed', '2026-10-19')).toBe('2026-10-19.1');
  });

  it('na v1 só a equipa interna edita', () => {
    expect(podeEditarAgente('admin')).toBe(true);
    expect(podeEditarAgente('equipa_toucamara')).toBe(true);
    expect(podeEditarAgente('chefe_divisao')).toBe(false);
  });
});

describe('equipa', () => {
  it('ninguém se desativa a si próprio', () => {
    const eu = { id: 'u1' };
    expect(() => validarAlteracao(eu, 'u1', { ativo: false })).toThrow(ErroApi);
    expect(() =>
      validarAlteracao(eu, 'u1', { perfil: 'tecnico' }),
    ).not.toThrow();
    expect(() => validarAlteracao(eu, 'u2', { ativo: false })).not.toThrow();
  });
});
