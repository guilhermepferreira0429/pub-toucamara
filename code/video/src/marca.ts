import { loadFont } from '@remotion/fonts';
import { staticFile } from 'remotion';

export const COR = {
  creme: '#F7F0E4',
  papel: '#FFFBF5',
  tinta: '#15263B',
  tinta2: '#4A5868',
  terracota: '#B84A24',
  terracotaSuave: '#F2D8CB',
  verde: '#3F6E4A',
  ambar: '#8A5A00',
  ambarSuave: '#F6E6C2',
  linha: '#E2D6C2',
};

// As fontes vão no projeto (public/fontes, licença OFL): o render não
// depende da rede.
export const TITULO = 'Bricolage Grotesque';
export const TEXTO = 'Inter';

loadFont({
  family: TITULO,
  url: staticFile('fontes/bricolage-grotesque-latin-wght-normal.woff2'),
  weight: '200 800',
  format: 'woff2',
});
loadFont({
  family: TEXTO,
  url: staticFile('fontes/inter-latin-wght-normal.woff2'),
  weight: '100 900',
  format: 'woff2',
});
