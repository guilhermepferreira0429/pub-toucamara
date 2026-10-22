/*
 * Animais para adoção de demonstração (Preparar demo). Sem fotografias: a
 * página /adotar desenha cada um com a cor e o ícone da espécie.
 */

export interface AnimalDemo {
  nome: string;
  especie: 'cao' | 'gato';
  sexo: 'macho' | 'femea';
  porte: 'pequeno' | 'medio' | 'grande';
  idade: string;
  descricao: string;
  cor: string;
  esterilizado: boolean;
  vacinado: boolean;
  estado: 'disponivel' | 'reservado';
  /** Há quantos dias entrou no canil. */
  entrou_ha_dias: number;
}

export const ANIMAIS_DEMO: readonly AnimalDemo[] = [
  {
    nome: 'Tejo',
    especie: 'cao',
    sexo: 'macho',
    porte: 'medio',
    idade: 'cerca de 3 anos',
    descricao:
      'Brincalhão e muito meigo. Dá-se bem com outros cães e adora passear.',
    cor: '#b7793f',
    esterilizado: true,
    vacinado: true,
    estado: 'disponivel',
    entrou_ha_dias: 40,
  },
  {
    nome: 'Amora',
    especie: 'cao',
    sexo: 'femea',
    porte: 'pequeno',
    idade: 'cerca de 8 anos',
    descricao:
      'Calma e companheira, ideal para quem quer um cão sossegado em apartamento.',
    cor: '#3b3330',
    esterilizado: true,
    vacinado: true,
    estado: 'disponivel',
    entrou_ha_dias: 120,
  },
  {
    nome: 'Trovão',
    especie: 'cao',
    sexo: 'macho',
    porte: 'grande',
    idade: 'cerca de 5 anos',
    descricao:
      'Grande e gentil. Precisa de casa com quintal e de quem tenha tempo para longos passeios.',
    cor: '#d9c3a0',
    esterilizado: true,
    vacinado: true,
    estado: 'disponivel',
    entrou_ha_dias: 200,
  },
  {
    nome: 'Pimenta',
    especie: 'gato',
    sexo: 'femea',
    porte: 'pequeno',
    idade: 'cerca de 1 ano',
    descricao: 'Curiosa e faladora. Gosta de colo depois de ganhar confiança.',
    cor: '#e08a3c',
    esterilizado: true,
    vacinado: true,
    estado: 'disponivel',
    entrou_ha_dias: 25,
  },
  {
    nome: 'Mocho',
    especie: 'gato',
    sexo: 'macho',
    porte: 'medio',
    idade: 'cerca de 6 anos',
    descricao: 'Tranquilo e dorminhoco. Prefere ser o único gato da casa.',
    cor: '#6f6a66',
    esterilizado: true,
    vacinado: false,
    estado: 'disponivel',
    entrou_ha_dias: 75,
  },
  {
    nome: 'Nina',
    especie: 'gato',
    sexo: 'femea',
    porte: 'pequeno',
    idade: 'cerca de 4 meses',
    descricao: 'Bebé cheia de energia, já usa a caixa de areia.',
    cor: '#f2efe8',
    esterilizado: false,
    vacinado: true,
    estado: 'reservado',
    entrou_ha_dias: 10,
  },
];
