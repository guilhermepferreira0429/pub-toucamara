import 'package:flutter/material.dart';

import '../../comum/api/cliente_api.dart';
import '../../comum/componentes/componentes.dart';
import '../../comum/tema.dart';
import '../cartas.dart';
import '../componentes.dart';
import '../servicos.dart';

/// "Não percebi uma carta": fotografar (câmara ou galeria) ou enviar o PDF,
/// e as cartas que a pessoa já mandou.
class EcraCartaNova extends StatefulWidget {
  const EcraCartaNova({super.key});

  @override
  State<EcraCartaNova> createState() => _EcraCartaNovaState();
}

class _EcraCartaNovaState extends State<EcraCartaNova> {
  bool _aLer = false;
  String? _erro;
  Future<List<CartaResumo>>? _minhas;

  ServicoCartas get _cartas =>
      ServicoCartas(FornecedorMunicipe.de(context).api);

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _minhas ??= _cartas.minhas();
  }

  Future<void> _fotografar({required bool daGaleria}) async {
    final s = FornecedorMunicipe.de(context);
    setState(() => _erro = null);
    final foto = await s.camara.tirar(daGaleria: daGaleria);
    if (foto == null || !mounted) return;
    setState(() => _aLer = true);
    try {
      final carta = await _cartas.enviar(foto.bytes, foto.mime);
      if (!mounted) return;
      await Navigator.of(
        context,
      ).push(MaterialPageRoute(builder: (_) => EcraCarta(inicial: carta)));
      if (mounted) setState(() => _minhas = _cartas.minhas());
    } on Object catch (e) {
      if (mounted) setState(() => _erro = _mensagem(e));
    } finally {
      if (mounted) setState(() => _aLer = false);
    }
  }

  /// O PDF escolhe-se na página da carta (o seletor de ficheiros do site).
  Future<void> _pdf() async {
    setState(() => _erro = null);
    try {
      final carta = await _cartas.criarAEspera();
      if (mounted) await abrirFora(context, carta.link);
    } on Object catch (e) {
      if (mounted) setState(() => _erro = _mensagem(e));
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    return Scaffold(
      appBar: AppBar(title: const Text('Não percebi uma carta')),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 32),
        children: [
          Semantics(
            header: true,
            child: Text('Mostre-nos a carta', style: t.headlineMedium),
          ),
          const SizedBox(height: 8),
          Text(
            'Tire uma fotografia à carta da câmara que não percebe. Explicamos o '
            'que quer dizer, até quando tem para responder e ajudamos a '
            'preparar a resposta.',
            style: t.bodyLarge?.copyWith(color: Cores.tinta2),
          ),
          const SizedBox(height: 16),
          const Cartao(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('• A carta toda, com boa luz.'),
                SizedBox(height: 4),
                Text('• Sem reflexos nem dedos por cima do texto.'),
                SizedBox(height: 4),
                Text('• Se tiver várias folhas, a que tem o prazo.'),
              ],
            ),
          ),
          const SizedBox(height: 16),
          if (_aLer)
            Semantics(
              liveRegion: true,
              child: const Padding(
                padding: EdgeInsets.all(24),
                child: Column(
                  children: [
                    CircularProgressIndicator(),
                    SizedBox(height: 12),
                    Text('A ler a carta…'),
                  ],
                ),
              ),
            )
          else ...[
            BotaoLargo(
              icone: Icons.photo_camera_rounded,
              texto: 'Tirar fotografia',
              onPressed: () => _fotografar(daGaleria: false),
            ),
            const SizedBox(height: 10),
            BotaoLargo(
              icone: Icons.photo_library_rounded,
              texto: 'Escolher da galeria',
              contorno: true,
              onPressed: () => _fotografar(daGaleria: true),
            ),
            const SizedBox(height: 10),
            BotaoLargo(
              icone: Icons.picture_as_pdf_rounded,
              texto: 'Tenho a carta em PDF',
              contorno: true,
              onPressed: _pdf,
            ),
          ],
          if (_erro != null) ...[const SizedBox(height: 12), ErroLinha(_erro!)],
          const SizedBox(height: 24),
          FutureBuilder<List<CartaResumo>>(
            future: _minhas,
            builder: (context, s) {
              final lista = s.data ?? const <CartaResumo>[];
              if (lista.isEmpty) return const SizedBox.shrink();
              return Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  const Rotulo('As suas cartas'),
                  for (final c in lista)
                    Cartao(
                      onTap: () => Navigator.of(context).push(
                        MaterialPageRoute(
                          builder: (_) => EcraCarta(codigo: c.codigo),
                        ),
                      ),
                      child: Row(
                        children: [
                          const Icon(Icons.mail_outline_rounded),
                          const SizedBox(width: 12),
                          Expanded(
                            child: Text(
                              c.assunto ??
                                  (c.estado == 'a_espera'
                                      ? 'À espera da fotografia'
                                      : 'Carta'),
                            ),
                          ),
                          if (c.estado == 'respondida')
                            const Pilula('Respondida', tom: TomPilula.verde)
                          else if (c.dataLimite != null)
                            Pilula(
                              'Até ${diaLongo(c.dataLimite)}',
                              tom: TomPilula.terracota,
                            ),
                        ],
                      ),
                    ),
                ],
              );
            },
          ),
          const SizedBox(height: 16),
          Text(
            'A fotografia serve só para lermos a carta. Não guardamos o seu NIF '
            'nem outros dados pessoais que lá apareçam.',
            style: t.bodySmall?.copyWith(color: Cores.tinta3),
          ),
        ],
      ),
    );
  }
}

String _mensagem(Object e) {
  if (e is SemRede) {
    return 'Sem rede: para ler a carta precisamos de internet. Tente quando tiver ligação.';
  }
  return mensagemDe(e);
}

/// A carta explicada: o que é, até quando, o que acontece se não fizer
/// nada, o processo e a resposta (rascunho → confirmar).
class EcraCarta extends StatefulWidget {
  const EcraCarta({super.key, this.inicial, this.codigo})
    : assert(inicial != null || codigo != null);
  final Carta? inicial;
  final String? codigo;

  @override
  State<EcraCarta> createState() => _EcraCartaState();
}

class _EcraCartaState extends State<EcraCarta> {
  Carta? _carta;
  String? _erro;
  bool _ocupado = false;

  ServicoCartas get _cartas =>
      ServicoCartas(FornecedorMunicipe.de(context).api);

  @override
  void initState() {
    super.initState();
    _carta = widget.inicial;
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_carta == null && widget.codigo != null && !_ocupado) {
      _correr(() => _cartas.ver(widget.codigo!));
    }
  }

  Future<void> _correr(Future<Carta> Function() f) async {
    setState(() {
      _ocupado = true;
      _erro = null;
    });
    try {
      final c = await f();
      if (mounted) setState(() => _carta = c);
    } on Object catch (e) {
      if (mounted) setState(() => _erro = _mensagem(e));
    } finally {
      if (mounted) setState(() => _ocupado = false);
    }
  }

  Future<void> _escolherDia() async {
    final hoje = DateTime.now();
    final dia = await showDatePicker(
      context: context,
      initialDate: hoje,
      firstDate: hoje.subtract(const Duration(days: 365)),
      lastDate: hoje,
      helpText: 'Em que dia recebeu a carta?',
    );
    if (dia != null) {
      await _correr(() => _cartas.rececao(_carta!.codigo, dia));
    }
  }

  Future<void> _preparar(String tipo, String rotulo) async {
    String? argumentos;
    if (tipo == 'pronuncia' || tipo == 'prorrogacao') {
      argumentos = await _pedirTexto(
        tipo == 'pronuncia'
            ? 'Por palavras suas: porque não concorda?'
            : 'Porque precisa de mais tempo?',
      );
      if (argumentos == null) return;
    }
    await _correr(
      () => _cartas.preparar(_carta!.codigo, tipo, argumentos: argumentos),
    );
  }

  Future<String?> _pedirTexto(String pergunta) {
    final c = TextEditingController();
    return showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(pergunta),
        content: TextField(
          controller: c,
          maxLines: 5,
          maxLength: 3000,
          decoration: const InputDecoration(
            hintText: 'Escreva como falaria. Nós pomos em linguagem formal.',
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Cancelar'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, c.text),
            child: const Text('Preparar'),
          ),
        ],
      ),
    );
  }

  Future<void> _entregar(RespostaCarta r) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Entregar a resposta?'),
        content: const Text(
          'Leu o texto e quer que seja entregue à câmara em seu nome? '
          '(Entrega simulada, sem valor legal.)',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Ainda não'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Sim, entregar'),
          ),
        ],
      ),
    );
    if (ok == true) {
      await _correr(() => _cartas.entregar(_carta!.codigo, r.id));
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = _carta;
    return Scaffold(
      appBar: AppBar(title: const Text('A sua carta')),
      body: c == null
          ? (_erro != null
                ? ListView(
                    padding: const EdgeInsets.all(16),
                    children: [ErroLinha(_erro!)],
                  )
                : const Center(child: CircularProgressIndicator()))
          : _conteudo(context, c),
    );
  }

  Widget _conteudo(BuildContext context, Carta c) {
    final t = Theme.of(context).textTheme;
    final l = c.leitura;
    final filhos = <Widget>[];
    void secao(String titulo, List<Widget> corpo) {
      filhos
        ..add(const SizedBox(height: 20))
        ..add(Semantics(header: true, child: Text(titulo, style: t.titleLarge)))
        ..add(const SizedBox(height: 8))
        ..addAll(corpo);
    }

    if (c.estado == 'a_espera' || l == null) {
      filhos.add(
        EstadoVazio(
          'Ainda não recebemos a fotografia desta carta.',
          icone: Icons.hourglass_empty_rounded,
        ),
      );
      filhos.add(
        BotaoLargo(
          icone: Icons.open_in_new_rounded,
          texto: 'Enviar pela página',
          onPressed: () => abrirFora(context, c.link),
        ),
      );
    } else if (c.estado == 'ilegivel') {
      filhos.add(
        ErroLinha(
          l.motivoIlegivel ??
              'Não conseguimos ler a carta. Tire outra fotografia.',
        ),
      );
    } else if (!c.daCamara) {
      filhos
        ..add(Text('Esta carta não é da câmara.', style: t.headlineMedium))
        ..add(const SizedBox(height: 8))
        ..add(
          Cartao(
            cor: Cores.tinta,
            child: Text(
              c.encaminhamento?.dizer ?? 'Só quem a mandou pode tratar dela.',
              style: const TextStyle(color: Colors.white, fontSize: 18),
            ),
          ),
        )
        ..add(const SizedBox(height: 8))
        ..add(Text(l.explicacao, style: t.bodyLarge));
    } else {
      filhos
        ..add(
          Semantics(
            header: true,
            child: Text(l.tipoRotulo, style: t.headlineMedium),
          ),
        )
        ..add(
          Text(l.assunto, style: t.bodyLarge?.copyWith(color: Cores.tinta2)),
        );
      if (c.demonstracao) {
        filhos
          ..add(const SizedBox(height: 8))
          ..add(
            const Align(
              alignment: Alignment.centerLeft,
              child: Pilula('Leitura de demonstração', tom: TomPilula.ambar),
            ),
          );
      }
      secao('O que quer dizer', [
        Text(l.explicacao, style: t.bodyLarge?.copyWith(fontSize: 19)),
        const SizedBox(height: 6),
        Text(l.oQueE, style: t.bodyMedium?.copyWith(color: Cores.tinta2)),
      ]);
      secao('Até quando tem', [_prazo(context, c)]);
      if (l.pedido.isNotEmpty) {
        secao('O que lhe pedem', [
          for (final p in l.pedido)
            Padding(
              padding: const EdgeInsets.only(bottom: 6),
              child: Text('• $p', style: t.bodyLarge),
            ),
        ]);
      }
      secao('Se não fizer nada', [
        for (final x in l.consequencias)
          Padding(
            padding: const EdgeInsets.only(bottom: 6),
            child: Text(
              x.daCarta
                  ? x.texto
                  : '${x.texto} (A carta não o diz: é a regra geral.)',
              style: t.bodyLarge,
            ),
          ),
      ]);
      if (l.termos.isNotEmpty) {
        secao('Palavras difíceis', [
          for (final x in l.termos)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Text.rich(
                TextSpan(
                  children: [
                    TextSpan(
                      text: '${x.termo}: ',
                      style: const TextStyle(fontWeight: FontWeight.w700),
                    ),
                    TextSpan(text: x.explicacao),
                  ],
                ),
                style: t.bodyLarge,
              ),
            ),
        ]);
      }
      if (c.processo != null) {
        secao('O seu processo', [
          Cartao(
            child: Text(
              '${c.processo!.numero} · o seu processo ${c.processo!.fase}.',
              style: t.bodyLarge,
            ),
          ),
        ]);
      }
      if (c.respostasPossiveis.isNotEmpty || c.respostas.isNotEmpty) {
        secao('Responder à câmara', [
          for (final r in c.respostas) _resposta(context, r),
          for (final o in c.respostasPossiveis)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: BotaoLargo(
                icone: Icons.edit_note_rounded,
                texto: o.rotulo,
                contorno: true,
                onPressed: _ocupado ? null : () => _preparar(o.tipo, o.rotulo),
              ),
            ),
        ]);
      }
    }
    if (_ocupado) {
      filhos.add(
        const Padding(
          padding: EdgeInsets.all(16),
          child: Center(child: CircularProgressIndicator()),
        ),
      );
    }
    if (_erro != null) {
      filhos
        ..add(const SizedBox(height: 12))
        ..add(ErroLinha(_erro!));
    }
    if (c.aviso != null) {
      filhos
        ..add(const SizedBox(height: 24))
        ..add(
          Text(c.aviso!, style: t.bodySmall?.copyWith(color: Cores.tinta3)),
        );
    }
    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 32),
      children: filhos,
    );
  }

  Widget _prazo(BuildContext context, Carta c) {
    final p = c.prazo;
    final t = Theme.of(context).textTheme;
    final cartao = p != null && p.calculado
        ? Cartao(
            cor: p.terminou ? Cores.tinta : Cores.terracota,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  p.terminou
                      ? 'Terminou a ${diaLongo(p.dataLimite)}'
                      : 'Até ${diaLongo(p.dataLimite)}',
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 24,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                if (!p.terminou && p.faltamDiasUteis != null)
                  Text(
                    p.faltamDias == 0
                        ? 'Termina hoje.'
                        : 'Faltam ${p.faltamDiasUteis} ${p.faltamDiasUteis == 1 ? 'dia útil' : 'dias úteis'}.',
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 18,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                const SizedBox(height: 6),
                Text(
                  p.regra,
                  style: const TextStyle(color: Colors.white, fontSize: 15),
                ),
              ],
            ),
          )
        : ErroLinha(
            p?.estado == 'falta_data'
                ? 'A carta dá ${p!.dias} dias a contar do dia em que a recebeu. Diga-nos esse dia.'
                : 'Não encontrámos um prazo escrito na carta. Não inventamos datas: diga-nos quando a recebeu ou confirme com a câmara.',
          );
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        cartao,
        if (c.leitura?.excertoPrazo != null) ...[
          const SizedBox(height: 6),
          Text(
            'Na carta: «${c.leitura!.excertoPrazo}»',
            style: t.bodyMedium?.copyWith(
              color: Cores.tinta2,
              fontStyle: FontStyle.italic,
            ),
          ),
        ],
        if (c.estado != 'respondida') ...[
          const SizedBox(height: 10),
          BotaoLargo(
            icone: Icons.event_rounded,
            texto: p != null && p.calculado
                ? 'Recebi noutro dia'
                : 'Em que dia a recebi?',
            contorno: true,
            onPressed: _ocupado ? null : _escolherDia,
          ),
          const SizedBox(height: 6),
          TextButton(
            onPressed: _ocupado
                ? null
                : () =>
                      _correr(() => _cartas.rececao(c.codigo, DateTime.now())),
            child: const Text('Recebi-a hoje'),
          ),
        ],
      ],
    );
  }

  Widget _resposta(BuildContext context, RespostaCarta r) {
    final t = Theme.of(context).textTheme;
    if (r.entregue) {
      return Cartao(
        cor: Cores.verdeSuave,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Resposta entregue',
              style: t.titleLarge?.copyWith(color: Cores.verde),
            ),
            Text('${r.rotulo}. N.º de entrada ${r.numeroEntrada ?? '—'}.'),
            const SizedBox(height: 6),
            const Pilula('Entrega simulada', tom: TomPilula.ambar),
          ],
        ),
      );
    }
    return Cartao(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text('Rascunho: ${r.rotulo}', style: t.titleMedium),
          const SizedBox(height: 8),
          SelectableText(r.texto, style: t.bodyMedium),
          const SizedBox(height: 12),
          if (r.tipo != 'pagamento') ...[
            OutlinedButton.icon(
              onPressed: () => abrirFora(context, _carta!.link),
              icon: const Icon(Icons.edit_rounded),
              label: const Text('Mudar o texto'),
            ),
            const SizedBox(height: 8),
            FilledButton.icon(
              onPressed: _ocupado ? null : () => _entregar(r),
              icon: const Icon(Icons.send_rounded),
              label: const Text('Confirmar e entregar'),
            ),
          ],
        ],
      ),
    );
  }
}
