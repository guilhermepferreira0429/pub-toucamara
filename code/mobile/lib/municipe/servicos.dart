import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;

import '../comum/api/cliente_api.dart';
import '../comum/armazenamento/armazem.dart';
import '../comum/armazenamento/ficheiros.dart';
import '../comum/definicoes.dart';
import '../comum/fila/fila_offline.dart';
import '../comum/localizacao/localizacao.dart';
import '../comum/plataforma/camara.dart';
import '../comum/plataforma/ditado.dart';
import 'chat.dart';
import 'config.dart';
import 'notificacoes.dart';
import 'notificacoes_fcm.dart';
import 'reportar.dart';
import 'repositorio.dart';
import 'sessao.dart';

/// O tamanho da letra escolhido na app (por cima do do telemóvel).
class Letra extends ChangeNotifier {
  Letra(this._armazem);
  static const _chave = 'letra_escala';
  static const opcoes = [1.0, 1.15, 1.3, 1.5];
  final Armazem _armazem;
  double escala = 1.0;

  Future<void> carregar() async {
    escala = double.tryParse(await _armazem.ler(_chave) ?? '') ?? 1.0;
    notifyListeners();
  }

  Future<void> mudar(double e) async {
    escala = e;
    await _armazem.escrever(_chave, '$e');
    notifyListeners();
  }
}

/// Os separadores da app e o navegador (para abrir os links das notificações).
class Navegacao {
  final chave = GlobalKey<NavigatorState>();
  final separador = ValueNotifier<int>(0);

  static const inicio = 0;
  static const perto = 1;
  static const assuntos = 2;
  static const avisos = 3;
  static const definicoes = 4;
}

/// Tudo o que os ecrãs da app do munícipe usam (trocado nos testes).
class ServicosMunicipe {
  ServicosMunicipe({
    required this.definicoes,
    required this.api,
    required this.sessao,
    required this.fila,
    required this.repositorio,
    required this.reportar,
    required this.localizador,
    required this.camara,
    required this.ditado,
    required this.notificacoes,
    required this.letra,
  });

  final Definicoes definicoes;
  final ClienteApi api;
  final ControladorSessaoMunicipe sessao;
  final FilaOffline fila;
  final RepositorioMunicipe repositorio;
  final ServicoReportar reportar;
  final Localizador localizador;
  final Camara camara;
  final Ditado ditado;
  final Notificacoes notificacoes;
  final Letra letra;
  final Navegacao navegacao = Navegacao();

  String get municipio => definicoes.municipio.trim().isEmpty
      ? ConfigMunicipe.municipio
      : definicoes.municipio.trim();

  ControladorChat novoChat() =>
      ControladorChat(repositorio: repositorio, api: api);

  static Future<ServicosMunicipe> criar() async {
    final prefs = ArmazemPreferencias();
    return montar(
      prefs: prefs,
      seguro: ArmazemSeguro(),
      ficheiros: GuardaFicheiros.daPlataforma(prefs),
      localizador: LocalizadorGps(),
      ditado: DitadoSistema(),
      notificacoes: ConfigMunicipe.fcm
          ? NotificacoesFcm(prefs)
          : NotificacoesSemFirebase(),
    );
  }

  static Future<ServicosMunicipe> montar({
    required Armazem prefs,
    required Armazem seguro,
    required GuardaFicheiros ficheiros,
    required Localizador localizador,
    required Ditado ditado,
    Notificacoes? notificacoes,
    Camara? camara,
    http.Client? cliente,
  }) async {
    final definicoes = Definicoes(prefs);
    await definicoes.carregar();
    final api = ClienteApi(
      servidor: () => definicoes.servidor,
      cliente: cliente,
    );
    String municipio() => definicoes.municipio.trim().isEmpty
        ? ConfigMunicipe.municipio
        : definicoes.municipio.trim();
    final sessao = ControladorSessaoMunicipe(
      api: api,
      armazemSeguro: seguro,
      municipio: municipio,
    );
    final fila = FilaOffline(
      armazem: prefs,
      ficheiros: ficheiros,
      api: api,
      dono: () => sessao.sessao?.sessaoId,
      // Sem armazenamento de fotografias na câmara: a ocorrência fica, a
      // fotografia fica "com problema" e não prende o resto.
      codigosDefinitivos: const {'armazenamento_indisponivel'},
    );
    final repositorio = RepositorioMunicipe(
      api: api,
      cache: prefs,
      municipio: municipio,
      dono: () => sessao.sessao?.sessaoId,
    );
    final notif = notificacoes ?? NotificacoesSemFirebase();
    sessao.antesDeSair = () async {
      await notif.desregistar(api);
      await repositorio.limpar(RepositorioMunicipe.chavesCache);
    };
    sessao.addListener(() {
      if (sessao.estado == EstadoSessao.dentro) fila.enviar();
    });
    final letra = Letra(prefs);
    await Future.wait([sessao.carregar(), fila.carregar(), letra.carregar()]);
    return ServicosMunicipe(
      definicoes: definicoes,
      api: api,
      sessao: sessao,
      fila: fila,
      repositorio: repositorio,
      reportar: ServicoReportar(fila),
      localizador: localizador,
      camara: camara ?? CamaraSistema(localizador),
      ditado: ditado,
      notificacoes: notif,
      letra: letra,
    );
  }
}

/// `ServicosMunicipe.de(context)` em qualquer ecrã.
class FornecedorMunicipe extends InheritedWidget {
  const FornecedorMunicipe({
    super.key,
    required this.servicos,
    required super.child,
  });
  final ServicosMunicipe servicos;

  static ServicosMunicipe de(BuildContext context) => context
      .dependOnInheritedWidgetOfExactType<FornecedorMunicipe>()!
      .servicos;

  @override
  bool updateShouldNotify(FornecedorMunicipe oldWidget) =>
      servicos != oldWidget.servicos;
}
