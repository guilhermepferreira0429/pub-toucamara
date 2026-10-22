"use client";

import { AlarmClock, Gavel } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import {
  Cartao,
  Campo,
  classeEntrada,
  Dialogo,
  dia,
  ErroLinha,
  Pilula,
  quando,
  useAcao,
  useDados,
} from "@/components/conhecimento/comum";
import { Botao } from "@/components/ui/botao";
import { useSessao } from "@/lib/sessao";
import { LinhaMomento, ROTULO_TIPO, type ContactoFeito, type Momento } from "./antecipacoes";

interface DoProcesso {
  hoje: string;
  previstos: Momento[];
  feitos: ContactoFeito[];
}

/**
 * Na ficha do processo: os momentos previstos (com o que o agente vai
 * dizer), os contactos antecipados já feitos e a ação "abrir audiência
 * prévia" (proposta de indeferimento, com o prazo para o munícipe).
 */
export function CartaoAntecipacoes({
  processoId,
  aberto,
  onMudou,
}: {
  processoId: string;
  /** Processo ainda sem decisão (pode abrir a audiência prévia). */
  aberto: boolean;
  onMudou?: () => void;
}) {
  const { pode, pedido } = useSessao();
  const dados = useDados<DoProcesso>(
    pode("processos") ? `/v1/painel/antecipacoes/processos/${processoId}` : null,
  );
  const [dialogo, setDialogo] = useState(false);
  const [fundamento, setFundamento] = useState("");
  const acao = useAcao();
  const d = dados.dados;
  if (!pode("processos")) return null;

  const abrir = async () => {
    const r = await acao.executar(() =>
      pedido(`/v1/painel/antecipacoes/processos/${processoId}/audiencia-previa`, {
        metodo: "POST",
        corpo: { fundamento },
      }),
    );
    if (r !== undefined) {
      setDialogo(false);
      setFundamento("");
      dados.recarregar();
      onMudou?.();
    }
  };

  return (
    <Cartao aria-labelledby="antecipacoes-processo">
      <div className="flex items-center justify-between gap-2 px-5 pt-4">
        <h2 id="antecipacoes-processo" className="flex items-center gap-2 text-[15px] font-bold text-tinta">
          <AlarmClock className="size-4 text-terracota-escuro" aria-hidden />
          Antecipações
        </h2>
        <Link href="/painel/antecipacoes" className="text-xs font-semibold text-terracota hover:underline">
          ver todas
        </Link>
      </div>
      <ErroLinha erro={dados.erro} className="m-4" />
      {d && d.previstos.length === 0 && d.feitos.length === 0 && (
        <p className="px-5 pt-2 text-[13px] text-tinta-3">Nenhum prazo a chegar neste processo.</p>
      )}
      {d && d.previstos.length > 0 && (
        <ul className="divide-y divide-linha">
          {d.previstos.map((m) => (
            <LinhaMomento key={m.chave} m={m} semProcesso />
          ))}
        </ul>
      )}
      {d && d.feitos.length > 0 && (
        <div className="flex flex-col gap-1.5 px-5 pt-3">
          <p className="text-[11px] font-bold uppercase tracking-[0.4px] text-tinta-3">Contactos feitos</p>
          <ul className="flex flex-col gap-1.5">
            {d.feitos.map((c) => (
              <li key={c.id} className="text-[13px] text-tinta-2">
                <span className="font-semibold text-tinta">{ROTULO_TIPO[c.tipo] ?? c.tipo}</span>{" "}
                {c.destinatario === "chefia" ? <Pilula tom="tinta">chefia</Pilula> : null} ·{" "}
                {quando(c.criado_em)} · alvo {dia(c.data_alvo)}. {c.resultado}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="flex justify-end px-5 py-4">
        {aberto && (
          <Botao tamanho="pequeno" variante="secundario" icone={Gavel} onClick={() => setDialogo(true)}>
            Abrir audiência prévia
          </Botao>
        )}
      </div>
      <Dialogo titulo="Abrir audiência prévia" aberto={dialogo} onFechar={() => setDialogo(false)}>
        <div className="flex flex-col gap-4">
          <p className="text-sm text-tinta-2">
            A câmara propõe indeferir e dá ao munícipe 10 dias úteis para responder por escrito
            (Código do Procedimento Administrativo, arts. 121.º e 122.º — a confirmar pelo jurista).
            O munícipe é contactado pelas antecipações.
          </p>
          <Campo rotulo="Porque se propõe indeferir" ajuda="Escrito para o munícipe perceber.">
            <textarea
              value={fundamento}
              onChange={(e) => setFundamento(e.target.value)}
              rows={3}
              maxLength={1000}
              className={classeEntrada}
            />
          </Campo>
          <ErroLinha erro={acao.erro} />
          <div className="flex justify-end gap-2">
            <Botao variante="discreto" tamanho="pequeno" onClick={() => setDialogo(false)}>
              Voltar
            </Botao>
            <Botao
              tamanho="pequeno"
              icone={Gavel}
              disabled={acao.aCorrer || fundamento.trim().length < 5}
              onClick={abrir}
            >
              Abrir audiência
            </Botao>
          </div>
        </div>
      </Dialogo>
    </Cartao>
  );
}
