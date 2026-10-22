import { destinoSimulado } from './destino-simulado';

describe('destinoSimulado (o único ponto que decide se um envio sai)', () => {
  it('registo de fonte simulada: nunca sai, mesmo com número de aspeto real', () => {
    expect(
      destinoSimulado({ destino: '+351919912345', simulado: true }),
    ).toEqual({ motivo: 'simulado', fornecedor: 'simulado' });
  });

  it('marca em falta: na dúvida, não sai', () => {
    expect(
      destinoSimulado({ destino: '+351919912345', simulado: undefined }),
    ).toMatchObject({ motivo: 'simulado' });
    expect(
      destinoSimulado({ destino: '+351919912345', simulado: null }),
    ).toMatchObject({ motivo: 'simulado' });
  });

  it('gama de teste da demonstração (+351 910 000 xxx): nunca sai', () => {
    expect(
      destinoSimulado({ destino: '+351910000123', simulado: false }),
    ).toEqual({ motivo: 'demonstracao', fornecedor: 'demonstracao' });
  });

  it('número real, sem marca: sai', () => {
    expect(
      destinoSimulado({ destino: '+351912345678', simulado: false }),
    ).toBeNull();
    expect(
      destinoSimulado({ destino: '+351910001123', simulado: false }),
    ).toBeNull();
  });
});
