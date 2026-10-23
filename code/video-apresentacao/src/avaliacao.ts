// Avaliação das 180 perguntas (22 e 23 de outubro de 2026), escala v2 por categorias, dois juízes às cegas;
// onde discordam, decide um terceiro juiz que verifica nas fontes oficiais. Gerado a partir de docs/avaliacao/escala/resultados.json.
// As mesmas 180 perguntas, o mesmo gabarito e os mesmos dois juízes para os dois sistemas.
// Ao correr uma ronda nova, trocar `tou` e `grelha.tou` (e a `ronda`).

export interface Resultados {
  /** Chega para o munícipe: sai a saber o que fazer, com informação certa (os dois juízes). */
  sai: number
  /** Ajuda, mas fica a faltar algo de que vai precisar. */
  parcial: number
  /** Não ajuda, só manda contactar, ou engana. */
  nao: number
  /** Respostas que só mandam contactar a câmara (categoria mandou_contactar). */
  contactenos: number
}

export const avaliacao = {
  data: '22 e 23 de outubro de 2026',
  perguntas: 180,
  ronda: 3,
  /** Páginas oficiais e trechos na base do Tou, Câmara? nesta ronda. */
  fontes: 1133,
  trechos: 6780,
  site: { sai: 15, parcial: 60, nao: 105, contactenos: 41 },
  tou: { sai: 82, parcial: 64, nao: 34, contactenos: 1 },
  /** Uma letra por pergunta, pela ordem do questionário: s = sai a saber, p = em parte, n = não ajuda. */
  grelha: {
    site: 'nnnnnpnppnnnpppppnpnnpnnnpnnnppnnppnppppppppnnnnpnnnnppppnppnpnnpppnnnnnnnnnnnnnnnnnpnnppssnpnnnnpnnppnppnnnnnnnnnpsspnpnnnnsnppnsssnsnnssnsnppnnpnpnpnnnnnnsnnnppnpnppnspnnnnnsnnnp',
    tou: 'ppnnsnppsnpsssnspppnnpsnnpnsnsssnppppppppssppsssspnppspsppsppnpnsspnssssssspspspssnppsnspssppnnpssppsspppsnnspsssnnnsspnsnppsnnpssnnppppnspssssppspppsssspnnspspsssssssssssspspsssss',
  },
}
