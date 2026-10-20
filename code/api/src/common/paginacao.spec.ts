import { types } from 'pg';
import { instalarParserDatas } from './datas-pg.js';
import { lerCursor, pagina } from './paginacao.js';

describe('pagina', () => {
  it('sem mais linhas, sem cursor', () => {
    expect(pagina([{ em: new Date(), id: 'a' }], 5, (l) => l)).toEqual({
      itens: [{ em: expect.any(Date) as Date, id: 'a' }],
      proximo_cursor: null,
    });
  });

  it('o cursor guarda os microssegundos das datas vindas da BD', () => {
    instalarParserDatas();
    const ler = types.getTypeParser(1184) as (s: string) => Date;
    // Duas linhas no mesmo milissegundo: com o ISO do Date (…123Z) a segunda
    // página saltava a linha de …123100.
    const linhas = [
      { em: ler('2026-10-20 09:00:00.123456+00'), id: 'b' },
      { em: ler('2026-10-20 09:00:00.123100+00'), id: 'a' },
    ];
    const p = pagina(linhas, 1, (l) => l);
    expect(p.itens).toHaveLength(1);
    const c = lerCursor(p.proximo_cursor!);
    expect(c).toEqual({ em: '2026-10-20 09:00:00.123456+00', id: 'b' });
  });

  it('datas criadas na aplicação usam o ISO', () => {
    const em = new Date('2026-10-20T09:00:00.123Z');
    const p = pagina(
      [
        { em, id: 'b' },
        { em, id: 'a' },
      ],
      1,
      (l) => l,
    );
    expect(lerCursor(p.proximo_cursor!).em).toBe('2026-10-20T09:00:00.123Z');
  });
});
