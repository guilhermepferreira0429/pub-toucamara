import 'package:flutter/material.dart';
import 'package:qr_flutter/qr_flutter.dart';

import '../../comum/componentes/componentes.dart';
import '../../comum/datas.dart';
import '../../comum/plataforma/abrir_pdf.dart';
import '../../comum/tema.dart';
import '../componentes.dart';
import '../config.dart';
import '../modelos.dart';
import '../servicos.dart';

/// Os meus assuntos: processos, licenças, pagamentos, marcações,
/// reclamações e ocorrências reportadas.
class EcraAssuntos extends StatelessWidget {
  const EcraAssuntos({super.key, this.separadorInicial = 0});
  final int separadorInicial;

  @override
  Widget build(BuildContext context) {
    final r = FornecedorMunicipe.de(context).repositorio;
    return DefaultTabController(
      length: 6,
      initialIndex: separadorInicial,
      child: Scaffold(
        appBar: AppBar(
          title: const Text('Os meus assuntos'),
          bottom: const TabBar(
            isScrollable: true,
            tabAlignment: TabAlignment.start,
            labelStyle: TextStyle(fontSize: 17, fontWeight: FontWeight.w700),
            unselectedLabelStyle: TextStyle(fontSize: 17),
            labelColor: Cores.tinta,
            indicatorColor: Cores.terracota,
            indicatorWeight: 4,
            tabs: [
              Tab(height: 52, text: 'Processos'),
              Tab(height: 52, text: 'Licenças'),
              Tab(height: 52, text: 'Pagamentos'),
              Tab(height: 52, text: 'Marcações'),
              Tab(height: 52, text: 'Reclamações'),
              Tab(height: 52, text: 'Ocorrências'),
            ],
          ),
        ),
        body: TabBarView(
          children: [
            Carregar<List<ProcessoResumo>>(
              ler: r.processos,
              eVazio: (l) => l.isEmpty,
              vazio: 'Ainda não tem processos na câmara.',
              construir: (context, l) => Column(
                children: [
                  for (final p in l) ...[
                    _CartaoProcesso(p),
                    const SizedBox(height: 10),
                  ],
                ],
              ),
            ),
            Carregar<List<Licenca>>(
              ler: r.licencas,
              eVazio: (l) => l.isEmpty,
              vazio: 'Não tem licenças.',
              construir: (context, l) => Column(
                children: [
                  for (final x in l) ...[
                    _CartaoLicenca(x),
                    const SizedBox(height: 10),
                  ],
                ],
              ),
            ),
            Carregar<List<Pagamento>>(
              ler: r.pagamentos,
              eVazio: (l) => l.isEmpty,
              vazio: 'Não tem pagamentos.',
              construir: (context, l) => Column(
                children: [
                  for (final x in l) ...[
                    CartaoPagamento(x),
                    const SizedBox(height: 10),
                  ],
                ],
              ),
            ),
            Carregar<List<Marcacao>>(
              ler: r.marcacoes,
              eVazio: (l) => l.isEmpty,
              vazio: 'Não tem marcações.',
              construir: (context, l) => Column(
                children: [
                  for (final x in l) ...[
                    _CartaoMarcacao(x),
                    const SizedBox(height: 10),
                  ],
                ],
              ),
            ),
            Carregar<List<Reclamacao>>(
              ler: r.reclamacoes,
              eVazio: (l) => l.isEmpty,
              vazio: 'Não tem reclamações.',
              construir: (context, l) => Column(
                children: [
                  for (final x in l) ...[
                    _CartaoReclamacao(x),
                    const SizedBox(height: 10),
                  ],
                ],
              ),
            ),
            Carregar<List<OcorrenciaMinha>>(
              ler: r.ocorrencias,
              eVazio: (l) => l.isEmpty,
              vazio: 'Ainda não reportou nenhum problema.',
              construir: (context, l) => Column(
                children: [
                  for (final x in l) ...[
                    _CartaoOcorrencia(x),
                    const SizedBox(height: 10),
                  ],
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------
// Processos
// ---------------------------------------------------------------------

class _CartaoProcesso extends StatelessWidget {
  const _CartaoProcesso(this.p);
  final ProcessoResumo p;

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    return Cartao(
      onTap: () => Navigator.of(
        context,
      ).push(MaterialPageRoute(builder: (_) => EcraProcesso(id: p.id))),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  p.numero,
                  style: t.labelLarge?.copyWith(color: Cores.terracotaEscuro),
                ),
              ),
              Pilula(p.faseRotulo, tom: TomPilula.tinta),
            ],
          ),
          const SizedBox(height: 6),
          Text(p.assunto, style: t.titleMedium),
          Text(p.tipo, style: t.bodyMedium?.copyWith(color: Cores.tinta2)),
          if (p.ultimoEvento != null) ...[
            const SizedBox(height: 8),
            LinhaDado(Icons.history_rounded, p.ultimoEvento!),
          ],
        ],
      ),
    );
  }
}

/// Um processo: a fase em palavras simples, o que falta, o prazo, a linha
/// do tempo, o pagamento e a decisão.
class EcraProcesso extends StatelessWidget {
  const EcraProcesso({super.key, required this.id});
  final String id;

  @override
  Widget build(BuildContext context) {
    final s = FornecedorMunicipe.de(context);
    return Scaffold(
      appBar: AppBar(title: const Text('Processo')),
      body: Carregar<Processo>(
        ler: () => s.repositorio.processo(id),
        construir: (context, p) => _Processo(p),
      ),
    );
  }
}

class _Processo extends StatelessWidget {
  const _Processo(this.p);
  final Processo p;

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    final s = FornecedorMunicipe.de(context);
    final pg = p.pagamento;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          p.numero,
          style: t.labelLarge?.copyWith(color: Cores.terracotaEscuro),
        ),
        const SizedBox(height: 4),
        Semantics(header: true, child: Text(p.assunto, style: t.headlineSmall)),
        Text(p.tipo, style: t.bodyLarge?.copyWith(color: Cores.tinta2)),
        const SizedBox(height: 14),
        Cartao(
          cor: Cores.creme2,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Rotulo('Em que fase está'),
              Pilula(p.faseRotulo, tom: TomPilula.tinta),
              if (p.faseEmPalavras != null) ...[
                const SizedBox(height: 8),
                Text(p.faseEmPalavras!, style: t.bodyLarge),
              ],
              if (p.prazoFim != null) ...[
                const SizedBox(height: 8),
                LinhaDado(
                  Icons.event_rounded,
                  'A câmara responde até ${diaLongo(p.prazoFim)}'
                  '${p.diasUteisRestantes != null && p.diasUteisRestantes! >= 0 ? ' (faltam ${p.diasUteisRestantes} dias úteis)' : ''}.',
                ),
              ] else if (!p.prazoAContar)
                const LinhaDado(
                  Icons.hourglass_empty_rounded,
                  'O prazo da câmara só começa quando tiver os documentos todos.',
                ),
            ],
          ),
        ),
        const SizedBox(height: 12),
        if (p.emFalta.isNotEmpty)
          Cartao(
            cor: Cores.ambarSuave,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('O que falta da sua parte', style: t.titleMedium),
                const SizedBox(height: 6),
                for (final d in p.emFalta)
                  LinhaDado(
                    Icons.description_outlined,
                    d.prazo == null
                        ? d.nome
                        : '${d.nome} (até ${diaLongo(d.prazo)})',
                    forte: true,
                  ),
                if (p.link != null) ...[
                  const SizedBox(height: 10),
                  BotaoLargo(
                    icone: Icons.upload_file_rounded,
                    texto: 'Enviar documentos',
                    onPressed: () => abrirFora(context, p.link!),
                  ),
                ],
              ],
            ),
          )
        else
          const Cartao(
            cor: Cores.verdeSuave,
            child: LinhaDado(
              Icons.check_circle_outline_rounded,
              'Não falta nada da sua parte.',
            ),
          ),
        if (pg != null) ...[
          const SizedBox(height: 12),
          CartaoPagamento(
            Pagamento(
              id: '',
              estado: '${pg['estado']}',
              valorCent: (pg['valor_cent'] as num?)?.toInt() ?? 0,
              pagarAte: pg['pagar_ate'] as String?,
              modoTeste: pg['modo_teste'] == true,
              guia: pg['guia_numero'] as String?,
              // A página de pagar do site (o mesmo sítio do link do processo).
              link: pg['codigo'] == null
                  ? null
                  : '${p.link != null ? Uri.parse(p.link!).origin : ConfigMunicipe.webUrl}/pagamento/${pg['codigo']}',
            ),
          ),
        ],
        if (p.decisao != null) ...[
          const SizedBox(height: 12),
          Cartao(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Decisão', style: t.titleMedium),
                const SizedBox(height: 6),
                Text(p.decisao!, style: t.bodyLarge),
                if (p.decisaoPdf && p.codigo != null) ...[
                  const SizedBox(height: 10),
                  BotaoLargo(
                    icone: Icons.picture_as_pdf_rounded,
                    texto: 'Abrir a decisão (PDF)',
                    contorno: true,
                    onPressed: () async {
                      try {
                        final b = await s.repositorio.pdfDecisao(p.codigo!);
                        await abrirPdf(b, 'decisao-${p.numero}.pdf');
                      } on Object catch (e) {
                        if (context.mounted) avisar(context, mensagemDe(e));
                      }
                    },
                  ),
                ],
              ],
            ),
          ),
        ],
        const SizedBox(height: 20),
        Semantics(
          header: true,
          child: Text('O que já aconteceu', style: t.titleLarge),
        ),
        const SizedBox(height: 8),
        LinhaDoTempo(p.linhaDoTempo),
        if (p.link != null) ...[
          const SizedBox(height: 16),
          BotaoLargo(
            icone: Icons.open_in_new_rounded,
            texto: 'Ver a página do processo',
            contorno: true,
            onPressed: () => abrirFora(context, p.link!),
          ),
        ],
      ],
    );
  }
}

class LinhaDoTempo extends StatelessWidget {
  const LinhaDoTempo(this.eventos, {super.key});
  final List<EventoProcesso> eventos;

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    if (eventos.isEmpty) return const Text('Ainda sem movimentos.');
    final lista = eventos.reversed.toList();
    return Column(
      children: [
        for (final (n, e) in lista.indexed)
          IntrinsicHeight(
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                SizedBox(
                  width: 28,
                  child: Column(
                    children: [
                      Container(
                        width: 16,
                        height: 16,
                        margin: const EdgeInsets.only(top: 4),
                        decoration: BoxDecoration(
                          color: n == 0 ? Cores.terracota : Cores.tinta3,
                          shape: BoxShape.circle,
                        ),
                      ),
                      if (n < lista.length - 1)
                        Expanded(
                          child: Container(width: 3, color: Cores.linha),
                        ),
                    ],
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Padding(
                    padding: const EdgeInsets.only(bottom: 16),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          e.em == null ? '' : diaHora(e.em),
                          style: t.bodySmall?.copyWith(color: Cores.tinta2),
                        ),
                        Text(e.descricao, style: t.bodyLarge),
                      ],
                    ),
                  ),
                ),
              ],
            ),
          ),
      ],
    );
  }
}

// ---------------------------------------------------------------------
// Licenças, pagamentos, marcações, reclamações
// ---------------------------------------------------------------------

class _CartaoLicenca extends StatelessWidget {
  const _CartaoLicenca(this.l);
  final Licenca l;

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    final s = FornecedorMunicipe.de(context);
    return Cartao(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(child: Text(l.tipoNome, style: t.titleMedium)),
              Pilula(
                l.estadoDito,
                tom: l.valida
                    ? TomPilula.verde
                    : l.estado == 'recusada'
                    ? TomPilula.terracota
                    : TomPilula.ambar,
              ),
            ],
          ),
          const SizedBox(height: 6),
          LinhaDado(Icons.tag_rounded, 'Processo ${l.processoNumero}'),
          if (l.data != null) LinhaDado(Icons.event_rounded, diaLongo(l.data)),
          if (l.morada != null) LinhaDado(Icons.place_outlined, l.morada!),
          if (l.validaAte != null)
            LinhaDado(
              Icons.verified_outlined,
              'Válida até ${diaLongo(l.validaAte)}',
            ),
          if (l.taxaCent != null && l.taxaCent! > 0)
            LinhaDado(Icons.euro_rounded, 'Taxa: ${euros(l.taxaCent!)}'),
          if (l.motivoRecusa != null)
            LinhaDado(Icons.info_outline_rounded, l.motivoRecusa!),
          if (l.valida) ...[
            const SizedBox(height: 12),
            Center(
              child: Semantics(
                label: 'Código QR para verificar a licença',
                child: Container(
                  color: Colors.white,
                  padding: const EdgeInsets.all(8),
                  child: QrImageView(data: l.link, size: 170),
                ),
              ),
            ),
            const SizedBox(height: 6),
            Center(
              child: Text(
                'Mostre este código a quem pedir a licença.',
                style: t.bodySmall?.copyWith(color: Cores.tinta2),
              ),
            ),
            const SizedBox(height: 12),
            BotaoLargo(
              icone: Icons.picture_as_pdf_rounded,
              texto: 'Abrir a licença (PDF)',
              onPressed: () async {
                try {
                  final b = await s.repositorio.pdfLicenca(l.codigo);
                  await abrirPdf(b, 'licenca-${l.codigo}.pdf');
                } on Object catch (e) {
                  if (context.mounted) avisar(context, mensagemDe(e));
                }
              },
            ),
          ],
          if (l.link.isNotEmpty) ...[
            const SizedBox(height: 8),
            BotaoLargo(
              icone: Icons.open_in_new_rounded,
              texto: 'Ver no site',
              contorno: true,
              onPressed: () => abrirFora(context, l.link),
            ),
          ],
        ],
      ),
    );
  }
}

class CartaoPagamento extends StatelessWidget {
  const CartaoPagamento(this.p, {super.key});
  final Pagamento p;

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    return Cartao(
      cor: p.pendente ? Cores.papel : null,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  euros(p.valorCent),
                  style: t.headlineSmall?.copyWith(
                    color: Cores.terracotaEscuro,
                  ),
                ),
              ),
              Pilula(
                p.estadoDito,
                tom: p.pendente
                    ? TomPilula.ambar
                    : p.estado == 'pago'
                    ? TomPilula.verde
                    : TomPilula.neutro,
              ),
            ],
          ),
          if (p.modoTeste) ...[
            const SizedBox(height: 6),
            const Pilula('Pagamento de teste', tom: TomPilula.ambar),
          ],
          const SizedBox(height: 8),
          if (p.processoNumero != null)
            LinhaDado(Icons.tag_rounded, 'Processo ${p.processoNumero}'),
          if (p.guia != null)
            LinhaDado(Icons.receipt_long_outlined, 'Guia ${p.guia}'),
          if (p.entidade != null && p.referencia != null && p.pendente)
            Container(
              margin: const EdgeInsets.only(top: 8),
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: Cores.creme,
                borderRadius: BorderRadius.circular(12),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('Multibanco', style: t.labelLarge),
                  const SizedBox(height: 4),
                  SelectableText('Entidade: ${p.entidade}', style: t.bodyLarge),
                  SelectableText(
                    'Referência: ${p.referenciaDita}',
                    style: t.bodyLarge?.copyWith(fontWeight: FontWeight.w700),
                  ),
                  SelectableText(
                    'Valor: ${euros(p.valorCent)}',
                    style: t.bodyLarge,
                  ),
                ],
              ),
            ),
          if (p.pagarAte != null && p.pendente)
            LinhaDado(Icons.event_rounded, 'Pagar até ${diaLongo(p.pagarAte)}'),
          if (p.pagoEm != null)
            LinhaDado(Icons.check_rounded, 'Pago a ${diaHora(p.pagoEm)}'),
          if (p.link != null && p.pendente) ...[
            const SizedBox(height: 12),
            BotaoLargo(
              icone: Icons.payment_rounded,
              texto: 'Pagar (MB WAY ou referência)',
              onPressed: () => abrirFora(context, p.link!),
            ),
          ],
        ],
      ),
    );
  }
}

class _CartaoMarcacao extends StatelessWidget {
  const _CartaoMarcacao(this.m);
  final Marcacao m;

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    final ini = m.inicio;
    return Cartao(
      cor: m.futura ? Cores.papel : Cores.creme,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(child: Text(m.servico, style: t.titleMedium)),
              Pilula(
                m.estadoDito,
                tom: m.futura ? TomPilula.verde : TomPilula.neutro,
              ),
            ],
          ),
          const SizedBox(height: 6),
          if (ini != null)
            LinhaDado(
              Icons.event_rounded,
              '${diaPorExtenso(ini.toLocal())}, ${hora(ini)}'
              '${m.fim != null && m.recolha ? '–${hora(m.fim!)}' : ''}',
              forte: m.futura,
            ),
          if (m.local != null) LinhaDado(Icons.place_outlined, m.local!),
          if (m.assunto != null) LinhaDado(Icons.notes_rounded, m.assunto!),
          if (m.levar.isNotEmpty)
            LinhaDado(Icons.backpack_outlined, 'Levar: ${m.levar.join(', ')}'),
          if (m.link != null && m.futura) ...[
            const SizedBox(height: 10),
            BotaoLargo(
              icone: Icons.edit_calendar_rounded,
              texto: 'Mudar ou cancelar',
              contorno: true,
              onPressed: () => abrirFora(context, m.link!),
            ),
          ],
        ],
      ),
    );
  }
}

class _CartaoReclamacao extends StatelessWidget {
  const _CartaoReclamacao(this.r);
  final Reclamacao r;

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    return Cartao(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  r.numero,
                  style: t.labelLarge?.copyWith(color: Cores.terracotaEscuro),
                ),
              ),
              Pilula(
                r.estadoRotulo,
                tom: r.resposta != null ? TomPilula.verde : TomPilula.ambar,
              ),
            ],
          ),
          const SizedBox(height: 6),
          Text(
            r.descricao,
            style: t.bodyLarge,
            maxLines: 4,
            overflow: TextOverflow.ellipsis,
          ),
          const SizedBox(height: 6),
          LinhaDado(
            Icons.event_rounded,
            'Recebida a ${diaLongo(r.recebidaEm)}',
          ),
          if (r.resposta == null)
            LinhaDado(
              Icons.hourglass_bottom_rounded,
              'Resposta até ${diaLongo(r.responderAte)}',
            ),
          if (r.resposta != null) ...[
            const SizedBox(height: 6),
            Text('Resposta da câmara', style: t.labelLarge),
            Text(r.resposta!, style: t.bodyLarge),
          ],
          if (r.link != null) ...[
            const SizedBox(height: 10),
            BotaoLargo(
              icone: Icons.open_in_new_rounded,
              texto: 'Ver no site',
              contorno: true,
              onPressed: () => abrirFora(context, r.link!),
            ),
          ],
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------
// Ocorrências
// ---------------------------------------------------------------------

class _CartaoOcorrencia extends StatelessWidget {
  const _CartaoOcorrencia(this.o);
  final OcorrenciaMinha o;

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    return Cartao(
      onTap: o.token.isEmpty
          ? null
          : () => Navigator.of(context).push(
              MaterialPageRoute(builder: (_) => EcraOcorrencia(resumo: o)),
            ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  o.numero,
                  style: t.labelLarge?.copyWith(color: Cores.terracotaEscuro),
                ),
              ),
              Pilula(
                o.resolvida
                    ? 'Resolvida'
                    : o.estado == 'com_equipa'
                    ? 'Com a equipa'
                    : o.estado == 'rejeitada'
                    ? 'Não seguiu'
                    : 'Recebida',
                tom: o.resolvida ? TomPilula.verde : TomPilula.ambar,
              ),
            ],
          ),
          const SizedBox(height: 6),
          Text(o.categoria, style: t.titleMedium),
          Text(
            o.descricao,
            style: t.bodyMedium,
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
          ),
          const SizedBox(height: 6),
          Text(
            o.estadoExplicado,
            style: t.bodyMedium?.copyWith(color: Cores.tinta2),
          ),
          if (o.juntadaAOutra) ...[
            const SizedBox(height: 6),
            const Pilula('Juntou-se a um aviso que já tínhamos'),
          ],
        ],
      ),
    );
  }
}

/// Uma ocorrência reportada: estado e fotografias (as suas e as do depois,
/// da equipa que resolveu).
class EcraOcorrencia extends StatefulWidget {
  const EcraOcorrencia({super.key, required this.resumo});
  final OcorrenciaMinha resumo;

  @override
  State<EcraOcorrencia> createState() => _EcraOcorrenciaState();
}

class _EcraOcorrenciaState extends State<EcraOcorrencia> {
  Future<OcorrenciaDetalhe>? _f;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _f ??= FornecedorMunicipe.de(
      context,
    ).repositorio.ocorrencia(widget.resumo.token);
  }

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    final o = widget.resumo;
    return Scaffold(
      appBar: AppBar(title: Text(o.numero)),
      body: FutureBuilder<OcorrenciaDetalhe>(
        future: _f,
        builder: (context, s) {
          final d = s.data;
          final depois = d?.fotos.where((f) => f.daEquipa).toList() ?? const [];
          final minhas =
              d?.fotos.where((f) => !f.daEquipa).toList() ?? const [];
          return ListView(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 32),
            children: [
              Text(d?.categoria ?? o.categoria, style: t.headlineSmall),
              const SizedBox(height: 8),
              Cartao(
                cor: o.resolvida ? Cores.verdeSuave : Cores.creme2,
                child: Text(
                  d?.estadoExplicado ?? o.estadoExplicado,
                  style: t.bodyLarge?.copyWith(fontWeight: FontWeight.w600),
                ),
              ),
              const SizedBox(height: 12),
              LinhaDado(Icons.place_outlined, d?.morada ?? o.morada),
              LinhaDado(Icons.notes_rounded, d?.descricao ?? o.descricao),
              if (o.criadaEm != null)
                LinhaDado(
                  Icons.event_rounded,
                  'Reportada a ${diaHora(o.criadaEm)}',
                ),
              if (s.connectionState != ConnectionState.done)
                const Padding(
                  padding: EdgeInsets.all(20),
                  child: Center(child: CircularProgressIndicator()),
                ),
              if (s.hasError) ErroLinha(mensagemDe(s.error!)),
              if (depois.isNotEmpty) ...[
                const SizedBox(height: 16),
                Text(
                  'Depois de resolvido (fotografia da equipa)',
                  style: t.titleMedium,
                ),
                const SizedBox(height: 8),
                _Fotos(depois),
              ],
              if (minhas.isNotEmpty) ...[
                const SizedBox(height: 16),
                Text('As suas fotografias', style: t.titleMedium),
                const SizedBox(height: 8),
                _Fotos(minhas),
              ],
              if (o.link != null) ...[
                const SizedBox(height: 16),
                BotaoLargo(
                  icone: Icons.open_in_new_rounded,
                  texto: 'Ver no site (juntar fotografias)',
                  contorno: true,
                  onPressed: () => abrirFora(context, o.link!),
                ),
              ],
            ],
          );
        },
      ),
    );
  }
}

class _Fotos extends StatelessWidget {
  const _Fotos(this.fotos);
  final List<FotoOcorrencia> fotos;

  @override
  Widget build(BuildContext context) => Wrap(
    spacing: 8,
    runSpacing: 8,
    children: [
      for (final f in fotos)
        ClipRRect(
          borderRadius: BorderRadius.circular(14),
          child: Container(
            width: 160,
            height: 120,
            color: Cores.creme2,
            child: f.url == null
                ? const Center(
                    child: Icon(
                      Icons.image_not_supported_outlined,
                      color: Cores.tinta3,
                    ),
                  )
                : Image.network(
                    f.url!,
                    fit: BoxFit.cover,
                    semanticLabel: f.daEquipa
                        ? 'Fotografia da equipa'
                        : 'A sua fotografia',
                    errorBuilder: (_, _, _) => const Center(
                      child: Icon(
                        Icons.broken_image_outlined,
                        color: Cores.tinta3,
                      ),
                    ),
                  ),
          ),
        ),
    ],
  );
}
