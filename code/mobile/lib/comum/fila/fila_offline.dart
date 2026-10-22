import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:uuid/uuid.dart';

import '../api/cliente_api.dart';
import '../armazenamento/armazem.dart';
import '../armazenamento/ficheiros.dart';

enum TipoAcao {
  /// Um pedido JSON à API (POST/PATCH).
  pedido,

  /// Uma fotografia: pede a URL assinada à API e envia o ficheiro (PUT).
  ficheiro,
}

enum EstadoAcao { pendente, falhou }

/// Uma ação feita no terreno, à espera de ser enviada. O `id` é a
/// Idempotency-Key: reenviar depois de uma resposta perdida não repete a
/// ação na API.
class Acao {
  Acao({
    required this.id,
    required this.tipo,
    required this.descricao,
    required this.alvo,
    required this.metodo,
    required this.caminho,
    this.corpo,
    this.ficheiroRef,
    this.usarResultados = const {},
    required this.criadaEm,
    this.tentativas = 0,
    this.ultimoErro,
    this.estado = EstadoAcao.pendente,
    this.intermedio,
    this.renovacoes = 0,
    this.dono,
  });

  /// Quem fez (id do utilizador): só se envia com a sessão dessa pessoa.
  final String? dono;

  final String id;
  final TipoAcao tipo;

  /// "Fechar a ocorrência OC-2026-0012" (para o ecrã da fila).
  final String descricao;

  /// A tarefa a que pertence (id da visita ou da ocorrência).
  final String alvo;
  final String metodo;
  final String caminho;
  final Map<String, dynamic>? corpo;

  /// A fotografia guardada no telemóvel ([GuardaFicheiros]).
  final String? ficheiroRef;

  /// Campo do corpo → ações de fotografia cujo `foto_id` entra nele (ex.:
  /// `foto_ids` do fecho), resolvido na hora de enviar.
  final Map<String, List<String>> usarResultados;
  final DateTime criadaEm;
  int tentativas;
  String? ultimoErro;
  EstadoAcao estado;

  /// Passo 1 da fotografia já feito: `{foto_id, url_envio, cabecalhos}`.
  Map<String, dynamic>? intermedio;

  /// Quantas vezes se pediu outra URL (a assinada expira em 10 minutos).
  int renovacoes;

  /// A chave enviada à API (muda só quando a URL assinada expira).
  String get chave => renovacoes == 0 ? id : '$id-r$renovacoes';

  Map<String, dynamic> paraJson() => {
        'id': id,
        'tipo': tipo.name,
        'descricao': descricao,
        'alvo': alvo,
        'metodo': metodo,
        'caminho': caminho,
        'corpo': corpo,
        'ficheiro_ref': ficheiroRef,
        'usar_resultados': usarResultados,
        'criada_em': criadaEm.toIso8601String(),
        'tentativas': tentativas,
        'ultimo_erro': ultimoErro,
        'estado': estado.name,
        'intermedio': intermedio,
        'renovacoes': renovacoes,
        'dono': dono,
      };

  factory Acao.deJson(Map<String, dynamic> j) => Acao(
        id: j['id'] as String,
        tipo: TipoAcao.values.byName(j['tipo'] as String),
        descricao: j['descricao'] as String,
        alvo: j['alvo'] as String,
        metodo: j['metodo'] as String,
        caminho: j['caminho'] as String,
        corpo: (j['corpo'] as Map?)?.cast<String, dynamic>(),
        ficheiroRef: j['ficheiro_ref'] as String?,
        usarResultados: ((j['usar_resultados'] as Map?) ?? const {}).map(
            (k, v) => MapEntry(k as String, (v as List).cast<String>())),
        criadaEm: DateTime.parse(j['criada_em'] as String),
        tentativas: (j['tentativas'] as num?)?.toInt() ?? 0,
        ultimoErro: j['ultimo_erro'] as String?,
        estado: EstadoAcao.values.byName(j['estado'] as String? ?? 'pendente'),
        intermedio: (j['intermedio'] as Map?)?.cast<String, dynamic>(),
        renovacoes: (j['renovacoes'] as num?)?.toInt() ?? 0,
        dono: j['dono'] as String?,
      );
}

/// O resultado de uma volta de envio.
class ResultadoEnvio {
  const ResultadoEnvio(
      {this.enviadas = 0, this.falharam = 0, this.semRede = false});
  final int enviadas;
  final int falharam;

  /// Parou por falta de rede ou servidor indisponível (fica para depois).
  final bool semRede;
}

/// Fila persistente do que se faz sem rede. Envia por ordem; pára na
/// primeira falha de rede (ou servidor indisponível) e tenta outra vez mais
/// tarde; um erro definitivo (4xx) fica marcado e não bloqueia as outras.
class FilaOffline extends ChangeNotifier {
  FilaOffline({
    required Armazem armazem,
    required this.ficheiros,
    required this.api,
    Duration intervalo = const Duration(seconds: 30),
    DateTime Function()? relogio,
    String? Function()? dono,
  })  : _armazem = armazem,
        _dono = dono ?? (() => null),
        _intervalo = intervalo,
        _relogio = relogio ?? DateTime.now;

  static const _chave = 'fila_v1';
  static const _uuid = Uuid();

  final Armazem _armazem;
  final GuardaFicheiros ficheiros;
  final ClienteApi api;
  final Duration _intervalo;
  final DateTime Function() _relogio;
  final String? Function() _dono;

  final List<Acao> _acoes = [];
  final Map<String, Map<String, dynamic>> _resultados = {};
  Timer? _temporizador;
  Future<ResultadoEnvio>? _aEnviar;

  /// Chamado quando uma ação chega à API (para atualizar a cache).
  void Function(Acao acao, dynamic resposta)? aoEnviar;

  /// A última falha de rede (para o indicador).
  String? ultimaFalhaRede;
  DateTime? ultimaTentativa;

  bool _minha(Acao a) => a.dono == null || a.dono == _dono();

  /// As ações de quem tem a sessão aberta (as de outra pessoa que usou este
  /// telemóvel ficam guardadas até ela voltar a entrar).
  List<Acao> get acoes => List.unmodifiable(_acoes.where(_minha));
  int get porEnviar => _acoes.where(_minha).length;
  int get falhadas => _acoes
      .where((a) => _minha(a) && a.estado == EstadoAcao.falhou)
      .length;
  bool get aEnviar => _aEnviar != null;

  /// Tem ações por enviar desta tarefa?
  bool temPendentes(String alvo) =>
      _acoes.any((a) => _minha(a) && a.alvo == alvo);
  List<Acao> daTarefa(String alvo) =>
      _acoes.where((a) => _minha(a) && a.alvo == alvo).toList();

  Future<void> carregar() async {
    final t = await _armazem.ler(_chave);
    _acoes.clear();
    _resultados.clear();
    if (t != null) {
      try {
        final j = jsonDecode(t) as Map<String, dynamic>;
        _acoes.addAll((j['acoes'] as List)
            .map((a) => Acao.deJson((a as Map).cast<String, dynamic>())));
        _resultados.addAll(((j['resultados'] as Map?) ?? const {}).map(
            (k, v) => MapEntry(k as String, (v as Map).cast<String, dynamic>())));
      } on Object catch (e) {
        debugPrint('Fila ilegível, recomeça vazia: $e');
      }
    }
    notifyListeners();
  }

  Future<void> _guardar() async {
    // Só os resultados que alguma ação ainda vai usar.
    final usados = _acoes.expand((a) => a.usarResultados.values.expand((x) => x)).toSet();
    _resultados.removeWhere((k, _) => !usados.contains(k));
    await _armazem.escrever(
      _chave,
      jsonEncode({
        'acoes': _acoes.map((a) => a.paraJson()).toList(),
        'resultados': _resultados,
      }),
    );
  }

  /// Junta um pedido JSON à fila e tenta enviar logo.
  Future<Acao> pedido({
    required String descricao,
    required String alvo,
    required String metodo,
    required String caminho,
    Map<String, dynamic>? corpo,
    Map<String, List<String>> usarResultados = const {},
    bool enviarJa = true,
  }) =>
      _juntar(
        Acao(
          id: _uuid.v4(),
          tipo: TipoAcao.pedido,
          descricao: descricao,
          alvo: alvo,
          metodo: metodo,
          caminho: caminho,
          corpo: corpo,
          usarResultados: usarResultados,
          criadaEm: _relogio(),
          dono: _dono(),
        ),
        enviarJa,
      );

  /// Junta uma fotografia (guardada já no telemóvel) e tenta enviar logo.
  Future<Acao> ficheiro({
    required String descricao,
    required String alvo,
    required String caminho,
    required Map<String, dynamic> corpo,
    required Uint8List bytes,
    bool enviarJa = true,
  }) async {
    final id = _uuid.v4();
    final ref = await ficheiros.guardar(id, bytes);
    return _juntar(
      Acao(
        id: id,
        tipo: TipoAcao.ficheiro,
        descricao: descricao,
        alvo: alvo,
        metodo: 'POST',
        caminho: caminho,
        corpo: corpo,
        ficheiroRef: ref,
        criadaEm: _relogio(),
        dono: _dono(),
      ),
      enviarJa,
    );
  }

  Future<Acao> _juntar(Acao a, bool enviarJa) async {
    _acoes.add(a);
    await _guardar();
    notifyListeners();
    if (enviarJa) unawaited(enviar());
    return a;
  }

  /// Os bytes de uma fotografia ainda por enviar (para a mostrar).
  Future<Uint8List?> bytesDe(Acao a) async =>
      a.ficheiroRef == null ? null : ficheiros.ler(a.ficheiroRef!);

  Future<void> descartar(String id) async {
    final i = _acoes.indexWhere((a) => a.id == id);
    if (i < 0) return;
    final a = _acoes.removeAt(i);
    if (a.ficheiroRef != null) await ficheiros.apagar(a.ficheiroRef!);
    await _guardar();
    notifyListeners();
  }

  Future<void> tentarDeNovo(String id) async {
    for (final a in _acoes) {
      if (a.id == id) {
        a.estado = EstadoAcao.pendente;
        a.ultimoErro = null;
      }
    }
    await _guardar();
    notifyListeners();
    await enviar();
  }

  /// Tenta de [intervalo] em [intervalo] enquanto houver ações por enviar.
  void iniciar() {
    _temporizador?.cancel();
    _temporizador = Timer.periodic(_intervalo, (_) {
      if (_acoes.any((a) => _minha(a) && a.estado == EstadoAcao.pendente)) {
        unawaited(enviar());
      }
    });
  }

  /// Pára as tentativas periódicas (a app fechou).
  void parar() {
    _temporizador?.cancel();
    _temporizador = null;
  }

  @override
  void dispose() {
    parar();
    super.dispose();
  }

  /// Envia por ordem o que estiver pendente. Uma volta de cada vez.
  Future<ResultadoEnvio> enviar() {
    final emCurso = _aEnviar;
    if (emCurso != null) return emCurso;
    final f = _enviarTudo().whenComplete(() {
      _aEnviar = null;
      notifyListeners();
    });
    _aEnviar = f;
    notifyListeners();
    return f;
  }

  Future<ResultadoEnvio> _enviarTudo() async {
    var enviadas = 0;
    var falharam = 0;
    ultimaTentativa = _relogio();
    for (final a in List<Acao>.from(_acoes)) {
      if (a.estado != EstadoAcao.pendente || !_minha(a)) continue;
      if (api.token == null) {
        return ResultadoEnvio(enviadas: enviadas, falharam: falharam, semRede: true);
      }
      try {
        final resposta = await _enviarUma(a);
        _acoes.remove(a);
        if (a.ficheiroRef != null) await ficheiros.apagar(a.ficheiroRef!);
        enviadas++;
        ultimaFalhaRede = null;
        await _guardar();
        notifyListeners();
        aoEnviar?.call(a, resposta);
      } on SemRede catch (e) {
        a.tentativas++;
        ultimaFalhaRede = e.motivo;
        await _guardar();
        notifyListeners();
        return ResultadoEnvio(enviadas: enviadas, falharam: falharam, semRede: true);
      } on ErroApi catch (e) {
        a.tentativas++;
        a.ultimoErro = e.mensagem;
        if (e.transitorio || e.sessaoInvalida) {
          // Servidor indisponível, armazenamento por configurar, sessão a
          // renovar: fica pendente e pára (a ordem conta).
          ultimaFalhaRede = e.mensagem;
          await _guardar();
          notifyListeners();
          return ResultadoEnvio(enviadas: enviadas, falharam: falharam, semRede: true);
        }
        a.estado = EstadoAcao.falhou;
        falharam++;
        await _guardar();
        notifyListeners();
      }
    }
    return ResultadoEnvio(enviadas: enviadas, falharam: falharam);
  }

  Future<dynamic> _enviarUma(Acao a) async {
    if (a.tipo == TipoAcao.pedido) {
      final corpo = a.corpo == null ? null : Map<String, dynamic>.from(a.corpo!);
      a.usarResultados.forEach((campo, ids) {
        corpo?[campo] = [
          for (final id in ids)
            if (_resultados[id]?['foto_id'] != null) _resultados[id]!['foto_id'],
        ];
      });
      return api.pedido(a.metodo, a.caminho, corpo: corpo, chave: a.chave);
    }

    // Fotografia: 1) URL assinada (com a chave: repetir dá a mesma), 2) PUT.
    final bytes = await ficheiros.ler(a.ficheiroRef!);
    if (bytes == null) {
      throw ErroApi(410, 'ficheiro_perdido',
          'A fotografia já não está no telemóvel. Tire-a outra vez.');
    }
    a.intermedio ??= Map<String, dynamic>.from(
        await api.pedido('POST', a.caminho, corpo: a.corpo, chave: a.chave)
            as Map);
    await _guardar();
    final i = a.intermedio!;
    try {
      await api.enviarFicheiro(
        i['url_envio'] as String,
        ((i['cabecalhos'] as Map?) ?? const {}).cast<String, String>(),
        bytes,
      );
    } on ErroApi catch (e) {
      if (e.estado == 403 || e.estado == 400) {
        // URL expirada: na próxima volta pede outra (chave nova).
        a.intermedio = null;
        a.renovacoes++;
        throw ErroApi(503, 'url_expirada', 'A ligação de envio expirou; tenta-se outra vez.');
      }
      rethrow;
    }
    _resultados[a.id] = {'foto_id': i['foto_id']};
    return i;
  }
}
