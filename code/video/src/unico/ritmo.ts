/*
 * O relógio do vídeo único: tudo em compassos da música, já cortada por
 * scripts/musica.mjs (122 BPM, 4 tempos por compasso, o primeiro tempo
 * forte aos 0,4807 s). Os cortes de imagem caem nos tempos fortes.
 */
export const FPS = 30;
export const MUSICA = 'musica/voxel-revolution.mp3';
/** Duração do ficheiro cortado (s). */
export const MUSICA_S = 98.48;
export const TEMPO_S = 60 / 122;
export const COMPASSO_S = 4 * TEMPO_S;
export const INICIO_S = 0.4807;
/** Frames por tempo (não é inteiro: 14,75). */
export const TEMPO_F = TEMPO_S * FPS;
export const TOTAL_F = Math.floor(MUSICA_S * FPS);

/** O frame em que começa o compasso k (o compasso 0 é o primeiro tempo forte). */
export const frameDoCompasso = (k: number) => Math.round((INICIO_S + k * COMPASSO_S) * FPS);

/** O frame, dentro de um plano que começa num tempo forte, do tempo n. */
export const tempo = (n: number) => Math.round(n * TEMPO_F);
