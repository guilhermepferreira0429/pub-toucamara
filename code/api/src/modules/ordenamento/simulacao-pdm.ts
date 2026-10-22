/*
 * "Testar uma lei antes de a aprovar", no PDM: as regras propostas de uma
 * zona (os degraus de cada obra) contra as perguntas que as pessoas já
 * fizeram nessa zona (`consultas_pdm`). Diz quantas respostas mudavam e
 * dá exemplos. Puro: usa a mesma simulação das licenças.
 *
 * Aqui "aprovado" quer dizer "resolve-se sem licença" (isento ou
 * comunicação prévia); não há taxas.
 */
import { z } from 'zod';
import { simular, type PedidoAntigo } from '../licencas/simulacao.js';
import {
  avaliarObra,
  CONTROLO_DITO,
  esquemaRegraObra,
  Obra,
  OBRAS,
  RegrasZona,
} from './regras.js';

export const esquemaRegrasZona = z.partialRecord(
  z.enum(Object.keys(OBRAS) as [Obra, ...Obra[]]),
  esquemaRegraObra,
);

export interface ConsultaAntiga {
  obra: Obra;
  medidas: { area_m2?: number; altura_m?: number };
}

const virgula = (v: number) => String(v).replace('.', ',');

function resultado(regras: RegrasZona, c: ConsultaAntiga) {
  const a = avaliarObra(regras[c.obra], c.medidas);
  const controlo = a.controlo;
  const decisao = a.em_falta.length
    ? 'faltam medidas'
    : controlo
      ? CONTROLO_DITO[controlo]
      : 'sem regra (técnico)';
  const semLicenca = controlo === 'isento' || controlo === 'comunicacao_previa';
  return {
    aprovado: semLicenca,
    decisao,
    taxa_cent: 0,
    regras: [
      {
        id: c.obra,
        ok: semLicenca,
        texto: `${OBRAS[c.obra]}: ${decisao}.`,
      },
    ],
  };
}

export function simularZona(
  atuais: RegrasZona,
  propostas: RegrasZona,
  consultas: PedidoAntigo<ConsultaAntiga>[],
) {
  return simular(
    atuais,
    propostas,
    consultas,
    (d, regras) => resultado(regras, d),
    {
      exemplos: 10,
      resumir: (d) =>
        `${OBRAS[d.obra]}${d.medidas.area_m2 ? ` · ${virgula(d.medidas.area_m2)} m²` : ''}${
          d.medidas.altura_m
            ? ` · ${virgula(d.medidas.altura_m)} m de altura`
            : ''
        }`,
    },
  );
}
