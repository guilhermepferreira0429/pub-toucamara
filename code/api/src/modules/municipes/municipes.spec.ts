import { telefoneComAlternativa } from './municipes.service.js';

describe('telefoneComAlternativa', () => {
  it('usa o principal quando é válido', () => {
    expect(telefoneComAlternativa('912345678', '+351912345679')).toBe(
      '+351912345678',
    );
  });

  it('vazio, inválido ou placeholder por resolver → o alternativo', () => {
    expect(telefoneComAlternativa('', '912345679')).toBe('+351912345679');
    expect(telefoneComAlternativa(undefined, '912345679')).toBe(
      '+351912345679',
    );
    expect(telefoneComAlternativa('{{system__caller_id}}', '912 345 679')).toBe(
      '+351912345679',
    );
  });

  it('nenhum válido → null', () => {
    expect(telefoneComAlternativa('abc', '{{telefone}}')).toBeNull();
    expect(telefoneComAlternativa(undefined, undefined)).toBeNull();
  });
});
