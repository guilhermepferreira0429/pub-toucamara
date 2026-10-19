import {
  avaliarDocumento,
  bytesDeBase64,
  dataValida,
  DocumentoComEstado,
  fraseVerificacao,
  Leitura,
  lerVerificacoes,
  mesesEntre,
  mimePelosBytes,
  resumirEntregas,
  resumirParaAgente,
  semPrefixoDataUrl,
} from './verificacao-documentos.js';

const HOJE = '2026-10-19';

const bom: Leitura = {
  tipo_reconhecido: 'Certidão do registo predial',
  corresponde_ao_esperado: true,
  confianca: 'alta',
  legivel: true,
  data_emissao: '2026-07-01',
  tem_assinatura_ou_carimbo: true,
};

function avaliar(
  leitura: Partial<Leitura>,
  verificacoes: unknown = [{ tipo: 'validade', meses: 6 }],
  nif: { visivel?: boolean; corresponde?: boolean | null } = {},
) {
  return avaliarDocumento({
    leitura: { ...bom, ...leitura },
    verificacoes: lerVerificacoes(verificacoes),
    hoje: HOJE,
    nifVisivel: nif.visivel ?? true,
    nifCorresponde: nif.corresponde ?? null,
  });
}

describe('lerVerificacoes', () => {
  it('aceita lista vazia, ignora desconhecidas e validade sem prazo', () => {
    expect(lerVerificacoes([])).toEqual([]);
    expect(lerVerificacoes(null)).toEqual([]);
    expect(
      lerVerificacoes([
        { tipo: 'validade', meses: 6 },
        { tipo: 'cor_da_capa' },
        { tipo: 'validade' },
        { tipo: 'assinatura' },
      ]),
    ).toEqual([{ tipo: 'validade', meses: 6 }, { tipo: 'assinatura' }]);
  });
});

describe('datas', () => {
  it('valida datas ISO reais', () => {
    expect(dataValida('2026-02-30')).toBeNull();
    expect(dataValida('21/10/2026')).toBeNull();
    expect(dataValida('2026-02-28')).toBe('2026-02-28');
  });

  it('conta meses completos', () => {
    expect(mesesEntre('2026-02-20', HOJE)).toBe(7);
    expect(mesesEntre('2026-02-19', HOJE)).toBe(8);
    expect(mesesEntre('2026-10-01', HOJE)).toBe(0);
  });
});

describe('avaliarDocumento', () => {
  it('documento certo e dentro do prazo → valido', () => {
    const a = avaliar({});
    expect(a.estado).toBe('valido');
    expect(a.emitido_em).toBe('2026-07-01');
    expect(a.regras.every((r) => r.ok)).toBe(true);
    expect(fraseVerificacao('Certidão do registo predial', a)).toBe(
      'Certidão do registo predial: está bem — emitida há 3 meses (validade de 6 meses).',
    );
  });

  it('emitida há 8 meses com validade de 6 → fora_de_prazo', () => {
    const a = avaliar({ data_emissao: '2026-02-10' });
    expect(a.estado).toBe('fora_de_prazo');
    expect(fraseVerificacao('Certidão do registo predial', a)).toBe(
      'Certidão do registo predial: fora de prazo — emitida há 8 meses, tem de ter menos de 6.',
    );
  });

  it('validade em dias', () => {
    expect(
      avaliar({ data_emissao: '2026-10-09' }, [{ tipo: 'validade', dias: 7 }])
        .estado,
    ).toBe('fora_de_prazo');
    const a = avaliar({ data_emissao: '2026-10-17' }, [
      { tipo: 'validade', dias: 7 },
    ]);
    expect(a.estado).toBe('valido');
    expect(a.regras[2].detalhe).toBe('emitida há 2 dias (validade de 7 dias)');
  });

  it('sem data legível (ou no futuro) quando a validade a exige → ilegivel', () => {
    expect(avaliar({ data_emissao: null }).estado).toBe('ilegivel');
    expect(avaliar({ data_emissao: '31-13-2026' }).estado).toBe('ilegivel');
    expect(avaliar({ data_emissao: '2027-01-01' }).estado).toBe('ilegivel');
    // Sem regra de validade a data não interessa.
    expect(avaliar({ data_emissao: null }, []).estado).toBe('valido');
  });

  it('outro documento ou confiança baixa → documento_errado', () => {
    const a = avaliar({
      corresponde_ao_esperado: false,
      tipo_reconhecido: 'Caderneta predial',
    });
    expect(a.estado).toBe('documento_errado');
    expect(fraseVerificacao('Certidão do registo predial', a)).toContain(
      'não é o documento certo — parece ser: Caderneta predial',
    );
    expect(avaliar({ confianca: 'baixa' }).estado).toBe('documento_errado');
  });

  it('ilegível ganha a tudo', () => {
    expect(
      avaliar({ legivel: false, corresponde_ao_esperado: false }).estado,
    ).toBe('ilegivel');
  });

  it('sem assinatura → documento_errado (incompleto)', () => {
    const a = avaliar({ tem_assinatura_ou_carimbo: false }, [
      { tipo: 'assinatura' },
    ]);
    expect(a.estado).toBe('documento_errado');
    expect(fraseVerificacao('Termo', a)).toBe(
      'Termo: incompleto — não se vê assinatura, carimbo nem código de validação.',
    );
  });

  it('fora de prazo tem prioridade sobre falta de assinatura', () => {
    const a = avaliar(
      { data_emissao: '2025-01-01', tem_assinatura_ou_carimbo: false },
      [{ tipo: 'validade', meses: 6 }, { tipo: 'assinatura' }],
    );
    expect(a.estado).toBe('fora_de_prazo');
    expect(a.regras.filter((r) => !r.ok)).toHaveLength(2);
  });

  it('NIF do requerente', () => {
    const v = [{ tipo: 'nif_requerente' }];
    expect(avaliar({}, v, { corresponde: true }).estado).toBe('valido');
    expect(avaliar({}, v, { corresponde: false }).estado).toBe(
      'documento_errado',
    );
    expect(avaliar({}, v, { visivel: false }).estado).toBe('ilegivel');
    const semNif = avaliar({}, v, { corresponde: null });
    expect(semNif.estado).toBe('valido');
    expect(semNif.regras[2].detalhe).toContain('por confirmar');
  });
});

describe('resumirEntregas', () => {
  const doc = (
    nome: string,
    estado: DocumentoComEstado['estado'],
    extra: Partial<DocumentoComEstado> = {},
  ): DocumentoComEstado => ({
    id: nome,
    nome,
    obrigatorio: true,
    gerado_pelo_sistema: false,
    estado,
    ...extra,
  });
  const lista = [
    doc('A', 'valido'),
    doc('B', 'por_verificar'),
    doc('C', 'fora_de_prazo'),
    doc('D', null, { obrigatorio: false }),
    doc('Planta', null, { gerado_pelo_sistema: true }),
  ];

  it('separa válidos, por verificar e em falta', () => {
    const r = resumirEntregas(lista);
    expect(r.tem.map((d) => d.nome)).toEqual(['A']);
    expect(r.por_verificar.map((d) => d.nome)).toEqual(['B']);
    expect(r.faltam).toEqual([
      {
        id: 'C',
        nome: 'C',
        obrigatorio: true,
        ultima_verificacao: 'fora_de_prazo',
      },
      { id: 'D', nome: 'D', obrigatorio: false, ultima_verificacao: null },
    ]);
  });

  it('para o agente: por verificar conta como entregue, faltam só obrigatórios', () => {
    expect(resumirParaAgente(lista)).toEqual({
      tem: ['A', 'B'],
      por_verificar: ['B'],
      faltam: ['C'],
    });
  });
});

describe('ficheiro', () => {
  it('conta bytes de base64 e tira o prefixo de data URL', () => {
    const b = Buffer.alloc(1000, 7);
    expect(bytesDeBase64(b.toString('base64'))).toBe(1000);
    expect(bytesDeBase64(Buffer.alloc(1001).toString('base64'))).toBe(1001);
    expect(semPrefixoDataUrl('data:image/png;base64,AAAA')).toBe('AAAA');
    expect(semPrefixoDataUrl('AAAA')).toBe('AAAA');
  });

  it('reconhece o tipo pelos bytes', () => {
    expect(mimePelosBytes(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe(
      'image/jpeg',
    );
    expect(
      mimePelosBytes(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0])),
    ).toBe('image/png');
    expect(mimePelosBytes(Buffer.from('GIF89a'))).toBe('image/gif');
    expect(mimePelosBytes(Buffer.from('RIFF\0\0\0\0WEBPVP8 '))).toBe(
      'image/webp',
    );
    expect(mimePelosBytes(Buffer.from('%PDF-1.7'))).toBe('application/pdf');
    expect(mimePelosBytes(Buffer.from('<html>'))).toBeNull();
  });
});
