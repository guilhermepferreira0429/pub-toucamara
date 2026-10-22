import type { ConfigService } from '@nestjs/config';
import type { DatabaseService } from '../../database/database.service.js';
import {
  contactoPara,
  ENTIDADE_POR_OMISSAO,
  eUrgente,
  fraseContacto,
  leituraDita,
  vaiParaOcorrencia,
} from './regras.js';
import { referenciaSimulada, VimaguaSimulada } from './vimagua-simulada.js';

describe('água · regras', () => {
  const entidade = {
    nome: 'Águas do Concelho',
    site_url: null,
    por_omissao: false,
    contactos: [
      { tipo: 'telefone', rotulo: null, valor: '253 000 001' },
      { tipo: 'avarias', rotulo: 'Avarias, 24 horas', valor: '800 000 000' },
    ],
  };

  it('urgência e ocorrência na câmara', () => {
    expect(eUrgente('rotura', false)).toBe(true);
    expect(eUrgente('falta_agua', false)).toBe(true);
    expect(eUrgente('avaria', false)).toBe(false);
    expect(eUrgente('avaria', true)).toBe(true);
    expect(vaiParaOcorrencia('rotura', true)).toBe(true);
    expect(vaiParaOcorrencia('rotura', false)).toBe(false);
    expect(vaiParaOcorrencia('falta_agua', true)).toBe(false);
  });

  it('avarias → linha de avarias; o resto → telefone geral', () => {
    expect(contactoPara(entidade, 'rotura')?.valor).toBe('800 000 000');
    expect(contactoPara(entidade, 'fatura')?.valor).toBe('253 000 001');
    expect(fraseContacto(entidade, 'avaria')).toBe(
      'Águas do Concelho: o 800 000 000 (Avarias, 24 horas)',
    );
  });

  it('sem a entidade nos dados: só o site, sem números inventados', () => {
    expect(ENTIDADE_POR_OMISSAO.contactos).toEqual([]);
    expect(fraseContacto(ENTIDADE_POR_OMISSAO, 'avaria')).toBe(
      'Vimágua: www.vimagua.pt',
    );
  });

  it('leitura dita', () => {
    expect(leituraDita(1234.5)).toBe('1234,5 metros cúbicos');
  });
});

describe('Vimágua simulada', () => {
  function adaptador(taxa: string, n = 7) {
    const db = {
      query: jest.fn().mockResolvedValue([{ ultimo: n }]),
    } as unknown as DatabaseService;
    const config = { get: () => taxa } as unknown as ConfigService;
    return new VimaguaSimulada(db, config);
  }

  it('dá uma referência marcada como simulada', async () => {
    const v = adaptador('0');
    expect(v.simulado).toBe(true);
    const ano = new Date().getFullYear();
    await expect(
      v.enviar('m', {
        numero: 'AG-1',
        tipo: 'leitura',
        morada: 'Rua',
        numero_cliente: null,
        leitura_m3: 1,
        descricao: null,
        urgente: false,
        nome: null,
        telefone: null,
        criado_em: new Date().toISOString(),
      }),
    ).resolves.toEqual({ referencia: referenciaSimulada(ano, 7) });
    expect(referenciaSimulada(2026, 42)).toBe('VIM-SIM-2026-000042');
  });

  it('falha de propósito com a taxa de falha', async () => {
    const v = adaptador('1');
    v.aleatorio = () => 0.5;
    await expect(
      v.enviar('m', {
        numero: 'AG-2',
        tipo: 'avaria',
        morada: 'Rua',
        numero_cliente: null,
        leitura_m3: null,
        descricao: 'x',
        urgente: false,
        nome: null,
        telefone: null,
        criado_em: new Date().toISOString(),
      }),
    ).rejects.toMatchObject({ codigo: 'vimagua_indisponivel' });
  });
});
