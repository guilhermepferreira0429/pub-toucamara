import { cruza, planosProibidos } from './camara';
import type { Bloco, Cena, Dados, Retangulo, Visual } from './tipos';

/*
 * O guião do vídeo do painel. Fala o próprio assistente da câmara, na
 * primeira pessoa (masculino, português de Portugal). Os números vêm de
 * src/dados.gerado.json, lidos do painel no momento das capturas: o que se
 * diz é o que está no ecrã.
 *
 * Regras: resultados, não funcionalidades; nada que o produto não faça; o
 * que é simulado diz-se (a chamada) e o selo "Dados de demonstração" fica
 * em todas as cenas do painel.
 */

/**
 * Quem liga na cena da chamada. A voz por omissão (ELEVENLABS_VOZ_MUNICIPE)
 * é de uma senhora; se for de um homem, muda-se só aqui. O balão no ecrã vem
 * do "Simular chamada" do painel e diz sempre "vivo sozinha" (no ecrã não há
 * legenda das falas, só o balão).
 */
export const QUEM_LIGA: 'senhora' | 'senhor' = 'senhora';

const GENERO = {
  senhora: { trocas: [] as [string, string][], resumo: 'A senhora vive sozinha.' },
  senhor: {
    trocas: [['vivo sozinha', 'vivo sozinho']] as [string, string][],
    resumo: 'O senhor vive sozinho.',
  },
}[QUEM_LIGA];

const pct = (n: number) => `${n} por cento`;

/** "a, b e c" */
function lista(itens: string[]) {
  return itens.length > 1
    ? `${itens.slice(0, -1).join(', ')} e ${itens.at(-1)}`
    : (itens[0] ?? '');
}

/** O que o assistente fez além de responder (só o que não está a zero). */
function trabalho(v: Dados['visao']) {
  const itens = [
    v.ocorrencias && `registei ${v.ocorrencias} ${v.ocorrencias === 1 ? 'ocorrência' : 'ocorrências'}`,
    v.requerimentos && `preenchi ${v.requerimentos} ${v.requerimentos === 1 ? 'requerimento' : 'requerimentos'}`,
    v.consultas && `respondi a ${v.consultas} ${v.consultas === 1 ? 'pergunta' : 'perguntas'} sobre processos`,
    v.marcacoes && `marquei ${v.marcacoes} ${v.marcacoes === 1 ? 'atendimento' : 'atendimentos'}`,
  ].filter((x): x is string => !!x);
  return lista(itens.slice(0, 3));
}

function fala(d: Dados, n: number) {
  const f = d.falas[n - 1];
  if (!f) throw new Error(`Falta a fala ${n} da chamada: corre npm run capturar.`);
  let texto = f.texto.replace(/\s*\(Chamada simulada[^)]*\)\s*/i, '').trim();
  if (f.quem === 'municipe') {
    for (const [de, para] of GENERO.trocas) texto = texto.replaceAll(de, para);
  }
  return { ...f, texto };
}

/** As câmaras que tocam em zonas proibidas (o render recusa-se a fazer o vídeo). */
export function verificarProibidas(cenas: Cena[], d: Dados): string[] {
  const planos = cenas.flatMap((c) =>
    c.blocos.flatMap((b) =>
      b.visual.flatMap((v) =>
        v.tipo === 'painel'
          ? [{ id: b.id, captura: v.captura, de: v.de, para: v.para }]
          : [],
      ),
    ),
  );
  // As capas mostram um recorte fixo de uma captura (o painel no monitor).
  const capas = cenas.flatMap((c) =>
    c.blocos.flatMap((b) =>
      b.visual.flatMap((v) => {
        if (v.tipo !== 'capa' || !v.recorte) return [];
        const z = d.capturas[v.captura]?.proibidas?.find((p) => cruza(v.recorte!, p));
        return z ? [`${b.id} (${v.captura}): o recorte da capa toca numa zona proibida`] : [];
      }),
    ),
  );
  return [...planosProibidos(planos, d.capturas), ...capas];
}

/**
 * A lista de documentos do processo, sem a nota do armazenamento por baixo
 * (nesta instalação local não há S3): a câmara acaba acima dela.
 */
function documentos(d: Dados) {
  const c = d.capturas.processo;
  const z = c?.zonas.documentos;
  if (!c || !z) return null;
  const nota = c.proibidas?.find((r) => r.y > z.y && r.y < z.y + z.h);
  const fim = nota ? nota.y - 6 : z.y + z.h + 30;
  const foco: Retangulo = { x: z.x, y: z.y, w: z.w, h: fim - z.y - 4 };
  const de: Retangulo = { x: c.largura - 1110 - 20, y: fim - 625, w: 1110, h: 624 };
  const para: Retangulo = { x: c.largura - 1010 - 20, y: fim - 569, w: 1010, h: 568 };
  return { foco, de, para };
}

/** As falas da chamada que se ouvem (as outras ficam só no ecrã). */
const FALAS_OUVIDAS = [2, 3, 4, 5, 6, 9];

export function guiao(d: Dados): Cena[] {
  const v = d.visao;
  const c = d.campanha;
  const docs = documentos(d);

  const chamada: Bloco[] = FALAS_OUVIDAS.map((n) => {
    const f = fala(d, n);
    const alerta = n >= 4 && !!d.capturas[f.captura]?.zonas.alerta;
    // A câmara acompanha a última fala, com a ajuda ao funcionário ao lado.
    const visual: Visual = {
      tipo: 'painel',
      captura: f.captura,
      de: { seguir: 'ultima', x: 630, w: 1270 },
      foco: n === 4 && alerta ? 'alerta' : undefined,
    };
    return {
      id: `chamada_${String(n).padStart(2, '0')}`,
      voz: f.quem === 'agente' ? 'assistente' : 'municipe',
      quem: f.quem === 'agente' ? 'Assistente' : 'Munícipe',
      texto: f.texto,
      visual: [visual],
      pausa: 0.35,
      // O que se ouve está escrito no ecrã, no balão da fala.
      semLegenda: true,
    };
  });

  return [
    {
      id: 'abertura',
      painel: false,
      blocos: [
        {
          id: 'abertura',
          voz: 'assistente',
          texto:
            'Olá. Sou o assistente da câmara. Atendo a qualquer hora, por telefone, chat e SMS. Isto é o que a câmara vê.',
          // Com o desenho da capa do vídeo (docs/anexos-taikai/capas), e o
          // painel verdadeiro no monitor (acima do cartão do teste de qualidade).
          visual: [
            {
              tipo: 'capa',
              video: 'painel',
              titulo: 'O lado da câmara',
              sub: 'Entrada única · apoio ao técnico · a chefia vê tudo',
              captura: 'visao',
              recorte: { x: 260, y: 0, w: 1400, h: 864 },
            },
          ],
          pausa: 0.6,
        },
      ],
    },
    {
      id: 'visao',
      painel: true,
      blocos: [
        {
          id: 'visao_1',
          voz: 'assistente',
          texto: `Em sete dias atendi ${v.conversas} conversas. ${pct(v.fora_de_horas_pct)} com o balcão fechado. ${pct(v.resolvidas_pct)} resolvidas sem passar a ninguém.`,
          // Sempre acima do cartão do teste de qualidade (proibido: são
          // resultados de demonstração).
          visual: [
            {
              tipo: 'painel',
              captura: 'visao',
              de: { rect: { x: 250, y: 20, w: 1100, h: 619 } },
              para: { rect: { x: 280, y: 60, w: 1000, h: 563 } },
              peso: 3,
            },
            {
              tipo: 'painel',
              captura: 'visao',
              de: { rect: { x: 760, y: 40, w: 1120, h: 630 } },
              para: { rect: { x: 870, y: 60, w: 1010, h: 568 } },
              peso: 2,
            },
          ],
        },
        {
          id: 'visao_2',
          legendaEmCima: true,
          voz: 'assistente',
          texto: `E não fiquei pela resposta: ${trabalho(v)}.`,
          visual: [
            {
              tipo: 'painel',
              captura: 'visao',
              // Panorâmica ao longo dos números, a acabar acima do cartão do
              // teste de qualidade. Sem requerimentos, começa nas ocorrências
              // (não se abre com um zero).
              de: { rect: { x: v.requerimentos ? 270 : 612, y: 312, w: 1010, h: 568 } },
              para: { rect: { x: 870, y: 312, w: 1010, h: 568 } },
              foco: 'tratou',
            },
          ],
          pausa: 0.8,
        },
      ],
    },
    {
      id: 'chamada',
      painel: true,
      blocos: [
        {
          id: 'chamada_intro',
          voz: 'assistente',
          texto: 'Uma chamada simulada, vista do lado da câmara.',
          visual: [
            {
              tipo: 'painel',
              captura: 'chamada_01',
              de: 'ecra',
              para: { seguir: 'ultima', x: 630, w: 1270 },
            },
          ],
          pausa: 0.4,
        },
        ...chamada,
        {
          id: 'chamada_fim',
          voz: 'assistente',
          texto: `${GENERO.resumo} O funcionário viu logo o alerta, a filha foi chamada a acompanhar, com autorização, e a licença saiu na chamada.`,
          visual: [
            {
              tipo: 'painel',
              captura: d.falas.at(-1)?.captura ?? 'chamada_09',
              de: { seguir: 'ultima', x: 630, w: 1270 },
              para: { rect: { x: 1060, y: 120, w: 840, h: 473 } },
              foco: 'alerta',
            },
          ],
          pausa: 0.8,
        },
      ],
    },
    {
      id: 'pessoas',
      painel: true,
      blocos: [
        {
          id: 'pessoas_1',
          voz: 'assistente',
          texto:
            'Quando não sei, não invento. Passo a um funcionário, com o caso já resumido.',
          visual: [
            {
              tipo: 'painel',
              captura: 'passagem',
              de: 'ecra',
              para: { zona: 'caso', margem: 140 },
              foco: 'caso',
            },
          ],
        },
        {
          id: 'pessoas_2',
          voz: 'assistente',
          texto:
            'E chega tudo à mesma entrada: telefone, chat, email e balcão.',
          visual: [
            {
              tipo: 'painel',
              captura: 'entrada',
              de: 'ecra',
              para: { rect: { x: 0, y: 0, w: 1700, h: 956 } },
            },
          ],
          pausa: 0.8,
        },
      ],
    },
    {
      id: 'processo',
      painel: true,
      blocos: [
        {
          id: 'processo_1',
          voz: 'assistente',
          texto: `A ${d.processo.requerente} quer abrir uma porta na cozinha. Expliquei-lhe o que precisava, e o pedido chegou à câmara organizado.`,
          visual: [
            {
              tipo: 'painel',
              captura: 'processo',
              de: 'ecra',
              para: { rect: { x: 230, y: 0, w: 1100, h: 619 } },
            },
          ],
        },
        {
          id: 'processo_2',
          legendaEmCima: true,
          voz: 'assistente',
          texto: `Certidão e termo do técnico verificados. Faltam ${d.processo.faltam === 2 ? 'dois' : d.processo.faltam} documentos, e o processo está à espera dela, não da câmara.`,
          visual: [
            {
              tipo: 'painel',
              captura: 'processo',
              de: { rect: docs?.de ?? { x: 0, y: 0, w: 1920, h: 1080 } },
              para: { rect: docs?.para ?? { x: 0, y: 0, w: 1920, h: 1080 } },
              foco: docs?.foco,
            },
          ],
        },
        {
          id: 'processo_3',
          voz: 'assistente',
          texto:
            'Para o técnico, as verificações automáticas e as regras aplicáveis já vêm à mão. A decisão continua a ser dele.',
          // Recortes da página do apoio ao técnico: só as verificações que
          // passaram e a primeira regra (o resto da página depende da IA, que
          // nesta instalação local não está ligada).
          visual: [
            {
              tipo: 'recortes',
              antes: 'Apoio ao técnico · verificações automáticas',
              titulo: `${d.processo.numero} · Porta na cozinha`,
              itens: ['apoio_documentos', 'apoio_termo', 'apoio_pdm'],
              lado: 'apoio_regra',
            },
          ],
          pausa: 0.8,
        },
      ],
    },
    {
      id: 'ocorrencias',
      painel: true,
      blocos: [
        {
          id: 'ocorrencias_1',
          voz: 'assistente',
          texto: 'Três pessoas avisaram do mesmo buraco na Rua de Santo António.',
          visual: [
            {
              tipo: 'painel',
              captura: 'ocorrencia',
              de: 'ecra',
              para: { zona: 'mapa', margem: 10 },
            },
          ],
        },
        {
          id: 'ocorrencias_2',
          voz: 'assistente',
          texto: `Para a câmara é uma ocorrência só, com ${d.ocorrencia.avisos === 3 ? 'três' : d.ocorrencia.avisos} avisos e o serviço certo. Quando ficar resolvida, aviso as três pessoas.`,
          visual: [
            {
              tipo: 'painel',
              captura: 'ocorrencia',
              de: { rect: { x: 757, y: 140, w: 1163, h: 654 } },
              para: { rect: { x: 860, y: 200, w: 1060, h: 596 } },
              foco: 'avisos',
              selo: 'esquerda',
            },
          ],
          pausa: 0.8,
        },
      ],
    },
    {
      id: 'acao_social',
      painel: true,
      blocos: [
        {
          id: 'acao_social_1',
          voz: 'assistente',
          texto: `Na onda de calor, liguei às ${c.total} pessoas inscritas. ${c.bem} estão bem.`,
          visual: [
            {
              tipo: 'painel',
              captura: 'campanha',
              de: 'ecra',
              para: { zona: 'contagens', margem: 80 },
              foco: 'contagens',
            },
          ],
        },
        {
          id: 'acao_social_2',
          voz: 'assistente',
          texto: `${c.ajuda === 2 ? 'Duas' : c.ajuda} precisavam de ajuda, e ${c.tratados === 1 ? 'uma já foi tratada' : `${c.tratados} já foram tratadas`} pela ação social. Quem não atendeu recebeu um SMS.`,
          visual: [
            {
              tipo: 'painel',
              captura: 'campanha',
              de: { zona: 'ajuda', margem: 140 },
              para: { zona: 'ajuda', margem: 60 },
              foco: 'ajuda',
            },
          ],
          pausa: 0.6,
        },
        {
          id: 'acao_social_3',
          semLegenda: true,
          voz: 'assistente',
          texto:
            'A relação com a câmara não começa quando a pessoa liga, nem acaba quando desliga.',
          visual: [
            {
              tipo: 'cartao',
              titulo:
                'A relação com a câmara não começa quando a pessoa liga, nem acaba quando desliga.',
            },
          ],
          pausa: 0.8,
        },
      ],
    },
    {
      id: 'fecho',
      painel: false,
      blocos: [
        {
          id: 'fecho_1',
          semLegenda: true,
          voz: 'assistente',
          texto: 'A chamada é só a parte que se ouve.',
          visual: [
            {
              tipo: 'cartao',
              escuro: true,
              titulo: 'A chamada é só a parte que se ouve.',
            },
          ],
          pausa: 0.6,
        },
        {
          id: 'fecho_2',
          semLegenda: true,
          voz: 'assistente',
          texto: 'Tou, Câmara? A câmara inteira, numa só plataforma.',
          visual: [
            {
              tipo: 'cartao',
              escuro: true,
              marca: true,
              titulo: 'A câmara inteira, numa só plataforma.',
              depois: 'Uma porta para o munícipe. Um sistema para a câmara.',
            },
          ],
          pausa: 2,
        },
      ],
    },
  ];
}
