import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';

import '../comum/sessao/sessao.dart';
import '../comum/tema.dart';
import 'ecras/entrar.dart';
import 'ecras/hoje.dart';
import 'servicos.dart';

/// "Tou, Câmara · Equipa": a app da equipa de campo.
class AppEquipa extends StatefulWidget {
  const AppEquipa({super.key, required this.servicos});
  final Servicos servicos;

  @override
  State<AppEquipa> createState() => _AppEquipaState();
}

class _AppEquipaState extends State<AppEquipa> with WidgetsBindingObserver {
  final _navegador = GlobalKey<NavigatorState>();

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    widget.servicos.fila.iniciar();
    widget.servicos.sessao.addListener(_aoMudarSessao);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    widget.servicos.sessao.removeListener(_aoMudarSessao);
    widget.servicos.fila.parar();
    super.dispose();
  }

  /// Sessão terminada (sair, ou revogada noutro sítio): fecha os ecrãs
  /// abertos e volta a "Entrar".
  void _aoMudarSessao() {
    if (widget.servicos.sessao.estado == EstadoSessao.fora) {
      _navegador.currentState?.popUntil((r) => r.isFirst);
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    // Ao voltar à app (pode ter apanhado rede entretanto).
    if (state == AppLifecycleState.resumed) widget.servicos.fila.enviar();
  }

  @override
  Widget build(BuildContext context) {
    final s = widget.servicos;
    return FornecedorServicos(
      servicos: s,
      child: MaterialApp(
        navigatorKey: _navegador,
        title: 'Tou, Câmara · Equipa',
        debugShowCheckedModeBanner: false,
        theme: temaToucamara(),
        locale: const Locale('pt', 'PT'),
        supportedLocales: const [Locale('pt', 'PT')],
        localizationsDelegates: GlobalMaterialLocalizations.delegates,
        home: ListenableBuilder(
          listenable: s.sessao,
          builder: (context, _) => switch (s.sessao.estado) {
            EstadoSessao.aCarregar => const Scaffold(
              body: Center(child: CircularProgressIndicator()),
            ),
            EstadoSessao.fora => const EcraEntrar(),
            EstadoSessao.dentro => const EcraHoje(),
          },
        ),
      ),
    );
  }
}
