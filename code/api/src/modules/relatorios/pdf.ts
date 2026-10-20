import PDFDocument from 'pdfkit';
import type { Indicador } from '../painel/periodos.js';
import type { DadosRelatorio } from './relatorio.js';

/*
 * PDF simples do relatório (pdfkit, Helvetica: os acentos do português cabem
 * no WinAnsi). Título, período, números grandes e listas.
 */

const COR = {
  texto: '#1c1917',
  suave: '#78716c',
  sobe: '#15803d',
  desce: '#b91c1c',
};

/** '2026-10-13' → '13/10/2026'. */
export function formatarDia(dia: string): string {
  const [a, m, d] = dia.split('-');
  return `${d}/${m}/${a}`;
}

export function numero(n: number, casas = 0): string {
  return n.toLocaleString('pt-PT', {
    minimumFractionDigits: casas,
    maximumFractionDigits: casas,
  });
}

/** Valor de um indicador para ler: '1 234', '62,5%', '3 min 20 s'. */
export function formatarValor(i: Indicador): string {
  if (i.valor === null) return '—';
  if (i.unidade === 'pct') return `${numero(i.valor, 1)}%`;
  if (i.unidade === 's') {
    const min = Math.floor(i.valor / 60);
    const s = Math.round(i.valor % 60);
    return min ? `${min} min ${s} s` : `${s} s`;
  }
  return numero(i.valor);
}

/** '+12,5%' (contagens) ou '-3,1 p.p.' (percentagens); vazio sem base. */
export function formatarVariacao(i: Indicador): string {
  if (i.variacao === null) return '';
  const sinal = i.variacao > 0 ? '+' : i.variacao < 0 ? '-' : '';
  const v = numero(Math.abs(i.variacao), 1);
  return i.unidade === 'pct' ? `${sinal}${v} p.p.` : `${sinal}${v}%`;
}

function eIndicador(v: unknown): v is Indicador {
  return typeof v === 'object' && v !== null && 'variacao' in v;
}

const ROTULOS_TRABALHO: Record<string, string> = {
  requerimentos: 'Requerimentos preenchidos',
  ocorrencias_agente: 'Ocorrências registadas',
  consultas_processo: 'Consultas de processo',
  referencias_mb: 'Referências Multibanco',
  marcacoes: 'Marcações',
  recolhas: 'Recolhas marcadas',
  passagens: 'Passagens a um funcionário',
};

const ROTULOS_FASE: Record<string, string> = {
  entrada: 'Entrada',
  documentos: 'Documentos',
  apreciacao: 'Apreciação',
  pareceres_externos: 'Pareceres externos',
  decisao: 'Decisão',
  notificado: 'Notificado',
};

export function gerarPdf(d: DadosRelatorio): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: 50,
      info: {
        Title: `${d.titulo} · ${d.municipio.nome}`,
        Author: 'Tou, Câmara?',
      },
    });
    const partes: Buffer[] = [];
    doc.on('data', (b: Buffer) => partes.push(b));
    doc.on('end', () => resolve(Buffer.concat(partes)));
    doc.on('error', reject);

    const largura = doc.page.width - 100;

    doc.fillColor(COR.suave).fontSize(10).text('Tou, Câmara?');
    doc.fillColor(COR.texto).font('Helvetica-Bold').fontSize(22).text(d.titulo);
    doc
      .font('Helvetica')
      .fontSize(12)
      .fillColor(COR.suave)
      .text(
        `${d.municipio.nome} · ${formatarDia(d.periodo.de)} a ${formatarDia(d.periodo.ate)}` +
          ` (comparado com ${formatarDia(d.periodo_anterior.de)} a ${formatarDia(d.periodo_anterior.ate)})`,
      );
    doc.moveDown(1.5);

    // Números grandes, quatro por linha.
    const grandes: [string, Indicador][] = [
      ['Conversas', d.totais.conversas],
      ['Resolvidas sem humano', d.totais.resolvidas_sem_humano_pct],
      ['Passadas a funcionário', d.totais.passadas],
      ['Fora de horas', d.totais.fora_de_horas_pct],
      ['Chamadas', d.totais.chamadas],
      ['Chat, SMS e email', d.totais.escritas],
      ['Sem resposta', d.totais.sem_resposta],
      ['Duração média', d.totais.duracao_media_s],
    ];
    const col = largura / 4;
    for (let i = 0; i < grandes.length; i += 4) {
      const y = doc.y;
      grandes.slice(i, i + 4).forEach(([rotulo, ind], j) => {
        const x = 50 + j * col;
        doc.font('Helvetica-Bold').fontSize(22).fillColor(COR.texto);
        doc.text(formatarValor(ind), x, y, { width: col - 8 });
        const v = formatarVariacao(ind);
        doc.font('Helvetica').fontSize(9).fillColor(COR.suave);
        doc.text(rotulo, x, y + 28, { width: col - 8 });
        if (v) {
          doc.fillColor(v.startsWith('+') ? COR.sobe : COR.desce);
          doc.text(v, x, y + 40, { width: col - 8 });
        }
      });
      doc.x = 50;
      doc.y = y + 62;
    }

    const secao = (titulo: string) => {
      doc.moveDown(0.8);
      doc.x = 50;
      doc.font('Helvetica-Bold').fontSize(13).fillColor(COR.texto).text(titulo);
      doc.moveDown(0.3);
      doc.font('Helvetica').fontSize(10).fillColor(COR.texto);
    };
    const linha = (texto: string, extra = '') => {
      doc.fillColor(COR.texto).text(`•  ${texto}`, { continued: !!extra });
      if (extra) doc.fillColor(COR.suave).text(`  ${extra}`);
    };

    secao('O que o agente tratou');
    for (const [chave, v] of Object.entries(d.trabalho_feito)) {
      const ind = eIndicador(v) ? v : null;
      const valor = ind ? (ind.valor ?? 0) : (v as number);
      linha(
        `${ROTULOS_TRABALHO[chave] ?? chave}: ${numero(valor)}`,
        ind ? formatarVariacao(ind) : '',
      );
    }

    secao('O que mais perguntam');
    if (!d.top_temas.length) linha('Sem temas no período.');
    for (const t of d.top_temas) {
      const v =
        t.variacao === null
          ? t.novo
            ? 'novo'
            : ''
          : formatarVariacao({ ...t, valor: t.total, unidade: 'n' });
      linha(`${t.tema}: ${numero(t.total)}`, v);
    }

    secao('Perguntas sem resposta');
    if (!d.sem_resposta.length) linha('Nenhuma por resolver.');
    for (const s of d.sem_resposta) linha(s.texto, `${s.vezes}×`);

    secao('Ocorrências');
    linha(
      `Registadas: ${formatarValor(d.ocorrencias.registadas)}`,
      formatarVariacao(d.ocorrencias.registadas),
    );
    linha(
      `Resolvidas: ${formatarValor(d.ocorrencias.resolvidas)}`,
      formatarVariacao(d.ocorrencias.resolvidas),
    );
    if (d.ocorrencias.tempo_medio_resolucao_h.valor !== null) {
      linha(
        `Tempo médio até resolver: ${numero(d.ocorrencias.tempo_medio_resolucao_h.valor, 1)} h`,
      );
    }
    linha(`Abertas agora: ${numero(d.ocorrencias.abertas_agora)}`);

    secao('Processos em curso');
    linha(
      `${numero(d.processos.em_curso)} em curso`,
      d.processos.atrasados ? `${numero(d.processos.atrasados)} atrasados` : '',
    );
    for (const f of d.processos.por_fase) {
      linha(
        `${ROTULOS_FASE[f.fase] ?? f.fase}: ${numero(f.total)}`,
        f.dias_medios_na_fase !== null
          ? `${numero(f.dias_medios_na_fase, 1)} dias na fase, em média`
          : '',
      );
    }

    secao('SMS');
    linha(
      `${numero(d.sms.enviados)} enviados, ${numero(d.sms.segmentos)} segmentos`,
      d.sms.custo_cent ? `${numero(d.sms.custo_cent / 100, 2)} €` : '',
    );

    doc.end();
  });
}
