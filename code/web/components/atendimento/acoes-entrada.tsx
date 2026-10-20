"use client";

import { CornerDownRight, FolderPlus, Lock } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useSessao } from "@/lib/sessao";
import { BotaoAcao } from "./caixa";
import { useDados } from "./dados";
import { useServicosEPessoas } from "./equipa";
import { mensagemErro } from "./formatos";
import type { TipoItem } from "./tipos";

/* Ações da Entrada: converter em processo e mudar o encaminhamento. */

/** O que cada tipo aceita na atribuição manual (entrada.regras.ts, DESTINO). */
const DESTINO: Record<TipoItem, { servico: boolean; tecnico: boolean }> = {
  passagem: { servico: false, tecnico: true },
  email: { servico: true, tecnico: false },
  processo: { servico: false, tecnico: true },
  ocorrencia: { servico: true, tecnico: false },
  pedido: { servico: true, tecnico: true },
};

const campo =
  "h-10 w-full rounded-[10px] border border-linha bg-papel px-3 text-[13px] text-tinta";

/** "Criar processo" a partir de um email ou pedido de balcão. */
export function CriarProcesso({
  tipo,
  id,
  assunto,
  aoCriar,
}: {
  tipo: "email" | "pedido";
  id: string;
  assunto?: string | null;
  aoCriar?: () => void;
}) {
  const { pedido, pode } = useSessao();
  const [aberto, setAberto] = useState(false);
  const tipos = useDados<{ itens: { id: string; nome: string; codigo: string; ativo: boolean }[] }>(
    aberto && pode("processos") ? "/v1/painel/tipos-processo" : null,
  );
  const [tipoId, setTipoId] = useState("");
  const [titulo, setTitulo] = useState(assunto ?? "");
  const [aEnviar, setAEnviar] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [criado, setCriado] = useState<{ processo_id: string; numero: string } | null>(null);

  if (!pode("processos")) {
    return (
      <span className="group relative">
        <BotaoAcao icone={Lock} disabled aria-describedby={`sem-processos-${id}`}>
          Criar processo
        </BotaoAcao>
        <span
          id={`sem-processos-${id}`}
          role="tooltip"
          className="pointer-events-none absolute left-0 top-12 z-10 hidden w-[250px] flex-col gap-2 rounded-xl bg-tinta p-3.5 text-xs leading-[1.45] text-white/80 group-hover:flex group-focus-within:flex"
        >
          <span className="flex items-center gap-2 text-[13px] font-bold text-white">
            <Lock className="size-3.5" aria-hidden />
            Sem acesso a Processos
          </span>
          O seu perfil não gere processos. Se precisar, peça acesso a quem gere a equipa.
        </span>
      </span>
    );
  }

  if (criado) {
    return (
      <p role="status" className="flex items-center gap-2 text-[13px] text-verde">
        Processo {criado.numero} criado.
        <Link
          href={`/painel/processos/${criado.processo_id}`}
          className="font-semibold text-terracota-escuro hover:underline"
        >
          Abrir
        </Link>
      </p>
    );
  }

  async function criar(e: React.FormEvent) {
    e.preventDefault();
    if (!tipoId) return;
    setAEnviar(true);
    setErro(null);
    try {
      const r = await pedido<{ processo_id: string; numero: string }>(
        `/v1/painel/entrada/${tipo}/${id}/processo`,
        { corpo: { tipo_processo_id: tipoId, assunto: titulo.trim() || undefined } },
      );
      setCriado(r);
      aoCriar?.();
    } catch (err) {
      setErro(mensagemErro(err));
    } finally {
      setAEnviar(false);
    }
  }

  if (!aberto) {
    return (
      <BotaoAcao icone={FolderPlus} principal onClick={() => setAberto(true)}>
        Criar processo
      </BotaoAcao>
    );
  }
  return (
    <form
      onSubmit={criar}
      className="flex w-full flex-col gap-2.5 rounded-2xl border border-linha bg-papel p-4"
    >
      <p className="text-sm font-semibold text-tinta">Criar processo</p>
      <label className="flex flex-col gap-1 text-xs font-semibold text-tinta-2">
        Tipo de processo
        <select
          required
          value={tipoId}
          onChange={(e) => setTipoId(e.target.value)}
          className={campo}
        >
          <option value="">{tipos.aCarregar ? "A carregar…" : "Escolha o tipo"}</option>
          {tipos.dados?.itens
            .filter((t) => t.ativo)
            .map((t) => (
              <option key={t.id} value={t.id}>
                {t.nome}
              </option>
            ))}
        </select>
      </label>
      {tipos.erro && <p className="text-xs text-terracota-escuro">{tipos.erro}</p>}
      <label className="flex flex-col gap-1 text-xs font-semibold text-tinta-2">
        Assunto
        <input
          value={titulo}
          onChange={(e) => setTitulo(e.target.value)}
          maxLength={300}
          className={campo}
        />
      </label>
      {erro && (
        <p role="alert" className="text-xs text-terracota-escuro">
          {erro}
        </p>
      )}
      <div className="flex gap-2">
        <BotaoAcao icone={FolderPlus} principal type="submit" disabled={aEnviar || !tipoId}>
          {aEnviar ? "A criar…" : "Criar"}
        </BotaoAcao>
        <button
          type="button"
          onClick={() => setAberto(false)}
          className="h-10 rounded-[10px] px-3 text-[13px] font-semibold text-tinta-2 hover:bg-creme"
        >
          Cancelar
        </button>
      </div>
    </form>
  );
}

/** "Mudar encaminhamento": serviço e/ou técnico (desfaz o automático). */
export function MudarEncaminhamento({
  tipo,
  id,
  servicoId,
  tecnicoId,
  aoMudar,
}: {
  tipo: TipoItem;
  id: string;
  servicoId?: string | null;
  tecnicoId?: string | null;
  aoMudar?: () => void;
}) {
  const { pedido, eu } = useSessao();
  const [aberto, setAberto] = useState(false);
  const { servicos, pessoas, disponivel } = useServicosEPessoas(aberto);
  const [servico, setServico] = useState(servicoId ?? "");
  const [tecnico, setTecnico] = useState(tecnicoId ?? "");
  const [aEnviar, setAEnviar] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [feito, setFeito] = useState(false);
  const d = DESTINO[tipo];

  async function guardar(corpo: { servico_id?: string; tecnico_id?: string }) {
    setAEnviar(true);
    setErro(null);
    try {
      await pedido(`/v1/painel/entrada/${tipo}/${id}/atribuir`, { corpo });
      setFeito(true);
      setAberto(false);
      aoMudar?.();
    } catch (e) {
      setErro(mensagemErro(e));
    } finally {
      setAEnviar(false);
    }
  }

  if (!aberto) {
    return (
      <span className="flex items-center gap-2">
        <BotaoAcao icone={CornerDownRight} onClick={() => setAberto(true)}>
          Mudar encaminhamento
        </BotaoAcao>
        {feito && (
          <span role="status" className="text-xs text-verde">
            Encaminhamento guardado.
          </span>
        )}
      </span>
    );
  }

  const tecnicos = servico ? pessoas.filter((p) => !p.servico_id || p.servico_id === servico) : pessoas;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        guardar({
          servico_id: d.servico && servico ? servico : undefined,
          tecnico_id: d.tecnico && tecnico ? tecnico : undefined,
        });
      }}
      className="flex w-full flex-col gap-2.5 rounded-2xl border border-linha bg-papel p-4"
    >
      <p className="text-sm font-semibold text-tinta">Mudar encaminhamento</p>
      {disponivel ? (
        <>
          {d.servico && (
            <label className="flex flex-col gap-1 text-xs font-semibold text-tinta-2">
              Serviço
              <select value={servico} onChange={(e) => setServico(e.target.value)} className={campo}>
                <option value="">Escolha o serviço</option>
                {servicos.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.nome}
                  </option>
                ))}
              </select>
            </label>
          )}
          {d.tecnico && (
            <label className="flex flex-col gap-1 text-xs font-semibold text-tinta-2">
              {tipo === "passagem" ? "Funcionário" : "Técnico"}
              <select value={tecnico} onChange={(e) => setTecnico(e.target.value)} className={campo}>
                <option value="">Escolha a pessoa</option>
                {tecnicos.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nome}
                  </option>
                ))}
              </select>
            </label>
          )}
        </>
      ) : (
        <p className="text-xs text-tinta-2">
          A lista de serviços e técnicos só aparece a quem gere a equipa ou vê os indicadores.
          {d.tecnico && " Pode ficar com o item para si."}
        </p>
      )}
      {erro && (
        <p role="alert" className="text-xs text-terracota-escuro">
          {erro}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {disponivel && (
          <BotaoAcao
            icone={CornerDownRight}
            principal
            type="submit"
            disabled={aEnviar || (!(d.servico && servico) && !(d.tecnico && tecnico))}
          >
            {aEnviar ? "A guardar…" : "Guardar"}
          </BotaoAcao>
        )}
        {d.tecnico && eu && (
          <button
            type="button"
            disabled={aEnviar}
            onClick={() => guardar({ tecnico_id: eu.utilizador.id })}
            className="h-10 rounded-[10px] border border-linha bg-papel px-3 text-[13px] font-semibold text-tinta hover:bg-creme disabled:opacity-60"
          >
            Ficar comigo
          </button>
        )}
        <button
          type="button"
          onClick={() => setAberto(false)}
          className="h-10 rounded-[10px] px-3 text-[13px] font-semibold text-tinta-2 hover:bg-creme"
        >
          Cancelar
        </button>
      </div>
    </form>
  );
}
