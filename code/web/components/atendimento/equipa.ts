"use client";

import { useSessao } from "@/lib/sessao";
import { useDados } from "./dados";
import type { Carga, Pessoa, Servico } from "./tipos";

interface MembroEquipa {
  id: string;
  nome: string;
  perfil: string;
  servico_id: string | null;
  servico: string | null;
  ativo: boolean;
}

/**
 * Serviços e pessoas para encaminhar e atribuir. A API não tem (ainda) uma
 * lista de serviços aberta a todos: usa-se a Equipa (quem a gere) ou a
 * carga da Gestão (quem vê Indicadores). Sem nenhuma, fica vazio.
 */
export function useServicosEPessoas(ativo = true): {
  servicos: Servico[];
  pessoas: Pessoa[];
  disponivel: boolean;
} {
  const { pode } = useSessao();
  const porEquipa = ativo && pode("equipa");
  const porCarga = ativo && !porEquipa && pode("indicadores");
  const equipa = useDados<{ itens: MembroEquipa[] }>(porEquipa ? "/v1/painel/equipa" : null);
  const carga = useDados<Carga>(porCarga ? "/v1/painel/gestao/carga" : null);

  if (equipa.dados) {
    const ativos = equipa.dados.itens.filter((m) => m.ativo);
    const servicos = new Map<string, string>();
    for (const m of ativos) if (m.servico_id && m.servico) servicos.set(m.servico_id, m.servico);
    return {
      disponivel: true,
      servicos: [...servicos].map(([id, nome]) => ({ id, nome })).sort((a, b) => a.nome.localeCompare(b.nome, "pt")),
      pessoas: ativos
        .filter((m) => ["tecnico", "atendimento", "chefe_divisao"].includes(m.perfil))
        .map((m) => ({ id: m.id, nome: m.nome, servico_id: m.servico_id })),
    };
  }
  if (carga.dados) {
    return {
      disponivel: true,
      servicos: carga.dados.servicos
        .filter((s) => s.servico_id)
        .map((s) => ({ id: s.servico_id!, nome: s.servico })),
      pessoas: carga.dados.tecnicos
        .filter((t) => t.tecnico_id)
        .map((t) => ({ id: t.tecnico_id!, nome: t.tecnico, servico_id: t.servico_id })),
    };
  }
  return { disponivel: false, servicos: [], pessoas: [] };
}
