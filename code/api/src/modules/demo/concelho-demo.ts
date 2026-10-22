import type { Tx } from '../../database/database.service.js';
import { diaLocal, horaLocal } from '../marcacoes/vagas.js';
import type { Canal, Resultado, Tema, Turno } from './demo.conteudo.js';
import { instanteDemo } from './demo.regras.js';

/*
 * "Pergunte ao concelho" na demonstração: conversas anónimas (sem munícipe)
 * em quatro freguesias, com a freguesia preenchida e um padrão claro:
 *
 * - Azurém: a obra da Rua da Universidade começou há 9 dias e as queixas de
 *   estacionamento dispararam (9 nos últimos 7 dias contra 2 nos 7 antes),
 *   cada vez mais irritadas (passeios ocupados, cargas e descargas, multas).
 * - Creixomil: contentores cheios ao fim de semana, de forma constante.
 * - Urgezes: uma rotura de água hoje (três conversas na mesma manhã).
 * - Oliveira, São Paio e São Sebastião (centro): ruído dos bares à noite.
 *
 * Tudo fictício. Algumas frases trazem de propósito nome, morada com número
 * e telefone (de teste), para se ver a anonimização a funcionar.
 */

const AZUREM = 'Azurém';
const CREIXOMIL = 'Creixomil';
const URGEZES = 'Urgezes';
const CENTRO = 'Oliveira, São Paio e São Sebastião';

export interface ConversaConcelhoDemo {
  chave: string;
  freguesia: string;
  tema: Tema;
  canal: Canal;
  dias: number;
  hora: string;
  resultado: Resultado;
  resumo: string;
  turnos: Turno[];
}

/** Falas alternadas, a começar pelo munícipe. */
function c(
  freguesia: string,
  tema: Tema,
  canal: Canal,
  dias: number,
  hora: string,
  resultado: Resultado,
  resumo: string,
  ...falas: string[]
): Omit<ConversaConcelhoDemo, 'chave'> {
  return {
    freguesia,
    tema,
    canal,
    dias,
    hora,
    resultado,
    resumo,
    turnos: falas.map((texto, i) => ({
      papel: i % 2 === 0 ? 'municipe' : 'agente',
      texto,
    })),
  };
}

const LISTA: Omit<ConversaConcelhoDemo, 'chave'>[] = [
  // Azurém · estacionamento depois da obra (dias 0 a 9)
  c(
    AZUREM,
    'vias',
    'telefone',
    0,
    '09:10',
    'resolvida',
    'Queixa-se de não conseguir estacionar desde o início da obra na Rua da Universidade. Foi informado do prazo da obra e do parque alternativo, que acha longe e pago.',
    'Desde que começaram as obras na Rua da Universidade não há um lugar para estacionar. Ando meia hora às voltas todos os dias.',
    'Compreendo. A obra tem prazo previsto para o fim do mês. Entretanto, o parque de Azurém tem lugares livres de manhã.',
    'O parque fica longe e é a pagar. Isto não pode continuar assim.',
  ),
  c(
    AZUREM,
    'vias',
    'chat',
    1,
    '18:30',
    'sem_resposta',
    'Carros em cima do passeio na Rua da Universidade desde a obra; tem de andar pela estrada com o carrinho do bebé. Diz que já avisou várias vezes.',
    'Há carros estacionados em cima do passeio desde a obra. Com o carrinho do bebé tenho de ir pela estrada.',
    'Obrigado pelo aviso. Posso registar uma ocorrência para a fiscalização.',
    'Já avisei não sei quantas vezes e ninguém faz nada. É perigoso.',
  ),
  c(
    AZUREM,
    'vias',
    'telefone',
    1,
    '08:45',
    'passada_funcionario',
    'Comerciante de Azurém: os fornecedores não têm onde descarregar desde o corte de meia faixa na Rua da Universidade. Pede um lugar de cargas e descargas provisório; passado ao serviço de trânsito.',
    'Tenho uma loja em Azurém e os fornecedores não têm onde parar para descarregar desde que fecharam metade da rua.',
    'Vou passar ao serviço de trânsito para ver um lugar de cargas e descargas provisório. Respondem-lhe por SMS.',
    'Ótimo, porque assim perco clientes todos os dias.',
  ),
  c(
    AZUREM,
    'vias',
    'whatsapp',
    2,
    '12:20',
    'resolvida',
    'Perguntou se o dístico de residente serve no parque durante a obra da Rua da Universidade. Não serve; achou injusto pagar o parque.',
    'O dístico de residente serve para o parque enquanto dura a obra?',
    'Neste momento não: o dístico vale para as ruas da sua zona. Registei a sugestão.',
    'Então aguentamos a obra e ainda pagamos o parque. É injusto.',
  ),
  c(
    AZUREM,
    'vias',
    'telefone',
    2,
    '15:00',
    'resolvida',
    'O táxi que leva a mãe à fisioterapia não consegue parar à porta por causa da obra. Informada da paragem temporária junto à farmácia.',
    'O táxi que leva a minha mãe à fisioterapia não consegue parar à porta por causa das obras.',
    'Durante a obra há uma paragem temporária para tomada e largada de passageiros junto à farmácia.',
    'Não sabia. Deviam ter posto um aviso na rua.',
  ),
  c(
    AZUREM,
    'vias',
    'telefone',
    3,
    '19:50',
    'resolvida',
    'Moradora da Rua da Universidade com dificuldade em estacionar perto de casa desde a obra. Informada sobre o lugar reservado para mobilidade reduzida.',
    'Boa noite, chamo-me Albertina Sousa e moro na Rua da Universidade, 112. Desde a obra não consigo estacionar perto de casa. O meu número é o 910 000 998.',
    'Lamento. Posso ver se tem direito a um lugar reservado para mobilidade reduzida.',
    'Preciso mesmo, as compras pesam e ando muito.',
  ),
  c(
    AZUREM,
    'vias',
    'sms',
    4,
    '10:05',
    'resolvida',
    'Perguntou quanto tempo dura a obra da Rua da Universidade, por falta de estacionamento. Indicado o prazo e o mapa de obras.',
    'Quanto tempo vai durar a obra da Rua da Universidade? Não há estacionamento nenhum.',
    'Prazo previsto: fim do mês. Pode acompanhar no mapa de obras do site.',
  ),
  c(
    AZUREM,
    'vias',
    'telefone',
    5,
    '17:15',
    'sem_resposta',
    'Estacionamento abusivo na rotunda junto à obra impede a passagem do autocarro. Registado para a polícia municipal; acha que não chega.',
    'Os carros agora estacionam na rotunda e o autocarro não consegue passar. Chego atrasado ao trabalho.',
    'Vou registar para a polícia municipal ver o estacionamento na rotunda.',
    'Registar não chega, toda a gente já sabe o que se passa.',
  ),
  c(
    AZUREM,
    'vias',
    'chat',
    6,
    '21:10',
    'resolvida',
    'Sugere abrir o terreno junto à escola como parque provisório durante a obra da Rua da Universidade. Sugestão registada.',
    'Porque não abrem o terreno ao lado da escola para estacionar enquanto dura a obra?',
    'É uma boa sugestão. Registei-a para a divisão de trânsito.',
  ),
  c(
    AZUREM,
    'vias',
    'telefone',
    7,
    '08:20',
    'passada_funcionario',
    'Multado por estacionar em segunda fila perto da obra; diz que não há alternativa. Quer reclamar; passado ao serviço de contraordenações.',
    'Recebi uma multa por estacionar em segunda fila, mas não há outro sítio desde a obra! Quero reclamar.',
    'Posso registar a reclamação e passar ao serviço que trata das contraordenações.',
    'Façam isso. Estou mesmo farto desta obra.',
  ),
  c(
    AZUREM,
    'vias',
    'telefone',
    9,
    '13:40',
    'resolvida',
    'Soube da obra da Rua da Universidade no próprio dia e queixa-se de os moradores não terem sido avisados. Inscrito nos avisos por SMS da rua.',
    'Começaram hoje as obras na Rua da Universidade? Ninguém avisou os moradores.',
    'A obra começou hoje e está no mapa de obras. Posso inscrevê-lo nos avisos por SMS da sua rua.',
    'Sim, por favor. Devíamos ter sido avisados antes.',
  ),
  // Azurém antes da obra
  c(
    AZUREM,
    'vias',
    'telefone',
    16,
    '11:00',
    'resolvida',
    'Buraco no passeio junto à paragem de autocarro. Registada a ocorrência.',
    'Há um buraco no passeio junto à paragem do autocarro.',
    'Registei a ocorrência e enviei-lhe o número por SMS.',
  ),
  c(
    AZUREM,
    'vias',
    'chat',
    23,
    '10:30',
    'resolvida',
    'Perguntou como pedir o dístico de residente. Explicados os documentos.',
    'Como peço o dístico de residente para a minha rua?',
    'Pode pedir comigo: precisa de morar na zona e de ter o carro em seu nome.',
  ),
  c(
    AZUREM,
    'vias',
    'chat',
    27,
    '08:40',
    'resolvida',
    'Viu marcas no chão e perguntou se ia haver obras na Rua da Universidade. Indicado o mapa de obras.',
    'Vai haver obras na Rua da Universidade? Vi umas marcas no chão.',
    'Está prevista uma requalificação para as próximas semanas. Os avisos saem no mapa de obras.',
  ),
  c(
    AZUREM,
    'residuos',
    'telefone',
    11,
    '09:00',
    'resolvida',
    'Contentor do papel cheio há uma semana. Pedida a recolha.',
    'O contentor do papel aqui da rua está cheio há uma semana.',
    'Pedi a recolha; deve passar até amanhã.',
  ),
  // Creixomil · contentores cheios ao fim de semana
  c(
    CREIXOMIL,
    'residuos',
    'telefone',
    1,
    '10:40',
    'sem_resposta',
    'Contentores a transbordar desde sexta, sacos no chão e mau cheiro. Pedida recolha extra; diz que acontece todos os fins de semana.',
    'Os contentores do lixo da minha rua estão a transbordar desde sexta. Há sacos no chão e cheira mal.',
    'Registei o pedido de recolha extra.',
    'Todos os fins de semana é a mesma coisa. Precisamos de mais recolhas.',
  ),
  c(
    CREIXOMIL,
    'residuos',
    'whatsapp',
    3,
    '08:30',
    'resolvida',
    'Monos deixados junto aos contentores continuam lá. Marcada a recolha.',
    'Os monos que deixaram junto aos contentores continuam lá há dias.',
    'Marquei a recolha para quinta-feira de manhã.',
  ),
  c(
    CREIXOMIL,
    'residuos',
    'chat',
    8,
    '22:15',
    'resolvida',
    'Os gatos rasgam os sacos porque os contentores estão sempre cheios ao domingo. Pede mais um contentor.',
    'Os gatos rasgam os sacos porque os contentores estão sempre cheios ao domingo.',
    'Vou registar o pedido de mais um contentor para a sua rua.',
    'Agradeço, já não se pode passar ali.',
  ),
  c(
    CREIXOMIL,
    'residuos',
    'telefone',
    14,
    '09:30',
    'resolvida',
    'Contentor do vidro cheio. Pedida a recolha.',
    'O vidrão junto ao café está cheio outra vez.',
    'Pedi a recolha do vidro.',
  ),
  c(
    CREIXOMIL,
    'residuos',
    'telefone',
    17,
    '11:20',
    'resolvida',
    'Perguntou quando passa a recolha de verdes. Indicado o dia.',
    'Quando passa a recolha dos verdes em Creixomil?',
    'Às terças de manhã. Deixe os ramos atados junto ao contentor na noite anterior.',
  ),
  c(
    CREIXOMIL,
    'residuos',
    'sms',
    21,
    '19:00',
    'resolvida',
    'Lixo no chão junto à escola ao fim de semana. Registada a limpeza.',
    'Ao domingo fica lixo no chão junto à escola. Os contentores não chegam.',
    'Registei o pedido de limpeza.',
  ),
  c(
    CREIXOMIL,
    'residuos',
    'telefone',
    25,
    '10:10',
    'passada_funcionario',
    'Pediu há duas semanas mais um contentor para o prédio e não teve resposta. Passado a funcionário.',
    'Pedi há duas semanas mais um contentor para o prédio e ninguém respondeu.',
    'Peço desculpa pela demora. Passo já a um funcionário dos resíduos.',
    'Espero que desta vez alguém responda.',
  ),
  c(
    CREIXOMIL,
    'vias',
    'telefone',
    18,
    '09:15',
    'resolvida',
    'Passadeira apagada à porta da escola. Registada a ocorrência.',
    'A passadeira à porta da escola está apagada. As crianças atravessam ali.',
    'Registei a ocorrência para a pintura.',
  ),
  c(
    CREIXOMIL,
    'balcao',
    'telefone',
    22,
    '12:00',
    'resolvida',
    'Esperou muito tempo no balcão para entregar um papel. Informado de que pode marcar e entregar online.',
    'Esperei uma hora no balcão só para entregar um papel. Não há outra maneira?',
    'Pode marcar hora ou entregar pelo link que lhe envio por SMS.',
    'Se soubesse não tinha perdido a manhã.',
  ),
  // Urgezes · rotura de água hoje
  c(
    URGEZES,
    'agua',
    'telefone',
    0,
    '07:50',
    'resolvida',
    'Sem água em casa desde manhã cedo. Informado da rotura e da hora prevista de reposição.',
    'Estou sem água em casa desde as seis da manhã. É só aqui?',
    'Há uma rotura em Urgezes; a empresa das águas prevê repor até ao meio-dia.',
    'Podiam ter avisado por SMS. Tenho filhos para despachar para a escola.',
  ),
  c(
    URGEZES,
    'agua',
    'chat',
    0,
    '08:30',
    'resolvida',
    'Perguntou até quando dura o corte de água. Indicada a hora prevista.',
    'Não há água em Urgezes. Até quando?',
    'A reposição está prevista até ao meio-dia.',
  ),
  c(
    URGEZES,
    'agua',
    'telefone',
    0,
    '09:05',
    'resolvida',
    'A água voltou com cor. Explicado que deve deixar correr alguns minutos e que é segura.',
    'A água voltou mas vem castanha. Posso beber?',
    'Depois de uma rotura é normal. Deixe correr alguns minutos até ficar limpa.',
  ),
  c(
    URGEZES,
    'agua',
    'telefone',
    6,
    '14:00',
    'passada_funcionario',
    'Pressão da água fraca há semanas. Passado à empresa das águas.',
    'A pressão da água está muito fraca há semanas. Já liguei antes.',
    'Vou passar o pedido à empresa das águas para irem ver.',
    'Desta vez venham mesmo, por favor.',
  ),
  c(
    URGEZES,
    'agua',
    'telefone',
    19,
    '10:00',
    'resolvida',
    'Fuga de água na estrada. Registada a ocorrência.',
    'Há uma fuga de água na estrada, a água corre pela berma.',
    'Registei e avisei a empresa das águas.',
  ),
  c(
    URGEZES,
    'agua',
    'whatsapp',
    26,
    '16:40',
    'resolvida',
    'Perguntou como pedir a tarifa social da água. Explicado.',
    'Como peço a tarifa social da água?',
    'Pode pedir comigo; preciso de saber se recebe alguma prestação social.',
  ),
  c(
    URGEZES,
    'social',
    'telefone',
    13,
    '17:20',
    'resolvida',
    'Perguntou se há transporte para consultas para a mãe, que não conduz. Indicado o transporte social.',
    'Há transporte para a consulta para a minha mãe? Ela não conduz.',
    'Há o transporte social da câmara. Enviei por SMS como marcar.',
  ),
  // Centro · ruído à noite, esplanadas e iluminação
  c(
    CENTRO,
    'ruido',
    'telefone',
    1,
    '23:40',
    'sem_resposta',
    'Barulho dos bares no centro histórico até de madrugada; não consegue dormir. Dado o contacto da PSP; diz que é todos os fins de semana.',
    'Outra vez barulho dos bares até às três da manhã. Não consigo dormir e trabalho cedo.',
    'De noite quem pode intervir é a PSP. Posso registar a queixa e dar-lhe o contacto.',
    'Isto é todos os fins de semana e ninguém faz nada.',
  ),
  c(
    CENTRO,
    'ruido',
    'whatsapp',
    2,
    '00:30',
    'resolvida',
    'Música alta numa esplanada depois da meia-noite. Registada a queixa.',
    'Música alta numa esplanada do centro depois da meia-noite.',
    'Registei a queixa para a fiscalização verificar a licença.',
  ),
  c(
    CENTRO,
    'comercio',
    'chat',
    5,
    '22:50',
    'resolvida',
    'Perguntou o horário das esplanadas no centro. Explicado o regulamento.',
    'Que horário têm as esplanadas no centro? Há uma aberta até tarde com música.',
    'As esplanadas fecham à meia-noite à semana e à uma ao fim de semana. Música só com licença.',
  ),
  c(
    CENTRO,
    'ruido',
    'telefone',
    8,
    '23:15',
    'passada_funcionario',
    'Já reclamou várias vezes do ruído do bar ao lado e continua. Passado à fiscalização.',
    'Já reclamei do ruído do bar ao lado três vezes e continua tudo igual.',
    'Passo à fiscalização com as queixas anteriores.',
    'Vou pôr no livro de reclamações se não fizerem nada.',
  ),
  c(
    CENTRO,
    'ruido',
    'telefone',
    15,
    '23:30',
    'resolvida',
    'Barulho de um bar à noite. Registada a queixa.',
    'O bar da esquina tem música alta todas as noites.',
    'Registei a queixa para a fiscalização.',
  ),
  c(
    CENTRO,
    'ruido',
    'chat',
    20,
    '22:00',
    'resolvida',
    'Perguntou até que horas pode haver música nos bares. Explicado.',
    'Até que horas pode haver música nos bares do centro?',
    'Depende da licença; sem licença especial de ruído, não depois das 23h.',
  ),
  c(
    CENTRO,
    'iluminacao',
    'telefone',
    3,
    '20:10',
    'resolvida',
    'Candeeiro apagado numa viela junto ao castelo. Registada a ocorrência.',
    'O candeeiro na viela junto ao castelo está apagado e de noite fica muito escuro.',
    'Registei a ocorrência para a iluminação pública.',
  ),
  c(
    CENTRO,
    'iluminacao',
    'sms',
    12,
    '21:00',
    'resolvida',
    'Candeeiro a piscar no centro. Registado.',
    'Há um candeeiro sempre a piscar no largo.',
    'Registei, obrigado pelo aviso.',
  ),
  c(
    CENTRO,
    'comercio',
    'telefone',
    10,
    '11:00',
    'resolvida',
    'Quer abrir uma esplanada no centro. Explicada a licença.',
    'Quero pôr uma esplanada no centro: preciso de licença?',
    'Precisa da licença de esplanada. Posso tratar já consigo.',
  ),
  c(
    CENTRO,
    'obras',
    'telefone',
    4,
    '15:30',
    'resolvida',
    'Perguntou se pode pintar a fachada no centro histórico. Explicada a comunicação prévia na zona classificada.',
    'Posso pintar a fachada da minha casa no centro histórico?',
    'Na zona classificada precisa de comunicação prévia, com a cor aprovada.',
  ),
  c(
    CENTRO,
    'eventos',
    'telefone',
    9,
    '11:45',
    'resolvida',
    'Perguntou o que há no centro no fim de semana. Indicados os eventos.',
    'O que há no centro no fim de semana?',
    'Uma feira de artesanato e um concerto ao fim da tarde. Enviei por SMS.',
  ),
];

export const CONVERSAS_CONCELHO: ConversaConcelhoDemo[] = LISTA.map((x, i) => ({
  ...x,
  chave: `concelho_${String(i + 1).padStart(2, '0')}`,
}));

/**
 * Cria uma conversa da demonstração do "Pergunte ao concelho" (sem munícipe,
 * com freguesia), já resumida, com a transcrição. Devolve o id.
 */
export async function criarConversaConcelho(
  tx: Tx,
  o: {
    municipioId: string;
    slug: string;
    fuso: string;
    agora: Date;
    temaId: string | null;
  },
  conv: ConversaConcelhoDemo,
  i: number,
): Promise<string> {
  const inicio = instanteDemo(
    o.agora,
    o.fuso,
    conv.dias,
    conv.hora,
    40 + i * 7,
  );
  const hora = Number(horaLocal(inicio, o.fuso).slice(0, 2));
  const semana = new Date(`${diaLocal(inicio, o.fuso)}T12:00:00Z`).getUTCDay();
  const foraDeHoras = hora < 9 || hora >= 17 || semana === 0 || semana === 6;
  const duracao =
    conv.canal === 'telefone'
      ? 45 + conv.turnos.length * 35 + (i % 4) * 11
      : null;
  const fim = new Date(inicio.getTime() + (duracao ?? 180) * 1000);
  const [nova] = await tx.query<{ id: string }>(
    `INSERT INTO conversas (municipio_id, canal, provider_id, iniciada_em, terminada_em, duracao_s,
       consentimento_em, resultado, tema_id, resumo, resumida_em, fora_de_horas, agente_versao, freguesia)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::resultado_conv, $9, $10, $5, $11, 'demonstracao', $12)
     RETURNING id`,
    [
      o.municipioId,
      conv.canal,
      `demo-${o.slug}-${conv.chave}`,
      inicio,
      fim,
      duracao,
      conv.canal === 'telefone' ? inicio : null,
      conv.resultado,
      o.temaId,
      conv.resumo,
      foraDeHoras,
      conv.freguesia,
    ],
  );
  let ms = 0;
  for (const [ordem, t] of conv.turnos.entries()) {
    const dur = 4000 + t.texto.length * 55;
    await tx.query(
      `INSERT INTO conversa_turnos (conversa_id, ordem, papel, texto, inicio_ms, fim_ms)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [nova.id, ordem + 1, t.papel, t.texto, ms, ms + dur],
    );
    ms += dur + 800;
  }
  return nova.id;
}
