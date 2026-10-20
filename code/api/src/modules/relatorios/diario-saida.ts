import PDFDocument from 'pdfkit';
import type { DadosDiario } from './diario.js';
import { formatarDia, numero } from './pdf.js';

/*
 * O resumo diário cá fora: email curto para ler no telemóvel (texto + HTML
 * simples) e um PDF de uma página em anexo. Puro.
 */

const COR = {
  texto: '#1c1917',
  suave: '#78716c',
  alerta: '#b91c1c',
};

/** 'HH:MM' do instante no fuso. */
export function formatarHora(iso: string, fuso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', {
    timeZone: fuso,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
}

function diaNoFuso(iso: string, fuso: string): string {
  return formatarDia(
    new Date(iso).toLocaleDateString('sv-SE', { timeZone: fuso }),
  );
}

/** 'das 07:30 de 19/10/2026 às 07:30 de 20/10/2026'. */
export function formatarJanela(d: DadosDiario): string {
  const { de, ate, fuso } = d.janela;
  return `das ${formatarHora(de, fuso)} de ${diaNoFuso(de, fuso)} às ${formatarHora(ate, fuso)} de ${diaNoFuso(ate, fuso)}`;
}

function euros(cent: number): string {
  return `${numero(cent / 100, 2)} €`;
}

function variacaoTema(t: DadosDiario['mais_pedidos'][number]): string {
  if (t.subiu_muito) return `subiu muito (média ${numero(t.media_7d, 1)}/dia)`;
  if (t.variacao_pct === null)
    return t.media_7d ? '' : 'sem casos nos 7 dias antes';
  const s = t.variacao_pct > 0 ? '+' : t.variacao_pct < 0 ? '-' : '';
  return `${s}${numero(Math.abs(t.variacao_pct), 0)}% vs média`;
}

const ROTULO_MOTIVO: Record<string, string> = {
  pedido: 'pediu uma pessoa',
  sem_fonte: 'sem resposta oficial',
  juridico: 'jurídico',
  politica: 'político',
  processo: 'processo',
  reclamacao: 'reclamação',
  outro: 'outro',
};

/** As secções do resumo em linhas de texto (o email e o PDF dizem o mesmo). */
export function seccoes(
  d: DadosDiario,
): { titulo: string; linhas: string[] }[] {
  const x = d.numeros;
  const fuso = d.janela.fuso;
  const canais = Object.entries(x.por_canal)
    .map(([c, v]) => `${c} ${numero(v)}`)
    .join(', ');
  const numeros = [
    `Conversas: ${numero(x.conversas)}${canais ? ` (${canais})` : ''}`,
    `Resolvidas sem humano: ${numero(x.resolvidas_sem_humano)}${x.resolvidas_sem_humano_pct !== null ? ` (${numero(x.resolvidas_sem_humano_pct, 1)}%)` : ''}`,
    `Passadas a funcionário: ${numero(x.passadas)}`,
    `Fora de horas: ${numero(x.fora_de_horas)}`,
    `Emergências: ${numero(x.emergencias)}`,
    `Ocorrências: ${numero(x.ocorrencias_novas)} novas, ${numero(x.ocorrencias_resolvidas)} resolvidas`,
    `Requerimentos novos: ${numero(x.requerimentos_novos)} · Processos novos: ${numero(x.processos_novos)}`,
    `Pagamentos: ${numero(x.pagamentos.pagos)} (${euros(x.pagamentos.valor_cent)})${x.pagamentos.modo_teste ? ` · ${numero(x.pagamentos.modo_teste)} em modo de teste` : ''}`,
    `Chamadas de saída: ${numero(x.chamadas_saida.total)} (${numero(x.chamadas_saida.atendidas)} atendidas)`,
  ];

  const pedidos = d.mais_pedidos.length
    ? d.mais_pedidos.map((t) => {
        const v = variacaoTema(t);
        return `${t.tema}: ${numero(t.total)}${v ? ` · ${v}` : ''}`;
      })
    : ['Sem temas nas últimas 24 horas.'];

  const r = d.reclamacoes;
  const reclamacoes = [
    r.total
      ? `${numero(r.total)} (${numero(r.conversas)} em conversas, ${numero(r.emails)} por email)`
      : 'Nenhuma reclamação.',
    ...r.por_tema.map((t) => `${t.tema}: ${numero(t.total)}`),
    ...r.ocorrencias_repetidas.map(
      (z) =>
        `Repetida: ${z.categoria} · ${z.zona} (${z.ocorrencias.join(', ')}): ${numero(z.repetidas)} ${z.repetidas === 1 ? 'aviso' : 'avisos'}`,
    ),
  ];

  const a = d.atencao;
  const atencao: string[] = [];
  if (a.emergencias.total) {
    atencao.push(
      `Emergências: ${numero(a.emergencias.total)} (${a.emergencias.itens
        .map(
          (e) =>
            `${formatarHora(e.iniciada_em, fuso)}${e.tema ? ` ${e.tema}` : ''}`,
        )
        .join('; ')})`,
    );
  }
  if (a.passagens.total) {
    atencao.push(
      `Por responder até hoje: ${numero(a.passagens.total)}${a.passagens.atrasadas ? ` (${numero(a.passagens.atrasadas)} já atrasadas)` : ''}`,
    );
    for (const p of a.passagens.itens) {
      atencao.push(
        `  ${p.atrasada ? 'atrasada' : `até ${formatarHora(p.responder_ate, fuso)}`} · ${p.tema ?? ROTULO_MOTIVO[p.motivo] ?? p.motivo}${p.atribuida_a ? ` · ${p.atribuida_a}` : ' · sem responsável'}`,
      );
    }
  }
  if (a.processos_prazo_hoje.total) {
    atencao.push(
      `Processos com o prazo a acabar hoje: ${numero(a.processos_prazo_hoje.total)}`,
    );
    for (const p of a.processos_prazo_hoje.itens) {
      atencao.push(
        `  ${p.numero} · ${p.tipo}${p.tecnico ? ` · ${p.tecnico}` : ''}`,
      );
    }
  }
  for (const t of a.picos) {
    atencao.push(
      `Pico: ${t.tema}, ${numero(t.total)} casos (média ${numero(t.media_7d, 1)}/dia)`,
    );
  }
  if (!atencao.length) atencao.push('Nada com prazo para hoje.');

  const s = [
    { titulo: 'Atenção hoje', linhas: atencao },
    { titulo: 'O que mais pediram', linhas: pedidos },
    { titulo: 'O que mais reclamaram', linhas: reclamacoes },
    { titulo: 'Números das 24 horas', linhas: numeros },
  ];
  if (d.citacoes.length) {
    s.push({
      titulo: 'O que disseram (anónimo)',
      linhas: d.citacoes.map(
        (c) => `«${c.texto}»${c.tema ? ` · ${c.tema}` : ''}`,
      ),
    });
  }
  return s;
}

function escapar(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Assunto, texto e HTML do email (curto: o resto está no PDF e no painel). */
export function emailDiario(d: DadosDiario): {
  assunto: string;
  texto: string;
  html: string;
} {
  const assunto = `Resumo diário · ${d.municipio.nome} · ${formatarDia(d.periodo.de)}`;
  const partes = seccoes(d);
  const texto = [
    `${d.titulo} de ${d.municipio.nome}, ${formatarJanela(d)}.`,
    '',
    d.abertura.texto,
    ...partes.flatMap((p) => [
      '',
      `${p.titulo}:`,
      ...p.linhas.map((l) =>
        l.startsWith('  ') ? `   ${l.trim()}` : `- ${l}`,
      ),
    ]),
    '',
    'O resumo em PDF segue em anexo; os detalhes estão no painel.',
  ].join('\n');

  const p = (t: string, estilo = '') =>
    `<p style="margin:0 0 12px;${estilo}">${t}</p>`;
  const html = [
    '<!doctype html><html lang="pt-PT"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>',
    `<body style="margin:0;padding:16px;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.45;color:${COR.texto};max-width:560px">`,
    p(
      `${escapar(d.municipio.nome)} · ${escapar(formatarJanela(d))}`,
      `color:${COR.suave};font-size:13px`,
    ),
    `<h1 style="font-size:20px;margin:0 0 12px">${escapar(d.titulo)}</h1>`,
    p(escapar(d.abertura.texto)),
    ...partes.map(
      (s) =>
        `<h2 style="font-size:16px;margin:18px 0 6px">${escapar(s.titulo)}</h2>` +
        `<ul style="margin:0;padding-left:18px">${s.linhas
          .map(
            (l) =>
              `<li style="margin:0 0 4px${l.startsWith('  ') ? `;list-style:none;color:${COR.suave}` : ''}">${escapar(l.trim())}</li>`,
          )
          .join('')}</ul>`,
    ),
    p(
      'O resumo em PDF segue em anexo; os detalhes estão no painel.',
      `margin-top:18px;color:${COR.suave};font-size:13px`,
    ),
    '</body></html>',
  ].join('');
  return { assunto, texto, html };
}

/** PDF de uma página: as mesmas secções, letra pequena, listas curtas. */
export function gerarPdfDiario(d: DadosDiario): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: 40,
      info: {
        Title: `${d.titulo} · ${d.municipio.nome} · ${formatarDia(d.periodo.de)}`,
        Author: 'Tou, Câmara?',
      },
    });
    const partes: Buffer[] = [];
    doc.on('data', (b: Buffer) => partes.push(b));
    doc.on('end', () => resolve(Buffer.concat(partes)));
    doc.on('error', reject);

    const largura = doc.page.width - 80;
    const fundo = doc.page.height - 40;
    // Uma página: o que não couber fica de fora (está no painel).
    const cabe = (altura: number) => doc.y + altura <= fundo;

    doc.fillColor(COR.suave).fontSize(9).text('Tou, Câmara?');
    doc.fillColor(COR.texto).font('Helvetica-Bold').fontSize(18).text(d.titulo);
    doc
      .font('Helvetica')
      .fontSize(10)
      .fillColor(COR.suave)
      .text(`${d.municipio.nome} · ${formatarJanela(d)}`);
    doc.moveDown(0.6);
    doc
      .fillColor(COR.texto)
      .fontSize(10.5)
      .text(d.abertura.texto, { width: largura });

    for (const s of seccoes(d)) {
      if (!cabe(40)) break;
      doc.moveDown(0.6);
      doc.x = 40;
      const alerta =
        s.titulo === 'Atenção hoje' &&
        s.linhas[0] !== 'Nada com prazo para hoje.';
      doc
        .font('Helvetica-Bold')
        .fontSize(11.5)
        .fillColor(alerta ? COR.alerta : COR.texto)
        .text(s.titulo);
      doc.moveDown(0.15);
      doc.font('Helvetica').fontSize(9).fillColor(COR.texto);
      for (const l of s.linhas) {
        const h = doc.heightOfString(l, { width: largura - 12 });
        if (!cabe(h + 2)) break;
        const sub = l.startsWith('  ');
        doc
          .fillColor(sub ? COR.suave : COR.texto)
          .text(`${sub ? '    ' : '•  '}${l.trim()}`, 40, doc.y, {
            width: largura,
          });
      }
    }
    doc.end();
  });
}
