import { somarDiasUteis } from '../../common/dias-uteis.js';
import { infoSms } from '../comunicacao/sms.js';
import {
  avisoFase,
  avisoLembrete,
  avisoPedido,
  comPrazos,
  diaPorExtenso,
  emFaltaFalado,
  escolherCanal,
  estadoPedido,
  FASES_AVISADAS,
  precisaLembrete,
  PRAZO_PEDIDO_DIAS_UTEIS,
} from './avisos.js';
import { FASES } from './regras.js';

const feriados = new Set(['2026-12-08', '2026-12-25']);
const base = {
  municipio: 'Câmara Municipal de Guimarães',
  numero: 'CP 1234/2026',
  link: 'https://toucamara.pt/r/8K2F9XQ',
};

describe('prazos dos pedidos', () => {
  it('10 dias úteis por omissão', () => {
    // Segunda 19/10 → segunda 2/11 (fins de semana não contam).
    expect(
      somarDiasUteis('2026-10-19', PRAZO_PEDIDO_DIAS_UTEIS, feriados),
    ).toBe('2026-11-02');
  });

  it('junta a cada documento em falta o prazo mais cedo do pedido', () => {
    expect(
      comPrazos(
        ['Certidão', 'Planta', 'Foto'],
        [
          { descricao: 'Foto', prazo: '2026-11-10' },
          { descricao: 'Certidão', prazo: '2026-11-02' },
          { descricao: 'Foto', prazo: '2026-11-03' },
        ],
      ),
    ).toEqual([
      { nome: 'Certidão', prazo: '2026-11-02' },
      { nome: 'Planta', prazo: null },
      { nome: 'Foto', prazo: '2026-11-03' },
    ]);
  });

  it('diz o prazo por extenso, também quando já passou', () => {
    expect(diaPorExtenso('2026-10-30')).toBe('30 de outubro');
    expect(diaPorExtenso('2026-03-01')).toBe('1 de março');
    expect(
      emFaltaFalado(
        [
          { nome: 'Certidão', prazo: '2026-10-30' },
          { nome: 'Foto', prazo: '2026-10-20' },
          { nome: 'Planta', prazo: '2026-10-15' },
          { nome: 'Termo', prazo: null },
        ],
        '2026-10-20',
      ),
    ).toBe(
      'Certidão (tem até dia 30 de outubro), Foto (o prazo termina hoje), ' +
        'Planta (o prazo terminou a 15 de outubro), Termo',
    );
  });

  it('estado do pedido', () => {
    const hoje = '2026-10-20';
    expect(
      estadoPedido({ respondido_em: new Date(), prazo: '2026-10-01' }, hoje),
    ).toBe('respondido');
    expect(estadoPedido({ respondido_em: null, prazo: hoje }, hoje)).toBe(
      'por_responder',
    );
    expect(
      estadoPedido({ respondido_em: null, prazo: '2026-10-19' }, hoje),
    ).toBe('fora_de_prazo');
  });
});

describe('precisaLembrete', () => {
  const pedido = { pedidoDia: '2026-10-19', prazo: '2026-11-02', feriados };

  it('a 3 dias úteis do fim ou menos, até ao próprio dia', () => {
    expect(precisaLembrete({ ...pedido, hoje: '2026-10-27' })).toBe(false); // 4
    expect(precisaLembrete({ ...pedido, hoje: '2026-10-28' })).toBe(true); // 3
    expect(precisaLembrete({ ...pedido, hoje: '2026-10-31' })).toBe(true); // sábado, 1
    expect(precisaLembrete({ ...pedido, hoje: '2026-11-02' })).toBe(true); // 0
    expect(precisaLembrete({ ...pedido, hoje: '2026-11-03' })).toBe(false); // passou
  });

  it('um pedido curto já disse o prazo: sem lembrete', () => {
    expect(
      precisaLembrete({
        pedidoDia: '2026-10-19',
        prazo: '2026-10-22',
        hoje: '2026-10-19',
        feriados,
      }),
    ).toBe(false);
  });
});

describe('escolherCanal', () => {
  const tel = '+351912345678';
  it('email se o preferir e o tiver, senão SMS', () => {
    expect(
      escolherCanal({ telefone: tel, email: 'a@b.pt', preferido: 'email' }),
    ).toEqual({ canal: 'email', destino: 'a@b.pt' });
    expect(
      escolherCanal({ telefone: tel, email: null, preferido: 'email' }),
    ).toEqual({ canal: 'sms', destino: tel });
    expect(
      escolherCanal({ telefone: tel, email: 'a@b.pt', preferido: null }),
    ).toEqual({ canal: 'sms', destino: tel });
  });

  it('sem telefone vai o email que houver; sem nada, ninguém', () => {
    expect(
      escolherCanal({ telefone: null, email: 'a@b.pt', preferido: 'sms' }),
    ).toEqual({ canal: 'email', destino: 'a@b.pt' });
    expect(
      escolherCanal({ telefone: null, email: null, preferido: 'email' }),
    ).toBeNull();
  });
});

describe('textos dos avisos', () => {
  const docs = {
    ...base,
    prazoFim: '2026-11-16',
    faltam: ['Certidão do registo predial', 'Termo de responsabilidade'],
  };

  it('só as fases que o munícipe percebe', () => {
    for (const fase of FASES) {
      expect(avisoFase(fase, docs) !== null).toBe(
        FASES_AVISADAS.includes(fase),
      );
    }
  });

  it('cada fase diz o que interessa, com o link', () => {
    expect(avisoFase('documentos', docs)?.texto).toBe(
      'Câmara Municipal de Guimarães: o processo CP 1234/2026 aguarda documentos seus: ' +
        'Certidão do registo predial, Termo de responsabilidade. Envie aqui: https://toucamara.pt/r/8K2F9XQ',
    );
    expect(avisoFase('apreciacao', docs)?.texto).toContain(
      'está completo e em análise. O prazo da câmara termina a 16/11.',
    );
    expect(
      avisoFase('apreciacao', { ...docs, prazoFim: null })?.texto,
    ).not.toContain('prazo');
    expect(avisoFase('pareceres_externos', docs)?.texto).toContain(
      'aguarda pareceres de entidades externas',
    );
    expect(avisoFase('apreciacao', docs)?.assunto).toBe(
      'Processo CP 1234/2026: Apreciação',
    );
  });

  it('muitos documentos: diz quantos', () => {
    const texto = avisoFase('documentos', {
      ...docs,
      faltam: [...docs.faltam, 'Planta de implantação', 'Fotografias'],
    })?.texto;
    expect(texto).toContain('aguarda documentos seus: 4 documentos.');
  });

  it('pedido e lembrete dizem até quando', () => {
    expect(
      avisoPedido({
        ...base,
        nome: 'Certidão do registo predial',
        nota: null,
        prazo: '2026-11-02',
      }).texto,
    ).toContain('precisamos de: Certidão do registo predial, até 02/11.');
    const lembrete = {
      ...base,
      descricao: 'Certidão do registo predial',
      prazo: '2026-11-02',
    };
    expect(avisoLembrete({ ...lembrete, hoje: '2026-10-28' }).texto).toContain(
      'falta entregar Certidão do registo predial até 02/11.',
    );
    expect(avisoLembrete({ ...lembrete, hoje: '2026-11-02' }).texto).toContain(
      'Certidão do registo predial até hoje.',
    );
  });

  it('cabem em 3 partes de SMS mesmo com acentos (UCS-2)', () => {
    const textos = [
      ...FASES_AVISADAS.map((f) => avisoFase(f, docs)!.texto),
      avisoPedido({
        ...base,
        nome: 'Certidão do registo predial',
        nota: null,
        prazo: '2026-11-02',
      }).texto,
      avisoLembrete({
        ...base,
        descricao: 'Certidão do registo predial',
        prazo: '2026-11-02',
        hoje: '2026-10-28',
      }).texto,
    ];
    for (const t of textos) {
      const info = infoSms(t);
      expect(info.codificacao).toBe('ucs2');
      expect(info.segmentos).toBeLessThanOrEqual(3);
    }
  });
});
