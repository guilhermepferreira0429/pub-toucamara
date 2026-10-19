import { HttpStatus, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import { ErroApi, FiltroErros } from './erros.js';
import { validar } from './validacao.js';

describe('FiltroErros', () => {
  const filtro = new FiltroErros();

  it('mantém o código de um ErroApi', () => {
    const r = filtro.paraCorpo(
      new ErroApi(HttpStatus.CONFLICT, 'ja_assinado', 'Já assinado.', {
        id: 1,
      }),
    );
    expect(r).toEqual({
      status: 409,
      corpo: {
        erro: {
          codigo: 'ja_assinado',
          mensagem: 'Já assinado.',
          detalhes: { id: 1 },
        },
      },
    });
  });

  it('dá código às exceções do Nest pelo estado', () => {
    const r = filtro.paraCorpo(new NotFoundException('Não há.'));
    expect(r.status).toBe(404);
    expect(r.corpo.erro).toEqual({
      codigo: 'nao_encontrado',
      mensagem: 'Não há.',
    });
  });

  it('esconde erros inesperados atrás de erro_interno', () => {
    jest.spyOn(filtro['logger'], 'error').mockImplementation(() => undefined);
    const r = filtro.paraCorpo(new Error('password=segredo'));
    expect(r).toEqual({
      status: 500,
      corpo: { erro: { codigo: 'erro_interno', mensagem: 'Erro interno.' } },
    });
  });
});

describe('validar', () => {
  const esquema = z.object({ pergunta: z.string().min(2) });

  it('devolve os dados válidos', () => {
    expect(validar(esquema, { pergunta: 'olá' })).toEqual({ pergunta: 'olá' });
  });

  it('lança pedido_invalido com os campos', () => {
    try {
      validar(esquema, { pergunta: 'x' });
      fail('devia ter lançado');
    } catch (e) {
      expect(e).toBeInstanceOf(ErroApi);
      const erro = e as ErroApi;
      expect(erro.getStatus()).toBe(400);
      expect(erro.codigo).toBe('pedido_invalido');
      const { campos } = erro.detalhes as { campos: { campo: string }[] };
      expect(campos.map((c) => c.campo)).toEqual(['pergunta']);
    }
  });
});
