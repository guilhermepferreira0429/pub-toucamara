import { ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ErroApi } from '../../common/erros.js';
import { MunicipiosService } from '../municipios/municipios.service.js';
import {
  MunicipioGuard,
  SegredoAgenteGuard,
  segredoIgual,
} from './agente.guard.js';

function contexto(headers: Record<string, string>, req: object = {}) {
  const pedido = {
    ...req,
    header: (n: string) => headers[n.toLowerCase()],
  };
  return {
    pedido,
    ctx: {
      switchToHttp: () => ({ getRequest: () => pedido }),
    } as unknown as ExecutionContext,
  };
}

function config(segredo: string, ambiente = 'development') {
  const valores: Record<string, unknown> = {
    agente: { segredo },
    'app.ambiente': ambiente,
  };
  return {
    get: (k: string) => valores[k],
    getOrThrow: (k: string) => valores[k],
  } as unknown as ConfigService;
}

describe('segredoIgual', () => {
  it('compara segredos de tamanhos diferentes sem rebentar', () => {
    expect(segredoIgual('abc', 'abc')).toBe(true);
    expect(segredoIgual('abc', 'abcd')).toBe(false);
  });
});

describe('SegredoAgenteGuard', () => {
  it('aceita o segredo certo', () => {
    const g = new SegredoAgenteGuard(config('s3gr3d0'));
    expect(g.canActivate(contexto({ 'x-agente-segredo': 's3gr3d0' }).ctx)).toBe(
      true,
    );
  });

  it('recusa segredo errado ou em falta', () => {
    const g = new SegredoAgenteGuard(config('s3gr3d0'));
    expect(() =>
      g.canActivate(contexto({ 'x-agente-segredo': 'x' }).ctx),
    ).toThrow(ErroApi);
    expect(() => g.canActivate(contexto({}).ctx)).toThrow(ErroApi);
  });

  it('sem segredo configurado: passa em dev, recusa em produção', () => {
    const dev = new SegredoAgenteGuard(config(''));
    jest.spyOn(dev['logger'], 'warn').mockImplementation(() => undefined);
    expect(dev.canActivate(contexto({}).ctx)).toBe(true);

    const prod = new SegredoAgenteGuard(config('', 'production'));
    expect(() => prod.canActivate(contexto({}).ctx)).toThrow(
      'AGENTE_SEGREDO não está configurado.',
    );
  });
});

describe('MunicipioGuard', () => {
  const guimaraes = {
    id: 'u1',
    slug: 'guimaraes',
    nome: 'Guimarães',
    fuso: 'Europe/Lisbon',
  };
  const municipios = {
    porSlug: jest.fn().mockResolvedValue(guimaraes),
  } as unknown as MunicipiosService;

  it('põe o município no pedido', async () => {
    const { ctx, pedido } = contexto({ 'x-municipio': 'guimaraes' });
    await expect(new MunicipioGuard(municipios).canActivate(ctx)).resolves.toBe(
      true,
    );
    expect(pedido).toMatchObject({ municipio: guimaraes });
  });

  it('exige o header X-Municipio', async () => {
    await expect(
      new MunicipioGuard(municipios).canActivate(contexto({}).ctx),
    ).rejects.toMatchObject({ codigo: 'municipio_em_falta' });
  });
});
