import { HttpStatus } from '@nestjs/common';
import {
  decidirPublicacao,
  erroPublicacao,
  ExecucaoGate,
  LIMIAR_PUBLICACAO,
} from './avaliacao.js';

describe('decidirPublicacao', () => {
  const exec = (o: Partial<ExecucaoGate> = {}): ExecucaoGate => ({
    execucao_id: 'e1',
    sistema: 'Tou · Teste',
    agente_versao: '2026.10.19-1',
    terminada_em: '2026-10-19T10:00:00Z',
    taxa: 85,
    total: 180,
    por_avaliar: 0,
    ...o,
  });
  const versao = '2026.10.19-1';

  it('o limiar é 80%', () => {
    expect(LIMIAR_PUBLICACAO).toBe(80);
  });

  it('permite com a versão atual e taxa ≥ limiar', () => {
    expect(decidirPublicacao(exec(), versao)).toEqual({
      permitir: true,
      execucao_id: 'e1',
      taxa: 85,
    });
  });

  it('exatamente no limiar passa', () => {
    expect(decidirPublicacao(exec({ taxa: 80 }), versao).permitir).toBe(true);
  });

  it('sem execução: avaliacao_em_falta', () => {
    expect(decidirPublicacao(null, versao)).toMatchObject({
      permitir: false,
      motivo: 'avaliacao_em_falta',
      causa: 'sem_execucao',
      execucao_id: null,
    });
  });

  it('execução ainda sem terminar conta como em falta', () => {
    expect(
      decidirPublicacao(exec({ terminada_em: null }), versao),
    ).toMatchObject({ motivo: 'avaliacao_em_falta', causa: 'sem_execucao' });
  });

  it('outra versão do agente (ou sem versão atual): em falta', () => {
    expect(
      decidirPublicacao(exec({ agente_versao: '2026.10.18-1' }), versao),
    ).toMatchObject({ motivo: 'avaliacao_em_falta', causa: 'outra_versao' });
    expect(decidirPublicacao(exec(), null)).toMatchObject({
      motivo: 'avaliacao_em_falta',
      causa: 'outra_versao',
    });
  });

  it('respostas por avaliar ou nada avaliado: em falta', () => {
    expect(decidirPublicacao(exec({ por_avaliar: 3 }), versao)).toMatchObject({
      motivo: 'avaliacao_em_falta',
      causa: 'por_avaliar',
      taxa: 85,
    });
    expect(
      decidirPublicacao(exec({ taxa: null, total: 0 }), versao),
    ).toMatchObject({ motivo: 'avaliacao_em_falta', causa: 'por_avaliar' });
  });

  it('abaixo do limiar: avaliacao_abaixo_do_limiar com a taxa', () => {
    expect(decidirPublicacao(exec({ taxa: 79.99 }), versao)).toEqual({
      permitir: false,
      motivo: 'avaliacao_abaixo_do_limiar',
      causa: 'abaixo',
      execucao_id: 'e1',
      taxa: 79.99,
    });
  });

  it('o limiar pode vir de fora', () => {
    expect(decidirPublicacao(exec({ taxa: 85 }), versao, 90).permitir).toBe(
      false,
    );
  });
});

describe('erroPublicacao', () => {
  const ctx = { versao_atual: 'v2', sistema: 'Tou · Teste' };

  it('em falta → 409 com o comando do avaliador', () => {
    const e = erroPublicacao(
      {
        permitir: false,
        motivo: 'avaliacao_em_falta',
        causa: 'sem_execucao',
        execucao_id: null,
        taxa: null,
      },
      ctx,
    );
    expect(e.getStatus()).toBe(HttpStatus.CONFLICT);
    expect(e.codigo).toBe('avaliacao_em_falta');
    expect(e.detalhes).toMatchObject({
      causa: 'sem_execucao',
      limiar: 80,
      versao_atual: 'v2',
      comando: 'avaliador executar --sistema "Tou · Teste" --motivo publicacao',
    });
  });

  it('abaixo → 422 com a taxa', () => {
    const e = erroPublicacao(
      {
        permitir: false,
        motivo: 'avaliacao_abaixo_do_limiar',
        causa: 'abaixo',
        execucao_id: 'e1',
        taxa: 72.5,
      },
      ctx,
    );
    expect(e.getStatus()).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
    expect(e.codigo).toBe('avaliacao_abaixo_do_limiar');
    expect(e.message).toContain('72,5%');
    expect(e.detalhes).toMatchObject({ taxa: 72.5, execucao_id: 'e1' });
  });
});
