/*
 * Vídeo do painel: a Visão geral, a Entrada e a passagem a funcionário, o
 * processo "Porta na cozinha" e o apoio ao técnico, o buraco reportado três
 * vezes, a campanha da onda de calor e a chamada simulada do "Ao vivo".
 */
import { api, captor } from './comum.mjs';

export async function capturarPainel({ pagina, capturas, pasta }) {
  const { ir, seccao, elemento, guardar, recorte } = captor(pagina, capturas, {
    largura: 1920,
    altura: 1080,
    pasta,
  });

  const visao = await api('visao-geral');
  if (!visao.indicadores.conversas.valor) {
    throw new Error(
      'A Visão geral ainda está a zeros: os números refrescam de 5 em 5 minutos depois de preparar a demonstração.',
    );
  }
  const processo = (
    await api(`processos?texto=${encodeURIComponent('Porta na cozinha')}`)
  ).itens?.find((p) => p.assunto === 'Porta na cozinha');
  const processoFicha = processo && (await api(`processos/${processo.id}`));
  const ocorrencias = (await api('ocorrencias?limite=100')).itens ?? [];
  const ocorrencia = ocorrencias.find(
    (o) => /Santo António, 40/.test(o.morada) && o.duplicados > 0,
  );
  const ocorrenciaFicha = ocorrencia && (await api(`ocorrencias/${ocorrencia.id}`));
  const campanha = (await api('campanhas')).campanhas.find((c) =>
    c.titulo.startsWith('Onda de calor'),
  );
  const campanhaFicha = campanha && (await api(`campanhas/${campanha.id}`));
  const passagens = (await api('passagens?estado=pendentes')).itens ?? [];
  const passagem = passagens.find((p) => /muro de vedação/i.test(p.resumo ?? ''));

  for (const [nome, o] of Object.entries({ processo, ocorrencia, campanha, passagem })) {
    if (!o) throw new Error(`Não encontrei ${nome}: a demonstração está preparada?`);
  }

  // 1. Visão geral (o cartão do teste de qualidade tem resultados de
  // demonstração: nunca entra no vídeo)
  await ir('/painel');
  await guardar(
    'visao',
    {
      titulo: await seccao(`${visao.indicadores.conversas.valor} conversas`),
      atencao: await seccao('Precisa de atenção agora'),
      tratou: await seccao('O que o agente tratou'),
    },
    { inteira: true, proibidas: [await seccao('Teste de qualidade')] },
  );

  // 2. Entrada e a passagem a funcionário
  await ir('/painel/entrada');
  await guardar('entrada', {
    lista: await elemento('Tudo o que chega, num só sítio', 2),
    separadores: await elemento('Balcão', 1),
  });
  await ir(`/painel/passagens/${passagem.id}`);
  await guardar('passagem', {
    caso: await elemento('O caso, resumido pelo agente', 2),
    titulo: await elemento('Pediu para falar com uma pessoa', 1),
  });

  // 3. Processo "Porta na cozinha" e o apoio ao técnico
  await ir(`/painel/processos/${processo.id}`);
  await guardar(
    'processo',
    {
      topo: await elemento('Porta na cozinha · ', 2),
      etapas: await elemento('Apreciação técnica', 3),
      documentos: await elemento('Certidão permanente do registo predial', 4),
    },
    {
      inteira: true,
      proibidas: [await elemento('Sem armazenamento configurado')],
    },
  );
  await ir(`/painel/processos/${processo.id}/apoio`);
  await guardar(
    'apoio',
    {
      verificacoes: await elemento('Documentos esperados', 3),
      documentos: await elemento('Faltam 2 elementos', 2),
    },
    {
      inteira: true,
      proibidas: [
        await elemento('O assistente de IA não está ligado', 1),
        await elemento('Técnico inscrito na Ordem', 2),
        await elemento('Leitura do projeto pela IA', 2),
        await elemento('Novo rascunho', 3),
        await elemento('O resumo precisa da IA', 1),
      ],
    },
  );
  // No vídeo, o apoio ao técnico mostra-se por recortes: as verificações
  // automáticas que passaram e a primeira regra aplicável (entre elas há as
  // que dependem da IA, que nesta instalação não está ligada).
  const linha = (texto) => pagina.locator('main li').filter({ hasText: texto }).first();
  await recorte('apoio_documentos', linha('Documentos esperados'));
  await recorte('apoio_termo', linha('Termo de responsabilidade válido'));
  await recorte('apoio_pdm', linha('Sem condicionantes do PDM'));
  // A regra que responde ao caso (abrir uma porta numa parede interior);
  // se não estiver na lista, a primeira.
  const regras = pagina
    .locator('main section', { hasText: 'Regras aplicáveis' })
    .locator('ol > li');
  const regraDoCaso = regras.filter({ hasText: /porta numa parede interior/i }).first();
  await recorte(
    'apoio_regra',
    (await regraDoCaso.count()) ? regraDoCaso : regras.first(),
  );

  // 4. Ocorrências: o buraco reportado três vezes
  await ir(`/painel/ocorrencias/${ocorrencia.id}`);
  await guardar('ocorrencia', {
    mapa: await elemento('Leaflet', 4),
    ficha: await elemento('Voltar à lista', 2),
    avisos: await elemento('Também reportada por', 1),
  });

  // 5. Ação social: a campanha da onda de calor
  await ir(`/painel/campanhas/${campanha.id}`);
  await guardar(
    'campanha',
    {
      contagens: await seccao('Contactadas'),
      ajuda: await seccao('Precisam de ajuda'),
      bem: await seccao('Estão bem'),
    },
    { inteira: true },
  );

  // 6. A chamada (simulada) no "Ao vivo": uma captura por fala, no fim (cria
  // uma conversa simulada, que já não entra nos números acima).
  const FALAS = [
    ['agente', 'Em que posso ajudar?'],
    ['municipe', 'Preciso de licença por causa do barulho?'],
    ['agente', 'Posso tratar disso já. Qual é a morada?'],
    ['municipe', 'Pode falar com a minha filha?'],
    ['agente', 'Posso mandar um SMS à sua filha'],
    ['municipe', 'Chama-se Ana.'],
    ['agente', 'Mandei um SMS para a sua filha'],
    ['municipe', 'E quanto é que isso custa?'],
    ['agente', 'a licença ficou emitida e segue por SMS'],
  ];
  await ir('/painel/ao-vivo', 'load');
  await pagina.getByRole('button', { name: 'Simular chamada' }).click();
  const falas = [];
  for (const [i, [quem, excerto]] of FALAS.entries()) {
    const alvo = pagina.getByText(excerto, { exact: false }).last();
    await alvo.waitFor({ state: 'visible', timeout: 60_000 });
    await pagina.waitForTimeout(1200);
    const texto = (await alvo.evaluate((e) => e.textContent ?? ''))
      .replace(/\s+/g, ' ')
      .trim();
    const nome = `chamada_${String(i + 1).padStart(2, '0')}`;
    // O balão da última fala (a câmara segue-o).
    const ultima = await alvo.evaluate((e) => {
      const r = (e.parentElement ?? e).getBoundingClientRect();
      return { x: r.x + scrollX, y: r.y + scrollY, w: r.width, h: r.height };
    });
    await guardar(
      nome,
      {
        ultima,
        conversa: await elemento('Chamada web', 3),
        ajuda: await elemento('Ajuda ao funcionário', 2),
        alerta: await elemento('Pessoa vulnerável', 1),
      },
      { proibidas: [await elemento('O assistente de IA não está configurado')] },
    );
    falas.push({ quem, texto, captura: nome });
  }
  const terminar = pagina.getByRole('button', { name: /Terminar a simulação/ });
  if (await terminar.isVisible().catch(() => false)) await terminar.click();

  const ind = visao.indicadores;
  const semana = visao.trabalho_semana;
  const cont = campanhaFicha.contagens;
  return {
    visao: {
      conversas: ind.conversas.valor,
      fora_de_horas_pct: Math.round(ind.fora_de_horas_pct.valor),
      resolvidas_pct: Math.round(ind.resolvidas_sem_humano_pct.valor),
      passadas: ind.passadas.valor,
      ocorrencias: semana.ocorrencias_agente,
      requerimentos: semana.requerimentos,
      consultas: semana.consultas_processo,
      marcacoes: semana.marcacoes,
      referencias: semana.referencias_mb,
    },
    processo: {
      numero: processoFicha.numero,
      requerente: (processoFicha.municipe?.nome ?? 'Sandra').split(' ')[0],
      verificados: processoFicha.documentos_resumo.tem.length,
      faltam: processoFicha.documentos_resumo.faltam.length,
    },
    ocorrencia: {
      numero: ocorrenciaFicha.numero,
      avisos: 1 + (ocorrenciaFicha.duplicados?.length ?? 0),
    },
    campanha: {
      total: campanhaFicha.total,
      bem: cont.bem,
      ajuda: cont.precisa_ajuda,
      sem_resposta: cont.nao_atendeu + cont.sem_ligacao + cont.recusou,
      tratados: campanhaFicha.destinatarios.filter(
        (d) => d.estado === 'precisa_ajuda' && d.tratado_em,
      ).length,
    },
    falas,
  };
}
