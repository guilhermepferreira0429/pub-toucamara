import { HttpStatus } from '@nestjs/common';
import { ErroApi } from '../../common/erros.js';
import type { DatabaseService } from '../../database/database.service.js';
import type { ClaudeService } from '../../ia/claude.service.js';
import type { AuditoriaService } from '../auditoria/auditoria.service.js';
import {
  CandidatoTecnico,
  conteudoServico,
  escolherTecnico,
  escreverCursor,
  lerCursorEntrada,
  linkPainel,
  mascararEmail,
  mascararMunicipe,
} from './entrada.regras.js';
import { EncaminhamentoAutomaticoService } from './encaminhamento-automatico.service.js';

const t = (
  id: string,
  abertos: number,
  prazo: string | null = null,
  nome = id,
): CandidatoTecnico => ({ id, nome, abertos, prazo_mais_proximo: prazo });

describe('escolherTecnico', () => {
  it('sem candidatos → null', () => {
    expect(escolherTecnico([])).toBeNull();
  });

  it('um só → único técnico do serviço', () => {
    expect(escolherTecnico([t('a', 1)])).toEqual({
      tecnico: t('a', 1),
      motivo: 'único técnico do serviço: 1 aberto',
    });
  });

  it('o de menor carga ganha', () => {
    const r = escolherTecnico([t('a', 5), t('b', 3), t('c', 4)]);
    expect(r?.tecnico.id).toBe('b');
    expect(r?.motivo).toBe('menor carga: 3 abertos');
  });

  it('empate na carga → prazo mais folgado (sem prazos ganha)', () => {
    const r = escolherTecnico([
      t('a', 2, '2026-10-22'),
      t('b', 2, null),
      t('c', 2, '2026-11-30'),
    ]);
    expect(r?.tecnico.id).toBe('b');
    expect(r?.motivo).toBe(
      'menor carga: 2 abertos; empate desfeito pelo prazo mais folgado (sem prazos)',
    );
  });

  it('empate na carga, todos com prazo → o mais distante', () => {
    const r = escolherTecnico([
      t('a', 2, '2026-10-22'),
      t('c', 2, '2026-11-30'),
    ]);
    expect(r?.tecnico.id).toBe('c');
    expect(r?.motivo).toContain('(2026-11-30)');
  });

  it('empate total → ordem alfabética, determinístico', () => {
    const lista = [t('2', 0, null, 'Rui'), t('1', 0, null, 'Ana')];
    expect(escolherTecnico(lista)?.tecnico.nome).toBe('Ana');
    expect(escolherTecnico([...lista].reverse())?.tecnico.nome).toBe('Ana');
    expect(escolherTecnico(lista)?.motivo).toBe(
      'menor carga: 0 abertos; empate, por ordem alfabética',
    );
  });

  it('não mexe na lista recebida', () => {
    const lista = [t('a', 5), t('b', 1)];
    escolherTecnico(lista);
    expect(lista.map((c) => c.id)).toEqual(['a', 'b']);
  });
});

describe('máscaras e links', () => {
  it('nome abreviado, senão telefone, senão email', () => {
    expect(
      mascararMunicipe({
        nome: 'Maria Fernandes',
        telefone: '+351912345214',
        email: null,
      }),
    ).toBe('Maria F.');
    expect(
      mascararMunicipe({ nome: null, telefone: '+351912345214', email: null }),
    ).toBe('+351 9•• ••• 214');
    expect(
      mascararMunicipe({ nome: null, telefone: null, email: 'ana@ex.pt' }),
    ).toBe('an•••@ex.pt');
    expect(
      mascararMunicipe({ nome: null, telefone: null, email: null }),
    ).toBeNull();
    expect(mascararEmail('sem-arroba')).toBe('•••');
  });

  it('link do painel por tipo', () => {
    expect(linkPainel('pedido', 'x')).toBe('/painel/entrada/pedidos/x');
    expect(linkPainel('processo', 'y')).toBe('/painel/processos/y');
  });
});

describe('cursor da entrada', () => {
  it('ida e volta', () => {
    const c = escreverCursor({
      urgente: true,
      criado_em: new Date('2026-10-20T10:00:00.123Z'),
      tipo: 'email',
      id: 'abc',
    });
    expect(lerCursorEntrada(c)).toEqual({
      urgente: true,
      em: '2026-10-20T10:00:00.123Z',
      tipo: 'email',
      id: 'abc',
    });
  });

  it('cursor estragado → 400 cursor_invalido', () => {
    expect(() => lerCursorEntrada('lixo')).toThrow(ErroApi);
    const sem = Buffer.from(JSON.stringify({ em: 'x', id: 'y' })).toString(
      'base64url',
    );
    expect(() => lerCursorEntrada(sem)).toThrow('Cursor inválido.');
  });
});

describe('conteudoServico', () => {
  it('lista os serviços e corta textos longos', () => {
    const c = conteudoServico('x'.repeat(10_000), [
      { id: 's1', nome: 'Obras' },
    ]);
    expect(c).toContain('- s1: Obras');
    expect(c).toContain('[... texto cortado]');
    expect(c.length).toBeLessThan(7_000);
  });
});

describe('EncaminhamentoAutomaticoService.decidirServico', () => {
  const servicos = [
    { id: 's-obras', nome: 'Obras particulares' },
    { id: 's-vias', nome: 'Vias' },
  ];
  const item = {
    tipo: 'pedido' as const,
    id: 'p1',
    municipio_id: 'm1',
    servico_id: null as string | null,
    tecnico_id: null,
    atribui_tecnico: true,
    servico_sugerido_id: null as string | null,
    servico_sugerido_motivo: null as string | null,
    texto: 'Quero abrir uma janela',
  };

  function montar(claude: Partial<ClaudeService>) {
    const db = {
      query: jest.fn().mockResolvedValue(servicos),
    } as unknown as DatabaseService;
    const svc = new EncaminhamentoAutomaticoService(
      db,
      claude as ClaudeService,
      {} as AuditoriaService,
    );
    return { svc, db };
  }

  it('regra da vista primeiro (sem IA)', async () => {
    const extrair = jest.fn();
    const { svc } = montar({ disponivel: true, extrair });
    const r = await svc['decidirServico']({
      ...item,
      tipo: 'processo',
      servico_sugerido_id: 's-obras',
      servico_sugerido_motivo: 'serviço do tipo de processo CP',
    });
    expect(r).toEqual({
      id: 's-obras',
      motivo: 'serviço do tipo de processo CP',
    });
    expect(extrair).not.toHaveBeenCalled();
  });

  it('serviço já classificado do email', async () => {
    const { svc } = montar({ disponivel: false });
    const r = await svc['decidirServico']({
      ...item,
      tipo: 'email',
      servico_id: 's-vias',
    });
    expect(r).toEqual({
      id: 's-vias',
      motivo: 'serviço já classificado do email',
    });
  });

  it('sem IA → null (fica por atribuir, sem registo)', async () => {
    const { svc } = montar({ disponivel: false });
    expect(await svc['decidirServico'](item)).toBeNull();
  });

  it('IA escolhe um serviço da lista, com esforço low', async () => {
    const extrair = jest
      .fn()
      .mockResolvedValue({ servico_id: 's-obras', motivo: 'é uma obra' });
    const { svc } = montar({ disponivel: true, extrair });
    const r = await svc['decidirServico'](item);
    expect(r).toEqual({
      id: 's-obras',
      motivo: 'classificado pela IA (Obras particulares): é uma obra',
    });
    const [, pedido] = extrair.mock.calls[0] as [
      unknown,
      { esforco: string; conteudo: string; sistema: string },
    ];
    expect(pedido.esforco).toBe('low');
    expect(pedido.conteudo).toContain('Quero abrir uma janela');
    expect(pedido.sistema).not.toContain('s-obras');
  });

  it('IA com um id fora da lista → sem serviço, registado', async () => {
    const extrair = jest
      .fn()
      .mockResolvedValue({ servico_id: 'inventado', motivo: '' });
    const { svc } = montar({ disponivel: true, extrair });
    expect(await svc['decidirServico'](item)).toEqual({
      id: null,
      motivo: 'a IA não encontrou o serviço',
    });
  });

  it('IA indisponível → null (tenta na próxima passagem)', async () => {
    const extrair = jest
      .fn()
      .mockRejectedValue(
        new ErroApi(HttpStatus.SERVICE_UNAVAILABLE, 'ia_indisponivel', 'x'),
      );
    const { svc } = montar({ disponivel: true, extrair });
    expect(await svc['decidirServico'](item)).toBeNull();
  });

  it('IA recusou → registado sem serviço (não repete)', async () => {
    const extrair = jest
      .fn()
      .mockRejectedValue(
        new ErroApi(HttpStatus.UNPROCESSABLE_ENTITY, 'ia_recusou', 'x'),
      );
    const { svc } = montar({ disponivel: true, extrair });
    expect(await svc['decidirServico'](item)).toEqual({
      id: null,
      motivo: 'a IA não classificou (ia_recusou)',
    });
  });
});
