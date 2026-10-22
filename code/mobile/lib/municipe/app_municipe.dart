import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';

import '../comum/componentes/componentes.dart';
import '../comum/tema.dart';
import 'componentes.dart';
import 'ecras/assuntos.dart';
import 'ecras/avisos.dart';
import 'ecras/definicoes.dart';
import 'ecras/entrar.dart';
import 'ecras/inicio.dart';
import 'ecras/perto.dart';
import 'notificacoes.dart';
import 'sessao.dart';
import 'servicos.dart';

/// "Tou, Câmara": a app dos munícipes.
class AppMunicipe extends StatefulWidget {
  const AppMunicipe({super.key, required this.servicos});
  final ServicosMunicipe servicos;

  @override
  State<AppMunicipe> createState() => _AppMunicipeState();
}

class _AppMunicipeState extends State<AppMunicipe> with WidgetsBindingObserver {
  final _mensageiro = GlobalKey<ScaffoldMessengerState>();
  ServicosMunicipe get s => widget.servicos;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    s.fila.iniciar();
    s.sessao.addListener(_aoMudarSessao);
    s.notificacoes.iniciar(aoAbrir: abrirLink, aoReceber: _aoReceber);
    if (s.sessao.estado == EstadoSessao.dentro) {
      s.notificacoes.registar(s.api);
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    s.sessao.removeListener(_aoMudarSessao);
    s.fila.parar();
    super.dispose();
  }

  void _aoMudarSessao() {
    if (s.sessao.estado == EstadoSessao.fora) {
      s.navegacao.chave.currentState?.popUntil((r) => r.isFirst);
      s.navegacao.separador.value = Navegacao.inicio;
    } else if (s.sessao.estado == EstadoSessao.dentro) {
      s.notificacoes.registar(s.api);
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) s.fila.enviar();
  }

  /// Um push com a app aberta: aparece em baixo, com "Ver".
  void _aoReceber(NotificacaoRecebida n) {
    _mensageiro.currentState
      ?..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(
          duration: const Duration(seconds: 8),
          content: Text('${n.titulo}\n${n.corpo}'),
          action: n.link == null
              ? null
              : SnackBarAction(
                  label: 'Ver',
                  onPressed: () => abrirLink(n.link!),
                ),
        ),
      );
  }

  /// O `data.link` de um push: `/processos/<id>`, `/avisos`, ou uma página.
  void abrirLink(String link) {
    final nav = s.navegacao;
    if (s.sessao.estado != EstadoSessao.dentro) return;
    final processo = RegExp(
      r'^/processos/([0-9a-fA-F-]{36})$',
    ).firstMatch(link);
    if (processo != null) {
      nav.separador.value = Navegacao.assuntos;
      nav.chave.currentState?.push(
        MaterialPageRoute(builder: (_) => EcraProcesso(id: processo[1]!)),
      );
      return;
    }
    final separador = switch (link) {
      '/avisos' => Navegacao.avisos,
      '/processos' || '/assuntos' => Navegacao.assuntos,
      '/agora' || '/perto' => Navegacao.perto,
      '/' || '/inicio' => Navegacao.inicio,
      _ => null,
    };
    if (separador != null) {
      nav.chave.currentState?.popUntil((r) => r.isFirst);
      nav.separador.value = separador;
      return;
    }
    final ctx = nav.chave.currentContext;
    if (ctx != null && link.startsWith('http')) abrirFora(ctx, link);
  }

  @override
  Widget build(BuildContext context) {
    return FornecedorMunicipe(
      servicos: s,
      child: ListenableBuilder(
        listenable: s.letra,
        builder: (context, _) => MaterialApp(
          navigatorKey: s.navegacao.chave,
          scaffoldMessengerKey: _mensageiro,
          title: 'Tou, Câmara',
          debugShowCheckedModeBanner: false,
          theme: temaToucamara(),
          locale: const Locale('pt', 'PT'),
          supportedLocales: const [Locale('pt', 'PT')],
          localizationsDelegates: GlobalMaterialLocalizations.delegates,
          // A letra do telemóvel vezes a escolhida na app (Definições).
          builder: (context, child) {
            final mq = MediaQuery.of(context);
            final base = mq.textScaler.scale(1);
            return MediaQuery(
              data: mq.copyWith(
                textScaler: TextScaler.linear(base * s.letra.escala),
              ),
              child: child!,
            );
          },
          home: ListenableBuilder(
            listenable: s.sessao,
            builder: (context, _) => switch (s.sessao.estado) {
              EstadoSessao.aCarregar => const Scaffold(
                body: Center(child: CircularProgressIndicator()),
              ),
              EstadoSessao.fora => const EcraEntrar(),
              EstadoSessao.dentro => const EcraPrincipal(),
            },
          ),
        ),
      ),
    );
  }
}

/// Os cinco separadores.
class EcraPrincipal extends StatelessWidget {
  const EcraPrincipal({super.key});

  @override
  Widget build(BuildContext context) {
    final s = FornecedorMunicipe.de(context);
    return ValueListenableBuilder<int>(
      valueListenable: s.navegacao.separador,
      builder: (context, i, _) => Scaffold(
        body: Column(
          children: [
            Expanded(
              child: IndexedStack(
                index: i,
                children: const [
                  EcraInicio(),
                  EcraPerto(),
                  EcraAssuntos(),
                  EcraAvisos(),
                  EcraDefinicoes(),
                ],
              ),
            ),
            SafeArea(
              top: false,
              bottom: false,
              child: IndicadorFila(
                fila: s.fila,
                aoAbrir: () => abrirFila(context),
              ),
            ),
          ],
        ),
        // Os nomes dos separadores não crescem (com os ícones, não cabiam cinco).
        bottomNavigationBar: MediaQuery.withClampedTextScaling(
          maxScaleFactor: 1.0,
          child: NavigationBar(
            selectedIndex: i,
            onDestinationSelected: (n) => s.navegacao.separador.value = n,
            destinations: const [
              NavigationDestination(
                icon: Icon(Icons.home_outlined),
                selectedIcon: Icon(Icons.home_rounded),
                label: 'Início',
              ),
              NavigationDestination(
                icon: Icon(Icons.place_outlined),
                selectedIcon: Icon(Icons.place_rounded),
                label: 'Perto',
              ),
              NavigationDestination(
                icon: Icon(Icons.folder_outlined),
                selectedIcon: Icon(Icons.folder_rounded),
                label: 'Assuntos',
              ),
              NavigationDestination(
                icon: Icon(Icons.notifications_outlined),
                selectedIcon: Icon(Icons.notifications_rounded),
                label: 'Avisos',
              ),
              NavigationDestination(
                icon: Icon(Icons.settings_outlined),
                selectedIcon: Icon(Icons.settings_rounded),
                label: 'Definições',
              ),
            ],
          ),
        ),
      ),
    );
  }
}

void abrirFila(BuildContext context) => Navigator.of(
  context,
).push(MaterialPageRoute(builder: (_) => const EcraPorEnviar()));

/// Usado por vários ecrãs: muda de separador.
void irPara(BuildContext context, int separador) {
  final s = FornecedorMunicipe.de(context);
  Navigator.of(context).popUntil((r) => r.isFirst);
  s.navegacao.separador.value = separador;
}
