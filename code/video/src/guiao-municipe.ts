import type { Bloco, Cena, Dados, DadosMunicipe } from './tipos';

/*
 * O guião do vídeo do munícipe: "Uma renovação, do princípio ao fim".
 * Fala o assistente (a mesma voz da chamada), na primeira pessoa; na
 * chamada ouvem-se as duas vozes. Tudo o que se vê é o que aconteceu na
 * captura (scripts/capturas/municipe.mjs): o aviso por SMS do job das
 * licenças, a chamada com as ferramentas verdadeiras, os SMS gravados pela
 * API, a página de pagamento (modo de teste), a licença com o QR e o painel.
 *
 * Hoje o aviso vai por SMS: a chamada da câmara para renovar existe no
 * produto, mas só sai quando há um número de saída (ainda não há).
 */

const MESES = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho',
  'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];

export function guiaoMunicipe(d: Dados): Cena[] {
  const m = d.municipe;
  if (!m) throw new Error('Falta o vídeo do munícipe: npm run capturar -- --video=municipe');
  return [
    {
      id: 'municipe_abertura',
      painel: false,
      blocos: [
        {
          id: 'municipe_abertura',
          voz: 'assistente',
          texto: `A licença da esplanada do ${m.estabelecimento} acabava daqui a dez dias. Renovar pede cinco dias úteis.`,
          visual: [
            {
              tipo: 'capa',
              video: 'municipe',
              titulo: 'Uma renovação, do princípio ao fim',
              sub: 'A câmara liga primeiro · renova na chamada · SMS com a referência',
              captura: 'municipe_chamada_06',
            },
          ],
          pausa: 0.6,
        },
      ],
    },
    {
      id: 'municipe_aviso',
      painel: true,
      blocos: [
        {
          id: 'municipe_aviso',
          voz: 'assistente',
          texto: 'Avisei por SMS, com tempo. Ela só teve de ligar.',
          visual: [
            {
              tipo: 'painel',
              captura: 'municipe_a_expirar',
              de: 'ecra',
              para: { zona: 'linha', margem: 60 },
              foco: 'linha',
            },
            {
              tipo: 'sms',
              mensagens: [m.sms.aviso ?? ''],
              titulo: 'O aviso por SMS',
              texto: 'Para renovar, basta ligar ou escrever: o assistente trata de tudo.',
            },
          ],
          pausa: 0.4,
        },
      ],
    },
    {
      id: 'municipe_chamada',
      painel: true,
      blocos: chamada(m),
    },
    {
      id: 'municipe_pagamento',
      painel: true,
      blocos: [
        {
          id: 'municipe_pagamento',
          voz: 'assistente',
          texto: 'O pagamento seguiu por SMS, em modo de teste: nada é cobrado.',
          visual: [
            {
              tipo: 'sms',
              mensagens: [m.sms.pagamento ?? ''],
              titulo: 'O pagamento',
              texto: 'MB WAY ou Multibanco, em modo de teste.',
            },
            {
              tipo: 'telemovel',
              captura: 'municipe_pagamento',
              de: 0,
              para: 220,
              titulo: 'Falta só pagar a taxa',
              texto: 'A página do link do SMS. Modo de teste: nada é cobrado.',
            },
            {
              tipo: 'telemovel',
              captura: 'municipe_pago',
              titulo: 'Pagamento recebido',
              texto: 'Simulado: não foi cobrado dinheiro.',
            },
          ],
          pausa: 0.4,
        },
        {
          id: 'municipe_licenca',
          voz: 'assistente',
          texto: `Paga, a licença nova chegou por SMS, com o QR. Válida até ${dataDita(m.nova_valida_ate)}.`,
          visual: [
            {
              tipo: 'sms',
              mensagens: [m.sms.pagamento ?? '', m.sms.emitida ?? ''],
              titulo: 'A licença',
              texto: 'Emitida pelas regras, logo depois do pagamento.',
            },
            {
              tipo: 'telemovel',
              captura: 'municipe_licenca',
              de: 0,
              para: 700,
              titulo: 'A licença com o QR',
              texto: `${m.renovacao}, a renovação da ${m.numero}.`,
            },
          ],
          pausa: 0.6,
        },
      ],
    },
    {
      id: 'municipe_painel',
      painel: true,
      blocos: [
        {
          id: 'municipe_painel',
          voz: 'assistente',
          texto: 'Do lado da câmara, ficou emitida pelas regras. Ninguém teve de lhe tocar.',
          visual: [
            {
              tipo: 'painel',
              captura: 'municipe_licencas',
              de: { zona: 'cartao', margem: 220 },
              para: { zona: 'cartao', margem: 90 },
              foco: 'cartao',
            },
          ],
          pausa: 0.8,
        },
      ],
    },
    {
      id: 'municipe_fecho',
      painel: false,
      blocos: [
        {
          id: 'municipe_fecho',
          voz: 'assistente',
          texto: 'Experimente com o seu número.',
          semLegenda: true,
          visual: [
            {
              tipo: 'cartao',
              marca: true,
              titulo: 'Experimente com o seu número.',
              depois:
                'toucamara.descortina.pt/ligar?experimentar=renovacao · ligue e diga "quero renovar a licença da esplanada".',
            },
          ],
          pausa: 2,
        },
      ],
    },
  ];
}

/** As falas da chamada, cada uma com o ecrã do telemóvel nesse momento. */
function chamada(m: DadosMunicipe): Bloco[] {
  const falas = m.falas.map((f) => ({ quem: f.quem, texto: f.texto }));
  let ultimaCaptura = 'municipe_chamada_01';
  return m.falas.map((f, i) => {
    if (f.captura) ultimaCaptura = f.captura;
    return {
      id: `municipe_fala_${String(i + 1).padStart(2, '0')}`,
      voz: f.quem === 'agente' ? 'assistente' : 'municipe',
      quem: f.quem === 'agente' ? 'Assistente' : 'Munícipe',
      texto: f.texto,
      // A conversa está escrita ao lado do telemóvel: sem legenda.
      semLegenda: true,
      visual: [{ tipo: 'chamada', captura: ultimaCaptura, falas, atual: i }],
      pausa: 0.35,
    };
  });
}

function dataDita(iso: string | null): string {
  if (!iso) return '';
  const [, mes, dia] = iso.split('-').map(Number);
  const UNIDADES = [
    '', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove',
    'dez', 'onze', 'doze', 'treze', 'catorze', 'quinze', 'dezasseis', 'dezassete',
    'dezoito', 'dezanove', 'vinte',
  ];
  const d =
    dia <= 20
      ? UNIDADES[dia]
      : dia < 30
        ? `vinte e ${UNIDADES[dia - 20]}`
        : dia === 30
          ? 'trinta'
          : 'trinta e um';
  return `${d} de ${MESES[mes - 1]}`;
}
