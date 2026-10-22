import 'package:flutter/widgets.dart';
import 'package:http/http.dart' as http;

import '../comum/api/cliente_api.dart';
import '../comum/armazenamento/armazem.dart';
import '../comum/armazenamento/ficheiros.dart';
import '../comum/definicoes.dart';
import '../comum/fila/fila_offline.dart';
import '../comum/localizacao/localizacao.dart';
import '../comum/plataforma/camara.dart';
import '../comum/plataforma/ditado.dart';
import '../comum/sessao/sessao.dart';
import 'repositorio.dart';

/// Tudo o que os ecrãs usam, criado uma vez (e trocado nos testes).
class Servicos {
  Servicos({
    required this.definicoes,
    required this.api,
    required this.sessao,
    required this.fila,
    required this.repositorio,
    required this.localizador,
    required this.camara,
    required this.ditado,
  });

  final Definicoes definicoes;
  final ClienteApi api;
  final ControladorSessao sessao;
  final FilaOffline fila;
  final RepositorioEquipa repositorio;
  final Localizador localizador;
  final Camara camara;
  final Ditado ditado;

  /// Os serviços reais (Android/web).
  static Future<Servicos> criar() async {
    final prefs = ArmazemPreferencias();
    return montar(
      prefs: prefs,
      seguro: ArmazemSeguro(),
      ficheiros: GuardaFicheiros.daPlataforma(prefs),
      localizador: LocalizadorGps(),
      ditado: DitadoSistema(),
    );
  }

  static Future<Servicos> montar({
    required Armazem prefs,
    required Armazem seguro,
    required GuardaFicheiros ficheiros,
    required Localizador localizador,
    required Ditado ditado,
    Camara? camara,
    http.Client? cliente,
  }) async {
    final definicoes = Definicoes(prefs);
    await definicoes.carregar();
    final api = ClienteApi(
      servidor: () => definicoes.servidor,
      cliente: cliente,
    );
    api.municipio = definicoes.municipio;
    definicoes.addListener(() => api.municipio = definicoes.municipio);
    final sessao = ControladorSessao(api: api, armazemSeguro: seguro);
    final fila = FilaOffline(
      armazem: prefs,
      ficheiros: ficheiros,
      api: api,
      dono: () => sessao.sessao?.utilizadorId,
    );
    final repositorio = RepositorioEquipa(
      api: api,
      fila: fila,
      cache: prefs,
      localizador: localizador,
      dono: () => sessao.sessao?.utilizadorId,
    );
    // Entrou (outra vez): envia o que ficou guardado desta pessoa. Saiu:
    // esquece as tarefas em memória.
    sessao.addListener(() {
      if (sessao.estado == EstadoSessao.dentro) fila.enviar();
      if (sessao.estado == EstadoSessao.fora) repositorio.limpar();
    });
    await Future.wait([sessao.carregar(), fila.carregar()]);
    return Servicos(
      definicoes: definicoes,
      api: api,
      sessao: sessao,
      fila: fila,
      repositorio: repositorio,
      localizador: localizador,
      camara: camara ?? CamaraSistema(localizador),
      ditado: ditado,
    );
  }
}

/// Dá acesso aos [Servicos] em qualquer ecrã: `Servicos.de(context)`.
class FornecedorServicos extends InheritedWidget {
  const FornecedorServicos({
    super.key,
    required this.servicos,
    required super.child,
  });
  final Servicos servicos;

  static Servicos de(BuildContext context) => context
      .dependOnInheritedWidgetOfExactType<FornecedorServicos>()!
      .servicos;

  @override
  bool updateShouldNotify(FornecedorServicos oldWidget) =>
      servicos != oldWidget.servicos;
}
