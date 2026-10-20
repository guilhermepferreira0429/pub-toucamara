"use client";

import { useSessao } from "@/lib/sessao";
import { useDados } from "./dados";
import type { Pessoa, Servico } from "./tipos";

/** Um membro ativo da câmara em `GET /v1/painel/servicos`. */
export interface MembroServico {
  id: string;
  nome: string;
  perfil: string;
  foto_url: string | null;
}

/** Um serviço do município com os membros ativos (`GET /v1/painel/servicos`). */
export interface ServicoComEquipa {
  id: string;
  nome: string;
  entidade: string | null;
  email: string | null;
  telefone: string | null;
  tecnicos: MembroServico[];
}

export interface ServicosEquipa {
  itens: ServicoComEquipa[];
  /** Membros ativos sem serviço atribuído. */
  sem_servico: MembroServico[];
}

/** Perfis a quem se encaminha ou atribui trabalho. */
export const PERFIS_ATRIBUIVEIS = ["tecnico", "atendimento", "chefe_divisao"];

/** Todos os membros (com o serviço de cada um), por nome. */
export function membrosDe(
  d: ServicosEquipa | undefined | null,
  perfis: readonly string[] = PERFIS_ATRIBUIVEIS,
): (MembroServico & { servico_id: string | null; servico: string | null })[] {
  if (!d) return [];
  return [
    ...d.itens.flatMap((s) =>
      s.tecnicos.map((t) => ({ ...t, servico_id: s.id, servico: s.nome })),
    ),
    ...d.sem_servico.map((t) => ({ ...t, servico_id: null, servico: null })),
  ]
    .filter((m) => perfis.includes(m.perfil))
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt"));
}

/**
 * Serviços e pessoas para encaminhar e atribuir, de `GET /v1/painel/servicos`
 * (qualquer perfil do painel).
 */
export function useServicosEPessoas(ativo = true): {
  servicos: Servico[];
  pessoas: Pessoa[];
  disponivel: boolean;
} {
  const { pode } = useSessao();
  const r = useDados<ServicosEquipa>(
    ativo && pode("visao_geral") ? "/v1/painel/servicos" : null,
  );
  if (!r.dados) return { disponivel: false, servicos: [], pessoas: [] };
  return {
    disponivel: true,
    servicos: r.dados.itens
      .map((s) => ({ id: s.id, nome: s.nome }))
      .sort((a, b) => a.nome.localeCompare(b.nome, "pt")),
    pessoas: membrosDe(r.dados).map((m) => ({
      id: m.id,
      nome: m.nome,
      servico_id: m.servico_id,
    })),
  };
}
