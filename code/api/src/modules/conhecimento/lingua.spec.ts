import { linguaProvavel, linguasDaPesquisa } from './lingua';

describe('linguaProvavel', () => {
  it.each([
    ['Preciso de licença para obras na cozinha?', 'pt'],
    ['Quanto custa a taxa dos toldos?', 'pt'],
    ['Como chego ao castelo?', 'pt'],
    ['How do I get to Guimarães Castle?', 'en'],
    ['What are the opening hours of the museum?', 'en'],
    ['¿Cómo llego al castillo desde Oporto?', 'es'],
    ['¿Dónde hay una farmacia?', 'es'],
    ['Comment venir en train depuis Porto ?', 'fr'],
    ["Où est l'office de tourisme ?", 'fr'],
    ['', 'pt'],
    ['Guimarães', 'pt'],
  ])('%s → %s', (texto, lingua) => {
    expect(linguaProvavel(texto)).toBe(lingua);
  });

  it('procura sempre em português, mais a língua da pergunta', () => {
    expect(linguasDaPesquisa('Posso trocar as janelas?')).toEqual(['pt']);
    expect(linguasDaPesquisa('Where can I park?')).toEqual(['pt', 'en']);
  });
});
