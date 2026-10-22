import 'package:flutter/material.dart';

import '../../comum/api/cliente_api.dart';
import '../../comum/componentes/componentes.dart';
import '../../comum/fila/fila_offline.dart';
import '../../comum/plataforma/abrir_pdf.dart';
import '../../comum/plataforma/navegar.dart';
import '../../comum/tema.dart';
import '../modelos.dart';
import '../servicos.dart';
import 'fotos.dart';

/// Visita de fiscalização: o local, a checklist, as fotografias (com GPS e
/// hora), o relatório ditado e concluir (a API gera o PDF).
class EcraVisita extends StatefulWidget {
  const EcraVisita({super.key, required this.id, required this.numero});
  final String id;
  final String numero;

  @override
  State<EcraVisita> createState() => _EcraVisitaState();
}

class _EcraVisitaState extends State<EcraVisita> {
  VisitaDetalhe? _v;
  bool _daCache = false;
  String? _erro;
  List<ItemChecklist> _checklist = [];
  final _relatorio = TextEditingController();
  final _notas = TextEditingController();
  bool _aOuvir = false;
  String _antesDoDitado = '';
  int _pendentesAntes = 0;
  FilaOffline? _fila;
  Servicos? _servicos;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_fila == null) {
      _servicos = FornecedorServicos.de(context);
      _fila = _servicos!.fila;
      _fila!.addListener(_aoMudarFila);
      _pendentesAntes = _fila!.daTarefa(widget.id).length;
      _carregar();
    }
  }

  @override
  void dispose() {
    _fila?.removeListener(_aoMudarFila);
    _servicos?.ditado.parar();
    _relatorio.dispose();
    _notas.dispose();
    super.dispose();
  }

  /// Quando a fila acaba de enviar o desta visita, recarrega da API.
  void _aoMudarFila() {
    final agora = _fila!.daTarefa(widget.id).length;
    if (_pendentesAntes > 0 && agora == 0) _carregar(manterTexto: true);
    _pendentesAntes = agora;
  }

  Future<void> _carregar({bool manterTexto = false}) async {
    final repo = FornecedorServicos.de(context).repositorio;
    try {
      final (v, daCache) = await repo.visita(widget.id);
      if (!mounted) return;
      setState(() {
        _v = v;
        _daCache = daCache;
        _erro = null;
        _checklist = v.checklist;
        if (!manterTexto && _relatorio.text.isEmpty) {
          _relatorio.text = v.transcricao ?? '';
        }
      });
    } on SemRede {
      if (mounted) {
        setState(() => _erro =
            'Sem rede e esta visita não está guardada no telemóvel. Abra-a quando tiver rede.');
      }
    } on ErroApi catch (e) {
      if (mounted) setState(() => _erro = e.mensagem);
    }
  }

  String get _texto {
    final r = _relatorio.text.trim();
    final n = _notas.text.trim();
    return n.isEmpty ? r : '$r\n\nNotas: $n';
  }

  Future<void> _ditar() async {
    final d = FornecedorServicos.de(context).ditado;
    if (_aOuvir) {
      await d.parar();
      setState(() => _aOuvir = false);
      return;
    }
    if (!await d.preparar()) {
      if (mounted) {
        avisar(context,
            'O ditado por voz não está disponível neste aparelho. Use o microfone do teclado ou escreva.');
      }
      return;
    }
    _antesDoDitado = _relatorio.text.trim();
    setState(() => _aOuvir = true);
    await d.comecar((texto, fim) {
      if (!mounted) return;
      setState(() {
        _relatorio.text =
            _antesDoDitado.isEmpty ? texto : '$_antesDoDitado $texto';
        if (fim) _aOuvir = false;
      });
    });
  }

  Future<void> _foto(bool daGaleria) async {
    final s = FornecedorServicos.de(context);
    final v = _v!;
    final f = await s.camara.tirar(daGaleria: daGaleria);
    if (f == null) return;
    await s.repositorio.fotoVisita(v, f);
    if (mounted) {
      avisar(
          context,
          f.local == null
              ? 'Fotografia guardada (sem GPS).'
              : 'Fotografia guardada com GPS e hora.');
    }
  }

  Future<bool> _guardarRelatorio({bool avisarFim = true}) async {
    if (_texto.length < 10) {
      avisar(context, 'Dite ou escreva o relatório (pelo menos uma frase).');
      return false;
    }
    final s = FornecedorServicos.de(context);
    await s.repositorio.relatorioVisita(_v!, _texto, _checklist);
    if (avisarFim && mounted) {
      avisar(context, 'Relatório guardado. Vai para a câmara assim que houver rede.');
    }
    return true;
  }

  Future<void> _concluir() async {
    final sim = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: const Text('Concluir a visita?'),
        content: const Text(
            'O relatório fecha e já não se altera. A câmara gera o PDF e trata do que se segue (nova visita se houver infrações, aviso ao munícipe).'),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(c, false),
              child: const Text('Ainda não')),
          FilledButton(
              onPressed: () => Navigator.pop(c, true),
              child: const Text('Concluir')),
        ],
      ),
    );
    if (sim != true || !mounted) return;
    if (!await _guardarRelatorio(avisarFim: false)) return;
    if (!mounted) return;
    await FornecedorServicos.de(context).repositorio.concluirVisita(_v!);
    if (mounted) avisar(context, 'Visita concluída. Envia quando houver rede.');
  }

  Future<void> _pdf() async {
    final repo = FornecedorServicos.de(context).repositorio;
    try {
      final bytes = await repo.pdfVisita(widget.id);
      final ok = await abrirPdf(bytes, 'vistoria-${widget.numero}.pdf');
      if (!ok && mounted) avisar(context, 'Não há app para abrir o PDF.');
    } on SemRede {
      if (mounted) avisar(context, 'Para ver o PDF é preciso rede.');
    } on ErroApi catch (e) {
      if (mounted) avisar(context, e.mensagem);
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = FornecedorServicos.de(context);
    final texto = Theme.of(context).textTheme;
    final v = _v;
    return Scaffold(
      appBar: AppBar(title: Text('Visita ${widget.numero}')),
      body: Column(children: [
        IndicadorFila(fila: s.fila),
        Expanded(
          child: v == null
              ? Center(
                  child: _erro != null
                      ? Padding(
                          padding: const EdgeInsets.all(16),
                          child: ErroLinha(_erro!, aoTentar: _carregar))
                      : const CircularProgressIndicator())
              : ListenableBuilder(
                  listenable: s.fila,
                  builder: (context, _) {
                    final pendentes = s.fila.daTarefa(v.id);
                    final concluidaLocal =
                        pendentes.any((a) => a.caminho.endsWith('/concluir'));
                    final editavel = v.aberta && !v.relatorioFechado && !concluidaLocal;
                    return ListView(
                      padding: const EdgeInsets.fromLTRB(16, 12, 16, 32),
                      children: [
                        _cabecalho(v, texto, concluidaLocal),
                        const SizedBox(height: 16),
                        _local(v, texto),
                        const SizedBox(height: 16),
                        if (v.relatorioFechado) ...[
                          _fechado(v, texto),
                          const SizedBox(height: 16),
                        ],
                        _secaoChecklist(editavel, texto),
                        const SizedBox(height: 16),
                        Cartao(
                          child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                const Rotulo('Fotografias'),
                                GaleriaFotos(
                                  fotos: v.fotos,
                                  pendentes: pendentes
                                      .where((a) => a.tipo == TipoAcao.ficheiro)
                                      .toList(),
                                  vazio:
                                      'Ainda sem fotografias. Ficam com a localização e a hora.',
                                ),
                                if (v.estado != 'cancelada') ...[
                                  const SizedBox(height: 14),
                                  BotoesFoto(aoEscolher: _foto),
                                ],
                              ]),
                        ),
                        const SizedBox(height: 16),
                        if (editavel) _secaoRelatorio(texto),
                      ],
                    );
                  },
                ),
        ),
      ]),
    );
  }

  Widget _cabecalho(VisitaDetalhe v, TextTheme texto, bool concluidaLocal) =>
      Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(v.tipoNome, style: texto.headlineSmall),
        const SizedBox(height: 8),
        Wrap(spacing: 8, runSpacing: 6, children: [
          Pilula(concluidaLocal ? 'Concluída · por enviar' : v.estadoNome,
              tom: concluidaLocal
                  ? TomPilula.tinta
                  : v.feita
                      ? TomPilula.verde
                      : TomPilula.neutro),
          if (v.janela != null) Pilula(v.janela!, icone: Icons.schedule_rounded),
          if (_daCache)
            const Pilula('Sem rede · guardado no telemóvel',
                tom: TomPilula.ambar, icone: Icons.cloud_off_rounded),
          if (v.valoresDemonstracao)
            const Pilula('valores de demonstração', tom: TomPilula.ambar),
        ]),
      ]);

  Widget _local(VisitaDetalhe v, TextTheme texto) => Cartao(
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          const Rotulo('Local e motivo'),
          LinhaDado(Icons.place_outlined, v.morada, forte: true),
          LinhaDado(Icons.info_outline_rounded, v.motivo),
          if (v.ocorrencia != null)
            LinhaDado(Icons.report_outlined,
                'Ocorrência ${v.ocorrencia!['numero']} · ${v.ocorrencia!['categoria']}: ${v.ocorrencia!['descricao']}'),
          if (v.processo != null)
            LinhaDado(Icons.folder_outlined,
                'Processo ${v.processo!['numero']} · ${v.processo!['assunto'] ?? ''}'),
          const SizedBox(height: 10),
          OutlinedButton.icon(
            onPressed: () => navegarPara(lat: v.lat, lng: v.lng, morada: v.morada),
            icon: const Icon(Icons.navigation_rounded),
            label: const Text('Navegar até lá'),
          ),
        ]),
      );

  Widget _fechado(VisitaDetalhe v, TextTheme texto) => Cartao(
        cor: Cores.verdeSuave,
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            const Icon(Icons.task_alt_rounded, color: Cores.verde, size: 30),
            const SizedBox(width: 10),
            Expanded(child: Text('Relatório fechado', style: texto.titleLarge)),
          ]),
          if (v.conclusaoNome != null) ...[
            const SizedBox(height: 6),
            Text(v.conclusaoNome!, style: texto.titleMedium),
          ],
          if (v.resumoRelatorio != null) ...[
            const SizedBox(height: 6),
            Text(v.resumoRelatorio!, style: texto.bodyLarge),
          ],
          const SizedBox(height: 12),
          FilledButton.icon(
            onPressed: _pdf,
            icon: const Icon(Icons.picture_as_pdf_rounded),
            label: const Text('Abrir o PDF do relatório'),
          ),
        ]),
      );

  Widget _secaoChecklist(bool editavel, TextTheme texto) => Cartao(
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          const Rotulo('Checklist'),
          if (_checklist.isEmpty)
            Text('Esta visita não tem checklist.', style: texto.bodyMedium),
          for (final i in _checklist) ...[
            Text(i.rotulo, style: texto.titleMedium),
            if (i.artigo != null)
              Text(i.artigo!,
                  style: texto.bodySmall?.copyWith(color: Cores.tinta2)),
            const SizedBox(height: 8),
            SizedBox(
              width: double.infinity,
              child: SegmentedButton<String>(
                showSelectedIcon: false,
                emptySelectionAllowed: true,
                segments: const [
                  ButtonSegment(value: 'sim', label: Text('Sim')),
                  ButtonSegment(value: 'nao', label: Text('Não')),
                  ButtonSegment(value: 'na', label: Text('N/A')),
                ],
                selected: {if (i.resposta != null) i.resposta!},
                onSelectionChanged: editavel
                    ? (sel) => setState(
                        () => i.resposta = sel.isEmpty ? null : sel.first)
                    : null,
              ),
            ),
            if (i.naoConforme)
              const Padding(
                padding: EdgeInsets.only(top: 6),
                child: Pilula('Não conforme', tom: TomPilula.terracota),
              ),
            const SizedBox(height: 16),
          ],
        ]),
      );

  Widget _secaoRelatorio(TextTheme texto) => Cartao(
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          const Rotulo('Relatório ditado'),
          Text('Diga o que viu, como se estivesse a contar ao chefe. A câmara organiza o texto.',
              style: texto.bodyMedium?.copyWith(color: Cores.tinta2)),
          const SizedBox(height: 12),
          SizedBox(
            width: double.infinity,
            child: FilledButton.icon(
              style: FilledButton.styleFrom(
                backgroundColor: _aOuvir ? Cores.terracotaEscuro : Cores.tinta,
                minimumSize: const Size(alvoMinimo, 64),
              ),
              onPressed: _ditar,
              icon: Icon(_aOuvir ? Icons.stop_rounded : Icons.mic_rounded, size: 30),
              label: Text(_aOuvir ? 'A ouvir… toque para parar' : 'Ditar relatório'),
            ),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _relatorio,
            minLines: 4,
            maxLines: 12,
            textCapitalization: TextCapitalization.sentences,
            decoration: const InputDecoration(
              labelText: 'Relatório',
              alignLabelWithHint: true,
            ),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _notas,
            minLines: 2,
            maxLines: 6,
            textCapitalization: TextCapitalization.sentences,
            decoration: const InputDecoration(
              labelText: 'Notas (opcional)',
              alignLabelWithHint: true,
            ),
          ),
          const SizedBox(height: 16),
          OutlinedButton.icon(
            onPressed: _guardarRelatorio,
            icon: const Icon(Icons.save_outlined),
            label: const Text('Guardar relatório'),
          ),
          const SizedBox(height: 10),
          FilledButton.icon(
            onPressed: _concluir,
            icon: const Icon(Icons.task_alt_rounded),
            label: const Text('Concluir visita'),
          ),
        ]),
      );
}
